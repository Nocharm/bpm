# 배포 절차 — Keycloak 로그인 + 사내 AD(LDAP) 동기화

이 기능(로그인 화면 + AD 동기화 + 임시 로그인)을 **서버 docker-compose**에 올리는 절차.
일반 배포(포트·헬스체크·롤백)는 `docs/deploy.md`를 따르고, 이 문서는 **인증·AD 연동에 필요한 추가 설정**만 다룬다.

> 전제: 로컬(auth OFF)에서 임시 로그인 플로우를 확인 완료. 서버는 `AUTH_ENABLED=true`로 Keycloak 실연동.
> 관련: `docs/superpowers/specs/2026-06-16-keycloak-login-ad-sync-design.md`

---

## 0. 사전 준비물 (인프라 담당과 확인)

| 항목 | 내용 |
|------|------|
| Keycloak realm | 기존 `ai-portal` (같은 서버) — **AD LDAP user federation** 구성되어 있어야 함 |
| `preferred_username` | 토큰 클레임이 **`sAMAccountName`(= loginId)** 이어야 함 (백엔드가 이 값으로 employees 매칭) |
| LDAP 서비스 계정 | AD 읽기 권한 보유한 bind 계정 (DN + 비밀번호) — 백엔드 동기화 전용 |
| LDAP 접속 | 주소/포트, LDAPS(636) 권장. StartTLS 쓰면 `LDAP_START_TLS=true` |
| 검색 기준 DN | 사용자 enumerate 기준 OU/DN (`LDAP_USER_SEARCH_BASE`) |
| 초기 관리자 | admin 권한 줄 loginId 목록 (`SYSTEM_ADMIN_LOGIN_IDS`) |

> **Keycloak federation과 백엔드 LDAP은 별개다.** Keycloak은 로그인·토큰 발급용(같은 AD federation), 백엔드 LDAP 동기화는 employees 테이블 채우기용(독립 bind 계정). 둘 다 같은 AD를 보지만 접속 경로가 다르다.

---

## 1. Keycloak 클라이언트 확인 (최초 1회)

`docs/deploy.md` §1의 public(PKCE) 클라이언트(`bpm-frontend`) 등록을 따른다. 추가로 이 기능에서 확인할 점:

- **Mappers**: 토큰의 `preferred_username`이 AD `sAMAccountName`을 담도록 매핑되어 있는지.
  (Keycloak LDAP federation 기본 매핑이 `sAMAccountName → username`이면 OK.)
- 로그인 후 `/api/me`가 그 loginId로 employees를 조회하므로, **federation으로 로그인 가능한 사용자 = AD 사용자**여야 한다.

---

## 2. `.env` 채우기 (서버)

`docs/deploy.md` §2의 기본값에 더해 **AD/LDAP 블록**을 채운다 (`.env.example` 참고). `.env`는 절대 커밋 금지.

```bash
# 인증 (deploy.md와 동일)
AUTH_ENABLED=true
KEYCLOAK_ISSUER=http://182.199.63.71:8080/realms/ai-portal
KEYCLOAK_AUDIENCE=
KEYCLOAK_CLIENT_ID=bpm-frontend

# 사내 AD(LDAP) 동기화 — 4종이 모두 채워져야 활성(ldap_enabled)
LDAP_URL=ldaps://<ad-host>:636
LDAP_BIND_DN=CN=svc-bpm,OU=Service Accounts,DC=corp,DC=example,DC=com
LDAP_BIND_CREDENTIALS=<서비스 계정 비밀번호 — 시크릿>
LDAP_USER_SEARCH_BASE=DC=corp,DC=example,DC=com
LDAP_START_TLS=false          # ldap://(389) + StartTLS면 true, ldaps://면 false
LDAP_USER_FILTER=             # 비우면 기본 (&(objectCategory=person)(objectClass=user)(sAMAccountName=*))
SYSTEM_ADMIN_LOGIN_IDS=hong.gildong,kim.cheolsu   # 초기 관리자 loginId(콤마)
```

검증 규칙:
- **`LDAP_URL`/`LDAP_BIND_DN`/`LDAP_BIND_CREDENTIALS`/`LDAP_USER_SEARCH_BASE` 4종이 모두 채워져야** 동기화가 켜진다(`settings.ldap_enabled`). 하나라도 비면 로그인 시 동기화는 skip되고, 전체 동기화 엔드포인트는 503을 반환한다.
- `SYSTEM_ADMIN_LOGIN_IDS`에 든 loginId만 `role=admin`이 된다. 비우면 AD 사용자는 전부 `user` → **관리자 페이지에 아무도 못 들어간다**. 최소 1명은 넣을 것.

> `LDAP_*`/`SYSTEM_ADMIN_LOGIN_IDS`는 `docker-compose.yml`의 backend `environment:`가 `.env`에서 주입한다(이번 배선 추가됨). 컨테이너는 `.env` 파일을 직접 읽지 않으므로 compose 배선이 없으면 전달되지 않는다.

---

## 3. 배포

```bash
docker compose up -d --build
```

- `AUTH_ENABLED`/`KEYCLOAK_*`는 frontend **빌드 타임**에 `NEXT_PUBLIC_*`로 인라인된다 → 값 변경 시 `--build` 필수(`docs/deploy.md` §3).
- `LDAP_*`는 backend **런타임** 환경변수 → 값만 바꾸면 `docker compose up -d`(재빌드 불필요)로 backend 재생성하면 반영된다.
- `employees` 테이블은 backend 起動 시 `create_all`로 생성된다(신규 테이블, 마이그레이션 불필요).

---

## 4. 검증 (서버)

기본 헬스체크는 `docs/deploy.md` §4. 이 기능 전용 확인:

```bash
# 1) backend가 LDAP 설정을 받았는지 (컨테이너 안)
docker compose exec backend python -c "from app.settings import settings; print('ldap_enabled=', settings.ldap_enabled, 'admins=', settings.admin_login_ids())"
# → ldap_enabled= True  admins= {'hong.gildong', ...}
```

브라우저(`http://<서버>:9787`) 플로우:
1. 미인증 접근 → **로그인 화면**(`/login`)으로 리다이렉트.
2. "Keycloak으로 로그인" → Keycloak 로그인 → 메인 진입.
3. 유저명 클릭 → 드롭다운. `SYSTEM_ADMIN_LOGIN_IDS`에 든 계정이면 **관리자 페이지** 노출.
4. 관리자 페이지 → 직원 테이블 → **"AD 전체 동기화"** 클릭 → `scanned/upserted/excluded` 요약 표시.
5. 5분 내 재클릭 → **429**(throttled — 남은 초 안내). 5분 후 정상.

> **로그인 시 1인 동기화**: 각 사용자가 로그인하면 `/api/me`에서 그 1명을 AD에서 조회·upsert한다. 전체 동기화를 안 돌려도 로그인한 사람은 점진적으로 채워진다.

---

## 5. 트러블슈팅

| 증상 | 확인 |
|------|------|
| 관리자 페이지가 아무에게도 안 보임 | `SYSTEM_ADMIN_LOGIN_IDS`에 해당 loginId가 정확히(대소문자) 들었는지. 변경 후 `docker compose up -d`로 backend 재생성 |
| 로그인은 되는데 이름/부서 비어 있음 | `/api/me`의 AD 조회 실패 — `ldap_enabled`(4종), bind 계정 권한, `LDAP_USER_SEARCH_BASE` 확인. `docker compose logs backend` |
| 전체 동기화가 503 | `ldap_enabled=False` — LDAP 4종 중 빈 값 있는지 |
| 전체 동기화가 timeout/오류 | LDAP 접속(방화벽/포트/LDAPS 인증서), bind 자격 증명, 검색 기준 DN. `LDAP_START_TLS`와 스킴(ldaps:// vs ldap://) 일치 여부 |
| 특정 사용자가 동기화에서 빠짐 | 필터 규칙(설계 §4.2): `loginId`에 `.` 없음 / `name`에 `_` 포함 / `org_l1`이 제외목록(Partners·TEST·View 등)이면 제외됨 — 의도된 동작 |
| `preferred_username`이 loginId가 아님 | Keycloak federation의 username 매퍼가 `sAMAccountName`인지. 다르면 employees 매칭이 어긋남 |
| 로그인 버튼 눌러도 무반응(Keycloak 화면 안 뜸) | 콘솔에 `crypto.subtle is available only in secure contexts`. 평문 HTTP(원격 IP)는 secure context가 아니라 PKCE의 `crypto.subtle`이 차단됨 → 프론트는 `disablePKCE: true`로 우회(아래 §6). Keycloak 클라이언트 `bpm-frontend` Advanced의 *PKCE Code Challenge Method*가 `S256`으로 **강제돼 있으면** 비워야 함 |

로그: `docker compose logs -f backend`

---

## 6. 보안 메모

- `LDAP_BIND_CREDENTIALS`는 **시크릿** — `.env`에만, git 금지. 서비스 계정은 **읽기 전용** 권한 최소화.
- 가능하면 **LDAPS(636)** 또는 StartTLS로 평문 bind 회피.
- `X-Dev-User` 헤더는 **`AUTH_ENABLED=false`에서만** 신뢰된다. 서버는 `AUTH_ENABLED=true`이므로 이 헤더가 들어와도 무시되고 JWT만 신뢰한다(우회 불가).
- 관리자 엔드포인트(`/api/employees`, `/api/employees/sync`)는 **백엔드 `require_admin`으로 서버측 보호**된다(프론트 숨김에 의존하지 않음).
- **PKCE 비활성(`disablePKCE: true`)은 의도된 트레이드오프** — 사내망 평문 HTTP 접속에서 `crypto.subtle`(secure context 전용)을 못 써서 끈 것. public 클라이언트에서 PKCE를 빼면 auth code 가로채기 방어가 약해진다. 사내망 한정·Keycloak도 같은 서버 개발용이라 수용. **HTTPS 도메인 경유로 전환하면 `disablePKCE`를 되돌려 PKCE(S256) 복구**할 것(앱·Keycloak 둘 다 HTTPS여야 discovery fetch mixed-content 회피).
