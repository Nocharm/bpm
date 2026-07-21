# 서버 배포 런북 (docker-compose)

로컬에서 검증한 코드를 서버(사내 71번)로 옮겨 docker-compose로 올리는 절차. 파이프라인 전체는 `CLAUDE.md` Operations 참고. Keycloak 로그인·사내 AD(LDAP) 동기화 설정도 이 문서에 통합돼 있다.

## 0. 전제조건

- 서버에 Docker / Docker Compose v2 설치
- 코드 전송 완료(scp 또는 gitlab pull) — 줄바꿈은 `.gitattributes`로 LF 고정되어 Windows 경유해도 안전
- Keycloak public 클라이언트 등록(§1), 인증/AD 인프라 확인(§1)

## 1. Keycloak 클라이언트 + AD 사전 준비 (최초 1회)

realm `ai-portal`에 frontend용 **public(PKCE)** 클라이언트 생성:

| 항목 | 값 |
|------|-----|
| Client ID | `bpm-frontend` (= `KEYCLOAK_CLIENT_ID`) |
| Client authentication | **Off** (public) |
| Standard flow | On (Authorization Code + PKCE) |
| Valid redirect URIs | `http://<서버호스트>:3333/*` (도메인 추가 시 `https://g-ai-agent.sbiologics.com/*`도) |
| Valid post logout redirect URIs | 위와 동일 |
| Web origins | `http://<서버호스트>:3333` (+ 도메인). **token 교환 CORS는 redirect URI가 아니라 Web origins가 푼다** |

- redirect_uri는 앱 origin이다 — 포트 직접 접속 단계는 `:3333`, 엣지 nginx에 도메인 붙이면 그 도메인도 추가.
- **post logout redirect URI는 실제 사용된다** — 로그아웃 직후 `/login`의 "Sign out of all sessions" 패널이 Keycloak `end_session`(`post_logout_redirect_uri=<origin>/login`)을 호출한다. 미등록이면 Keycloak이 에러/확인 화면에 멈춘다.
- **Mappers**: 토큰 `preferred_username`이 AD `sAMAccountName`(= loginId)을 담아야 한다(백엔드가 이 값으로 employees 매칭). Keycloak LDAP federation 기본 매핑이면 OK.

**AD 인프라 (인프라 담당과 확인)** — Keycloak federation(로그인·토큰 발급용)과 백엔드 LDAP 동기화(employees 채우기용 독립 bind 계정)는 **별개**다. 둘 다 같은 AD를 보지만 접속 경로가 다르다.

| 항목 | 내용 |
|------|------|
| Keycloak realm | 기존 `ai-portal` — AD LDAP user federation 구성됨 |
| LDAP 서비스 계정 | AD 읽기 권한 bind 계정(DN + 비밀번호) — 동기화 전용, 읽기 전용 최소 권한 |
| LDAP 접속 | 주소/포트, LDAPS(636) 권장. StartTLS면 `LDAP_START_TLS=true` |
| 검색 기준 DN | 사용자 enumerate 기준 OU/DN (`LDAP_USER_SEARCH_BASE`) |
| 초기 관리자 | admin 권한 줄 loginId 목록 (`SYSTEM_ADMIN_LOGIN_IDS`) — 최소 1명 |

## 2. `.env` 작성

`.env`는 절대 커밋 금지. `.env.example` 참고.

```bash
cp .env.example .env
```

```
APP_PORT=3333
POSTGRES_USER=processmap
POSTGRES_PASSWORD=<강한 비밀번호>
POSTGRES_DB=processmap

# 인증
AUTH_ENABLED=true
KEYCLOAK_ISSUER=http://182.199.63.71:8080/realms/ai-portal
KEYCLOAK_AUDIENCE=
KEYCLOAK_CLIENT_ID=bpm-frontend

# 사내 AD(LDAP) 동기화 — 4종이 모두 채워져야 활성(ldap_enabled)
LDAP_URL=ldaps://<ad-host>:636
LDAP_BIND_DN=CN=svc-bpm,OU=Service Accounts,DC=corp,DC=example,DC=com
LDAP_BIND_CREDENTIALS=<서비스 계정 비밀번호 — 시크릿>
LDAP_USER_SEARCH_BASE=DC=corp,DC=example,DC=com
LDAP_START_TLS=false          # ldap://(389)+StartTLS면 true, ldaps://면 false
LDAP_USER_FILTER=             # 비우면 기본 (&(objectCategory=person)(objectClass=user)(sAMAccountName=*))
SYSTEM_ADMIN_LOGIN_IDS=hong.gildong,kim.cheolsu   # 초기 관리자 loginId(콤마)

# 온프레미스 AI (OpenAI 호환) — 단일 엔드포인트면 AI_BASE_URL 3종, 여러 개면 AI_ENDPOINTS 사용
AI_ENABLED=true
AI_BASE_URL=http://<gpu>:8000/v1
AI_API_TOKEN=<시크릿>
AI_MODEL=<기본 모델 id>
# 다중 엔드포인트+모델(JSON 배열 한 줄, 설정 시 위 3종 대신 사용 — 형식은 .env.example 참고)
AI_ENDPOINTS=
```

- `NEXT_PUBLIC_*`는 compose가 `AUTH_ENABLED`/`KEYCLOAK_ISSUER`/`KEYCLOAK_CLIENT_ID`로부터 build args로 자동 주입(docker-compose.yml). 별도 설정 불필요.
- **`LDAP_URL`/`LDAP_BIND_DN`/`LDAP_BIND_CREDENTIALS`/`LDAP_USER_SEARCH_BASE` 4종이 모두** 채워져야 동기화가 켜진다(`settings.ldap_enabled`). 하나라도 비면 로그인 시 동기화 skip, 전체 동기화 엔드포인트는 503.
- `SYSTEM_ADMIN_LOGIN_IDS`에 든 loginId만 `role=admin`. 비우면 아무도 관리자 페이지에 못 들어간다.

## 3. 배포

```bash
docker compose up -d --build
```

- `AUTH_ENABLED`/`KEYCLOAK_*`는 frontend **빌드 타임**에 `NEXT_PUBLIC_*`로 번들 인라인된다 → 값 변경 시 `--build` 필수(§7).
- `LDAP_*`는 backend **런타임** 환경변수 → 값만 바꾸면 `docker compose up -d`(재빌드 불필요)로 backend 재생성 시 반영.
- `AI_*`(AI_ENDPOINTS 포함)는 backend **런타임** 환경변수 → 모델 추가/삭제는 `.env` 수정 후 `docker compose up -d`로 backend 재생성(재빌드 불필요).
- DB 스키마는 backend 起動 시 `create_all`로 생성(마이그레이션은 후속). 신규 테이블은 자동 생성되지만 **제거된 테이블은 드롭되지 않는다** — 아래 업그레이드 노트.
- **업그레이드 노트(2026-07-09, AI 챗 서버 저장 머지)**: 기존 배포 DB에는 더 이상 코드가 쓰지 않는 `ai_chat_logs` 테이블이 남는다. 배포 후 1회 정리:

  ```bash
  docker compose exec db psql -U ${POSTGRES_USER:-processmap} -d ${POSTGRES_DB:-processmap} -c 'DROP TABLE IF EXISTS ai_chat_logs;'
  ```
- 프룬 도입(2026-07-09) 후 첫 AD 전체 동기화는 스테일 ad 행을 대량 삭제할 수 있음(비활성·퇴사자). 삭제 행의 한글이름/한글부서도 함께 사라지므로, 동기화 전 한글이름 모달의 전체 목록 추출로 백업 권장.
- **데모 데이터 시드**(선택, 미런칭 빈 DB일 때): 시드 스크립트는 backend 이미지에 포함돼 있다 → `docker compose exec backend python -m scripts.reset_db`. ⚠️ `reset_db`는 `drop_all`로 전체 삭제 후 재시드 — 데이터가 있으면 날아간다. 상세·부분 시드는 `db-seed.md`.

## 4. 헬스체크 + 인증/AD 검증

```bash
docker compose ps                                  # 4개 서비스 Up, db healthy
curl -s http://localhost:3333/api/health           # {"status":"ok"} (인증 면제)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3333/   # 200
# backend가 LDAP 설정을 받았는지
docker compose exec backend python -c "from app.settings import settings; print('ldap_enabled=', settings.ldap_enabled, 'admins=', settings.admin_login_ids())"
```

브라우저(`http://<서버>:3333`) 플로우: ① 미인증 → `/login` 리다이렉트 ② "Keycloak으로 로그인" → 메인 진입 ③ 유저명 클릭 → `SYSTEM_ADMIN_LOGIN_IDS` 계정이면 관리자 페이지 노출 ④ 관리자 페이지 → "AD 전체 동기화" → `scanned/upserted/excluded` 요약 ⑤ 5분 내 재클릭 → 429(throttled). **로그인 시 1인 동기화**: 각 사용자가 로그인하면 `/api/me`에서 본인 1명을 AD에서 upsert(전체 동기화 없이도 점진 충전).

## 5. 트러블슈팅

| 증상 | 확인 |
|------|------|
| 로그인 후 redirect 오류 | Keycloak Valid redirect URIs에 `:3333/*` 등록됐는지 |
| `/api/*` 401 | 토큰 만료 / `KEYCLOAK_ISSUER`가 realm URL(`/realms/ai-portal`까지)과 일치하는지 |
| frontend가 인증 안 함 | `NEXT_PUBLIC_AUTH_ENABLED=true`로 **빌드됐는지** — 값 변경 시 `--build` |
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
- `X-Dev-User` 헤더는 `AUTH_ENABLED=false`에서만 신뢰. 서버는 `true`라 무시(우회 불가).
- 관리자 엔드포인트(`/api/employees`, `/api/employees/sync`)는 백엔드 `require_admin`으로 서버측 보호(프론트 숨김에 의존 안 함).
- **PKCE 비활성(`disablePKCE:true`)은 의도된 트레이드오프** — 사내망 평문 HTTP에서 `crypto.subtle`(secure context 전용)을 못 써 끈 것. auth code 가로채기 방어가 약해지나 사내망 한정으로 수용. **HTTPS 도메인 전환 시 PKCE(S256) 복구**(앱·Keycloak 둘 다 HTTPS여야 discovery mixed-content 회피).

## 7. 프론트 — insecure context · 빌드 반영(해시 청크) 확인

**왜 "로컬은 되는데 서버만" 깨지나 — secure context.** 브라우저는 `crypto.subtle`·`crypto.randomUUID`(Web Crypto)를 secure context(HTTPS 또는 `localhost`/`127.0.0.1`)에서만 노출한다. 서버는 원격 IP + 평문 HTTP라 insecure → 이 API가 `undefined`. 그래서 로그인은 `disablePKCE:true`로, 노드/엣지 생성은 `lib/id.ts`의 `genId()`(`getRandomValues` 폴백)로 우회. **로컬 `npm run dev`를 `localhost`로 띄우면 둘 다 정상 → 버그/수정 검증 불가.** 서버 또는 윈도우에서 LAN IP(`http://192.168.x.x:3000`)로 재현할 것.

**`NEXT_PUBLIC_*`는 빌드 타임 인라인** — 값 변경 시 `docker compose up -d --build frontend` 필수. `APP_PORT`는 런타임이라 재빌드 불필요.

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
