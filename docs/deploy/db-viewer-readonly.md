# db-viewer 읽기전용 조회 연결 런북 (9910 검증 → 운영)

같은 71번 서버에 떠 있는 **db-viewer**(스키마 탐색·ERD·행 미리보기 도구, `:6678`)에서 이 앱의
PostgreSQL을 **읽기 전용**으로 조회하기 위한 절차. 앱 소스코드는 바뀌지 않는다 — 바뀌는 것은
`docker-compose.yml`의 네트워크 항목과 `.env` 두 줄, 그리고 DB 안의 읽기전용 계정뿐이다.

그림으로 먼저 보려면 [`db-viewer-readonly.html`](db-viewer-readonly.html)(브라우저에서 열기).
db-viewer 쪽 원본 런북은 그 저장소의 `docs/connect-sources.md`·`docs/handoff/service-owner-prompt.md`.

> 이 문서는 **9910 검증 스택에서 먼저 리허설**하고(§2~§6), 통과하면 같은 절차를 운영 9900에
> 값만 바꿔 반복한다(§7). 운영 DB는 리허설 동안 일절 건드리지 않는다.

---

## 1. 무엇이 어떻게 연결되나

| 항목 | 값(검증 9910) | 값(운영 9900) |
|---|---|---|
| 전용 브리지 네트워크 | `dbv-bpm9910` (`10.203.1.0/24`) | `dbv-bpm` (`10.203.0.0/24`) |
| db 컨테이너 별칭(= db-viewer가 입력할 host) | `bpm9910-db` | `bpm-db` |
| compose 프로젝트 / db 컨테이너 | `bpm-9910` / `bpm-9910-db-1` | `business-process-mgmt` / `business-process-mgmt-db-1` |
| `.env` 키 | `DBV_NETWORK=dbv-bpm9910` · `DBV_DB_ALIAS=bpm9910-db` | `DBV_NETWORK=dbv-bpm` · `DBV_DB_ALIAS=bpm-db` |
| 읽기전용 계정 | `dbviewer_ro` | `dbviewer_ro` |

**방식(B′ — 서비스당 전용 네트워크).** 스택마다 전용 브리지 네트워크를 *compose 밖에서* 만들고,
그 네트워크에 **db-viewer backend와 이 스택의 db 컨테이너 둘만** 넣는다.

- 기존 `default` 네트워크(운영 172.36, 9910은 별도 대역)는 **한 줄도 안 바뀐다** — db는 두 네트워크에
  동시에 속하고, backend·db-backup은 예전처럼 `default`로 db를 찾는다.
- db-viewer는 별칭(`bpm-db`)으로만 접속한다. 여러 서비스가 `db`/`postgres` 같은 흔한 컨테이너명을 쓰므로
  별칭이 스택마다 달라야 엉뚱한 DB에 붙는 사고를 막는다 — 운영과 9910을 env로 가르는 이유.
- 네트워크가 어느 compose에도 속하지 않아 이 스택이 `down` 돼도 db-viewer 기동엔 영향이 없다.
- 호스트 포트를 새로 여는 것이 아니다(`5432` 노출 없음). 같은 브리지 안에서만 닿는다.

**compose에 이미 반영된 것**(dev 브랜치, 이 문서와 같은 커밋):

```yaml
services:
  db:
    networks:
      default:                              # 기존 자동 연결을 명시로 승격 — 빠뜨리면 backend가 db를 못 찾는다
      dbv:
        aliases: ["${DBV_DB_ALIAS:-bpm-db}"]
networks:
  dbv:
    external: true
    name: ${DBV_NETWORK:-dbv-bpm}
```

⚠️ **external 네트워크는 `up` 전에 존재해야 한다.** 이 compose를 올리는 모든 스택(운영 포함)에서
§2-1의 `docker network create`를 먼저 1회 실행한다. 없으면 `network dbv-bpm declared as external, but
could not be found`로 `up`이 실패한다 — 만들고 다시 `up` 하면 된다(데이터 무관).

---

## 2. 사전 준비 (db-viewer 운영자 = 본인)

### 2-1. 전용 네트워크 생성 (서버, 1회)

```bash
docker network ls | grep -E "dbv-|172"                        # 이름 충돌 확인
docker network create --subnet 10.203.1.0/24 dbv-bpm9910      # 검증 9910
# 운영 승격 때:  docker network create --subnet 10.203.0.0/24 dbv-bpm
```

`10.203.<n>.0/24`는 사설 대역(RFC1918)이면서 기존 서비스 대역(172.36~46)·db-viewer 자신의 대역(172.48.0.0/16)과 겹치지 않는 값(서버 실측 2026-09-11 — db-viewer 런북의 172.50은 공인 대역이라 쓰지 않는다).
**주의**: 브리지 서브넷은 그 대역으로 가는 라우트를 컨테이너 안에서 가로챈다 — 사내망에 실제 10.203.<n>.x 호스트(AD·n8n·AI 등)가 있으면 db-viewer backend가 거기에 못 붙는다. `ip route | grep 10.203`과 db-viewer `.env`의 주소들로 충돌이 없는지 먼저 본다.
`Pool overlaps with other one on this address space`가 나면 `<n>`을 바꾼다.

### 2-2. db-viewer 쪽 전제 확인

```bash
cd <db-viewer 디렉터리>
grep -n SOURCE_SECRET_KEY .env                          # 비어 있으면 소스 등록 API가 503
docker compose logs backend | grep -i "Running upgrade" | tail -3   # 0015(data_sources) 이상이어야 소스 등록 화면이 뜬다
```

- `SOURCE_SECRET_KEY`가 비어 있으면 생성해 채우고 backend를 재기동한다(최초 1회, 이후 교체 금지):
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- 서버 db-viewer가 멀티 소스 이전 버전(0014 이하)이면 먼저 db-viewer를 최신으로 배포한다(그쪽 런북 §6.3 —
  alembic 로그를 눈으로 확인).

---

## 3. 이 스택(9910) 사전 확인 — 데이터 손실 방지

이 작업은 db 컨테이너를 **1회 재생성**한다. 데이터가 named volume(`pgdata`)에 있으면 무손실이다.

```bash
docker inspect -f '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' bpm-9910-db-1
# 기대: volume bpm-9910_pgdata -> /var/lib/postgresql/data
```

출력이 비어 있으면 **중단** — 재생성만으로 데이터가 사라지는 상태다(compose에 `pgdata`가 선언돼 있어
정상이면 반드시 보인다). 운영 승격 때는 직전 백업 덤프(`backups/bpm-*.dump`)가 오늘 자로 있는지도 본다.

---

## 4. compose 반영 — `up -d db` (down 금지)

```bash
cd ~/bpm-dev && git fetch && git checkout origin/dev          # 이 커밋 이상
DC910="docker compose -p bpm-9910 --env-file .env.9910"

# .env.9910 에 두 줄 추가
printf 'DBV_NETWORK=dbv-bpm9910\nDBV_DB_ALIAS=bpm9910-db\n' >> .env.9910

$DC910 config | grep -n -A3 "aliases"                         # bpm9910-db 가 보이는지 (보간 확인)
$DC910 up -d db                                               # db 컨테이너만 in-place 재생성 (수 초)
$DC910 restart backend                                        # 풀에 남은 구 DB 연결 정리
```

- **`docker compose down`은 쓰지 않는다** — 네트워크까지 지워 같은 스택의 다른 서비스가 영향을 받는다.
- backend 재시작 이유: `create_async_engine`에 `pool_pre_ping`이 없어 db 재생성 직후 풀의 구 연결로
  한두 요청이 실패할 수 있다. 조용한 시간대에 하고 재시작으로 깔끔히 끊는다. db-backup은 psql 단발 호출이라 불필요.

✅ 통과 기준:

```bash
docker inspect -f '{{json .NetworkSettings.Networks}}' bpm-9910-db-1 | python3 -m json.tool | grep -E '"(bpm-9910_default|dbv-bpm9910)"|Aliases' -A1
# → 두 네트워크가 모두 있고 dbv-bpm9910 의 Aliases 에 bpm9910-db 가 있다
docker network inspect bpm-9910_default -f '{{json .IPAM.Config}}'    # subnet 무변경
$DC910 ps                                                             # db healthy · backend Up
curl -s http://localhost:9910/api/health                              # {"status":"ok"}
```

---

## 5. 읽기전용 계정 발급 (db 컨테이너 안)

```bash
$DC910 exec db psql -U processmap -d processmap
```

```sql
-- 비밀번호는 직접 생성: openssl rand -base64 24
CREATE ROLE dbviewer_ro LOGIN PASSWORD '<강력한 비밀번호>';

GRANT CONNECT ON DATABASE processmap TO dbviewer_ro;
GRANT USAGE ON SCHEMA public TO dbviewer_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbviewer_ro;

-- 앞으로 startup create_all 이 만드는 새 테이블에도 자동 적용 — 없으면 릴리스마다 새 테이블이 안 보인다
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbviewer_ro;

-- 민감 테이블 제외 (권장): 로컬 계정 비밀번호 해시 · 로그인 기록 · AI/인터뷰 원문 · KB 문서 본문
REVOKE SELECT ON local_credentials, login_records,
                 ai_chat_messages, interview_messages, interview_attachments,
                 kb_documents, kb_chunks
  FROM dbviewer_ro;
```

이 앱의 테이블(43개)은 전부 `public` 스키마라 다른 스키마 GRANT는 필요 없다. db-viewer 쪽 허용 목록은
스키마 단위(`public` 통째)라 **테이블 단위 차단은 이 REVOKE로만** 걸린다 — 제외 목록은 필요에 맞게 조정.
`ALTER DEFAULT PRIVILEGES`는 실행한 롤(`processmap`)이 만드는 테이블에만 적용되며, 이 앱은 그 롤로
`create_all`을 돌리므로 조건이 맞는다.

✅ 통과 기준 — 다른 세션에서:

```bash
$DC910 exec db psql -U dbviewer_ro -d processmap -c "SELECT count(*) FROM process_maps;"   # 숫자
$DC910 exec db psql -U dbviewer_ro -d processmap -c "CREATE TABLE zzz_probe (id int);"     # ERROR: permission denied
$DC910 exec db psql -U dbviewer_ro -d processmap -c "SELECT count(*) FROM local_credentials;" # ERROR: permission denied (REVOKE 했다면)
```

---

## 6. db-viewer 쪽 합류 + 등록

### 6-1. db-viewer compose에 네트워크 추가 (그 저장소)

```yaml
services:
  backend:
    networks: [dbviewer, dbv-bpm9910]      # 운영 승격 시 dbv-bpm 추가 (둘 다 나열 가능)
networks:
  dbv-bpm9910: { external: true }
```

```bash
cd <db-viewer 디렉터리>
docker compose up -d --build backend
docker compose logs backend | grep -i alembic | tail -3       # 오류 없이 head 까지
curl -s http://localhost:6678/api/health                      # {"status":"ok"}
docker compose exec backend python -c "import socket; print(socket.gethostbyname('bpm9910-db'))"   # 10.203.1.x
```

### 6-2. `/admin` 소스 패널에서 등록 → 테스트 → 수집 → 허용

1. **등록** — 이름 `BPM (9910)`, 엔진 `postgres`, host `bpm9910-db`, port `5432`, database `processmap`,
   username `dbviewer_ro`, password(§5). 저장 후 목록에 `has_password: true`.
2. **[연결 테스트]** — 응답의 `database`가 **`processmap`**, `version`이 PostgreSQL 16인지 **눈으로 대조**.
   별칭이 틀려도 "어떤" postgres에는 붙어 초록으로 뜰 수 있는 것이 이 방식의 유일한 함정이다.
3. **[카탈로그 수집]** — 진행 패널에서 스냅샷 `ready`.
4. **미리보기 허용 스키마**에 이 소스의 `public` 등록(`PREVIEW_ADMIN_PASSWORD` 필요). 등록 전에는 값이
   전혀 안 열린다(기본 전부 차단).

✅ 통과 기준: 브라우저에서 소스를 고른 뒤 `process_maps` 미리보기에 행이 보이고, `local_credentials`는
권한 오류(REVOKE 반영)로 안 열린다.

---

## 7. 운영(9900) 승격 — 9910 통과 후

값만 바꿔 §2-1 → §3 → §4 → §5 → §6을 반복한다.

```bash
docker network create --subnet 10.203.0.0/24 dbv-bpm
cd <운영 디렉터리>            # 프로젝트 business-process-mgmt
git fetch && git checkout <9910에서 검증한 dev와 같은 내용의 main 커밋>
printf 'DBV_NETWORK=dbv-bpm\nDBV_DB_ALIAS=bpm-db\n' >> .env
docker compose up -d db && docker compose restart backend
docker inspect -f '{{json .NetworkSettings.Networks}}' business-process-mgmt-db-1     # default + dbv-bpm
```

db-viewer compose에는 `dbv-bpm`을 **추가로** 나열하고(`dbv-bpm9910`은 검증 스택 폐기 시 제거),
`/admin`에 `BPM (운영)` 소스를 따로 등록한다(host `bpm-db`).

**운영 배포 체크리스트에 추가된 항목** — 이 커밋 이후 운영 `docker compose up`은 `dbv-bpm` 네트워크가
있어야 성공한다. 서버 재구축 시 §2-1을 [`setup-once.md`](setup-once.md) A9로 다시 밟는다.

---

## 8. 되돌리기 · 트러블슈팅

**`docker compose down -v` 이후(검증 스택에서 흔함)** — 네트워크는 남고 계정은 사라진다.

- `dbv-*`는 `external`이라 `down`이 지우지 않는다(compose는 자기가 만든 `*_default`만 지운다). 다음 `up`은 그대로 된다.
- `-v`로 `pgdata`가 지워지면 **`dbviewer_ro` 롤과 권한도 함께 사라진다**. 운영 덤프를 복원해도 돌아오지 않는다(`pg_dump`는 롤을 담지 않는다). 복원 직후 §5 SQL을 다시 실행한다 — 파일로 두고 한 줄로:
  ```bash
  docker compose -p bpm-9910 --env-file .env.9910 exec -T db psql -U processmap -d processmap < dbviewer-ro.sql
  ```
  db-viewer 쪽 소스 등록은 그대로 유효하다(재등록 불필요) — 계정만 살리면 연결 테스트가 다시 초록이 된다.
- `docker network prune`은 다르다 — 붙은 컨테이너가 하나도 없는 네트워크를 지운다. bpm과 db-viewer를 둘 다 내린 상태에서 돌리면 `dbv-*`가 사라지고 다음 `up`이 `not found`로 실패한다 → §2-1로 다시 만든다.

**연결 해제**: db-viewer `/admin`에서 소스 비활성화(또는 스냅샷·정책 정리 후 삭제) → db-viewer compose에서
네트워크 제거 후 `up -d backend` → 이 스택에서 `DROP ROLE dbviewer_ro`(먼저 `REASSIGN`/`DROP OWNED` 불필요 —
소유 객체 없음). compose의 `dbv` 합류를 빼려면 코드 revert 후 `up -d db`.

| 증상 | 확인 |
|---|---|
| `network dbv-bpm9910 declared as external, but could not be found` | §2-1 `docker network create` 누락 — 만들고 다시 `up` |
| db 재생성 후 backend가 `db` 를 못 찾음 / 502 | compose `db.networks`에 `default:`가 빠졌다 — 이 커밋의 compose 그대로인지 확인 |
| backend 로그 `ConnectionDoesNotExistError` 몇 건 | db 재생성 직후 풀의 구 연결 — `restart backend` (§4) |
| `Pool overlaps with other one on this address space` | `10.203.<n>`이 이미 사용 중 — 다른 `<n>` |
| 연결 테스트 초록인데 `database`가 다른 이름 | 별칭 오타·다른 서비스 별칭 — host를 `bpm9910-db`/`bpm-db`로 |
| 연결 테스트 502 | 별칭 해석 실패(6-1의 `gethostbyname`으로 확인)·비밀번호 오류·db-viewer backend가 네트워크에 안 붙음 |
| 연결 테스트 503 | db-viewer `SOURCE_SECRET_KEY` 미설정/불일치 (§2-2) |
| 소스 등록 폼 자체가 안 뜸 | db-viewer가 0015 이전 버전 (§2-2) |
| 미리보기가 비어 있음 | 허용 스키마 미등록 (§6-2 4단계) 또는 REVOKE 한 테이블 |
| 새 릴리스 후 신규 테이블이 db-viewer에 없음 | `ALTER DEFAULT PRIVILEGES` 누락 (§5) — 실행 후 카탈로그 재수집 |
