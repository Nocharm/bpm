# LDAP 인증 폴백 + 로컬 계정 설계 (2026-08-19)

Keycloak을 쓸 수 없는 배포에서 **LDAP(사내 AD)을 인증 수단으로 쓰고**, AD 계정이 없는 외부 컨설턴트에게는 **설정 화면에서 발급한 로컬 계정(ID+비밀번호)** 으로 접속시킨다. 목적은 9910 서버를 LDAP으로 열어 컨설턴트가 직접 들어와 확인하는 것.

기준 커밋: `872a953` (dev = main).

## 1. 배경 — 현재 무엇이 있고 무엇이 없나

현재 인증은 불리언 하나로 갈린다.

| 상태 | 동작 | 위치 |
|---|---|---|
| `AUTH_ENABLED=true` | Keycloak OIDC. 백엔드는 realm JWKS로 RS256 **검증만** 한다 | `backend/app/auth.py:22-51`, `frontend/src/components/providers.tsx:182-185` |
| `AUTH_ENABLED=false` | 인증 우회. `X-Dev-User` 헤더를 그대로 신뢰하고, 기동 시 임시 유저 5명을 시드 | `auth.py:27-28`, `main.py:76-81`, `ad/service.py:22` |

없는 것:

- **앱 자체 세션 발급 기계** — 토큰은 Keycloak이 발급하고 앱은 검증만 한다. LDAP 모드에는 앱이 직접 발급하는 경로가 필요하다.
- **비밀번호 저장소** — `employees` 테이블은 loginId·이름·조직뿐이다. `ad/client.py`도 서비스 계정 bind로 *동기화*만 하고 사용자 인증 bind는 하지 않는다.
- **런타임 모드 전환** — 프론트의 `NEXT_PUBLIC_AUTH_ENABLED`·`NEXT_PUBLIC_KEYCLOAK_*`는 `frontend/Dockerfile:14-19` ARG로 굽는 빌드타임 값이라, 모드를 바꾸려면 프론트 이미지를 다시 빌드해야 한다.

이미 있어서 재사용할 것:

- LDAP 연결 코드와 배포 배선 (`ad/client.py`, `docker-compose.yml:76-82`) — `hr/service.py:193`이 직책 갱신에 여전히 사용 중이라 살아 있다.
- **HR 동기화의 로컬 계정 보호** — 삭제 대상이 `source in ("ad","hr")`로 한정되어 있어(`hr/service.py:162`) `source='local'` 행은 동기화에 쓸려나가지 않는다. 로컬 계정을 `employees`에 두어도 안전하다.
- 권한 판정·조직 경로 해석·부서 선택 UI·협업자 피커 — 전부 `employees` 행을 전제로 이미 동작한다.

## 2. 모드 — `AUTH_MODE`

불리언 `AUTH_ENABLED`를 **`AUTH_MODE=keycloak|ldap|dev`** 로 대체한다. 세 모드는 배타적이다.

- `keycloak` — 현행 OIDC. 변경 없음.
- `ldap` — 신규. 로컬 계정 또는 AD bind로 인증하고 앱이 토큰을 발급한다.
- `dev` — 현행 로컬 우회(`X-Dev-User` + 임시 유저 5명). **인증 메커니즘은 건드리지 않는다** (로그인 화면은 §6에서 모드별로 정리된다).

**하위호환**: `AUTH_MODE`가 비어 있으면 기존 `AUTH_ENABLED`로 유도한다 (`true→keycloak`, `false→dev`). 기존 로컬·서버 `.env`가 수정 없이 그대로 돈다.

**런타임 노출**: `GET /api/auth/mode` (인증 불필요) → `{mode, keycloakIssuer, keycloakClientId}`. 프론트는 부팅 시 이걸 받아 분기하고, 모드가 확정되기 전에는 기존 `AuthLoadingScreen`을 띄운다. 이로써 프론트의 인증 관련 빌드타임 상수 3개가 사라지고 **9910을 LDAP으로 여는 데 프론트 재빌드가 필요 없어진다**.

`keycloakIssuer`/`keycloakClientId`는 비밀이 아니다 (브라우저가 어차피 리다이렉트 URL로 노출한다). 시크릿은 응답에 절대 넣지 않는다.

## 3. 로컬 계정 — 저장 구조

컨설턴트 계정은 **`employees` 행 (`source='local'`)** 으로 만든다. 별도 사용자 테이블을 만들지 않는 이유는, 권한 판정·조직 경로·디렉터리·협업자 피커·맵 권한이 전부 `employees`를 전제로 이미 동작하기 때문이다. 새 테이블을 만들면 그 기계장치를 전부 다시 배선해야 한다.

비밀번호는 `employees`에 넣지 않고 **신규 `local_credentials`** 테이블로 분리한다.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `login_id` | str PK | `employees.login_id` 느슨 참조 |
| `password_hash` | str | scrypt (아래) |
| `is_sysadmin` | bool | 기본 `false`. 설정 화면에서 부여 (§3.1) |
| `created_by` | str | 발급한 sysadmin loginId |
| `created_at` / `updated_at` | datetime | `app/clock.now()` (KST) |

**분리하는 이유**: 디렉터리 데이터를 raw dict로 직렬화하는 엔드포인트가 있어(`library.py`류 — 응답 validator를 우회한다) 같은 테이블에 해시를 두면 새어나갈 경로가 생긴다. 신규 테이블이므로 startup `create_all`이 만든다 — `_ADDED_COLUMNS` 등록 대상이 아니다.

**해싱**: stdlib `hashlib.scrypt`. 새 의존성을 넣지 않는다 (`rules/common/dependencies.md` — stdlib 우선). 계정마다 무작위 salt를 생성해 `salt$hash` 형태로 저장하고, 검증은 `hmac.compare_digest`로 상수 시간 비교한다. salt는 `secrets.token_bytes(16)`.

### 3.1 sysadmin 부여 — 판정 경로 확장

로컬 계정에는 설정 화면에서 sysadmin을 부여할 수 있어야 한다. 그런데 현재 `permissions/logic.is_sysadmin(login_id)`(`logic.py:43`)은 **env만 읽는 동기 순수 함수**이고 앱 코드 33곳에서 세션 없이 호출된다. DB를 직접 읽게 바꾸면 그 호출부를 전부 async + 세션 전달로 고쳐야 하므로, 대신 **모듈 수준 집합을 캐시로 얹는다**.

```
is_sysadmin(login_id) =
    (auth OFF and dev_enforce OFF)            # 현행 로컬 잠금 방지
    or login_id in BPM_SYSADMINS              # 현행 env
    or login_id in _granted_sysadmins         # 신규 — local_credentials.is_sysadmin
```

`_granted_sysadmins`는 **기동 시 `local_credentials`에서 로드**하고, 로컬 계정의 생성·수정·삭제 시 갱신한다. 함수 시그니처와 33개 호출부는 그대로다.

**전제**: 백엔드는 단일 uvicorn 프로세스다(`backend/Dockerfile:27` — `--workers` 없음). 워커를 늘리면 프로세스별 캐시가 갈라져 부여·회수가 일부 워커에만 반영된다. 이 전제를 `logic.py` 주석과 배포 문서에 남기고, 워커를 늘려야 할 때는 캐시를 버리고 DB 조회로 전환한다.

**불변식**: `BPM_SYSADMINS`로 지정된 계정은 **UI에서 회수할 수 없다.** UI로 마지막 관리자를 지워 스스로 잠기는 것을 막는다. env sysadmin과 UI sysadmin은 출처가 다르며, UI는 자기가 부여한 것만 회수한다.

## 4. LDAP 모드 로그인 흐름

`POST /api/auth/login` — body `{loginId, password}`, 응답 `{token, expiresAt}` 또는 401.

1. **로컬 우선**: `local_credentials`에 `loginId`가 있으면 scrypt로 검증한다. AD로 보내지 않는다 — 컨설턴트 비밀번호가 사내 AD에 흘러가지 않게 하기 위함이며, 동시에 AD에 불필요한 bind 부하를 주지 않는다.
2. **AD 폴백**: 없으면 `ad/client.authenticate_user(login_id, password)` — 서비스 계정으로 사용자 DN을 검색한 뒤, 그 DN과 사용자 비밀번호로 재bind한다.
3. **발급**: 성공하면 `AUTH_JWT_SECRET`으로 HS256 서명한 토큰을 반환한다 (`sub`=loginId, `exp`=now+TTL). 이후 요청은 기존 `Authorization: Bearer` 경로를 그대로 탄다.

**가드**

- 실패 사유를 구분하지 않고 동일한 401을 반환한다 — 계정 존재 여부를 노출하지 않는다.
- **빈 비밀번호는 명시적으로 거부**한다. LDAP unauthenticated bind는 빈 비밀번호에 성공을 돌려주므로, 막지 않으면 아이디만 알면 통과한다.
- **시도 제한** — `loginId`+클라이언트 IP 기준 인메모리 카운터. 앱이 AD에 무제한 bind를 중계하면 **실제 AD 계정이 잠긴다**. 임계 초과 시 짧은 잠금(예: 5회/5분)으로 중계를 끊는다. 프로세스 메모리면 충분하다(단일 백엔드 컨테이너).
- `employees.active=false`인 계정은 거부한다 — 기존 차단 수단을 그대로 쓴다.
- 성공·실패 모두 기존 `login_records`에 기록한다.

**토큰 검증**: `auth.py`의 `get_current_user`가 모드에 따라 검증기만 고른다.

| 모드 | 검증 |
|---|---|
| `keycloak` | 현행 JWKS RS256 |
| `ldap` | `AUTH_JWT_SECRET` HS256 |
| `dev` | 현행 `X-Dev-User` |

API 라우터와 권한 로직은 변경하지 않는다.

**한계 (의도적)**: 자체 JWT는 무상태라 만료 전 강제 로그아웃이 불가능하다. TTL을 8시간으로 한정하고, 즉시 차단이 필요하면 `employees.active=false`로 처리한다 (다음 요청부터가 아니라 다음 로그인부터 막힌다는 점을 배포 문서에 명시).

## 5. 설정 화면 — 로컬 계정 탭

`frontend/src/app/settings/page.tsx`의 **조직 카테고리**에 탭을 추가한다. 노출 조건은 **sysadmin이면서 `mode === "ldap"`** 일 때만. 다른 모드에서는 탭 자체가 렌더되지 않고, 백엔드 엔드포인트도 `ldap` 모드가 아니면 404를 반환한다(UI 숨김만으로 막지 않는다).

| 필드 | 처리 |
|---|---|
| loginId | 신규 발급. **AD 계정과 충돌 검사** — `source != 'local'`인 행이 이미 있으면 거부한다. 실계정을 로컬 계정으로 가로채는 것을 막는다 |
| 이름 | 표시명 |
| 부서 | 기존 부서 선택 UI 재사용 → `dept_code` 지정. 조직 경로는 기존 resolver(`app/orgchart.py`)가 해석한다 |
| 권한 | 저장 위치가 다르므로 컨트롤도 둘로 나눈다 — **역할 선택**(`user`/`admin` → `employees.role`)과 **sysadmin 토글**(→ `local_credentials.is_sysadmin`, §3.1 캐시 반영). `BPM_SYSADMINS`로 지정된 계정은 토글이 켜진 채 비활성으로 보이고 이 화면에서 회수되지 않는다 |
| 비밀번호 | sysadmin이 발급·재설정한다. 본인 변경 기능은 넣지 않는다 |
| 차단 | 기존 `employees.active` 토글 |

엔드포인트는 sysadmin 전용(`require_sysadmin`)으로 `GET/POST/PATCH/DELETE /api/admin/local-accounts`. 응답에 `password_hash`를 절대 포함하지 않는다.

## 6. 로그인 화면

모드별로 단일 CTA만 보인다 — `keycloak`은 Keycloak 버튼(현행), `ldap`은 ID/비밀번호 폼, `dev`는 계정 선택(현행). 현재 폴백 화면에 secondary로 남아 있는 죽은 Keycloak 버튼(`login/page.tsx:148`)을 제거한다.

## 7. 설정·배포

`backend/app/settings.py` 신규 필드:

| 필드 | 기본 | 분류 |
|---|---|---|
| `auth_mode` | `""` (비면 `auth_enabled`로 유도) | Environment |
| `auth_jwt_secret` | `""` | Environment (시크릿) |
| `auth_jwt_ttl_hours` | `8` | Tuning |

`.env.example`에 항목과 주석을 추가하고, **`docker-compose.yml`의 backend `environment:` 블록에 명시 등록**한다 — backend에는 `env_file:`이 없어서, 빠뜨리면 로컬에선 되는데 서버에서만 조용히 기본값으로 도는 기존 함정에 걸린다 (`rules/backend/config.md`, `CSV_MANUAL_URL` 선례).

`ldap` 모드인데 `auth_jwt_secret`이 비어 있으면 **기동 시 실패**시킨다. 빈 시크릿으로 서명하면 누구나 토큰을 위조할 수 있으므로 조용히 넘어가면 안 된다.

frontend build ARG 3개(`NEXT_PUBLIC_AUTH_ENABLED`, `NEXT_PUBLIC_KEYCLOAK_ISSUER`, `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`)와 compose의 대응 build args를 제거한다.

## 8. 검증

**pytest** — 모드별 `get_current_user` 분기 3종 / 로컬 계정 성공·실패 / AD bind 성공·실패(ldap3 mock) / 빈 비밀번호 거부 / `active=false` 거부 / loginId 충돌 거부 / 시도 제한 발동 / 토큰 위조·만료 거부 / `ldap` 모드 아닐 때 관리 엔드포인트 404 / 응답에 해시 미포함.

sysadmin 부여 경로(§3.1) — 부여 즉시 `is_sysadmin` True / 회수 즉시 False / 계정 삭제 시 캐시에서 제거 / 기동 시 DB에서 재로드 / **`BPM_SYSADMINS` 계정은 UI 회수로 내려가지 않음** / sysadmin 부여·회수 자체가 sysadmin 전용.

**vitest** — 모드 fetch 분기, 로그인 폼 상태.

**Playwright** — `ldap` 모드에서 로컬 계정 로그인 왕복(발급 → 로그인 → 딥링크 복원 → 로그아웃).

`AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" pytest`로 전체 그린을 확인한다.

## 9. 위험 — 명시적으로 감수한 것

1. **평문 HTTP로 비밀번호가 전송된다.** 이 앱은 서버에서 원격 IP + 평문 HTTP(3333)로 접속한다(`docs/deploy/deploy.md:145`). 따라서 AD 비밀번호와 로컬 계정 비밀번호가 모두 사내망을 평문으로 지난다. 같은 LAN에서 캡처 가능하며, AD 비밀번호가 유출되면 피해는 BPM이 아니라 AD 계정 전체에 미친다. **사내망 전제로 감수하고 진행하기로 결정했다(2026-08-19).** 앱이 사내망 밖으로 노출되거나 엣지 nginx에 도메인 라우팅이 붙는 시점에 이 결정을 재검토한다.
2. **`AUTH_JWT_SECRET` 유출 = 전 계정 위조 가능.** `.env` 전용, 커밋 금지. 유출 시 시크릿 교체로 전 세션이 무효화된다.
3. **외부 컨설턴트 계정이 운영 서버에 상주한다.** 시연 종료 후 `active=false` 처리 절차를 배포 문서에 남긴다.
4. **UI에서 부여하는 sysadmin은 AD를 우회하는 상시 최고권한 계정이 된다.** 비밀번호를 sysadmin이 직접 정하므로, 부여된 계정 하나는 곧 AD 인증을 거치지 않는 전권 접속 경로다. 완화: 부여·회수는 sysadmin만 가능하고, `created_by`와 `updated_at`을 남기며, 로컬 계정 목록에서 sysadmin 여부가 항상 보이게 한다. 시연 종료 시 회수 절차를 배포 문서에 명시한다.

## 10. 범위 밖

- 비밀번호 자가 변경·재설정 메일
- 토큰 갱신(refresh) — 만료 시 재로그인
- 세션 즉시 폐기 / 관리자의 강제 로그아웃
- Keycloak 장애 자동 감지 후 모드 전환 — 모드는 명시적 env 전환이다
