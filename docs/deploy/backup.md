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

- **Backup now** — 즉시 백업 1회. 서버(postgres)는 backend가 `${BACKUP_DIR}/backup.request`
  트리거 파일을 쓰고, 사이드카(5초 폴링)가 지운 뒤 pg_dump를 수행한다(검증·기록·보존정리 동일).
  로컬 네이티브(sqlite)는 backend가 sqlite backup API로 즉시 사본(`bpm-*.sqlite`)을 만든다.
- **백업 파일 목록·다운로드** — `${BACKUP_DIR}`의 `bpm-*.dump`/`bpm-*.sqlite`를 최신순으로 보여주고
  관리자 PC로 내려받을 수 있다(오프서버 사본을 수동으로 확보하는 경로).

전제: backend 컨테이너가 백업 디렉터리를 공유해야 한다 — compose가 `${BACKUP_DIR:-./backups}`를
backend `/backups`로 마운트(+`BACKUP_DIR=/backups` env). API는 `/api/admin/backups*` 3종, sysadmin 전용.

## 3. 복구 — 기존 스택에 덮어쓰기 복원

운영 DB를 특정 시점 덤프로 되돌린다. **파괴적 작업** — 현재 DB 내용이 덤프 시점으로 교체된다.

```bash
cd <저장소 루트>
docker compose stop backend frontend    # 쓰기 중단 (db는 유지, 그동안 앱은 502)
# --clean --if-exists: 기존 객체 드랍 후 재생성. 파일명은 backups/ 목록에서 선택
docker compose exec -T db pg_restore -U ${POSTGRES_USER:-processmap} -d ${POSTGRES_DB:-processmap} \
  --clean --if-exists --no-owner < backups/bpm-YYYYMMDD-HHMMSS.dump
docker compose start backend frontend
curl -s http://localhost:9900/api/health   # {"status":"ok"}
# 내용 확인: 브라우저 접속 또는
docker compose exec db psql -U ${POSTGRES_USER:-processmap} -d ${POSTGRES_DB:-processmap} -c "SELECT count(*) FROM maps;"
```

## 4. 복구 — 신규 서버 / 볼륨 유실 시

저장소 + `.env` 사본 + 백업 덤프를 새 서버로 복사한 뒤:

```bash
docker compose up -d db                 # db만 먼저 기동(빈 DB 생성)
docker compose exec db pg_isready -U ${POSTGRES_USER:-processmap}   # ready까지 대기
docker compose exec -T db pg_restore -U ${POSTGRES_USER:-processmap} -d ${POSTGRES_DB:-processmap} \
  --no-owner < backups/bpm-YYYYMMDD-HHMMSS.dump
docker compose up -d --build            # 나머지 기동 — backend create_all은 기존 테이블을 건드리지 않음
```

## 5. 오프서버 사본 (후속 단계)

현재 결정(2026-08-27): 1단계는 서버 디스크만. 확장 경로 —

- **NAS 마운트가 생기면**: `.env`의 `BACKUP_DIR`만 그 경로로 바꾸면 끝(코드 무변경).
- **타 서버 전송이면**: `scripts/db-backup.sh`의 백업 성공 지점에 scp/rsync 단계를 추가(SSH 키 준비 필요).
