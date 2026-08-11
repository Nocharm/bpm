# 조직 기준 전환 — dept_info → departments + AD 인원별 manager

> 2026-08-11 · dev(953d5cb, HR 웹훅 머지) 기준 · 선행: [2026-08-10 HR 웹훅 디렉터리 설계](2026-08-10-hr-webhook-directory-design.md)

## 0. 목적

HR 웹훅 전환(§선행)으로 `departments` 테이블(HR `kind=departments` 미러 — dept_code 계층·영문/한글명)이 생겼다. 이 테이블이 수동 관리 `dept_info`보다 최신·정확하므로:

1. **조직도·부서권한 판정의 기준을 departments 계층으로 전환**한다 (employees `org_l1~l5`는 폴백으로 강등).
2. **dept_info를 소비에서 제외**한다 — 한글 부서명은 `departments.name_ko`, 부서장 개념은 **AD 인원별 manager 체인**으로 대체.
3. **JSON 임포트 2종(직원 한글명·dept_info)을 API까지 제거**한다.
4. 승인자 피커의 Manager 태그는 "나의 매니저 또는 매니저의 매니저"(개인 체인 2단계)로 재정의한다.
5. 부서관리 화면: 소멸 부서(고아) 재지정 섹션을 테이블 위로 이동, 테이블은 자체 스크롤 컨테이너로 격리.

### 확정 결정 (사용자, 2026-08-11)

| 결정 | 내용 |
|---|---|
| 권한 principal 저장 형식 | **경로 문자열 유지** — `MapPermission.principal_id`·`UserGroupMember.member_id`·`ProcessMap.owning_department`의 저장값 무변경. 판정 입력(직원의 소속 경로)만 departments 해석으로 교체. 부서 개명 이관은 현행 dept-remap 콘솔 유지 |
| 빈 부서 표시 | **현행대로 숨김** — 트리·피커는 구성원이 있는 경로만. departments는 구조·이름의 소스일 뿐 노출 범위를 늘리지 않는다 |
| 임포트 제외 수준 | **API까지 제거** — `PUT /api/admin/dept-info`, `PUT /api/employees/korean-names` 엔드포인트·스키마·테스트 삭제. FE 모달 2종 삭제 |
| manager 태그 범위 | 개인 체인 **2단계**: 나의 매니저, 매니저의 매니저 |

## 1. 데이터 모델

```
employees
  + manager_login_id VARCHAR(100) NULL   # AD manager 역추적 결과. db.py _ADDED_COLUMNS 등록
  (org_l1~l5 · department · dept_code · korean_name · korean_dept — 유지, 의미 불변)

dept_info   # 모델 클래스 삭제(코드 참조 0), 운영 DB 테이블은 잔류(물리 드랍 금지 원칙)
departments # 무변경 — 이번 전환으로 첫 소비처 발생
```

- `korean_dept`(직원별 HR departmentKo)는 유지 — 멤버 카드 표시·피커 검색 키워드로 계속 쓴다.
- `dept_info` 테이블/데이터는 남는다(롤백 대비). 코드에서 모델·참조를 전부 제거하므로 신규 로컬 sqlite에는 생성되지 않는다.

## 2. 경로 해석 계층 — 신설 `backend/app/orgchart.py`

직원 → 조직 경로(루트→리프 `/` 조인 문자열) 해석을 한 곳으로 단일화한다.

```python
@dataclass(frozen=True)
class DeptIndex:
    by_code: dict[str, DeptRow]      # dept_code → (name, name_ko, parent_dept_code)
    name_ko_by_name: dict[str, str]  # 영문명 → 한글명 (충돌 시 dept_code 정렬 첫 행 우선)

async def load_dept_index(session) -> DeptIndex        # departments 전체 1회 로드
def resolve_org_path(emp, index) -> str                # 아래 규칙
def resolve_org_prefixes(path) -> list[str]            # "A/B/C" → ["A","A/B","A/B/C"]
```

`resolve_org_path` 규칙:

1. `emp.dept_code`가 index에 있으면 `parent_dept_code` 체인을 루트까지 상향, `name`을 루트→리프로 조인. **깊이 제한 없음**(현행 5레벨 캡 해소). 가드: 방문 집합으로 사이클 차단·최대 깊이 15, 빈 `name` 세그먼트는 건너뜀.
2. dept_code가 없거나(NULL) index에 없으면(스테일 코드·departments 빈 환경) **현행 폴백**: `org_path(org_l1..l5, department)` — 기존 `app/ad/org.py org_path()` 재사용.
3. departments 테이블이 비어 있으면 전 직원이 폴백 → **로컬 sqlite·테스트·HR 미설정 환경은 현행과 완전 동일 동작** (핵심 불변식).

체인 해석과 폴백이 다른 경로를 낼 수 있다(HR orgLevels와 departments 계층 불일치·5레벨 초과). 판정·트리·remap이 모두 같은 resolver를 쓰므로 앱 내부는 일관되고, 저장된 구 경로 principal과의 불일치는 기존 dept-remap 절차로 이관한다(§7).

## 3. 소비처 전환 (백엔드)

| 파일 | 현행 | 전환 |
|---|---|---|
| `permissions/access.py` (3곳: effective_role 경로·get_user_active_group_ids 입력·get_eligible_users) | `logic.org_path(org_l1..l5, department)` | `resolve_org_path(emp, index)` — 요청당 index 1회 로드 |
| `main.py` `/api/me` `org_path` | org 컬럼 조인 | resolver |
| `main.py` `/api/me` `manager_ids` | org 레벨별 `dept_info.manager` 체인 | **개인 체인 2단계** — `emp.manager_login_id` → 그 직원의 `manager_login_id` (§5) |
| `routers/directory.py` | users `org_path`·`seen_paths` = org 컬럼 프리픽스, `dept_infos` 조인(리프명→korean·manager) | 경로·프리픽스 = resolver, `DirectoryDeptOut.korean_name` = `name_ko_by_name[리프명]`, **`manager` 필드 삭제** |
| `routers/versions.py` eligible-assignees `dept_infos` | DeptInfo 조인 | `name_ko_by_name` — `DeptInfoValueOut`은 `korean_name`만 남김(`manager` 삭제) |
| `routers/admin.py` `get_admin_users` 부서 목록 | org 컬럼 파생 + DeptInfo 조인(korean·manager) | resolver 파생 + `name_ko_by_name`, **manager 필드 삭제** |
| `routers/admin.py` `_load_valid_org_paths` (dept-remap 유효 경로) | org 컬럼 프리픽스 | 전 직원 resolved 경로의 프리픽스 합집합 |
| `routers/dashboard.py` `_resolve_display_name`·coverage 한글맵 | DeptInfo 리프 조회/전체 로드 | `name_ko_by_name` 조회 |
| `routers/employees.py` `PUT /employees/korean-names` | 직원 한글명 JSON 임포트 | **삭제** (스키마·테스트 포함) |
| `routers/admin.py` `PUT /admin/dept-info` | dept_info JSON 임포트 | **삭제** (스키마·테스트 포함) |
| `hr/service.py` `_find_dept_info_orphans`·`SyncSummary.dept_info_orphans`·프리뷰 동명 필드 | dept_info 고아 리포트 | **삭제** (dept_info 소비 소멸로 의미 없음. 소멸 *경로* 리포트는 dept-remap이 담당) |
| `models.py` `DeptInfo` | — | 클래스 삭제 |

`hr/service.py`의 나머지(sync·가드·프리뷰의 case_mismatch/orphan_dept_paths)는 무변경. 단 프리뷰 `orphan_dept_paths`의 유효 경로 산정은 피드 orgLevels 기반 유지(이행 전 도구 — departments 미러가 아직 없을 수 있음).

## 4. AD 인원별 manager 역추적

AD 각 인원의 `manager` 속성은 매니저의 DN이다: `CN=Dongweon Yi (20150555),OU=…`.

- `ad/client.py`: `_ATTRS`에 `"manager"` 추가, `RawUser.manager_dn: str | None`.
- `ad/service.py`: `refresh_titles` → **`refresh_titles_and_managers`**로 확장(HR sync 후속 패스 호출부 동일). 같은 전수 스윕에서:
  1. **1차 — DN 매칭**: `dn.lower() → sam_account_name` 맵을 만들고 `manager_dn` 직접 조회. (각 RawUser가 자기 `distinguished_name`을 이미 가짐 — 추가 조회 없음)
  2. **2차 폴백 — CN 괄호 사번**: DN 문자열 표기가 안 맞는 행은 `manager_dn`의 CN에서 `(...)` 사번을 추출, 각자 자기 DN CN의 사번→login_id 맵과 대조.
  3. 해석 실패·자기 자신이면 기존 값 유지(소거하지 않음 — AD 일시 결측으로 체인이 깜빡이는 것 방지).
- `employees.manager_login_id` 갱신. title과 같은 패스라 실패 시 sync 본체는 무사(현행 try/except 유지). 반환은 `(title_refreshed, manager_refreshed)` — `SyncSummaryOut`에 `manager_refreshed: int | None` 추가(dept_info_orphans 제거와 같은 스키마 개편에 포함).
- 사번 자체는 컬럼으로 저장하지 않는다(매칭 중간값).

## 5. `/api/me` manager_ids — 개인 체인 2단계

```
m1 = employees[me].manager_login_id
m2 = employees[m1].manager_login_id  (m1이 존재할 때)
manager_ids = [m1, m2] 중 존재·active·본인 아님·중복 제거, 순서 유지(가까운 매니저 먼저)
```

- `MeOut.manager_ids` 형태 불변 → **승인자 피커의 Manager 태그·우선 정렬(`sortManagersFirst`) FE 코드 무변경으로 그대로 작동**. 의미만 "상위 부서장 체인" → "나의 매니저·매니저의 매니저"로 바뀐다.
- AD 패스가 아직 안 돈 환경(로컬·최초 배포 직후)은 빈 배열 — 태그 없음, 기능 저하 없음.

## 6. 프론트엔드 변경

| 파일 | 변경 |
|---|---|
| `components/admin/korean-name-modal.tsx` | 삭제 + `employee-table.tsx`의 진입 버튼 제거 |
| `components/admin/dept-info-modal.tsx` | 삭제 + `department-table.tsx`의 `dept-info-add-btn` 제거 |
| `components/admin/department-table.tsx` | ① **소멸 부서 재지정(고아) 섹션을 테이블 위로** 이동 — 테이블이 길어도 항상 보임 ② 테이블을 자체 스크롤 컨테이너로 격리(`max-h-[60vh] overflow-y-auto`, 카드 래퍼 `overflow-hidden` — "오버플로우 히든"은 컨테이너 클리핑으로 해석, 내용 접근은 스크롤 유지) ③ **Manager 열 삭제**(부서 단위 manager 개념 소멸), 한글명 열은 응답값 그대로(소스가 departments로 바뀜) |
| `components/permissions/principal-picker.tsx` | 부서 옵션의 `manager` 텍스트 검색 필드 제거 (Manager 태그·정렬은 유저 옵션 기능 — 무변경) |
| `lib/korean-dept.ts` `buildDepartmentOptions` | `manager` 키워드 제거 (`korean_name`·소속 유저 `korean_dept` 키워드는 유지) |
| `lib/api.ts` | `putKoreanNames`·dept-info 임포트 함수 삭제, `DirectoryDeptOut`/eligible `dept_infos`/admin dept 타입에서 `manager` 제거, `SyncSummary.dept_info_orphans` 제거 |
| i18n | 임포트 모달·Manager 열 관련 키 제거. Manager 태그 문구(`perm.principalManager`)는 유지 |

조직도 트리(`org-tree.ts`·홈·피커)는 **무변경** — 백엔드가 주는 경로 문자열의 파생 방식만 바뀐다. 5레벨 초과 경로도 문자열이라 그대로 동작.

## 7. 이행·롤백 (운영)

1. 배포 → `manager_login_id` 자동 ALTER(`_ADDED_COLUMNS`). dept_info 테이블은 그대로 두되 코드가 더는 읽지 않는다.
2. 배포 직후 상태: 한글 부서명 = departments.name_ko(이미 미러됨), Manager 태그 = **AD 패스 1회 전까지 빈 상태** → 다음 정기 sync 또는 수동 `POST /api/employees/sync`로 채움.
3. 경로 기준 전환으로 dept-remap 콘솔에 "소멸 경로"가 새로 보일 수 있다(HR orgLevels ↔ departments 계층 불일치분·5레벨 초과 심화 경로로의 재지정). **재지정 대상 옵션도 resolver 기반이므로 콘솔에서 그대로 이관 가능** — 고아 섹션이 테이블 위로 와서 눈에 띈다.
4. 롤백: 코드 리버트만으로 복원 — dept_info 데이터·org_l1~l5·기존 principal 모두 무손실.

## 8. 한계(수용)

- `name_ko_by_name`은 **영문 부서명 키** — 서로 다른 부모 아래 동명 부서는 첫 행이 이긴다(현행 dept_info 리프명 PK와 동일한 한계, dept_code 정렬로 결정적).
- departments 미러와 employees orgLevels가 크게 어긋나면 resolved 경로가 대량 이동할 수 있다 — 첫 배포 후 dept-remap 콘솔에서 확인이 이행 절차의 일부.
- HR sync-preview의 `orphan_dept_paths`는 피드 orgLevels 기준 유지(이행 전 도구 한계, 기존 유예 판정과 동일).

## 9. 테스트

- **orgchart 단위**: 체인 해석(루트→리프 순서)·폴백(dept_code NULL/스테일/departments 빈 테이블)·사이클 가드·빈 name 스킵·`resolve_org_prefixes`.
- **권한 회귀**: departments 시드 후 부서 principal 판정이 체인 경로로 매칭됨 + departments 빈 환경에서 기존 테스트 전체 그린(폴백 불변식 증명).
- **/me**: manager_login_id 시드로 2단계 체인·inactive 제외·자기참조 제외·빈 체인.
- **AD 패스**: fake RawUser로 DN 매칭·사번 폴백·해석 실패 시 기존값 유지·자기 자신 스킵.
- **directory/eligible/admin/dashboard**: 한글명이 departments.name_ko에서 옴, manager 필드 부재.
- **제거 확인**: korean-names·dept-info 엔드포인트 404(라우트 부재), 관련 테스트 삭제.
- **FE vitest**: `buildDepartmentOptions` manager 키워드 제거 반영, api 타입 컴파일, department-table 렌더(고아 섹션 선행·Manager 열 부재).
