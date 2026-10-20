# DB 자동 백업 · 복구 런북

운영 서버(사내 71번) Postgres의 자동 백업 정책과 복구 절차. 백업 주체는 compose의 `db-backup` 사이드카(`scripts/db-backup.sh`, `postgres:16-alpine` — db와 동일 이미지).

> 스택당 1회 준비(`BACKUP_DIR`·`BACKUP_RETENTION_DAYS` 결정, `.env` 사본 별도 보관)는 [`setup-once.md`](setup-once.md) A5·A6. 이 문서는 정책과 **복구 절차**를 다룬다.

## 1. 백업 정책

| 항목 | 값 |
|------|-----|
| 대상 | Postgres 전체 (`pg_dump -Fc`, 압축 custom 포맷) — 업로드 파일(KB 문서·인터뷰 첨부)도 DB에 저장되고 backend 컨테이너에는 디스크 영속이 없으므로, DB 덤프 하나로 앱 영속 상태 전부가 커버된다 |
| 주기 | 매일 **04:00 KST** 이후 하루 1회 + 컨테이너 기동 직후 오늘자 덤프가 없으면 즉시 1회(배포 베이스라인) + **온디맨드**(설정 > Batch jobs "Backup now" — §2.5) |
| 저장 위치 | 호스트 `${BACKUP_DIR}` (기본 `./backups`, 저장소 루트 기준) — git 추적 제외(`.gitignore`) |
| 파일명 | `bpm-YYYYMMDD-HHMMSS.dump` (KST 기준) |
| 보존 | `${BACKUP_RETENTION_DAYS}` (기본 14)일 초과분은 백업 성공 시마다 자동 삭제 |
| 무결성 | 덤프 직후 `pg_restore --list` 검증 통과 시에만 `.dump`로 확정 — 실패하면 `.tmp` 삭제 + FAIL 로그 + 1분 뒤 재시도(성공할 때까지) |
| 시간대 | alpine(musl)엔 zoneinfo가 없어 `TZ=KST-9`(POSIX 오프셋) 사용 — KST는 DST가 없어 안전 |

**한계(현재 단계)**: 백업이 같은 서버 디스크에만 있다 — 서버 디스크 장애·서버 유실 시 백업도 함께 잃는다. 오프서버 사본은 §5 후속.

**`.env`는 별도 수동 백업**: 시크릿 포함이라 git 밖 자산 — 서버 재구축에 필수이므로 안전한 별도 위치에 사본을 유지할 것.

## 2. 동작 확인 (배포 후 체크)

```bash
docker compose ps db-backup             # Up
docker compose logs --tail 5 db-backup  # "[db-backup] ... ok bpm-....dump (크기)"
ls -lh backups/                         # 일자별 덤프 누적
```

FAIL 로그가 반복되면 db 상태(`docker compose ps db`)와 `.env`의 `POSTGRES_*` 값을 확인한다.

앱에서도 확인 가능 — **설정 > Batch jobs 탭(sysadmin)**: 잡별(백업·인원동기화) 최근 시도 시각과
성공/실패, 최신 성공·실패 기록(`batch_job_runs` 테이블 — 사이드카가 psql로 기록, 스키마는
`backend/app/models.py` `BatchJobRun`과 계약).

## 2.5 온디맨드 백업 · 로컬 다운로드 (설정 > Batch jobs, sysadmin)

같은 탭의 **DB 백업 카드**에서:

- **Backup now** — 즉시 백업 1회. 서버(postgres)는 backend가 `${BACKUP_DIR}/requests/backup.request`
  트리거 파일을 쓰고, 사이드카(5초 폴링)가 지운 뒤 pg_dump를 수행한다(검증·기록·보존정리 동일).
  `requests/`는 사이드카가 기동할 때 `1777`로 만든다 — backend는 비root라 root 소유 백업 디렉터리에
  직접 못 쓴다(예전 경로는 서버에서 500이었다). 버튼이 "restart the db-backup service" 오류를 내면
  사이드카가 새 스크립트로 아직 안 뜬 것이다: `docker compose up -d --force-recreate db-backup`.
  로컬 네이티브(sqlite)는 backend가 sqlite backup API로 즉시 사본(`bpm-*.sqlite`)을 만든다.
- **백업 파일 목록·다운로드** — `${BACKUP_DIR}`의 `bpm-*.dump`/`bpm-*.sqlite`를 최신순으로 보여주고
  관리자 PC로 내려받을 수 있다(오프서버 사본을 수동으로 확보하는 경로).

전제: backend 컨테이너가 백업 디렉터리를 공유해야 한다 — compose가 `${BACKUP_DIR:-./backups}`를
backend `/backups`로 마운트(+`BACKUP_DIR=/backups` env). API는 `/api/admin/backups*` 3종, sysadmin 전용.

## 3. 복구 — 기존 스택에 덮어쓰기 복원

운영 DB를 특정 시점 덤프로 되돌린다. **파괴적 작업** — 현재 DB 내용이 덤프 시점으로 교체된다.

**빈 스키마에 한 트랜잭션으로 복원한다.** 예전 절차의 `pg_restore --clean --if-exists`(덮어쓰기)는
덤프 뒤 배포에서 생긴 테이블의 FK가 핵심 테이블 드랍을 막아, 오류를 무시한 채 `exit 1`로 끝나고
일부 테이블은 현재 값·일부는 덤프 값인 **섞인 DB**를 남겼다(리뷰 2026-10-19 H-1, postgres 16 재현:
오류 5건, 맵 이름은 현재 값·노드는 덤프 값). 아래 절차는 같은 조건에서 `exit 0`·덤프와 동일한 DB를 만들고,
덤프가 깨졌으면 아무것도 쓰지 않고 `exit 1`로 끝난다. 읽기전용 계정(`dbviewer_ro`) 권한은 덤프에 함께
들어 있어 복원 뒤에도 유지된다.

```bash
cd <저장소 루트>
DUMP=backups/bpm-YYYYMMDD-HHMMSS.dump    # backups/ 목록에서 고른다
PGU=${POSTGRES_USER:-processmap}; PGD=${POSTGRES_DB:-processmap}
docker compose stop backend frontend     # 쓰기 중단 (db는 유지, 그동안 앱은 502)

# 1) 안전망 — 지금 DB를 먼저 덤프한다. 복원이 실패하면 이 파일로 되돌린다
SAFETY=backups/pre-restore-$(date +%Y%m%d-%H%M%S).dump
docker compose exec -T db pg_dump -U $PGU -Fc $PGD > $SAFETY && ls -lh $SAFETY

# 2) 빈 스키마로 비운다
docker compose exec -T db psql -U $PGU -d $PGD -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 3) 한 트랜잭션으로 복원 — 오류가 하나라도 나면 전부 취소하고 exit 1
docker compose exec -T db pg_restore -U $PGU -d $PGD --no-owner --exit-on-error --single-transaction < $DUMP
echo "exit=$?"                           # 0이 아니면 4)로 가지 말고 아래 "실패하면"을 따른다

# 4) 기동 — backend가 덤프 뒤에 생긴 테이블·컬럼을 create_all·자동 ALTER로 다시 붙인다
docker compose start backend frontend
curl -s http://localhost:9900/api/health   # {"status":"ok"}
docker compose exec db psql -U $PGU -d $PGD -c "SELECT count(*) FROM process_maps;"
```

**실패하면(3의 exit가 0이 아님)**: 스키마는 빈 상태로 남는다(부분 복원 없음). 앱을 띄우지 말고 2)·3)을
`DUMP=$SAFETY`로 다시 실행해 복원 직전 상태로 되돌린 뒤 4)로 기동하고, 덤프 파일을 다른 날짜로 골라 다시 시도한다.

> `pre-restore-*.dump`는 사이드카의 보존 정리 대상(`bpm-*.dump`)이 아니라 자동으로 지워지지 않는다 — 복구가 끝나면 수동으로 정리한다.

## 4. 복구 — 신규 서버 / 볼륨 유실 시

저장소 + `.env` 사본 + 백업 덤프를 새 서버로 복사한 뒤:

```bash
docker compose up -d db                 # db만 먼저 기동(빈 DB 생성)
docker compose exec db pg_isready -U ${POSTGRES_USER:-processmap}   # ready까지 대기
docker compose exec -T db pg_restore -U ${POSTGRES_USER:-processmap} -d ${POSTGRES_DB:-processmap} \
  --no-owner --exit-on-error --single-transaction < backups/bpm-YYYYMMDD-HHMMSS.dump
echo "exit=$?"                          # 0이 아니면 다른 덤프로 다시 — 빈 DB라 반복해도 안전
docker compose up -d --build            # 나머지 기동 — backend create_all은 기존 테이블을 건드리지 않음
```

## 5. 오프서버 사본 (후속 단계)

현재 결정(2026-08-27): 1단계는 서버 디스크만. 확장 경로 —

- **NAS 마운트가 생기면**: `.env`의 `BACKUP_DIR`만 그 경로로 바꾸면 끝(코드 무변경).
- **타 서버 전송이면**: `scripts/db-backup.sh`의 백업 성공 지점에 scp/rsync 단계를 추가(SSH 키 준비 필요).
