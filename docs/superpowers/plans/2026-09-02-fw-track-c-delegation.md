# Framework 트랙 C — 레벨 권한 위임·현황판·레벨 요약 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카테고리 구조 CRUD·하위 관리자 임명을 L1~L4 관리자에게 서브트리 위임(§7)하고, 프레임워크 현황판(§8.1)·설정 접근 확장(§8.2)·홈 레벨 요약 카드(§8.3)를 구현한다. 편입: fw_confirm 요청 철회 경로·그룹 기반 알림 수신자 테스트.

**Architecture:** 판정은 기존 `is_category_admin` 쿼리 형태를 유지한 채 select 컬럼만 늘려 레벨 인지형 `resolve_category_admin`으로 확장, 서브트리 스코프는 `_admin_category_ids`를 `(admin_ids, seed_ids)` 반환으로 확장해 CRUD 5게이트가 공유. 현황판은 `GET /categories/framework-overview`(배치 검사기 `validate_confirm_readiness_batch` 신설 — L5당 ~10쿼리 반복을 일괄 로드로 대체). 홈 요약 카드는 `GET /categories/{id}/summary` 1왕복. FE는 설정 Access 1케이스 추가 + FrameworkPanel 스코프 props + 홈 aside 3분기.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + TypeScript + vitest / Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-framework-l5-publish-governance-design.md` §7·§8(+§5 철회 결정 2026-09-02 추가분)

## Global Constraints

- 베이스 `dev`(ea445889 — 트랙 A·B 포함), 브랜치 `feat/fw-track-c-delegation`(워크트리 `.claude/worktrees/fw-track-c`).
- BE 테스트 `backend/`에서 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` / `.venv/bin/ruff check app/ tests/`(py311). FE `frontend/`에서 `npx tsc --noEmit`·`npm run lint`·`npx vitest run`·`npm run build`.
- **§7 위임 규칙(스펙 문면 해석 고정)**: 생성(자식 추가)·개명·정렬 = 서브트리 전체(seed 노드 자기 자신 포함) / **이동·삭제 = seed 노드 자신은 금지**(상위 소관) / 이동은 대상·새 부모 **양쪽** 모두 서브트리 내 / 임명(perms PUT·GET) = 서브트리 내 **자기(seed) 레벨보다 하위 레벨** 카테고리만 / 루트 생성(parent_id=None)·인터뷰 임포트 = sysadmin 전용 유지. 위임 거부는 403 detail `"outside your delegated subtree"`(레벨 위반은 `"can only manage lower-level categories"`).
- `CategoryPermission.principal_id`는 그룹일 때 **문자열화된 group id**(`str(gid)`) — 시드·비교 형 변환 주의.
- `getCategoryChain` 응답 `map_count`는 서버가 0 고정 — 요약 카드가 체인에서 집계를 읽지 말 것.
- 색 토큰만·Lucide 16/1.5·i18n en/ko 대칭. PROGRESS는 마지막 태스크 1회.
- 줄번호는 dev ea445889 실측(2026-09-02) — 선행 태스크로 밀리면 심볼/grep 재확인.

---

### Task 1: BE — 레벨 인지 판정 + MeOut 관리자 필드

**Files:**
- Modify: `backend/app/permissions/access.py:63-128`(is_category_admin 개조·resolve 신설), `backend/app/routers/categories.py:239-272`(_admin_category_ids seed 반환), `backend/app/schemas.py:1452-1469`(MeOut), `backend/app/main.py:185-199`(GET /me)
- Test: `backend/tests/test_categories_api.py`(또는 판정 테스트가 사는 파일 실측)

**Interfaces:**
- Produces:
```python
@dataclass
class CategoryAdminInfo:
    is_admin: bool
    admin_level: int | None      # 매치된 행이 붙은 카테고리의 level(최상위 매치 = 최소 level)
    admin_category_id: int | None
    direct: bool                 # 매치 행이 category_id 자신에 직접 붙음

async def resolve_category_admin(session, login_id, category_id) -> CategoryAdminInfo
# is_category_admin/is_direct_l5_admin은 이 확장형의 얇은 래퍼로 전환(기존 7곳 소비처 시그니처 불변)
async def get_admin_scope(session, user) -> tuple[set[int], dict[int, int]]
# categories.py의 _admin_category_ids 확장판: (서브트리 전체 admin_ids, seed_id→seed_level dict). sysadmin은 (전체, {}).
# MeOut.category_admin_root_ids: list[int] = []  — seed id 목록(can_view_dashboard 선례 패턴)
```

- [ ] **Step 1: 실패 테스트** — ① `resolve_category_admin`이 조상 행 매치 시 그 행의 level/category_id를 반환(직접 행이면 direct=True) ② 다중 매치(조상+직접) 시 **최소 level(최상위) 우선** ③ `get_admin_scope`가 seed dict를 반환 ④ `GET /me`가 관리자에게 `category_admin_root_ids` 반환·비관리자는 빈 배열. 셋업은 기존 카테고리 시드 헬퍼(`test_framework_canvas._seed_category` 또는 test_categories_api의 관례) 재사용.
- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현** — `access.py`: ①의 전량 로드 select에 `ProcessCategory.level` 추가, ③ perm select에 `category_id` 추가, 매치들 중 최소 level 채택. `categories.py._admin_category_ids`는 내부 로직 유지 + seed dict 동반 반환(기존 소비처는 튜플 언패킹으로 갱신 — grep 전수). `MeOut` 필드 + `main.py`에서 `get_admin_scope` seed 키 목록 주입.
- [ ] **Step 4: GREEN + full suite + ruff.** 기존 7개 소비처 회귀 0.
- [ ] **Step 5: Commit** — `feat(permissions): level-aware category admin resolution — 레벨 인지 판정·me 필드`

---

### Task 2: BE — 카테고리 CRUD 위임 5게이트

**Files:**
- Modify: `backend/app/routers/categories.py` — POST(:635-686)·PATCH(:689-809)·DELETE(:811-881)·GET perms(:988-997)·PUT perms(:1000-1026)
- Test: `backend/tests/test_categories_api.py`

**Interfaces:**
- Consumes: `get_admin_scope`(Task 1). 403 detail 문자열은 Global Constraints 고정값.

- [ ] **Step 1: 실패 테스트 — 위임 매트릭스** (L2 관리자 `deleg.mid`를 시드해 케이스별 단언; sysadmin 경로 회귀 확인 포함):

```python
def test_delegated_create_child_inside_subtree(...):      # L2 관리자가 자기 서브트리 L3 아래 생성 → 201
def test_delegated_create_outside_subtree_403(...):       # 남의 트리 아래 생성 → 403 "outside your delegated subtree"
def test_delegated_root_create_sysadmin_only(...):        # parent_id=None → 관리자 403, sysadmin 201
def test_delegated_rename_own_seed_allowed(...):          # seed 노드 개명 → 200 (§7 해석: 개명은 자기 포함)
def test_delegated_move_seed_forbidden(...):              # seed 노드 이동 → 403
def test_delegated_move_outside_target_parent_403(...):   # 서브트리 내 노드를 밖 부모로 이동 → 403 (신설 검사)
def test_delegated_delete_seed_forbidden_child_ok(...):   # seed 삭제 403 / 하위 삭제 200(기존 409 규칙 유지 확인)
def test_delegated_perms_lower_level_only(...):           # L2 관리자가 L3 임명 200, L2(동급) 임명 403 "can only manage lower-level categories"
def test_delegated_perms_get_scope(...):                  # 서브트리 내 GET 200, 밖 403
def test_nonadmin_still_403_everywhere(...):              # 일반 사용자 전 CRUD 403
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: 구현** — 각 엔드포인트의 `Depends(require_sysadmin)`을 `user: str = Depends(get_current_user)`로 교체하고 본문 최상단에서 `admin_ids, seeds = await get_admin_scope(session, user)` 후 규칙 검사(sysadmin은 get_admin_scope가 전체 반환이라 자동 통과 — sysadmin 판정으로 seed 규칙 우회: sysadmin이면 seed 금지 미적용). PATCH는 **move 필드 존재 시에만** seed 금지+new_parent 검사(개명/정렬만이면 admin_ids 검사만). PUT perms의 레벨 규칙: `target.level > seeds[해당 seed].level` — 대상이 어느 seed 서브트리에 속하는지는 admin_ids 산출 시의 BFS를 seed별로 나누거나, 간단히 `max(seed level among seeds that contain target)`... **구현 단순화: 대상 카테고리 level이 `min(관리자 seed levels)`보다 크면 허용**(최상위 seed 기준 — 다중 seed 케이스에서 가장 관대하지만 §7 의도 부합, 주석으로 명시). 기존 로직(레벨 상한·이동 깊이·삭제 409·개명 동기 rename)은 불변.
- [ ] **Step 4: GREEN + full suite + ruff.** 기존 sysadmin CRUD 테스트 전건 그린.
- [ ] **Step 5: Commit** — `feat(categories): delegate subtree CRUD and appointment to category admins — 서브트리 위임 게이트`

---

### Task 3: BE+FE — fw_confirm 요청 철회 + 그룹 수신자 테스트

**Files:**
- Modify: `backend/app/routers/maps.py`(철회 DELETE — rename 철회 :853-880 템플릿, fw-confirm-requests 라우트들 옆), `frontend/src/components/framework-confirm-section.tsx`("Requested by" 캡션에 본인 요청이면 Withdraw 버튼), `frontend/src/lib/api.ts`(withdrawFwConfirmRequest), i18n
- Test: `backend/tests/test_fw_confirm_workflow.py`

**Interfaces:**
- Produces: `DELETE /api/maps/{map_id}/fw-confirm-requests/pending` — viewer 게이트 + `requested_by != user → 403` + pending 아니면 404/409(rename 선례 그대로), `status="withdrawn"`. **점유 자동 반환 없음**(스펙 §5 결정 — 주석 1줄).

- [ ] **Step 1: 실패 테스트** — ① 요청자 철회 → 204 + status withdrawn + 이후 새 요청 가능 ② 타인 철회 403 ③ pending 없음 404 ④ **그룹 기반 수신자**: `principal_type="group"`(str(group_id)) 행을 L5에 심고 그룹 멤버(user 멤버십)가 `fw_confirm_requested` 알림을 받는지 — 시드는 `tests/test_group_judgment.py:72-125 seed_group_map` 선례 + `test_fw_confirm_workflow._make_hierarchical_canvas` 조합.
- [ ] **Step 2: RED.**
- [ ] **Step 3: 구현** — BE 철회 라우트(rename 템플릿 복제, 알림 없음 — 스펙 3종 고정 주석). FE: `getPendingFwConfirmRequest` 소비부의 "Requested by" 캡션 옆, `pending.requested_by === 현재 사용자`일 때만 Withdraw 버튼(`data-id="framework-request-withdraw"`, 클릭→DELETE→상태 재조회). 현재 로그인 사용자 식별은 컴포넌트가 이미 받는 정보 실측(없으면 `useCurrentUser`류 훅/컨텍스트 grep — page.tsx의 username 소스).
- [ ] **Step 4: GREEN(BE full+FE 게이트 3종).**
- [ ] **Step 5: Commit** — `feat(framework): withdraw confirm requests and group recipient coverage — 요청 철회·그룹 수신자`

---

### Task 4: BE — `GET /categories/framework-overview` (배치 현황판)

**Files:**
- Modify: `backend/app/subprocess.py`(배치 검사기), `backend/app/routers/categories.py`(overview 라우트 + `_subtree_map_counts` 배치 헬퍼 추출 — `list_category_nodes:359-370`의 배치 블록), `backend/app/schemas.py`(FrameworkOverviewOut)
- Test: `backend/tests/test_categories_api.py` 또는 신규 `test_framework_overview.py`

**Interfaces:**
- Produces:
```python
# GET /api/categories/framework-overview?root_id=<int|생략>
# 게이트: sysadmin은 root 생략(전사) 또는 임의 root; 카테고리 관리자는 root_id가 자기 admin_ids 안일 때만(403), 생략 시 자기 seed들 전체.
# 응답 FrameworkOverviewOut{rows: [FrameworkOverviewRow]}:
#   {category_id, path: str, linkage_map_id: int|None, latest_fw: str|None("v2.1"), confirmed_at: str|None,
#    confirmed_by: str|None, ready: bool|None(캔버스 없으면 None), failures: [{code,count}](node_ids 생략 — 경량)}
async def validate_confirm_readiness_batch(session, canvases: list[tuple[ProcessMap, int]]) -> dict[int, list[GateFailure]]
# canvases=(맵, draft_version_id) 목록. Node/Edge를 version_id.in_() 2쿼리로 일괄 로드 → version별 그룹핑 →
# 기존 순수부(noexit/fanout 판정·placeholder)·배치 쿼리(링크맵 상태·published·missing)를 category/map 단위로 재사용.
```

- [ ] **Step 1: 실패 테스트** — ① sysadmin 전사 조회: L5 행 전부·캔버스 있는 행의 latest_fw/ready 정확(확정 1회 만든 캔버스 + 게이트 위반 캔버스 + 캔버스 없는 L5 3종 시드) ② 관리자 스코프: 자기 서브트리만·밖 root_id 403 ③ 비관리자 403.
- [ ] **Step 2: RED.**
- [ ] **Step 3: 구현** — 골격 쿼리(§실측): `select(ProcessCategory.id, linkage_map_id).where(level==5, id.in_(scope))` → path는 전량 로드된 (id,parent_id,name)로 메모리 조립(기존 chain/`build_category_paths` 선례 grep) → 최신 fw는 `map_id.in_()` 배치 max → draft들 일괄 로드(`status=="draft"` 최신, selectinload 없이 version_id만) → 배치 검사기. 정렬은 path 오름차순.
- [ ] **Step 4: GREEN + full + ruff.**
- [ ] **Step 5: Commit** — `feat(categories): framework overview endpoint with batch gate checks — 현황판 API·배치 검사기`

---

### Task 5: BE — `GET /categories/{id}/summary` (레벨 요약)

**Files:**
- Modify: `backend/app/routers/categories.py`, `backend/app/schemas.py`(CategorySummaryOut)
- Test: overview 테스트 파일에 추가

**Interfaces:**
- Produces:
```python
# GET /api/categories/{category_id}/summary — 로그인 전체(403 없음, 404만)
# CategorySummaryOut{
#   id, name, level, path,                       # path = 체인 이름 " > " 조인
#   child_count: int, subtree_l5_count: int, subtree_map_count: int,
#   admins: [{login_id, name, level}],           # 직접 행 + 조상 행(상속) — level은 행이 붙은 카테고리 레벨, 표시명 get_display_name
#   l5: {linkage_map_id, latest_fw, confirmed_at, confirmed_by, ready, failures:[{code,count}]} | None,   # level==5일 때
#   subtree_confirm: {confirmed: int, not_ready: int, no_canvas: int} | None }  # level<5일 때 — overview 행 집계 재사용
```
- Consumes: Task 4의 배치 재료(같은 파일 내 헬퍼 재사용 — 단건이라 `validate_confirm_readiness` 기존 단건판 사용 가능), `get_category_admin_logins`(admins — 직접+체인, 표시명), `_subtree_map_counts`.

- [ ] **Step 1: 실패 테스트** — L5 요약(캔버스 상태 포함)·L2 요약(subtree_confirm 카운트 3종)·404·admins에 상속 행 포함(level 표기).
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN + full + ruff.**
- [ ] **Step 5: Commit** — `feat(categories): per-category summary endpoint — 레벨 요약 API`

---

### Task 6: FE — 설정 접근 확장 + FrameworkPanel 위임 스코프

**Files:**
- Modify: `frontend/src/lib/current-user.ts:3-18`(+`categoryAdminRootIds`), `frontend/src/components/providers.tsx`(매핑), `frontend/src/app/settings/page.tsx`(:52 Access에 `"frameworkAdmin"`·:84-87 framework 카테고리 access 교체·:163-169 canAccess 1케이스 — dashboard 선례), `frontend/src/components/admin/framework-panel.tsx`(스코프 props·버튼 활성화·PermsModal 레벨 라벨), i18n
- Test: tsc/lint/vitest(판정 순수 함수 분리 시 단위 테스트)

**Interfaces:**
- Produces: `FrameworkPanel` 신규 props `scopeRootIds?: number[]`(undefined=sysadmin 전체). 내부: 스코프 모드면 루트 로드 대신 각 root id의 노드를 시딩(`getCategoryChain` 마지막 요소 또는 `listCategoryNodes(parent)` — 실측해 단순한 쪽), `add-root`·인터뷰 임포트 섹션 숨김, 행 버튼 활성화 `canManage(node, kind)`: 스코프 모드에서 move/delete는 `!scopeRootIds.includes(node.id)`, perms는 `node.level > minSeedLevel`(seed 노드들의 level은 시딩 시 확보), add-child/rename은 항상(스코프 내 렌더 자체가 서브트리 한정이므로).
- settings/page.tsx: framework 탭 access를 `"frameworkAdmin"`으로, 패널 마운트에 `scopeRootIds={user?.isSysadmin ? undefined : user?.categoryAdminRootIds}` 전달.
- PermsModal: 헤더에 `L{level} admins` 라벨 + 하향 상속 안내 1줄(i18n).

- [ ] **Step 1: 구현(실측 기반) → Step 2: 게이트(tsc·lint·vitest) 그린 → Step 3: Commit** — `feat(fe): open framework panel to category admins with subtree scope — 설정 위임 스코프`

---

### Task 7: FE — 현황판 뷰 (설정>Framework 전환)

**Files:**
- Modify: `frontend/src/lib/api.ts`(getFrameworkOverview), `frontend/src/components/admin/framework-panel.tsx`(상단 세그먼트 "Manage ↔ Status" — `page.tsx:697-719 home-view-toggle` 스타일 복제) + 신규 `frontend/src/components/admin/framework-overview.tsx`, i18n
- Test: tsc/lint/vitest

**Interfaces:**
- Produces: `FrameworkOverview({scopeRootId?})` — L5 행 테이블(`data-id="framework-overview"`, 행 `framework-overview-row-${category_id}`): 경로 · 캔버스 유무 · 최신 확정(vX.Y+확정일) · ready 필(Ready=added 톤/Blocked=error 톤+실패 코드 필 나열/No canvas=중립) · "Open" 버튼(`/maps/{linkage_map_id}` 이동, 없으면 비활성). 게이트 코드 라벨은 트랙 B의 `framework.gate.*` i18n 키 재사용. 로딩/빈 상태 data-id 부여.

- [ ] **Step 1: 구현 → Step 2: 게이트 그린 → Step 3: Commit** — `feat(fe): framework status board view — 현황판 뷰`

---

### Task 8: FE — 홈 레벨 요약 카드 (§8.3)

**Files:**
- Modify: `frontend/src/lib/api.ts`(getCategorySummary), `frontend/src/components/maps/framework-tree.tsx`(:36-45 props에 `selectedCategoryId`·`onSelectCategory`, :254-270 헤더 클릭에서 토글+선택 동시, 행 하이라이트 `bg-accent-tint text-accent`), `frontend/src/app/page.tsx`(:67 카테고리 선택 state·selectMap/selectCategory 래퍼로 배타·:599-602 빈공간 해제·:963-982 aside 3분기) + 신규 `frontend/src/components/maps/category-summary-card.tsx`, i18n
- Test: tsc/lint/vitest + 요약 조립 순수 함수 있으면 단위 1개

**Interfaces:**
- Produces: `CategorySummaryCard({categoryId, onOpenCanvas, onSelectMap?})` — 레이아웃은 `map-detail-card` 선례: 헤더(경로 브레드크럼+레벨 배지 `L{n}`) · 집계 3필(직계/서브트리 L5/맵 수) · 관리자 필 목록(이름+`L{level}` 캡션) · **L5 섹션**: 캔버스 상태(최신 확정·게이트 ready 필+실패 코드·Open canvas 버튼=`openLinkageMap` 기존 패턴 재사용 page.tsx:876-886) · **L1~L4 섹션**: subtree_confirm 카운트 3필(확정/미충족/캔버스 없음). `data-id="category-summary-card"`.
- page.tsx 배타 규칙: 맵 선택↔카테고리 선택 상호 해제, 빈 공간 클릭 시 둘 다 해제→HomeDashboard. 히스토리 push는 맵 선택만 유지(카테고리는 미포함 — 문서화된 가정, 후속 여지).

- [ ] **Step 1: 구현 → Step 2: 게이트 그린(build 포함) → Step 3: Commit** — `feat(fe): home category summary card — 홈 레벨 요약 카드`

---

### Task 9: 스모크 + 전체 게이트 + PROGRESS (마감)

**Files:**
- Modify: `frontend/scripts/pw-smoke-framework-admin.mjs`(위임·현황판) 또는 신규 검증 스크립트, `PROGRESS.md`

- [ ] **Step 1: 실브라우저 검증** — 워크트리 전용 포트(BE 8003·FE 3003, 자체 dev.db reset_db): ① sysadmin 설정>Framework에서 Manage↔Status 전환·현황판 행/ready 필 확인 ② 홈 framework 뷰에서 카테고리 행 클릭→요약 카드(L5·L2 각 1회)·맵 선택과 배타·빈공간 해제 ③ (가능하면) 위임 관리자 계정으로 설정 탭 노출+서브트리만 렌더 — 시드로 카테고리 권한자 심기(pw 시드는 앱 모델/API 경유 관례). 스크린샷 SHOT_DIR 보존. 범위 제한이 있으면 보고에 명시.
- [ ] **Step 2: BE 전체(pytest+ruff) → Step 3: FE 전체(tsc·lint·vitest·build) → Step 4: PROGRESS 1항목(1-3줄) + Commit** — `test(framework): smoke for delegation and status board — 트랙 C 마감`
