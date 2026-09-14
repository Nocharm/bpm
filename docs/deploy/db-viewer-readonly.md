# db-viewer 읽기전용 조회 연결 (서버 수작업분)

같은 71번 서버의 **db-viewer**(스키마 탐색·ERD·행 미리보기, `:6678`)가 이 앱의 PostgreSQL을
**읽기 전용**으로 조회하기 위한 절차. 앱 코드는 바뀌지 않는다 — 저장소에 이미 반영된 것은
`docker-compose.yml`의 네트워크 항목 한 덩어리뿐이고, **나머지는 사람이 서버에서 한 번 실행해야 하는
작업**이라 이 문서에 모았다.

db-viewer 쪽 원본 런북(연결 방식·네트워크 정책·트러블슈팅 총괄)은 그 저장소의
`docs/connect-sources.md` · `docs/handoff/service-owner-prompt.md`. 여기는 **BPM 스택에서 밟는 부분**만 적는다.

---

## 0. 저장소가 한 것 / 사람이 할 것

| | 무엇 | 어디서 |
|---|---|---|
| ✅ 반영됨 | db 컨테이너의 `dbv-shared` 합류 + 스택별 별칭(`DBV_DB_ALIAS`) | `docker-compose.yml` · `.env.example` |
| ⬜ 수작업 | 공유 네트워크 `dbv-shared` 존재 확인(없으면 생성) | 서버 — §2 |
| ⬜ 수작업 | db 컨테이너 볼륨 사전 확인 | 서버 — §3 |
| ⬜ 수작업 | `up -d db` + `restart backend`로 반영 | 서버 — §4 |
| ⬜ 수작업 | 읽기전용 계정 `dbviewer_ro` 발급(민감 테이블 REVOKE 포함) | 서버 psql — §5 |
| ⬜ 수작업 | db-viewer `/admin`에 소스 등록 → 연결 테스트 → 수집 → 미리보기 허용 | db-viewer 화면 — §6 |

§2~§6은 **스택마다 한 번씩** 밟는다(검증 9910 → 운영 9900). 앱을 재배포해도 반복하지 않는다.

## 1. 스택별 값

| 항목 | 검증 9910 | 운영 9900 |
|---|---|---|
| 공유 브리지 | `dbv-shared` (`10.203.0.0/24`) | 같음 |
| db 별칭(= db-viewer가 host로 입력) | `bpm9910-db` | `bpm-db` |
| compose 프로젝트 / db 컨테이너 | `bpm-9910` / `bpm-9910-db-1` | `business-process-mgmt` / `business-process-mgmt-db-1` |
| `.env` 키 | `DBV_DB_ALIAS=bpm9910-db` | 기본값(`bpm-db`) — 적지 않아도 됨 |
| 읽기전용 계정 | `dbviewer_ro` | `dbviewer_ro` |

**왜 별칭이 스택마다 달라야 하나.** 공유 네트워크에는 여러 서비스의 DB가 함께 있고 컨테이너명은
`db`/`postgres`처럼 흔하다. 별칭이 겹치면 db-viewer가 **엉뚱한 DB에 붙고도 연결 테스트는 초록으로 뜬다** —
이 방식의 유일한 함정이라 §6-2에서 DB명을 눈으로 대조한다.

기존 `default` 네트워크(운영 172.36 · 9910 172.44)는 한 줄도 바뀌지 않는다. db는 두 네트워크에 동시에
속하고, backend·db-backup은 예전처럼 `default`로 db를 찾는다. 호스트 포트를 새로 여는 것이 아니다
(`5432` 미노출) — 같은 브리지 안에서만 닿는다.

## 2. 공유 네트워크 확인 (없으면 생성)

⚠️ **external 네트워크는 `up` 전에 존재해야 한다.** 이 커밋 이후 `docker compose up`은 `dbv-shared`가
없으면 `network dbv-shared declared as external, but could not be found`로 **실패한다**(데이터는 무관 —
만들고 다시 `up` 하면 된다).

```bash
docker network inspect dbv-shared -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # 10.203.0.0/24
# 없으면 (db-viewer 운영자 = 본인, 서버 전체에서 1회):
docker network create --subnet 10.203.0.0/24 dbv-shared
```

db-viewer backend는 이 네트워크에 **상시 합류**해 있다(그 저장소 `docker-compose.yml`) — 그쪽 compose는
더 고칠 것이 없다.

## 3. 볼륨 사전 확인 — 유일한 데이터 손실 지점

§4는 db 컨테이너를 **1회 재생성**한다. 데이터가 named volume에 있으면 무손실이다.

```bash
docker inspect -f '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' business-process-mgmt-db-1
# 기대: volume business-process-mgmt_pgdata -> /var/lib/postgresql/data   (9910은 bpm-9910_pgdata)
```

출력이 비면 **중단**. 운영에서는 오늘 자 덤프(`backups/bpm-*.dump`)가 있는지도 함께 본다
([`backup.md`](backup.md) §2).

## 4. 반영 — `up -d db` (down 금지)

```bash
cd <배포 디렉터리> && git pull
docker compose config | grep -n -A2 aliases     # bpm-db(9910이면 bpm9910-db)로 보간됐는지
docker compose up -d db                         # db만 in-place 재생성 (수 초)
docker compose restart backend                  # 풀에 남은 구 DB 연결 정리
```

- **`docker compose down`은 쓰지 않는다** — 네트워크까지 지워 같은 스택의 다른 서비스가 영향을 받는다.
- backend 재시작 이유: `create_async_engine`에 `pool_pre_ping`이 없어 db 재생성 직후 풀의 구 연결로
  한두 요청이 실패할 수 있다. 조용한 시간대에 하고 재시작으로 깔끔히 끊는다. db-backup은 psql 단발
  호출이라 불필요.
- 9910 스택은 `docker compose -p bpm-9910 --env-file .env.9910 …` 형태로(스택 분리 규칙:
  [`setup-once.md`](setup-once.md) A7), `.env.9910`에 `DBV_DB_ALIAS=bpm9910-db` 한 줄을 먼저 넣는다.

✅ 통과 기준:

```bash
docker inspect -f '{{json .NetworkSettings.Networks}}' business-process-mgmt-db-1 | python3 -m json.tool | grep -E '"(business-process-mgmt_default|dbv-shared)"|Aliases' -A1
docker compose ps                                 # db healthy · backend Up
curl -s http://localhost:9900/api/health          # {"status":"ok"}
```

## 5. 읽기전용 계정 `dbviewer_ro`

```bash
# 컨테이너를 직접 지정한다 — compose exec는 프로젝트명(-p)·--env-file 조합이 어긋나면 자주 실패한다(실측).
DB=business-process-mgmt-db-1        # 9910 스택이면 bpm-9910-db-1
docker exec -it $DB psql -U processmap -d processmap
```

```sql
-- 비밀번호는 직접 생성: openssl rand -base64 24
CREATE ROLE dbviewer_ro LOGIN PASSWORD '<강력한 비밀번호>';

GRANT CONNECT ON DATABASE processmap TO dbviewer_ro;
GRANT USAGE ON SCHEMA public TO dbviewer_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbviewer_ro;

-- 앞으로 startup create_all 이 만드는 새 테이블에도 자동 적용 — 없으면 릴리스마다 새 테이블이 안 보인다
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbviewer_ro;

-- 민감 테이블 제외(권장): 로컬 계정 비밀번호 해시 · 로그인 기록 · AI/인터뷰 원문 · KB 문서 본문
REVOKE SELECT ON local_credentials, login_records,
                 ai_chat_messages, interview_messages, interview_attachments,
                 kb_documents, kb_chunks
  FROM dbviewer_ro;
```

이 앱의 테이블(43개)은 전부 `public` 스키마라 다른 스키마 GRANT는 필요 없다. db-viewer의 허용 목록은
**스키마 단위**(`public` 통째)라 테이블 단위 차단은 이 REVOKE로만 걸린다 — 제외 목록은 필요에 맞게 조정.
`ALTER DEFAULT PRIVILEGES`는 실행한 롤(`processmap`)이 만드는 테이블에만 적용되며, 이 앱은 그 롤로
`create_all`을 돌리므로 조건이 맞는다.

위 SQL은 `dbviewer-ro.sql`로 저장해 두면 재실행이 한 줄이다(§7의 볼륨 삭제 복구에 쓴다):

```bash
docker exec -i $DB psql -U processmap -d processmap < dbviewer-ro.sql   # 파이프 입력은 -i만 (-t 금지)
```

✅ 통과 기준 — 별도 세션에서:

```bash
docker exec -i $DB psql -U dbviewer_ro -d processmap -c "SELECT count(*) FROM process_maps;"      # 숫자
docker exec -i $DB psql -U dbviewer_ro -d processmap -c "CREATE TABLE zzz_probe (id int);"        # permission denied
docker exec -i $DB psql -U dbviewer_ro -d processmap -c "SELECT count(*) FROM local_credentials;" # permission denied
```

## 6. db-viewer `/admin` 등록

1. **등록** — 이름 `BPM (운영)`(9910이면 `BPM (9910)`), 엔진 `postgres`, host `bpm-db`/`bpm9910-db`,
   port `5432`, database `processmap`, username `dbviewer_ro`, password(§5).
   저장 후 목록에 `has_password: true`. 폼이 아예 안 뜨면 db-viewer의 `SOURCE_SECRET_KEY` 미설정이다.
2. **[연결 테스트]** — 응답의 `database`가 **`processmap`**, `version`이 PostgreSQL 16인지 **눈으로 대조**.
   초록인데 DB명이 다르면 별칭이 다른 서비스와 겹친 것 — host를 고친다.
3. **[카탈로그 수집]** — 진행 패널에서 스냅샷이 `ready`로 끝나는지.
4. **미리보기 허용 스키마**에 이 소스의 `public` 등록(db-viewer의 `PREVIEW_ADMIN_PASSWORD` 필요).
   등록 전에는 값이 전혀 안 열린다(기본 전부 차단).

> 등록 폼에는 비밀번호 칸이 두 군데다 — 위쪽은 db-viewer의 `PREVIEW_ADMIN_PASSWORD`, 폼 안쪽이
> `dbviewer_ro`의 비밀번호다.

✅ 통과 기준: 소스를 고른 뒤 `process_maps` 미리보기에 행이 보이고, `local_credentials`는 권한 오류로
안 열린다(REVOKE 반영).

## 7. 되돌리기 · 트러블슈팅

**연결 해제**: db-viewer `/admin`에서 소스 비활성화(또는 스냅샷·정책 정리 후 삭제) → 이 스택에서
`DROP ROLE dbviewer_ro`. compose 합류까지 빼려면 `docker-compose.yml`의 `dbv` 항목을 되돌리고 `up -d db`.

**`docker compose down -v` 이후(검증 스택에서 흔함)** — `dbv-shared`는 `external`이라 남지만,
`pgdata`가 지워지면 **`dbviewer_ro` 롤과 권한도 함께 사라진다**. 운영 덤프를 복원해도 돌아오지 않는다
(`pg_dump`는 롤을 담지 않는다) → §5 SQL 재실행. db-viewer 쪽 소스 등록은 그대로 유효하다.

| 증상 | 확인 |
|---|---|
| `network dbv-shared declared as external, but could not be found` | §2 — 네트워크가 없거나 `docker network prune`으로 지워졌다. 만들고 다시 `up` |
| db 재생성 후 backend가 db를 못 찾음 / 502 | compose `db.networks`에서 `default:`가 빠졌다(명시하는 순간 자동 연결이 사라진다) |
| backend 로그 `ConnectionDoesNotExistError` 몇 건 | db 재생성 직후 풀의 구 연결 — `restart backend`(§4) |
| 연결 테스트 초록인데 `database`가 다른 이름 | 별칭 충돌·오타 — host를 `bpm-db`/`bpm9910-db`로(§1) |
| 연결 테스트 502 | 별칭 해석 실패·비밀번호 오류. db-viewer에서 `docker exec -i dbviewer-backend-1 python -c "import socket; print(socket.gethostbyname('bpm-db'))"`(컨테이너명은 `docker ps`로 확인) → `10.203.0.x` |
| 연결 테스트 503 | db-viewer `SOURCE_SECRET_KEY` 미설정/불일치 — 그쪽 런북 |
| 미리보기가 비어 있음 | 허용 스키마 미등록(§6-4) 또는 REVOKE 한 테이블 |
| 새 릴리스 후 신규 테이블이 안 보임 | `ALTER DEFAULT PRIVILEGES` 누락(§5) — 실행 후 카탈로그 재수집 |
