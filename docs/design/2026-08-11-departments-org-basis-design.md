# 조직 기준 전환 — dept_info → departments + EDW 직책 기반 관리자

> 2026-08-11 · dev(953d5cb, HR 웹훅 머지) 기준 · 선행: [2026-08-10 HR 웹훅 디렉터리 설계](2026-08-10-hr-webhook-directory-design.md)
> **개정 v2 (2026-08-11)**: EDW에 사번 키 부서코드·직책 뷰 발견(n8n 연동) — v1의 "AD 인원별 manager DN 역추적"을 폐기하고 **EDW 직책(FRNM) 기반 부서장 모델**로 재설계. v1 구현분은 `backup/dept-basis-v1-impl` 브랜치 보존(orgchart resolver·권한 전환은 재사용).

## 0. 목적

HR 웹훅 전환(§선행)으로 `departments` 테이블(HR `kind=departments` 미러 — dept_code 계층·영문/한글명)이 생겼다. 이 테이블이 수동 관리 `dept_info`보다 최신·정확하므로:

1. **조직도·부서권한 판정의 기준을 departments 계층으로 전환**한다 (employees `org_l1~l5`는 폴백으로 강등).
2. **dept_info를 소비에서 제외**한다 — 한글 부서명은 `departments.name_ko`, 부서장은 **EDW 직책 데이터**로 대체.
3. **JSON 임포트 2종(직원 한글명·dept_info)을 API까지 제거**한다.
4. **EDW 직책 파이프라인 신설** — n8n 새 워크플로가 EDW 뷰의 부서장 목록(FRNM ≠ '프로')을 내려주고, AD `employeeNumber`로 사번→loginId 매핑해 `employees.position`에 저장. 승인자 피커의 Manager 태그는 "내 부서 체인(리프→루트)의 노출 직책 보유자"로 재정의.
5. 부서관리 화면: 소멸 부서(고아) 재지정 섹션을 테이블 위로 이동, 테이블은 자체 스크롤 컨테이너로 격리.

### 확정 결정 (사용자, 2026-08-11)

| 결정 | 내용 |
|---|---|
| 권한 principal 저장 형식 | **경로 문자열 유지** — `MapPermission.principal_id`·`UserGroupMember.member_id`·`ProcessMap.owning_department` 저장값 무변경. 판정 입력(직원 소속 경로)만 departments 해석으로 교체. 부서 개명 이관은 현행 dept-remap 콘솔 유지 |
| 빈 부서 표시 | **현행대로 숨김** — 트리·피커는 구성원 있는 경로만 |
| 임포트 제외 수준 | **API까지 제거** — `PUT /api/admin/dept-info`, `PUT /api/employees/korean-names` 엔드포인트·스키마·테스트 삭제. FE 모달 2종 삭제 |
| 직책 소스 (v2) | **EDW 뷰(MSSQL)** — n8n 새 워크플로(웹훅 path `hr-position`, 기존 `N8N_HR_TOKEN` X-API-Key 재사용). `DT = MAX(DT ≤ 오늘)` 스냅샷, `FRNM ≠ '프로'`(트림) 행만. **title은 계속 AD**(EDW 직책은 title 대체 아님) |
| 사번 매핑 (v2) | AD **`employeeNumber` 속성**(실측 확인: `20210194` 형태) = EDW `EMPID`. CN 괄호 파싱은 쓰지 않는다 |
| 관리자 노출 범위 (v2) | **부서 체인 전체(리프→루트)** — 각 레벨의 노출 직책 보유자 전부(본인·중복 제외, 가까운 순). 구 dept_info 부서장 체인과 같은 형태라 피커 UX 무변경 |
| 노출 직책 allowlist (v2) | **sysadmin이 프론트에서 선택** — `app_settings` 키 `exposed_positions`(JSON 배열), 행 없으면 기본 `["그룹장","파트장","팀장","센터장"]`. 수집된 직책 목록에서 체크 |

## 1. 데이터 모델

```
employees
  + position VARCHAR(100) NULL   # EDW 직책(FRNM) — 부서장 목록에 있는 직원만, 그 외 NULL. db.py _ADDED_COLUMNS 등록
  (org_l1~l5 · department · dept_code · korean_name · korean_dept · title — 유지, 의미 불변)

dept_info    # 모델 클래스 삭제(코드 참조 0), 운영 DB 테이블은 잔류(물리 드랍 금지 원칙)
departments  # 무변경 — 이번 전환으로 첫 소비처 발생
app_settings # 키 추가만: exposed_positions (DDL 불요)
```

- `korean_dept`(직원별 HR departmentKo)는 유지 — 멤버 카드 표시·피커 검색 키워드.
- `dept_info` 테이블/데이터는 남는다(롤백 대비). 코드에서 모델·참조 전부 제거 → 신규 로컬 sqlite에는 생성 안 됨.

## 2. 경로 해석 계층 — 신설 `backend/app/orgchart.py`

직원 → 조직 경로(루트→리프 `/` 조인 문자열) 해석을 한 곳으로 단일화한다. (v1 구현 `backup/dept-basis-v1-impl`의 2fefc78 재사용 가능)

```python
@dataclass(frozen=True)
class DeptIndex:
    by_code: dict[str, DeptEntry]    # dept_code → (name, parent_dept_code)
    name_ko_by_name: dict[str, str]  # 영문명 → 한글명 (충돌 시 dept_code 오름차순 첫 행 우선)

async def load_dept_index(session) -> DeptIndex        # departments 전체 1회 로드
def resolve_org_path(emp, index) -> str                # 아래 규칙
def resolve_org_prefixes(path) -> list[str]            # "A/B/C" → ["A","A/B","A/B/C"]
```

`resolve_org_path` 규칙:

1. `emp.dept_code`가 index에 있으면 `parent_dept_code` 체인을 루트까지 상향, `name`을 루트→리프로 조인. **깊이 제한 없음**(5레벨 캡 해소). 가드: 방문 집합 사이클 차단·최대 깊이 15, 빈 `name` 세그먼트 건너뜀.
2. dept_code가 없거나 index에 없으면 **현행 폴백**: `org_path(org_l1..l5, department)` (`app/ad/org.py` 재사용).
3. departments가 비어 있으면 전 직원 폴백 → **로컬 sqlite·테스트·HR 미설정 환경은 현행과 완전 동일 동작** (핵심 불변식).

## 3. 소비처 전환 (백엔드)

| 파일 | 현행 | 전환 |
|---|---|---|
| `permissions/access.py` (3곳: get_effective_role·get_eligible_users 루프·can_view_dashboard_db) | `logic.org_path(org 컬럼)` | `resolve_org_path(emp, index)` — 요청당 index 1회 로드 |
| **잔여 판정 경로 4파일** — `routers/library.py:35`·`routers/maps.py:234·438·509(list_editors 부서 확장)`·`routers/groups.py:118(_emp_org_path)`·`routers/categories.py:65` | `logic.org_path(org 컬럼)` | 동일 패턴 전환(v1 구현 중 발견된 플랜 누락분 — 남기면 엔드포인트 간 판정 불일치) |
| `main.py` `/api/me` `org_path` | org 컬럼 조인 | resolver |
| `main.py` `/api/me` `manager_ids` | org 레벨별 `dept_info.manager` 체인 | **부서 체인 직책 보유자** (§5) |
| `routers/directory.py` | org 컬럼 경로·`dept_infos` 조인(korean·manager) | 경로·프리픽스 = resolver, `korean_name` = `name_ko_by_name`, **`manager` 필드 삭제**, `DirectoryUserOut.position` 추가(§6) |
| `routers/versions.py` eligible-assignees `dept_infos` | DeptInfo 조인 | `name_ko_by_name` — `DeptInfoValueOut`은 `korean_name`만(`manager` 삭제) |
| `routers/admin.py` `get_admin_users` | org 컬럼 파생 + DeptInfo 조인 | resolver 파생(users·departments 동일 소스) + `name_ko_by_name`, **manager 필드 삭제** |
| `routers/admin.py` `_load_valid_org_paths` | org 컬럼 프리픽스 | 전 직원 resolved 경로 프리픽스 합집합 |
| `routers/dashboard.py` `_resolve_display_name`·coverage 한글맵 | DeptInfo 조회 | departments `name_ko` 조회(리프명, dept_code 정렬 첫 행) |
| `routers/employees.py` `PUT /employees/korean-names` | 직원 한글명 임포트 | **삭제** |
| `routers/admin.py` `PUT /admin/dept-info` | dept_info 임포트 | **삭제** |
| `hr/service.py` `_find_dept_info_orphans`·summary/preview `dept_info_orphans` | dept_info 고아 리포트 | **삭제** (소멸 *경로* 리포트는 dept-remap 담당) |
| `models.py` `DeptInfo` | — | 클래스 삭제 |

프리뷰 `orphan_dept_paths`의 유효 경로 산정은 피드 orgLevels 기반 유지(이행 전 도구).

## 4. EDW 직책 파이프라인 (v2 신설)

### 4-1. n8n 워크플로

`docs/deploy/n8n/hr-position-workflow.json` — n8n에 임포트 후 ① 웹훅 헤더 자격증명(hr-dept와 동일 X-API-Key) ② MSSQL 자격증명 ③ 쿼리의 `EDW_VIEW_TODO` 실제 뷰명, 3곳만 지정하면 된다.

- 쿼리: `DT = MAX(DT ≤ 오늘 YYYYMMDD)` 스냅샷(업데이트 지연 시 자동으로 전일분), `FRNM` 트림 후 `'프로'`·빈값 제외.
- 응답 계약: `POST /webhook/hr-position` (X-API-Key) → `{kind:"positions", dt:"20260811", count, rows:[{empId, deptCode, name, position}]}` — rows는 이미 부서장 후보만.

### 4-2. 백엔드 수집

- env: **`N8N_POSITION_URL`** 신규(Settings `n8n_position_url` + `.env.example` + **docker-compose backend `environment:` 블록** — `rules/backend/config.md`의 3종 세트). 토큰은 기존 `n8n_hr_token` 재사용. `position_enabled` property = URL·토큰 둘 다 존재.
- `hr/client.py` `fetch_positions() -> tuple[str, list[RawHrPosition]]` — 전체 1콜(타임아웃 30초, 수백 행), `RawHrPosition(emp_id, dept_code, name, position)` frozen dataclass, 트림·결측(empId/position) 행 skip 파싱.
- `ad/client.py`: `_ATTRS`에 `"employeeNumber"` 추가, `RawUser.employee_number: str | None`.
- `ad/service.py`: `refresh_titles` → **`refresh_titles_and_positions(session, positions) -> tuple[int, int, int]`** (title_refreshed, position_refreshed, position_unmatched). 같은 AD 전수 스윕에서:
  1. title 갱신(기존 로직 그대로).
  2. `employee_number → sam_account_name` 맵 구성(중복 사번은 오매칭 방지 위해 제외).
  3. positions rows의 `empId` 매핑 → 해당 `employees.position = FRNM` 갱신. 매핑 실패(사번 미해석·직원 행 부재)는 skip + `position_unmatched` 카운트.
  4. **소거 규칙**: positions rows가 1건 이상일 때만, 이번에 매핑된 리더 집합 밖의 기존 `position` 보유자를 NULL 소거(승진·이동 반영). 빈 피드(0행)면 소거 스킵(사고 방어 — departments 미러와 동일 패턴).
- `hr/service.py` 호출부(sync 후속 패스): `position_enabled`면 `fetch_positions()` 호출 → AD 패스에 전달. EDW fetch 실패 시 title만 갱신(positions=[] 전달 → 소거 스킵), AD 패스 실패 시 sync 본체 무사(현행 try/except 유지). `HrSyncSummary`·`SyncSummaryOut`에 `position_refreshed: int | None`·`position_unmatched: int | None` 추가.

## 5. /api/me manager_ids — 부서 체인 직책 보유자

```
내 dept_code에서 departments 부모 체인을 리프→루트로 상향하며, 각 코드에 대해
  managers = employees where dept_code == 그 코드 and active and position ∈ exposed_positions
리프부터 순서대로 manager_ids에 추가(본인·중복 제외).
```

- `MeOut.manager_ids` 형태 불변(list[str]) → **승인자 피커 Manager 태그·우선 정렬(`sortManagersFirst`) FE 무변경**. 의미는 "부서장 체인"으로 복원(소스만 dept_info→EDW 자동).
- dept_code가 없거나 departments가 빈 환경(로컬) → 빈 배열(태그 없음, 기능 저하 없음 — 시드로 재현 가능).
- 조회 비용: 체인 코드 목록으로 `WHERE dept_code IN (...) AND position IS NOT NULL` 1쿼리 후 메모리 필터.

### 5-1. 노출 직책 allowlist

- `app_settings` 키 `exposed_positions` — JSON 배열, 행 없으면 기본 상수 `DEFAULT_EXPOSED_POSITIONS = ["그룹장", "파트장", "팀장", "센터장"]` (`app/app_settings.py`의 기존 tips 패턴).
- 기존 `GET/PUT /api/admin/app-settings`(sysadmin)에 필드 추가: `exposed_positions: list[str]` + 읽기전용 `available_positions: list[str]`(= `SELECT DISTINCT position FROM employees WHERE position IS NOT NULL` 정렬).
- 노출 필터는 **백엔드 단일 강제**: manager_ids 산정과 directory `position` 직렬화(§6) 둘 다 allowlist에 든 직책만 노출. FE는 온 값을 그대로 표기.

## 6. 프론트엔드 변경

| 파일 | 변경 |
|---|---|
| `components/admin/korean-name-modal.tsx` | 삭제 + `employee-table.tsx` 진입 버튼 제거 |
| `components/admin/dept-info-modal.tsx` | 삭제 + `department-table.tsx`의 `dept-info-add-btn` 제거 |
| `components/admin/department-table.tsx` | ① **고아(소멸 부서 재지정) 섹션을 테이블 위로** ② 테이블 자체 스크롤 격리(`max-h-[60vh] overflow-y-auto` 래퍼) ③ **Manager 열 삭제**, 한글명 열은 응답값 그대로(소스=departments) |
| `components/admin/employee-table.tsx` | 한글명 임포트 버튼 제거 + **노출 직책 카드 신설**(수집된 `available_positions` 체크박스 → `exposed_positions` 저장, app-settings API) |
| 멤버 카드(디렉터리 표시) | `DirectoryUserOut.position`(노출 직책만 직렬화, 아니면 "") — title 옆 병기(예: `Principal · 팀장`). 표기 지점은 멤버 카드 2번째 줄 title 영역 |
| `components/permissions/principal-picker.tsx` | 부서 옵션 `manager` 검색 필드 제거. **Manager 태그·정렬은 무변경** |
| `lib/korean-dept.ts` `buildDepartmentOptions` | `manager` 키워드 제거 |
| `lib/api.ts` | 임포트 함수 2종 삭제, `manager` 필드 3타입 삭제, `SyncSummary` `dept_info_orphans`→`position_refreshed`·`position_unmatched`, `DirectoryUser.position` 추가, app-settings 타입에 exposed/available_positions |
| i18n | 임포트 모달·Manager 열 키 제거, 노출 직책 카드 키 추가(EN/KO) |

조직도 트리(`org-tree.ts`·홈·피커)는 **무변경** — 백엔드가 주는 경로 문자열의 파생 방식만 바뀐다.

## 7. 이행·롤백 (운영)

1. 배포 → `position` 자동 ALTER(`_ADDED_COLUMNS`). dept_info 테이블은 잔류하되 코드가 더는 읽지 않는다. 한글 부서명은 즉시 departments.name_ko로 전환.
2. n8n에서 `docs/deploy/n8n/hr-position-workflow.json` 임포트 → 자격증명 2개·뷰명 지정 → 활성화. `.env`에 `N8N_POSITION_URL` 추가(+compose environment 블록 — 누락 시 컨테이너 미도달).
3. 수동 `POST /api/employees/sync` 1회 → 요약의 `position_refreshed`/`position_unmatched` 확인 → 설정 화면에서 수집된 직책 목록 보고 노출 allowlist 조정.
4. 경로 기준 전환으로 dept-remap 콘솔에 소멸 경로가 새로 보일 수 있다 — 재지정 대상 옵션도 resolver 기반이라 콘솔에서 그대로 이관.
5. 롤백: 코드 리버트만으로 복원 — dept_info 데이터·org_l1~l5·기존 principal 무손실.

## 8. 한계(수용)

- `name_ko_by_name`은 영문 부서명 키 — 동명 부서는 dept_code 정렬 첫 행 우선(현행 dept_info 리프명 PK와 동일 한계).
- EDW `DT` 스냅샷 지연 → 쿼리가 자동으로 직전 영업일분 사용(최대 하루 지연 수용).
- 사번 매핑 실패 리더(AD `employeeNumber` 결측·중복)는 스킵 — `position_unmatched`로 정량 보고, 첫 이행 때 확인.
- 한 부서에 노출 직책 보유자가 여럿이면 전부 관리자로 노출(피커 태그 다수 — 수용).
- HR sync-preview `orphan_dept_paths`는 피드 orgLevels 기준 유지(이행 전 도구).

## 9. 테스트

- **orgchart 단위**: 체인 해석·폴백(dept_code NULL/스테일/빈 테이블)·사이클 가드·빈 name 스킵·프리픽스. (v1 테스트 재사용)
- **권한 회귀**: departments 시드 후 부서 principal 판정이 체인 경로로 매칭 + departments 빈 환경에서 기존 테스트 전체 그린(폴백 불변식). 잔여 판정 4파일 포함.
- **positions 파이프라인**: fetch_positions 파싱(트림·결측 skip)·employeeNumber 매핑·중복 사번 제외·소거 규칙(정상 피드만)·빈 피드 소거 스킵·EDW 실패 시 title만 갱신.
- **/me manager_ids**: departments+position 시드로 체인 리더 노출·allowlist 필터·inactive 제외·본인 제외·빈 환경 빈 배열.
- **allowlist API**: 기본값 폴백·PUT 저장·available_positions distinct.
- **directory/eligible/admin/dashboard**: 한글명 departments 소스·manager 부재·position 직렬화(allowlist 필터).
- **제거 확인**: korean-names·dept-info 라우트 부재(실행으로 상태코드 확인), 관련 테스트 삭제.
- **FE vitest**: buildDepartmentOptions·api 타입·department-table 렌더(고아 섹션 선행·Manager 열 부재)·노출 직책 카드.
