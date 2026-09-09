# 고아 참조 감사(Ref audit) — 부서·사용자 참조 캐치·일괄 재지정·오너 알림 설계

작성 2026-09-09 · 브랜치 `feat/ux-polish` · 상태 **승인(구현 전)**

## 0. 배경·목표

조직개편·퇴직으로 현 조직에 없는 부서 경로·사용자를 참조하는 데이터가 남는다. 현재는 설정 > Departments 탭 상단 카드가 **부서 경로 3곳**(맵 부서 권한·그룹 부서 멤버·오우닝 부서)만 잡고 일괄 재지정한다(`GET/POST /api/admin/dept-remap`). 노드·SP 지정의 담당부서/담당자, 그리고 사용자 참조 전반은 잡지 못한다.

목표 4가지.

1. 부서·사용자를 참조하는 **12곳 전부**에서 고아를 캐치한다. 고칠 수 없는 항목(노드 필드)은 목록에만 뜬다.
2. 고칠 수 있는 항목은 **체크한 것만** 일괄 재지정한다. 고칠 수 없는 항목은 같은 목록에 체크 불가로 섞여 보인다.
3. 고칠 수 없는 항목은 **맵 오너에게 알림**을 보내 드래프트에서 직접 고치게 한다. 오너당 알림 1건에 맵 목록을 담는다. 그런 맵은 홈 목록에서 배지·필터로 드러난다.
4. 기존 관리 화면 문법(TableCard·CheckInput·DeptTreePicker·PrincipalPicker·ConfirmDialog·PersonHoverCard)을 재활용한다.

결정: 스캔은 **온디맨드**(저장 테이블 없음). 관리 탭을 열 때와 맵 목록을 조회할 때 그 자리에서 계산한다. 오너가 고치면 배지가 즉시 사라지고, 새 스키마·마이그레이션이 없다.

## 1. 참조 12곳과 처리 가능 여부

| # | 참조 | 값 형태 | 저장 위치 | 종류 | 일괄 처리 | 비고 |
|---|---|---|---|---|---|---|
| 1 | 맵 부서 권한 | 조직 경로 | `map_permissions(principal_type=department)` | dept | O | 기존 |
| 2 | 그룹 부서 멤버 | 조직 경로 | `user_group_members(member_type=department)` | dept | O | 기존 |
| 3 | 오우닝 부서 | 조직 경로 | `process_maps.owning_department` | dept | O | 기존. 소프트삭제 맵 포함 |
| 4 | SP 지정 부서 | 리프명 | `process_maps.sp_department` | dept | O | 오너 API가 드래프트 없이 바꾸는 필드 |
| 5 | 노드 담당부서 | 리프명 | `nodes.department` | dept | **X** | 드래프트 필요 → 캐치·알림만 |
| 6 | 맵 오너 | login_id | `process_maps.owner_id` | user | O (replace만) | 새 오너에게 알림 |
| 7 | 협업자 | login_id | `map_permissions(principal_type=user)` | user | O | |
| 8 | 승인자 | login_id | `map_approvers.user_id` | user | O | |
| 9 | 그룹 user 멤버 | login_id | `user_group_members(member_type=user)` | user | O | |
| 10 | 카테고리 권한자 | login_id | `category_permissions(principal_type=user)` | user | O | |
| 11 | SP 지정 담당자 | 영문 이름(콤마) | `process_maps.sp_assignee` | user | O | 이름 단위 치환 |
| 12 | 노드 담당자 | 영문 이름(콤마) | `nodes.assignee` | user | **X** | 드래프트 필요 → 캐치·알림만 |

제외: `map_versions.checked_out_by`는 HR sync의 `reconcile_departures`가 이미 해제한다. `created_by`·`granted_by`·`assigned_by`는 감사 이력이라 건드리지 않는다.

## 2. 유효 집합·고아 판정

| 집합 | 출처 | 판정 대상 |
|---|---|---|
| 부서 경로 | `orgchart.load_valid_org_prefixes(session, active_only=True)` — 기존 remap과 동일 | #1 #2 #3 (정확 일치) |
| 부서 리프명 | 위 경로의 **모든 세그먼트** ∪ active 직원 `department` | #4 #5 (정확 일치) |
| 사용자 login_id | `employees.active = True` | #6~#10 (행 없음도 고아) |
| 사용자 이름 | active 직원 `name` ∪ `korean_name`(빈 값 제외) | #11 #12 — 콤마 분리 후 이름별 판정 |

- 빈 값(`""`/NULL)은 고아가 아니다.
- 노드 스캔 범위: 맵별 **게시본(status=published) + 최신 드래프트(status=draft, 최대 id)**. 그 외 버전·아카이브·소프트삭제 맵의 노드는 제외. 오우닝(#3)만 소프트삭제 맵을 포함한다(복구 시 일관성, 기존 동작).
- 이름 기반(#11 #12)은 로그인이 아니라 **이름 문자열**이 그룹 키다. 동명이인이 한 명이라도 active면 유효로 본다(현행 `AssigneePills` 해석과 동일한 관대함).

## 3. 백엔드

### 3-1. 모듈 `backend/app/ref_audit.py`

```python
Source = Literal[
    "map_grant", "group_member", "owning_dept", "sp_dept", "node_dept",
    "map_owner", "map_collab", "map_approver", "group_user", "category_perm",
    "sp_assignee", "node_assignee",
]
FIXABLE: dict[Source, bool]   # node_dept·node_assignee만 False
OWNER_ACTIONABLE: frozenset   # {node_dept, node_assignee, sp_dept, sp_assignee} — 홈 배지 집계 대상

@dataclass
class RefLine:
    source: Source
    fixable: bool
    count: int                 # 노드 계열=해당 버전의 노드 수, 그 외 1
    map_id: int | None; map_name: str | None; owner_id: str | None; owner_name: str | None
    group_id: int | None; group_name: str | None
    category_id: int | None; category_name: str | None
    version_id: int | None; version_status: str | None   # 노드 계열만(published|draft)
    target_id: str             # 라인 식별자 — remap 요청이 되돌려주는 키(§3-3)

@dataclass
class RefGroup:
    kind: Literal["dept", "user"]
    value: str                 # 경로·리프명·login_id·이름 원문
    value_kind: Literal["path", "leaf", "login", "name"]
    lines: list[RefLine]

async def load_valid_sets(session) -> ValidSets
async def scan_refs(session) -> tuple[list[RefGroup], list[RefGroup]]   # (departments, users)
async def count_stale_refs_by_map(session, version_ids_by_map) -> dict[int, int]  # 홈 배지용 경량 경로
```

- `scan_refs`는 유효 집합 1회 로드 + 참조별 1쿼리(12쿼리 내외). N+1 금지.
- `count_stale_refs_by_map`는 `list_maps`가 이미 갖고 있는 `published_vid`·`latest_vid`(드래프트일 때만)를 받아 노드 2컬럼(`department`,`assignee`) + 맵 SP 2컬럼만 읽는다. 쿼리 3개(노드·유효 부서·유효 사용자)로 고정.
- `target_id` 규약: `"{source}:{pk}"` — 예 `map_grant:{permission_id}`, `owning_dept:{map_id}`, `node_dept:{version_id}`, `sp_assignee:{map_id}`, `map_owner:{map_id}`, `group_user:{member_id}`, `category_perm:{perm_id}`. 서버는 remap 시 이 키로 행을 다시 찾아 **요청 시점 값이 여전히 from_value인지 확인**하고 아니면 그 라인은 `skipped`로 돌려준다(동시 편집 방어).

### 3-2. `GET /api/admin/ref-audit` (sysadmin)

응답 `{ departments: RefGroup[], users: RefGroup[], generated_at }`. 그룹은 value 오름차순, 라인은 (fixable desc, map_name, source) 순. 기존 `GET /admin/dept-remap`은 삭제.

### 3-3. `POST /api/admin/ref-audit/remap` (sysadmin)

```json
{ "kind": "dept"|"user", "from_value": "...", "mode": "replace"|"remove",
  "to_value": "...",            // replace 필수. dept=조직 경로(현존), user=login_id(active)
  "target_ids": ["map_grant:12", "owning_dept:3", "sp_dept:3"] }
```

규칙.

- `to_value` 검증: dept는 유효 경로 집합에 있어야 422, user는 active 직원이어야 422. `mode=remove`에 `to_value`가 오면 무시.
- 라인별 적용(체크된 `target_ids`만). 소스별 동작:

| 소스 | replace | remove |
|---|---|---|
| map_grant | `principal_id=to`. 같은 맵에 to 행 있으면 높은 역할 유지 후 from 행 삭제(기존) | 행 삭제 |
| group_member / group_user | `member_id=to`. 중복이면 from 삭제(기존) | 행 삭제 |
| owning_dept | `owning_department=to` | **불가**(422 `owning department cannot be removed`) |
| sp_dept | `sp_department=leaf(to)` + `sp_changed_by/at` 스탬프 | 불가(422) — SP 부서는 필수 필드 |
| map_collab | map_grant와 동일. from이 owner 역할이면 건너뛰고 `skipped`(§3-4 ⑤) | 행 삭제(owner 역할이면 `skipped`) |
| map_approver | `user_id=to`. to가 이미 승인자면 from 삭제. 진행 중 pending 사이클은 리셋하지 않음 | 행 삭제 |
| category_perm | `principal_id=to`, 중복 시 from 삭제 | 행 삭제 |
| map_owner | §3-4 | **불가**(422 `owner cannot be removed`) |
| sp_assignee | 콤마 분리 → from 이름을 to 직원의 `name`으로 치환(중복 제거) + 스탬프 | from 이름만 제거 |
| node_dept / node_assignee | 422 `not fixable` | 422 |

- 응답 `{ applied: {source: count}, skipped: [target_id] }`. 커밋은 요청 단위 1회(부분 실패 없음 — 검증은 적용 전에 전부 수행).
- 기존 `POST /admin/dept-remap`은 삭제, `test_dept_remap.py`는 `test_ref_audit.py`로 흡수.

### 3-4. 오너 교체(`map_owner`, replace)

`permissions.transfer_owner`와 결과 상태를 맞추되 전제 조건이 다르다(퇴직 오너, 새 오너가 grant 없을 수 있음).

1. 퇴직 오너의 user grant(있으면) 삭제.
2. 새 오너의 user grant upsert → `role=owner`(기존 행이 있으면 역할만 상향). 다른 owner 역할 grant는 editor로 강등(기존 방어와 동일).
3. `owner_id=to`, `consultant_owner_pending=False`.
4. 새 오너에게 알림 `owner_assigned` 1건/맵: payload `{map_name, actor, actor_name, from_name}`(from_name=퇴직 오너 표시명).
5. 같은 요청에서 `map_collab` 라인이 함께 체크돼 있어도 오너 grant는 위 절차가 담당 — collab 처리에서 owner 역할 행을 만나면 건너뛰고 `skipped`에 넣는다(422 대신, 한 요청에서 둘 다 체크한 정상 사용을 막지 않기 위해).

### 3-5. `POST /api/admin/ref-audit/notify` (sysadmin)

```json
{ "target_ids": ["node_dept:41", "node_assignee:41", "sp_dept:7"] }
```

- 대상은 `OWNER_ACTIONABLE` 소스만(그 외 target_id는 422). 서버가 `target_id`→맵을 다시 해석해 **맵 오너별로 묶는다**.
- 오너별 알림 1건, type `ref_fix_requested`, `map_id=None`(복수 맵), payload:

```json
{ "actor": "admin.sys", "actor_name": "…", "count": 3,
  "maps": [ { "id": 41, "name": "Refund", "node_dept": 3, "node_assignee": 2, "sp_dept": 0, "sp_assignee": 0 } ] }
```

  `maps[].{node_dept…}`는 알림 시점 스캔값(라인 count 합). message(영어 폴백)는 `"{actor_name} asked you to fix stale department/assignee references in N map(s)"`.
- 오너가 없거나 고아(#6)인 맵은 건너뛰고 `skipped_maps: [{id, name, reason: "owner_missing"}]`로 돌려준다. UI는 "오너를 먼저 재지정하세요"로 안내.
- 응답 `{ recipients: n, maps: n, skipped_maps }`.

### 3-6. `GET /api/maps` — `MapOut.stale_ref_count: int`

`_set_card_metrics`에서 `count_stale_refs_by_map` 결과를 주입. 집계 = 게시본·드래프트의 노드 고아 부서·담당자 수 + SP 부서·담당자 고아 수. 접근권이 있으면 누구나 보인다(오우닝 누락 배지와 동일 정책). 휴지통 목록(`deleted`)은 0 고정.

### 3-7. 알림 유형 추가 2종

| type | 수신 | payload | 아이콘 |
|---|---|---|---|
| `ref_fix_requested` | 맵 오너 | §3-5 | `TriangleAlert` |
| `owner_assigned` | 새 오너 | `{map_name, actor, actor_name, from_name}` | `Crown` |

FE 4곳 동시 등록(payload 타입·`KNOWN_TYPES`·i18n `notifLabel.*`/`notifBody.*`·아이콘).

## 4. 프론트

### 4-1. 설정 > 조직 > 새 탭 `refs` — "Orphaned refs"(고아 참조)

`frontend/src/components/admin/ref-audit-panel.tsx`(패널) + `ref-group-card.tsx`(그룹 카드, 부서·사용자 공용) + `lib/ref-audit.ts`(순수 로직). 탭은 `CATEGORIES`의 조직 카테고리(`access: "admin"`)에 세 번째로 추가하되, 데이터는 sysadmin API라 admin(비 sysadmin)에게는 기존 다른 sysadmin 탭과 같은 403 안내 문구를 재사용한다.

레이아웃(영어 UI, 동적 데이터만 한글).

```
[Missing departments (3)]                                  [Rescan]
┌ Sales/APAC/Team-B  ·path·   grants 2 · owning 1 · nodes 5 ──▾┐
│ [x] Order intake   Map grant (editor)              1          │
│ [x] Order intake   Owning department               —          │
│ [ ] Refund         Node department · published     3  ⓘ draft │  ← 체크 불가, ink-tertiary
│ [ ] Refund         Node department · draft         2  ⓘ draft │
│ Reassign to [Select department…]     [Apply (2)] [Notify owners (1)] │
└───────────────────────────────────────────────────────────────┘
[Departed users (2)]
┌ jane.doe (Jane Doe) ·login·  owner 1 · collaborator 1 · nodes 4 ─▾┐
│ [x] Map A          Owner                            —  remove 불가 │
│ [x] Map B          Collaborator (editor)            —             │
│ [ ] Map C          Node assignee · published        4  ⓘ draft    │
│ (•) Replace with [Select user…]   ( ) Remove   [Apply (2)] [Notify owners (1)] │
└───────────────────────────────────────────────────────────────┘
```

- 섹션 헤더: 제목 + 건수 필 + 우측 `Rescan`. 비어 있으면 섹션 대신 빈 상태 한 줄("No missing departments").
- 그룹 카드: 접힘 기본, 헤더에 값(경로는 `font-mono`, 이름류는 그대로) + 종류 태그(path/leaf/login/name) + 소스별 합계 요약. 펼침은 `useSectionMotion` 아코디언. 헤더 체크박스 = 그 그룹의 체크 가능 라인 전체 토글.
- 라인: `CheckInput` + 맵/그룹/카테고리 이름(맵은 링크 `/maps/{id}`, 오너는 `PersonHoverCard`) + 소스 라벨(+역할/버전 상태) + count. 체크 불가 라인은 `text-ink-tertiary` + 툴팁 "Owner must fix this in a draft".
- 액션 바(그룹 하단, sticky 아님): 대상 피커 버튼(부서=`DeptTreePicker` 모달, 사용자=`PrincipalPicker` users만·active만) · 사용자 그룹만 mode 라디오(Replace/Remove) · `Apply (n)` · `Notify owners (n)`.
  - `mode=remove`이면 오너·오우닝·SP 부서 라인은 체크 해제되고 비활성(툴팁 "cannot be removed").
  - `Apply`는 체크 ≥1 + (replace면 대상 선택) 일 때만 활성. 클릭 → `ConfirmDialog`(from → to, n lines) → POST → 결과 한 줄(카드 하단, 기존 `remapMsg` 자리) → 자동 재스캔.
  - `Notify owners`는 체크 불가 라인 중 `OWNER_ACTIONABLE` 소스를 대상으로 한다(체크와 무관 — 체크 불가이므로). 건수는 오너 수. 클릭 → `ConfirmDialog`(오너 n명·맵 n개) → POST → 결과 한 줄(+ skipped 안내).
- 실패는 `humanizeApiError`. 모든 인터랙티브 요소에 `data-id`(`ref-audit-*`).
- `department-table.tsx`의 재지정 카드·관련 state·API 호출은 제거.

### 4-2. 홈 맵 카드·필터

- `map-card.tsx`: `stale_ref_count > 0`이면 오우닝 누락 배지와 같은 문법의 경고 필(`TriangleAlert` 12px, `bg-error/10 text-error`, 라벨 "Stale refs" 영어 고정, 툴팁 `home.staleRefsNote`에 건수). 오우닝 누락 배지와 동시 표시 가능(둘 다 카운트 자리 옆에 나란히).
- `home-filter-pills.tsx`: 기존 "Owning" 드롭다운을 **"Issues"**로 개명, 옵션 2개 `missing`(오우닝 누락) · `stale_refs`. 상태 키·세션 스토리지 키(`owning`)는 그대로 두고 허용값만 늘린다(`x === "missing" || x === "stale_refs"`). 필터 로직은 OR(둘 다 체크면 둘 중 하나라도).

### 4-3. 인박스 렌더

- `ref_fix_requested`: 제목=라벨, 본문 한 문장(`{actor}` 인물 필 포함) + 본문 아래 **맵 필 목록**(`Link /maps/{id}`, 각 필에 `node_dept+node_assignee+sp_dept+sp_assignee` 합 배지). `map_id`가 null이라 기존 "관련 맵" 버튼은 안 뜬다.
- `owner_assigned`: 기존 문법(`{actor}` 필 + `{from}` 이름 칩) + 관련 맵 버튼.
- 필 목록은 `formatNotificationBodyParts` 밖에서 `payload.maps`를 직접 렌더한다(파츠 문법은 문장 내 치환 전용이라 확장하지 않는다).

## 5. 테스트·검증

**BE (`backend/tests/test_ref_audit.py`, 기존 `test_dept_remap.py` 흡수)**

- 스캔: 경로 3곳·리프 2곳·login 5곳·이름 2곳 각각 고아 검출 / 유효값·빈값 미검출 / 게시본+최신 드래프트만(구 버전·아카이브 제외) / 소프트삭제 맵은 오우닝만 / 동명이인 active 1명이면 유효.
- remap: replace·remove 소스별 동작(위 표 전수), 병합(높은 역할 유지·중복 제거), owner remove 422, owning remove 422, to_value 미존재 422, `target_id` 값 불일치 → skipped, 노드 소스 422, sysadmin 게이트 403.
- 오너 교체: grant 정리·owner_id·pending 해제·`owner_assigned` 알림 1건.
- notify: 오너별 1건 묶음·payload maps 집계·오너 고아 맵 skipped·`OWNER_ACTIONABLE` 외 422.
- `list_maps.stale_ref_count`: 노드+SP 합, 휴지통 0, 비 sysadmin도 채워짐.

**FE**

- `lib/ref-audit.test.ts`: 체크 가능 판정(mode·source), 그룹 토글, 요청 payload 조립, notify 대상 오너 수 계산.
- `notification-format.test.ts`: 두 유형 라벨·본문.
- Playwright `frontend/scripts/pw-smoke-ref-audit.mjs`: 전용 sqlite 시드(소멸 부서 경로·퇴직자·노드 리프/이름 고아) → 탭 진입 → 그룹 펼침 → 체크·대상 선택·Apply → 재스캔 결과 → Notify → 인박스 알림 필 목록 → 홈 배지·Issues 필터. 게이트 4종(tsc·lint·vitest·catalog) + BE pytest·ruff.

**문서**

- `docs/deploy/db-migration-9910.md` §6-4·`setup-once.md` B4의 "Departments 탭 상단 카드" → "Orphaned refs 탭"으로 갱신.
- `docs/spec.md` §7에 "참조 감사" 항목 추가(12곳 표·온디맨드 결정·알림 2종).
- `frontend/COMPONENTS.md` 재생성, `PROGRESS.md` 항목.

## 6. 범위 밖(후속 후보)

- 에디터에서 낡은 노드 하이라이트·인스펙터 경고.
- HR sync 직후 자동 알림(반복 억제 필요).
- 인박스 알림에서 노드로 직행하는 딥링크.
