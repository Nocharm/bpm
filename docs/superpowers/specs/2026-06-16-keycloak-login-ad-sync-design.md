# Keycloak 로그인 화면 + 사내 AD(LDAP) 동기화 — 설계 문서

**작성일:** 2026-06-16
**상태:** 브레인스토밍 확정 (구현 대기)
**관련:** `docs/spec.md` §4 인증, `backend/app/auth.py`, `frontend/src/components/providers.tsx`
**참고:** Nocharm/gitlab (같은 서버 Keycloak 연동 사례)

## 1. 목적

세 가지를 더한다.

1. Keycloak 기반 **로그인 화면** — 미인증 상태로 임의 URL 접근 시 로그인 화면으로, 로그인 성공 시 메인으로.
2. 사용자 정보를 **사내 AD(LDAP)** 에서 동기화해 로컬 `employees` 테이블에 영속.
3. **로컬 개발**에서 Keycloak/AD 없이 임시 아이디 선택식 로그인(비밀번호 없음).

## 2. 범위 결정 (브레인스토밍 확정)

| 결정 | 선택 |
|------|------|
| 세션 범위 | 프론트(A·B) + 백엔드(C) 모두, 단일 `feat/auth-login-ad-sync` 브랜치, 단계별 커밋 |
| 로컬 임시 유저 전달 | `X-Dev-User` 헤더(인증 OFF일 때만 신뢰) + 임시 5명을 `employees(source=local)`로 startup 시드 |
| 로그인 시 1인 동기화 | `GET /api/me` 요청에서 해당 사용자 1명 AD upsert |
| 동기화 버튼 위치 | 관리자 설정 화면(`/admin`) — 현재는 employees 테이블 조회 + 전체 동기화 버튼만(추후 디자인). 진입점은 TopNav 유저아이디 클릭 → 드롭다운(관리자 페이지 / 로그아웃) |
| 5분 가드 저장 | 인메모리(모듈 전역, 단일 컨테이너 전제, 재시작 시 리셋 무해) |
| 인증 의존성 | 기존 `get_current_user()->str`(loginId) 유지, `get_current_employee`/`require_admin` 신설 |

## 3. 데이터 모델 — `employees` (신규 테이블)

신규 테이블이므로 `init_models`의 `create_all`이 생성한다(`_ADDED_COLUMNS` 보강 불필요).

| 컬럼 | 타입 | 비고 |
|------|------|------|
| `login_id` | `String(100)` PK | `sAMAccountName` = Keycloak `preferred_username`. 고유 식별자 |
| `name` | `String(200)` | `displayName`(없으면 `login_id`) |
| `title` | `String(100)` | AD `title`(직급/직함), 빈 값 허용 |
| `source` | `String(10)` | `ad` \| `local` |
| `role` | `String(10)` | `admin` \| `user`. 기본 `user` |
| `org_l1` / `org_l2` / `org_l3` | `String(200)` nullable | DN 파싱 결과(루트→리프) |
| `department` | `String(200)` | 도출값 = `org_l3 ?? org_l2 ?? org_l1` |
| `created_at` / `updated_at` | `DateTime(tz)` | `_now` / `onupdate=_now` (기존 모델 패턴) |

- `role` 결정: **AD 유저**는 `login_id ∈ SYSTEM_ADMIN_LOGIN_IDS` 면 `admin`, 아니면 `user`. **로컬 fixture**는 명시 role(아래 §7) — `source`로 구분.

## 4. 조직구조 파싱 · 필터링 — 순수 함수 (`backend/app/ad/org.py` + pytest)

DN은 리프→루트 순으로 토큰이 등장한다(예: `CN=...,OU=TeamA,OU=DeptB,OU=DivC,OU=SAMSUNGBIOLOGICS,DC=...`).

### 4.1 `parse_org(dn: str) -> OrgLevels`

`OrgLevels = (org_l1, org_l2, org_l3, department)` (각 `str | None`, department는 `str`).

1. DN에서 `OU=` 토큰 **값만** 추출 (등장 순 = 리프→루트). RDN 이스케이프(`\,` 등) 고려해 파싱.
2. 제외 토큰(대소문자·공백 **정확 일치**): `BioLogics Users`, `BioLogics Groups`, `SAMSUNGBIOLOGICS`, `President & CEO`.
3. 남은 OU를 **루트→리프** 순으로 뒤집어 `org_l1, org_l2, org_l3`에 매핑. 제외 후 **3개 초과면 루트 쪽 3개**만 사용(리프 쪽 초과분 버림).
4. `department = org_l3 ?? org_l2 ?? org_l1`(가장 깊은 레벨). 남은 OU가 0개면 `department = ""`.

### 4.2 `is_excluded(org_l1, login_id, name) -> bool`

다음 중 하나라도 참이면 동기화 제외(`True`):

- `org_l1 ∈ {Partners, Partner, External users, delete, Client, TEST, View}`
- `login_id`에 `.` 없음
- `name`에 `_` 포함

> 제외 규칙은 **로그인 동기화·전체 동기화 양쪽 동일** 적용.

### 4.3 테스트(`backend/tests/test_org.py`, AAA)

- 정상 4단계 DN → L1/L2/L3·department 매핑.
- 제외 토큰 섞인 DN(대소문자 경계 포함) → 토큰 제거 검증.
- OU 3 초과 → 루트 3개 선택·리프 버림.
- OU 0~2개 → department 폴백(`??`) 단계별.
- `is_excluded`: org_l1 블랙리스트 / `.` 없는 loginId / `_` 포함 name 각각.

## 5. LDAP 클라이언트 · 동기화 서비스 (`backend/app/ad/`)

### 5.1 `client.py` — ldap3 래퍼

- `settings`의 LDAP 5종으로 서비스 계정 bind. 전송 보안은 URL 스킴(`ldaps://`) + 선택 StartTLS(`LDAP_START_TLS`, 기본 false)로 구성.
- AD 속성: `sAMAccountName, displayName, title, distinguishedName`만 요청(raw `department` 미요청).
- `fetch_user(login_id) -> RawUser | None`: `(&(objectCategory=person)(objectClass=user)(sAMAccountName=<login_id>))`.
- `fetch_all_users() -> list[RawUser]`: 필터 기본값 `(&(objectCategory=person)(objectClass=user)(sAMAccountName=*))` — `LDAP_USER_FILTER`로 교체 가능. 페이징(`paged_search`) 사용.
- LDAP 미설정(필수 변수 공백)이면 클라이언트 비활성 — 호출부에서 graceful 처리(로그인 동기화는 skip, 전체 동기화는 503).

### 5.2 `service.py` — upsert 로직

- `to_employee(raw) -> EmployeeFields | None`: §4 매핑·파싱 적용, `is_excluded`면 `None`(제외).
- `sync_one(session, login_id) -> Employee | None`: AD 1인 조회 → 변환 → upsert(`login_id` PK 기준 갱신, `source="ad"`, role from `SYSTEM_ADMIN_LOGIN_IDS`). 제외/미존재면 기존 행 유지하고 `None`.
- `sync_all(session) -> SyncSummary`: enumerate → 변환·필터 → 일괄 upsert. 반환 `{scanned, upserted, excluded}`.
- role 부여는 단일·전체 공통 헬퍼 `resolve_role(login_id)`.

## 6. 엔드포인트 (`backend/app/routers/employees.py`)

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `GET /api/me` | 인증 사용자 | 현재 loginId 기준 employee 반환. 인증 ON + LDAP 설정 시 **먼저 `sync_one` upsert**. 행 없으면(로컬·AD제외 등) loginId 기반 최소 정보로 응답(role=user). |
| `GET /api/employees` | **admin** | 전체 employees 목록(테이블 조회용). |
| `POST /api/employees/sync` | **admin** | 전체 동기화. **인메모리 5분 가드** — 5분 내 재호출 시 `429`(남은 초 포함). 성공 시 `SyncSummary`. |

- **인증 의존성**: `get_current_employee(login_id=Depends(get_current_user))` → employees 조회(없으면 임시 Employee, role=user). `require_admin`은 `get_current_employee`의 role≠admin이면 `403`.
- `get_current_user`(auth.py) 보강: `auth_enabled=False`면 `X-Dev-User` 헤더 우선, 없으면 `settings.dev_user`. **헤더는 인증 OFF에서만 신뢰**(ON이면 무시).

## 7. 설정 · 환경변수 (`settings.py` + `.env.example`)

```
# AD(LDAP) — 비우면 동기화 비활성(로컬). 시크릿은 .env만(git 금지)
LDAP_URL=                    # 예: ldaps://ad.example.com:636
LDAP_BIND_DN=                # 서비스 계정 DN
LDAP_BIND_CREDENTIALS=       # 서비스 계정 비밀번호(시크릿)
LDAP_USER_SEARCH_BASE=       # 사용자 검색 기준 DN
LDAP_START_TLS=false         # ldap:// + StartTLS 쓸 때만 true
LDAP_USER_FILTER=            # 비우면 기본 enumerate 필터 사용
SYSTEM_ADMIN_LOGIN_IDS=      # admin loginId 콤마 구분(선택)
```

- Settings 필드: `ldap_url, ldap_bind_dn, ldap_bind_credentials, ldap_user_search_base, ldap_start_tls(bool), ldap_user_filter(str), system_admin_login_ids(str)`. 헬퍼 `admin_login_ids() -> set[str]`(콤마 분리·trim).
- `ldap_enabled` = 필수 4종이 모두 채워졌는지 파생 프로퍼티.

### 로컬 임시 유저 5명 (fixture, startup 시드 — auth OFF일 때만)

`source=local`. loginId는 `.` 포함·`_` 미포함(필터 규칙 비충돌), name 무 `_`.

| login_id | name | title | dept | role |
|---|---|---|---|---|
| `admin.kim` | 김관리 | 팀장 | 프로세스혁신팀 | **admin** |
| `user.lee` | 이업무 | 선임 | 구매팀 | user |
| `user.park` | 박담당 | 사원 | 인사팀 | user |
| `user.choi` | 최실무 | 책임 | 생산관리팀 | user |
| `user.jung` | 정사용 | 선임 | 품질팀 | user |

- 시드는 멱등 upsert. 프론트 임시 로그인 모달이 이 목록을 보여주고, 선택 loginId가 `X-Dev-User`로 흐른다.

## 8. 프론트엔드 (A·B)

### 8.1 로그인 화면 · 라우팅

- `/login` 라우트(App Router page).
  - **인증 ON**: "Keycloak으로 로그인" 버튼 → `signinRedirect()`.
  - **인증 OFF**: 같은 버튼 → 임시 로그인 모달(§7 5명 목록, 선택식). 선택 시 localStorage(`bpm.devUser`)에 loginId 저장 → 인증된 것으로 간주.
- **게이트(`AuthGate`/`providers.tsx`) 변경**: 미인증 시 즉시 `signinRedirect()` 하지 않고 **`/login`으로 라우팅**(와일드카드 — 임의 경로 접근 시). 인증되면 자녀 렌더, 로그인 성공 후 메인(`/`)으로.
  - "인증됨" 정의: 인증 ON = 유효 토큰 보유 / 인증 OFF = `bpm.devUser` 선택됨.
- 인증(토큰/프로필) 발행은 기존 `react-oidc-context` 로직 재사용. `redirect_uri`는 origin 유지(딥링크 복원 불필요 — 항상 메인으로).

### 8.2 현재 사용자 · 역할

- 인증 직후 **`GET /api/me`** 호출 → `current-user.ts` 스토어에 `{loginId, name, role, department}` 발행(기존 name/email 확장). role로 admin 메뉴 노출 판정.
- API 클라이언트(`lib/api`): 인증 OFF면 모든 요청에 `X-Dev-User: <bpm.devUser>` 헤더 부착. 인증 ON은 기존 Bearer 토큰.

### 8.3 TopNav 드롭다운 · 관리자 페이지 · 로그아웃

- TopNav 유저아이디 클릭 → 드롭다운: **관리자 페이지**(role=admin만) / **로그아웃**.
- **로그아웃**: 인증 ON = `signoutRedirect()`(또는 `removeUser` 후 `/login`) / 인증 OFF = `bpm.devUser` 제거 후 `/login`.
- **`/admin` 페이지(admin 전용)**: 현재는 `GET /api/employees` 테이블 조회 + "AD 전체 동기화" 버튼(`POST /api/employees/sync`, 결과·429 안내). 디자인은 추후. 비-admin 접근 시 메인으로 리다이렉트.

## 9. 로컬 개발 플로우 (요약)

```
인증 OFF 첫 진입 → 게이트가 /login → "로그인" → 임시 모달(5명) → 선택(admin.kim)
  → bpm.devUser 저장 → 메인 → 모든 API에 X-Dev-User: admin.kim
  → GET /api/me → employees(source=local) 조회 → role=admin → TopNav에 관리자 페이지 노출
```

## 10. 테스트 · 검증

- **순수 함수**: `test_org.py`(§4.3) — pytest.
- **서비스**: `to_employee`/`sync_*`는 LDAP를 모킹(외부 의존 mock 규칙)하고 upsert·필터·role을 실 DB 경로로 검증.
- 완료 기준: 백엔드 `pytest` + `ruff` green, 프론트 `eslint` + `next build` green → `main` 머지·푸시.

## 11. 권장 구현 순서 (커밋 단위)

1. `employees` 모델 + settings/env(.env.example) + 로컬 5명 시드.
2. `ad/org.py` DN 파싱·필터 순수 함수 + `test_org.py`.
3. `ad/client.py` + `ad/service.py`(`sync_one`) + 인증 의존성(`get_current_employee`/`require_admin`, `X-Dev-User`).
4. `routers/employees.py`(`/api/me`·`/api/employees`·`/api/employees/sync`) + 5분 가드 + admin 보호.
5. 프론트 `/login` + `AuthGate` 와일드카드 라우팅 + `current-user` role + `X-Dev-User` 헤더.
6. 임시 로그인 모달(5명) + TopNav 드롭다운 + `/admin` 테이블·동기화 버튼 + 로그아웃.

## 12. 범위 외 (YAGNI)

- Alembic 마이그레이션(기존대로 create_all + 보강).
- 스케줄러 기반 자동 동기화(수동 엔드포인트만).
- 관리자 페이지 본격 디자인(현재는 단순 테이블).
- AD 그룹→권한 매핑(role은 `SYSTEM_ADMIN_LOGIN_IDS`만).
- 딥링크 복원, 다중 컨테이너 가드 공유.
