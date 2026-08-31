# 서버 배포 런북 (docker-compose)

로컬에서 검증한 코드를 서버(사내 71번)로 옮겨 docker-compose로 올리는 절차. 파이프라인 전체는 `CLAUDE.md` Operations 참고.

> **최초 1회 셋업은 [`setup-once.md`](setup-once.md)로 분리했다** — Keycloak 클라이언트 등록, AD/LDAP 인프라, n8n 웹훅, 시크릿 발급, 서브넷 분리, 릴리스별 1회 보정까지. 이 문서는 **매 배포마다 반복하는 절차**를 다룬다.

## 0. 전제조건

- 서버에 Docker / Docker Compose v2 설치 → [`setup-once.md`](setup-once.md) A1
- 코드 전송 완료(scp 또는 gitlab pull) — 줄바꿈은 `.gitattributes`로 LF 고정되어 Windows 경유해도 안전
- Keycloak public 클라이언트 등록 + 인증/AD 인프라 확인 → 아래 §1

## 1. Keycloak 클라이언트 + AD 사전 준비 (최초 1회)

**→ [`setup-once.md`](setup-once.md) A2(Keycloak public 클라이언트·redirect URI·Web origins·post logout URI·`preferred_username` 매퍼) · A3(AD/LDAP 서비스 계정·검색 DN·초기 관리자)로 이전했다.**

여기서 기억할 두 가지만 다시 적어둔다 — 배포 때 실제로 밟는 지뢰다:

- **URI 등록은 realm당 1회가 아니라 포트·도메인마다 1회다.** `redirect_uri`를 코드가 `window.location.origin`으로 만들기 때문에 운영 `:9900`과 검증 `:9910`이 서로 다른 origin이다. 새 포트로 스택을 열었는데 로그인이 안 되면 여기부터 본다.
- **Web origins는 redirect URI와 별개 항목이다.** 빼먹으면 로그인 왕복은 되는데 토큰 교환이 CORS로 죽는다(`failed to fetch` / `No matching state found`).

## 2. `.env` 작성

`.env`는 절대 커밋 금지. `.env.example` 참고.

```bash
cp .env.example .env
```

```
APP_PORT=9900
POSTGRES_USER=processmap
POSTGRES_PASSWORD=<강한 비밀번호>
POSTGRES_DB=processmap

# DB 자동 백업(db-backup 사이드카) — 저장 위치·보존 일수 (backup.md)
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=14

# 인증 모드 — 빈 값이면 AUTH_ENABLED로 하위호환 유도(§2.1). 3값 중 하나로 명시 권장.
AUTH_MODE=keycloak
AUTH_ENABLED=true
KEYCLOAK_ISSUER=http://182.199.63.71:8080/realms/ai-portal
KEYCLOAK_AUDIENCE=
KEYCLOAK_CLIENT_ID=bpm-frontend
# ldap 모드일 때만 필수 — openssl rand -hex 32
AUTH_JWT_SECRET=

# 사내 AD(LDAP) 동기화 — 4종이 모두 채워져야 활성(ldap_enabled). ldap 모드 로그인의 AD bind도 이 값을 공유.
LDAP_URL=ldaps://<ad-host>:636
LDAP_BIND_DN=CN=svc-bpm,OU=Service Accounts,DC=corp,DC=example,DC=com
LDAP_BIND_CREDENTIALS=<서비스 계정 비밀번호 — 시크릿>
LDAP_USER_SEARCH_BASE=DC=corp,DC=example,DC=com
LDAP_START_TLS=false          # ldap://(389)+StartTLS면 true, ldaps://면 false
LDAP_USER_FILTER=             # 비우면 기본 (&(objectCategory=person)(objectClass=user)(sAMAccountName=*))
SYSTEM_ADMIN_LOGIN_IDS=hong.gildong,kim.cheolsu   # 초기 관리자 loginId(콤마)

# 온프레미스 AI (OpenAI 호환) — 단일 엔드포인트면 AI_BASE_URL 3종, 여러 개면 AI_ENDPOINTS 사용
# GLM-5.2/SGLang 전환(2026-08-18): 모델은 glm-5.2 하나. 사고 모드는 모델명 alias가 아니라
# 코드가 요청 파라미터(chat_template_kwargs)로 지정 — 구 glm-5.2-think/-high/-nothink는 폐기.
AI_ENABLED=true
AI_BASE_URL=https://gpu02.sbiologics.com/v1
AI_API_TOKEN=<시크릿>
AI_MODEL=glm-5.2
# 응답 max_tokens 상한(사고 토큰 포함) — 작으면 빈 응답. 타임아웃은 최대 사고 기준 120~180 권장
AI_MAX_TOKENS=8000
# 다중 엔드포인트+모델(JSON 배열 한 줄, 설정 시 위 3종 대신 사용 — 형식은 .env.example 참고)
AI_ENDPOINTS=
```

- 인증 모드는 frontend가 **런타임**에 `GET /api/auth/mode`로 조회한다 — `NEXT_PUBLIC_*` 빌드 인라인은 폐기됐다(2026-08-19). `AUTH_MODE`/`KEYCLOAK_*`를 바꿔도 frontend 재빌드 불필요, backend 재기동만으로 반영된다.
- **`LDAP_URL`/`LDAP_BIND_DN`/`LDAP_BIND_CREDENTIALS`/`LDAP_USER_SEARCH_BASE` 4종이 모두** 채워져야 동기화가 켜진다(`settings.ldap_enabled`). 하나라도 비면 로그인 시 동기화 skip, 전체 동기화 엔드포인트는 503. `AUTH_MODE=ldap`의 AD bind 로그인도 이 게이트를 그대로 쓴다.
- `SYSTEM_ADMIN_LOGIN_IDS`에 든 loginId만 `role=admin`. 비우면 아무도 관리자 페이지에 못 들어간다.

## 2.1 인증 모드 (`AUTH_MODE`)

`AUTH_MODE`는 `keycloak` / `ldap` / `dev` 셋 중 하나다. 비우면 `settings.resolved_auth_mode()`가 구 `AUTH_ENABLED`로 유도한다(하위호환) — `AUTH_ENABLED=true`→`keycloak`, `false`→`dev`. 새 배포는 `AUTH_MODE`를 명시하는 걸 권장.

| 모드 | 의미 | 로그인 화면 |
|------|------|-------------|
| `keycloak` | 운영 기본. 사내 Keycloak(realm `ai-portal`) OIDC | "Keycloak으로 로그인" 버튼 |
| `ldap` | 사내 AD 직접 bind 인증 + 설정 화면에서 발급한 로컬 계정(컨설턴트용) — Keycloak 인프라 없이도 운영 가능 | ID/PW 폼 |
| `dev` | 로컬 우회(임시 유저 선택) — 서버 배포에서 사용 금지 | 유저 피커 |

**`ldap` 모드 필수값:**
- `AUTH_JWT_SECRET` — 앱이 자체 서명하는 세션 토큰(HS256)의 서명키. 비우면 **기동 자체가 실패**한다(`backend/app/main.py` — `AUTH_MODE=ldap requires AUTH_JWT_SECRET to be set`). 발급: `openssl rand -hex 32`.
- LDAP 연결 4종(`LDAP_URL`·`LDAP_BIND_DN`·`LDAP_BIND_CREDENTIALS`·`LDAP_USER_SEARCH_BASE`) — 위 §2 그대로. 이 4종이 채워져야 AD bind 로그인이 동작한다. 비어 있으면 로컬 계정(설정 화면에서 발급)만으로 로그인 가능.
- AD bind는 비밀번호가 맞아도 `employees` 테이블에 해당 loginId 행이 없으면 로그인이 401이다(`backend/app/routers/auth.py`) — HR 동기화로 아직 들어오지 않은 신규 입사자는 AD 계정이 유효해도 로그인할 수 없다.

**컨설턴트 로컬 계정 회수 절차(시연/프로젝트 종료 시):** 설정 화면(sysadmin 전용, `/api/admin/local-accounts`)에서
1. 먼저 sysadmin 권한을 해제(`is_sysadmin=false`) — 즉시 관리자 권한 상실.
2. 이어서 계정을 완전 삭제하거나(`DELETE`), 재사용 여지가 있으면 `active=false`로 비활성화만.

둘 다 로그인 자체를 막을 뿐 **이미 발급된 토큰은 즉시 무효화되지 않는다** — 아래 참고.

**토큰은 만료 전 강제 무효화가 안 된다.** 앱 서명 토큰(HS256, 무상태)은 서버가 세션을 추적하지 않으므로 계정을 삭제/비활성화해도 만료 시각(`AUTH_JWT_TTL_HOURS`, 기본 8시간) 전까지는 그 토큰 자체로 계속 인증된다(`/api/me` 조회는 막히지만 토큰 검증은 통과). **즉시 전면 차단이 필요하면 `AUTH_JWT_SECRET`을 교체하고 backend를 재기동한다** — 서명키가 바뀌면 기존에 발급된 모든 토큰이 한 번에 무효화된다(전 사용자 재로그인 필요, kill switch 용도).

**백엔드 워커를 늘리면 sysadmin 캐시가 프로세스별로 갈라진다.** sysadmin 부여/회수(`grant_sysadmin_cache`, `backend/app/permissions/logic.py`)는 프로세스 내 메모리 캐시다. 현재 Dockerfile은 uvicorn 단일 워커 전제 — 워커를 늘리면 부여/회수가 일부 워커에만 반영돼 사용자마다 다른 권한을 보는 상황이 생긴다. 스케일아웃 시 이 캐시를 DB 조회로 전환할 것.

## 3. 배포

```bash
docker compose up -d --build
```

- `AUTH_MODE`/`AUTH_ENABLED`/`KEYCLOAK_*`/`AUTH_JWT_SECRET`는 backend **런타임** 환경변수(§2.1) → 값만 바꾸면 `docker compose up -d`(재빌드 불필요)로 backend 재생성 시 반영. frontend는 부팅 시 backend에 조회하므로 재빌드 불필요.
- `LDAP_*`는 backend **런타임** 환경변수 → 값만 바꾸면 `docker compose up -d`(재빌드 불필요)로 backend 재생성 시 반영.
- `AI_*`(AI_ENDPOINTS 포함)는 backend **런타임** 환경변수 → 모델 추가/삭제는 `.env` 수정 후 `docker compose up -d`로 backend 재생성(재빌드 불필요).
- DB 스키마는 backend 기동 시 `create_all` + `_add_missing_columns`로 보강(마이그레이션은 후속). 신규 테이블·컬럼은 자동 생성되지만 **제거된 테이블은 드롭되지 않는다.**
- 프룬 도입(2026-07-09) 후 첫 AD 전체 동기화는 스테일 ad 행을 대량 삭제할 수 있음(비활성·퇴사자). 삭제 행의 한글이름/한글부서도 함께 사라지므로, 동기화 전 한글이름 모달의 전체 목록 추출로 백업 권장.
- **1회성 후처리는 [`setup-once.md`](setup-once.md) B절에 모아뒀다** — `ai_chat_logs` 드랍(B1) · KB 게시본 백필(B2) · 필드 승격 재임포트(B3) · HR 첫 sync와 고아 경로 이관(B4) · 노출 직책 확정(B5). 지난 릴리스라면 이미 끝났을 수 있으니 해당 항목만 골라 확인한다.
- **데모 데이터 시드**는 빈 DB 전용 → [`setup-once.md`](setup-once.md) A8. ⚠️ `reset_db`는 `drop_all`이라 **운영에서 실행 금지**.

## 4. 헬스체크 + 인증/AD 검증

```bash
docker compose ps                                  # 5개 서비스 Up(db-backup 포함), db healthy
curl -s http://localhost:9900/api/health           # {"status":"ok"} (인증 면제)
docker compose logs --tail 3 db-backup             # "[db-backup] ... ok bpm-....dump" — 첫 덤프 확인 (backup.md §2)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9900/   # 200
# backend가 LDAP 설정을 받았는지
docker compose exec backend python -c "from app.settings import settings; print('ldap_enabled=', settings.ldap_enabled, 'admins=', settings.admin_login_ids())"
```

브라우저(`http://<서버>:9900`) 플로우: ① 미인증 → `/login` 리다이렉트 ② "Keycloak으로 로그인" → 메인 진입 ③ 유저명 클릭 → `SYSTEM_ADMIN_LOGIN_IDS` 계정이면 관리자 페이지 노출 ④ 관리자 페이지 → "AD 전체 동기화" → `scanned/upserted/excluded` 요약 ⑤ 5분 내 재클릭 → 429(throttled). **로그인 시 1인 동기화**: 각 사용자가 로그인하면 `/api/me`에서 본인 1명을 AD에서 upsert(전체 동기화 없이도 점진 충전).

## 5. 트러블슈팅

**로그인이 안 되면 인증 설정보다 backend 생존을 먼저 본다.** 프론트의 인증 모드 조회(`GET /api/auth/mode`)는 fail-closed라, backend가 죽어 무응답이면 에러를 띄우지 않고 **빈 issuer/client_id의 Keycloak 카드**를 그린다 — 화면은 멀쩡한데 버튼만 죽은 것처럼 보인다. 순서대로:

```bash
docker compose ps                                  # backend가 restarting/exited인가
docker compose logs --tail 120 backend             # 기동 실패 사유
curl -s http://localhost:9900/api/auth/mode; echo  # issuer·clientId가 채워져 있는가
```

| 증상 | 확인 |
|------|------|
| **로그인 버튼 무반응 + `/api/auth/mode` 무응답** | backend 기동 실패. 아래 두 행을 먼저 볼 것 |
| backend 로그에 `SyntaxError`(import 단계) | **로컬 파이썬이 배포 런타임보다 높다.** 배포 이미지는 `python:3.11-slim` — 로컬 3.12+에서 짠 상위 문법(PEP 695 제네릭 `def f[T]()` 등)은 서버에서만 죽는다. `backend/ruff.toml`의 `target-version = "py311"`이 린트에서 잡는다(2026-08-31 실사고) |
| backend 로그에 `AUTH_MODE=ldap requires AUTH_JWT_SECRET` | `.env`에 서명키 누락 — `openssl rand -hex 32` |
| `/api/auth/mode`의 `keycloakClientId`가 빈 문자열 | `.env`에 `KEYCLOAK_CLIENT_ID` 누락. compose 기본값이 빈 문자열이라 **에러 없이 조용히** 빈 값이 들어간다 → Keycloak `Invalid parameter: client_id` |
| 로그인 후 redirect 오류 | Keycloak Valid redirect URIs에 접속 포트(`:9900/*` 등) 등록됐는지 |
| `/api/*` 401 | 토큰 만료 / `KEYCLOAK_ISSUER`가 realm URL(`/realms/ai-portal`까지)과 일치하는지 |
| frontend가 인증 안 함 | backend `GET /api/auth/mode` 응답 확인(`curl http://localhost:9900/api/auth/mode`) — `AUTH_MODE`/`AUTH_ENABLED`가 의도대로 설정됐는지, backend가 재기동됐는지 |
| db 연결 실패 | `docker compose logs db`, healthcheck 통과 여부 |
| 관리자 페이지가 아무에게도 안 보임 | `SYSTEM_ADMIN_LOGIN_IDS`에 loginId 정확히(대소문자) 들었는지. 변경 후 backend 재생성 |
| 로그인은 되는데 이름/부서 빔 | `/api/me`의 AD 조회 실패 — `ldap_enabled`(4종)·bind 권한·`LDAP_USER_SEARCH_BASE` 확인 |
| 전체 동기화 503 | `ldap_enabled=False` — LDAP 4종 중 빈 값 |
| 전체 동기화 timeout/오류 | LDAP 접속(방화벽/포트/인증서)·bind 자격·검색 DN·`LDAP_START_TLS`↔스킴(ldaps/ldap) 일치 |
| 특정 사용자가 동기화에서 빠짐 | 필터(설계 §4.2): loginId에 `.` 없음 / name에 `_` 포함 / org_l1이 제외목록(Partners·TEST·View 등) → 의도된 제외 |
| `preferred_username`이 loginId 아님 | Keycloak federation username 매퍼가 `sAMAccountName`인지 |
| 로그인 버튼 무반응(Keycloak 화면 안 뜸) | 콘솔 `crypto.subtle is available only in secure contexts`. 평문 HTTP는 secure context 아님 → 프론트 `disablePKCE:true`로 우회(§6·§7). Keycloak이 PKCE `S256` **강제**면 비울 것 |
| 복귀 시 `failed to fetch` / `No matching state found` | **token 엔드포인트 CORS** — Keycloak `bpm-frontend` **Web origins**에 접속 출처 추가(§1). state 오류는 후속 증상, 깨끗한 `/login`에서 재시도 |
| `GET /maps 401 - missing bearer token` 배너 | 로그인 직후 첫 요청 레이스(`58139e7` 이전 빌드). 최신 빌드로 재배포 |
| 노드/엣지 생성 무반응 + `crypto.randomUUID is not a function` | secure context 전용 API. `lib/id.ts`의 `genId`로 교체됨(`58139e7`) → 최신 빌드 재배포. **localhost에선 재현 안 됨** — 서버/원격 IP로 확인(§7) |

로그: `docker compose logs -f backend` / `frontend` / `proxy`

## 6. 보안 메모

- `LDAP_BIND_CREDENTIALS`는 시크릿 — `.env`에만, git 금지. 서비스 계정은 읽기 전용 최소 권한.
- 가능하면 LDAPS(636)/StartTLS로 평문 bind 회피.
- `X-Dev-User` 헤더는 `AUTH_MODE=dev`(또는 구 `AUTH_ENABLED=false`로 유도된 dev)에서만 신뢰. 서버는 `keycloak`/`ldap`이라 무시(우회 불가).
- 관리자 엔드포인트(`/api/employees`, `/api/employees/sync`)는 백엔드 `require_admin`으로 서버측 보호(프론트 숨김에 의존 안 함).
- **PKCE 비활성(`disablePKCE:true`)은 의도된 트레이드오프** — 사내망 평문 HTTP에서 `crypto.subtle`(secure context 전용)을 못 써 끈 것. auth code 가로채기 방어가 약해지나 사내망 한정으로 수용. **HTTPS 도메인 전환 시 PKCE(S256) 복구**(앱·Keycloak 둘 다 HTTPS여야 discovery mixed-content 회피).

## 7. 프론트 — insecure context · 빌드 반영(해시 청크) 확인

**왜 "로컬은 되는데 서버만" 깨지나 — secure context.** 브라우저는 `crypto.subtle`·`crypto.randomUUID`(Web Crypto)를 secure context(HTTPS 또는 `localhost`/`127.0.0.1`)에서만 노출한다. 서버는 원격 IP + 평문 HTTP라 insecure → 이 API가 `undefined`. 그래서 로그인은 `disablePKCE:true`로, 노드/엣지 생성은 `lib/id.ts`의 `genId()`(`getRandomValues` 폴백)로 우회. **로컬 `npm run dev`를 `localhost`로 띄우면 둘 다 정상 → 버그/수정 검증 불가.** 서버 또는 윈도우에서 LAN IP(`http://192.168.x.x:3000`)로 재현할 것.

**소스 코드 변경만 frontend 재빌드가 필요하다** — 인증 모드 관련 값(`AUTH_MODE`/`KEYCLOAK_*`/`AUTH_JWT_SECRET`)은 backend 런타임 환경변수로 바뀌었으므로(§2.1) `--build frontend` 불필요, backend 재기동만으로 반영된다. `APP_PORT`도 런타임이라 재빌드 불필요.

**"고쳤는데 서버에서 여전히 같은 에러" — 빌드 반영부터 확인.** 흔한 함정: `git pull`은 했지만 이미지 재빌드 안 함, 또는 옛 JS 청크 캐시.

1. 소스가 디스크에 반영됐는지: `git rev-parse HEAD` / `grep -n genId frontend/src/lib/id.ts`
2. 컨테이너 번들에 들어갔는지: `docker compose exec frontend grep -rl genId .next` — 비면 미리빌드 → `docker compose build --no-cache frontend && docker compose up -d --force-recreate frontend`
3. **해시 청크 단서**: 소스가 바뀌면 청크 파일명(콘텐츠 해시)이 반드시 바뀐다. 재빌드 후에도 청크명이 그대로면 빌드 미반영.
4. 브라우저 캐시 배제: 시크릿 창으로 재확인.

> 진단 팁: 실제 호출처를 찾을 때 이 저장소의 `src/app/maps/[mapId]/page.tsx`처럼 **대괄호 디렉터리**는 일부 grep(ugrep)이 조용히 건너뛴다 — 누락 의심 시 `find`+파일별 grep으로 재확인.

## 8. 롤백

```bash
git checkout <이전-커밋> && docker compose up -d --build
```

데이터는 `pgdata` 볼륨에 유지. 완전 초기화는 `docker compose down -v`(볼륨 삭제 — 주의).

> **샌드박스 한계:** CI 환경은 Docker Hub 무인증 풀 제한으로 `compose build`를 끝까지 검증 못 한다. `docker compose config` 정적 검증은 통과, 실제 빌드/기동은 서버에서 확인.
