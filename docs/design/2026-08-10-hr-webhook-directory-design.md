# 사용자·조직도 소스 교체 — AD LDAP → n8n HR 웹훅 (2026-08-10)

사용자 목록·조직도의 단일 소스를 사내 AD(LDAP 디렉터리 조회)에서 사내 n8n HR 웹훅으로 교체한다.
LDAP은 삭제하지 않고 **title 조인 전용**으로 축소 유지한다(인증 폴백 기능은 현존하지 않으며 이번 범위 아님 — 코드 보존만).

> 전제: 운영 런칭 상태(운영 DB 리셋 불가, `docs/deploy/db-seed.md`). 기존 데이터(권한 경로·수동 임포트 한글값·login_id 참조) 보존이 1급 요구사항 — §9 이행 절차 참조.

## 0. 확정 결정 (브레인스토밍 Q&A)

| 쟁점 | 결정 |
|---|---|
| 퇴직자(status=inactive) 처리 | 행 유지 + `active=false`. **피커·디렉터리에서 제외**, 신규 비활성 전환 시 reconcile(점유 해제·pending 재평가). admin 콘솔만 비활성 표시 유지 |
| 주기 배치 트리거 | **백엔드 내장 스케줄러**(asyncio, env 주기). 수동 sysadmin 버튼 유지. n8n은 데이터 제공만 |
| LDAP "로그인 인증 폴백" | **코드 보존만** — client·설정 삭제 금지, title 배치에만 사용. 실제 인증 폴백은 현존 기능 아님, 필요 시 별도 과제 |

## 1. 엔드포인트 계약 (n8n HR 웹훅)

```
POST {N8N_HR_URL}          # 예: http://182.199.63.71:5678/webhook/hr-dept (※ 철자 실측 확인 — §11)
헤더: Content-Type: application/json, X-API-Key: {N8N_HR_TOKEN}
요청: {"kind":"employees","status":"all"} | {"kind":"employees","loginId":"..."} | {"kind":"departments"}
응답: {kind, count, rows}
```

- employees row: `loginId, status(active|inactive), name, nameKo, deptCode, department, departmentKo, orgL1~orgL3(+Ko), orgLevels/orgLevelsKo(빈 단계 압축 배열, 최대 6), orgPath/orgPathKo`. **loginId 외 전부 null 가능.**
- departments row: `deptCode, name, nameKo, parentDeptCode, level`
- 전수 약 6,000명 / 3MB / 수초. **타임아웃 180초.** 부분검색 불가 — 단건은 반드시 loginId.
- 이 응답에 **email·title·부서장은 없다.**

## 2. 모듈 구조 — 신규 `app/hr/` + 기존 파이프라인 재사용

- `app/hr/client.py` — httpx 웹훅 클라이언트: `fetch_all_employees()`, `fetch_employee(login_id)`, `fetch_departments()`. 타임아웃 180s, X-API-Key 헤더. 응답 row → `RawHrEmployee`/`RawHrDepartment` dataclass.
- `app/hr/service.py` — 동기화 오케스트레이션: 매핑(순수 함수) → upsert → inactive 전환 → 부재 삭제(청크) → departments 미러 → dept_info 고아 리포트 → AD title 패스. `workflow.reconcile_departures`·5분 가드 재사용.
- `app/ad/` — **client.py·settings 보존**(삭제 금지). `service.py`는 ① `LOCAL_USERS` 시드(auth OFF) ② **title 전용 패스 `refresh_titles()`**(전 직원 LDAP 조회 → `title`만 upsert, 이름·조직 미터치)로 축소. 기존 `sync_all`/`sync_one`(디렉터리 동기화)은 호출처가 HR로 바뀌므로 제거.
- 호출처 교체: `routers/employees.py` POST `/sync` → `hr.service.run_full_sync`, `main.py` `/api/me` 1인 동기화 → `hr.service.sync_one`.

## 3. 스키마

- `Employee`: **`email` 컬럼 모델 제거**(운영 DB 물리 드랍 없음), **`dept_code: str | None`(VARCHAR(100)) 추가**, `source` 의미 확장 `ad | local | hr`.
- 신규 `Department`(`departments`) 테이블: `dept_code` PK(VARCHAR(100)), `parent_dept_code`(nullable), `level`(INTEGER), `name`(VARCHAR(300)), `name_ko`(VARCHAR(300)), `updated_at`. create_all이 생성(신규 테이블 — `_ADDED_COLUMNS` 불요). 이번 범위 소비처 없음 — 조직도 트리 후속 기반.
- `db.py`:
  - `_ADDED_COLUMNS`에 `("employees", "dept_code", "VARCHAR(100)")` 등록.
  - **부트스트랩 스텝 `_relax_employees_email_not_null`**(비치명 스텝 패턴): Postgres `ALTER TABLE employees ALTER COLUMN email DROP NOT NULL`. 모델에서 email을 빼면 ORM INSERT가 email을 안 보내는데 운영 컬럼이 NOT NULL(서버 default 없음)이라 신규 직원 INSERT가 즉사하는 것을 방지. sqlite는 ALTER 불가 → 로컬은 reset_db 재생성으로 흡수(무설정 전제).

## 4. 매핑 규칙 (순수 함수 — 핵심 테스트 대상)

| HR | employees | 비고 |
|---|---|---|
| `loginId` | `login_id` | 필수 — 없으면 행 skip(카운트) |
| `status` | `active` | `active`→True, 그 외→False |
| `name` | `name` | null → `login_id` 폴백(현행 관례) |
| `nameKo` | `korean_name` | null → **기존값 보존**(소거 아님) |
| `department` | `department` | null → orgLevels 리프 폴백 |
| `departmentKo` | `korean_dept` | null → 기존값 보존 |
| `deptCode` | `dept_code` | 신규 컬럼 |
| `orgLevels[0..4]` | `org_l1~org_l5` | 루트→리프. 6레벨 이상 절사 시 리포트 카운트 |
| — | `title` | **절대 미터치** — AD title 패스 전용 |
| — | `email` | 컬럼 제거 |

- korean 필드는 HR non-null이면 **HR 우선 덮어씀**(HR가 새 소스), null이면 보존. 기존 수동 임포트 경로(`PUT /api/employees/korean-names`, `PUT /api/admin/dept-info`)는 보완용으로 존치.
- `role`은 현행대로 `SYSTEM_ADMIN_LOGIN_IDS` 파생. AD DN 기반 제외 규칙(`EXCLUDED_ORG_L1` 등)은 HR 피드에 미적용 — n8n 쿼리가 정제 책임(실데이터로 검증, §11).
- **불변식 감시**: `department != orgLevels 리프`인 행·6레벨 절사 행은 수정 없이 **카운트+샘플을 sync 요약에 리포트** — `permissions/logic.py`의 org_path 매칭(`org_l1~l5` 루트→리프 "/" 조인, 리프=department 전제)이 깨지는 지점 감지.

## 5. 전체 동기화 플로우 (`hr/service.sync_all`)

1. employees(status=all) 페치 → 매핑 → upsert. **행 `source='hr'` 스탬프** — 기존 `'ad'` 행도 매칭 시 `'hr'` 전환.
2. inactive 행: `active=false`. **이번에 True→False로 전환된 유저 집합에 reconcile**(퇴직자 점유 해제 + pending 승인 재평가 — `load_active_approvers`가 이미 `active=True` 필터라 정합).
3. 피드 완전 부재 행: **`source IN ('ad','hr')`만 삭제**(레거시 'ad' 잔재 자연 소멸, `'local'` 시드 보존). **500개 청크로 IN 바인드**(SQLite 상한 회피). 삭제 대상에도 reconcile.
4. **삭제 안전 가드**: ① 응답 `count` vs `rows` 길이 정합 검증 ② 유효 집합 공집합이면 스킵(현행 유지) ③ **삭제 예정이 기존 배치 관리 행의 20% 초과 시 sync 중단**(부분 피드/사고 방어, `HR_SYNC_DELETE_CAP_PCT` env, 0=off) — 중단 시 요약에 사유 리포트.
5. departments 피드 → `dept_code` 기준 업서트, 피드 부재 코드 삭제(단순 미러 — 소비처 없음).
6. **dept_info 고아 검사(리포트만)**: `dept_info.department`가 (org_l1~l5 ∪ department distinct)에 없으면 요약에 나열. **수정·삭제 금지**(manager는 이번 범위 제외 — 절대 안 덮음).
7. **이어서 AD title 패스**: `ldap_enabled`면 `ad.service.refresh_titles()` — title만 갱신. 실패해도 sync는 성공 처리(로깅만).
8. 5분 가드(`run_full_sync`) 유지 — 수동 버튼·스케줄러 공유.
9. 요약 개편 `SyncSummaryOut`: `scanned / upserted / deactivated / deleted / skipped / org_mismatches / truncated_levels / dept_info_orphans[] / aborted_reason?` + FE sync 요약 표시 갱신.

## 6. 1인 동기화 (`/api/me`) · 스케줄러 · 설정

- 1인 동기화: `hr.sync_one(login_id)` — 단건 웹훅 호출. 게이트는 현행 패턴 승계: `auth_enabled and hr_enabled`일 때만 실행(로컬·미설정은 무음 스킵). title 보존, HR 미응답/미존재 시 기존 행 유지(None 반환). inactive 응답이면 active=false 반영. **유저당 하루 1회 인메모리 스로틀**(login_records 하루 1건 리듬과 동일) — 앱 로드마다 외부 웹훅 호출로 인한 로그인 레이턴시·n8n 부하 방지.
- 스케줄러: `main.py` lifespan asyncio 태스크 — `hr_enabled`이고 `HR_SYNC_INTERVAL_HOURS > 0`(기본 24)일 때 주기 실행, `run_full_sync` 재사용(가드 공유). 단일 컨테이너 전제(현행 5분 가드와 동일).
- 설정(3종 세트 — settings + `.env.example` + **docker-compose backend environment 블록**, `rules/backend/config.md`):
  - `N8N_HR_URL` — 웹훅 주소(하드코딩 금지)
  - `N8N_HR_TOKEN` — X-API-Key 시크릿(.env만, 커밋 금지)
  - `HR_SYNC_INTERVAL_HOURS` — 기본 24, 0=스케줄러 off
  - `HR_SYNC_DELETE_CAP_PCT` — 기본 20, 0=가드 off
  - `hr_enabled` property = URL·TOKEN 모두 설정 시 True. 미설정이면 sync 엔드포인트 503(현행 LDAP 게이트 패턴).

## 7. 소비처 스윕 — active 필터

퇴직자 행이 DB에 잔류하게 되므로("비활성은 DB에 없다" 전제 폐기) Employee 전수 조회 지점에 `active=True` 필터 추가:

- `routers/directory.py` — users·부서 경로 파생 모두 active 기준
- `permissions/access.py get_eligible_users` — 협업자·담당자·승인자 후보
- `routers/versions.py` eligible-assignees·`routers/maps.py` 점유권 이전 피커 등 피커성 조회 전수
- **예외(비활성 포함 유지)**: `/api/admin/users`(관리 가시성 — active 뱃지 표시), 이름 해석용 단건 get(`_resolve_display_name`, owner 이름 머지 등 — 퇴직자 이름이 계속 해석되는 것이 이번 전환의 개선점), `load_active_approvers`(이미 필터 있음)

## 8. email 컬럼 제거 스윕

`models.Employee.email` 제거 + `ad/service.py`(`EmployeeFields.email`·`LOCAL_USERS` placeholder)·`scripts/seed_org_demo.py`·스키마 잔재 제거. FE는 Employee.email 실사용 없음 확인됨(Keycloak scope의 email과 무관). 운영 DB 물리 드랍 없음 — §3 NOT NULL 완화만.

## 9. 기존 데이터 이행 (마이그레이션) — 운영 적용 절차

기존 데이터 위험 지점과 방어:

| 데이터 | 위험 | 방어 |
|---|---|---|
| `map_permissions.principal_id`(department)·`owning_department`·그룹 부서 멤버 | HR 영문 부서 표기가 AD OU와 다르면 org_path 변경 → 권한 고아 | **드라이런 리포트로 사전 산출** → 어긋난 경로는 기존 `/api/admin/dept-remap` 콘솔로 이관(자동 마이그레이션 금지) |
| login_id 기반 전 참조(승인자·점유·알림·권한 등) | HR loginId 표기(대소문자 포함)가 sAMAccountName과 다르면 전 참조 고아 | 드라이런에서 **login_id 집합 diff**(신규/삭제 예정/케이스 불일치) 산출 — 불일치 발견 시 적용 중단·보고 |
| 수동 임포트 `korean_name`/`korean_dept` | HR nameKo/departmentKo가 덮어씀 | HR null이면 보존. non-null 충돌 건수는 드라이런에 표시(HR 우선 정책 확인용) |
| `dept_info`(한글 부서명·**manager**) | 키(영문 리프명) 불일치 시 고아 | 고아 리포트만, 수정 금지. manager 불변 |
| 기존 `source='ad'` 행 | HR 피드 부재 시 삭제 대상 | 드라이런 삭제 예정 목록 + 20% 상한 가드 |

**드라이런**: `POST /api/employees/sync?dry_run=true`(sysadmin) — DB 무변경으로 위 리포트 전체를 반환. 운영 이행 순서:

1. 서버 배포(스키마 보강만 자동 적용 — email NOT NULL 완화·dept_code 추가·departments 생성)
2. **드라이런 실행 → diff 리포트 검토**(login_id 불일치 0 확인이 진행 조건)
3. 첫 실 sync 수동 실행 → 요약 확인(org_mismatches·dept_info_orphans·삭제 수)
4. 고아 부서 경로는 dept-remap 콘솔로 수동 이관
5. 스케줄러 활성(`HR_SYNC_INTERVAL_HOURS`)

## 10. 테스트 (httpx MockTransport 목 — 실 HTTP 없음)

- 매핑: null 각 필드·orgLevels 6레벨 절사·department≠리프 리포트·status 판정·loginId 결측 skip
- full sync: inactive 전환(+reconcile 발화)·부재 삭제 청크(>500 행)·`local` 보존·`ad`→`hr` 전환·삭제 상한 가드 중단·count 불일치 거부
- title: HR upsert가 title 미터치·AD 패스가 title만 갱신·AD 실패 시 sync 성공 유지
- 1인: 스로틀(하루 1회)·미존재 시 기존 행 유지·inactive 반영
- 게이트: HR 미설정 503·드라이런 무변경
- 소비처: directory·eligible에 inactive 미노출, admin에는 노출
- email 제거 회귀: 신규 INSERT 성공(NOT NULL 완화 스텝)
- 게이트: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" pytest tests/ -q` 그린 + ruff. FE 변경분(sync 요약 표시·email 잔재) vitest·tsc·lint.

## 11. 실데이터 확인 항목 (구현 전/중 검증 전제)

- [ ] 웹훅 URL 철자(`webhoop`→`webhook` 추정) — 실호출로 확정
- [ ] `orgLevels` 순서가 루트→리프인지
- [ ] HR 영문 부서명 ↔ 기존 AD OU 표기 diff 규모(드라이런으로 정량화)
- [ ] HR loginId ↔ sAMAccountName 완전 일치 여부(대소문자 포함)
- [ ] 6레벨 조직 실재 여부·department≠orgLevels 리프 사례 유무
- [ ] AD 제외 규칙 해당 계정(Partners·TEST 등)이 HR 피드에 섞여 오는지(n8n 쿼리 정제 범위 협의)

## 12. 원 지시안 10항목 대응

1 → §2(호출처 교체·LDAP 보존) · 2 → §4 · 3 → §8(+§3 NOT NULL 함정) · 4 → §5-7(title 패스) · 5 → §5-6/§9(manager 불변·고아 리포트) · 6 → §3/§5-5 · 7 → §5-2~4(inactive=비삭제·청크·local 보존, +삭제 상한 가드 보강) · 8 → §6(설정 3종 세트) · 9 → §4 불변식 감시 · 10 → §10.
