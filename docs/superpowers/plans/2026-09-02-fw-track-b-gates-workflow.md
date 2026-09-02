# Framework 트랙 B — 확정 게이트·요청 워크플로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L5 캔버스 확정에 완결성 게이트 6종(하드 블록)+점유 규약을 넣고, 상위 관리자→직속 L5 관리자 확정 요청 워크플로(알림·승인 표면 포함)를 구현한다.

**Architecture:** 검사기 `validate_confirm_readiness`는 `app/subprocess.py`에 async 신설(draft ORM 인메모리 + 배치 쿼리 2회). 확정 본체는 `app/framework_confirm.py` 신설 모듈로 추출해 라우터와 요청 승인(`_apply_request`)이 공유(라우터간 순환 import 방지). 상시 체크리스트는 신규 `GET /maps/{id}/confirm-readiness`가 단일 소스(422는 문자열 요약). 요청 워크플로는 `ApprovalRequest kind='fw_confirm'`으로 rename-requests 선례를 복제. 병행 팬아웃 예외 판정을 위해 `Edge.gateway` 컬럼을 신설한다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + TypeScript + vitest / Playwright(playwright-core+시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-09-02-framework-l5-publish-governance-design.md` §4(게이트)·§5(요청 워크플로) — 2026-09-02 보강판(병행 팬아웃 예외·readiness GET·직속 L5 최소형 판정).

## Global Constraints

- 베이스 브랜치 `dev`(69d62c21+), 작업 브랜치 `feat/fw-track-b-gates`(워크트리 `.claude/worktrees/fw-track-b`). 트랙 A(confirmed 상태·옆문 봉쇄)는 이미 dev에 있음.
- BE 테스트: `backend/`에서 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`. 린트 `.venv/bin/ruff check app/ tests/`(py311 — 3.12+ 문법 금지).
- FE 게이트: `frontend/`에서 `npx tsc --noEmit`·`npm run lint`·`npx vitest run`·`npm run build`.
- 신규 컬럼은 `db.py _ADDED_COLUMNS` 등록 필수(운영 자동 ALTER). 색은 토큰만. 알림 신규 타입은 FE 4곳 동시 갱신. i18n은 en/ko 두 블록 대칭(Record라 누락은 tsc가 잡음).
- 게이트 6종 코드 고정: `missing_l6`·`placeholder`·`stale_link`·`l6_unpublished`·`noexit_cycle`·`plain_fanout`. 422 detail 문자열: `"confirm gates failed: <comma-joined codes>"`. 점유 409 detail: `"another user holds the draft checkout"`.
- 확정 요청 kind 문자열: `fw_confirm`. 알림 타입 3종: `fw_confirm_requested`·`fw_confirm_done`·`fw_confirm_rejected`.
- 커밋 메시지 `type(scope): English summary — 한국어 요약`. PROGRESS는 마지막 태스크에서 1회.
- 아래 줄번호는 dev 69d62c21 실측(2026-09-02) — 선행 태스크로 어긋나면 심볼/grep으로 재확인.

---

### Task 1: BE+FE — `Edge.gateway` 컬럼 전수

**Files:**
- Modify: `backend/app/models.py:391-412`(Edge), `backend/app/db.py`(_ADDED_COLUMNS), `backend/app/schemas.py:1084-1096`(EdgeIn), `backend/app/routers/versions.py:169` 부근(clone_graph 엣지 복사), `backend/scripts/import_consultant.py`(연계 캔버스 엣지 기록), `frontend/src/lib/api.ts:194` 부근(Edge 타입), `frontend/src/lib/csv-import.ts:712,727,975` 부근 + `frontend/src/lib/merge-diff.ts`(line_style 이월 지점 미러)
- Test: `backend/tests/test_framework_canvas.py`, 기존 임포트 테스트 스위트

**Interfaces:**
- Produces: `Edge.gateway: str | None`(값은 `"parallel"`만 의미 — 자유 문자열이되 앱은 parallel만 해석), `EdgeIn.gateway`, FE `Edge.gateway?: string | null`. Task 2의 plain_fanout 예외가 소비.

- [ ] **Step 1: 실패 테스트 — gateway 왕복**

`backend/tests/test_framework_canvas.py`에 추가:

```python
def test_edge_gateway_roundtrip_and_clone(client: TestClient, enforce: None) -> None:
    """Edge.gateway가 graph PUT→GET 왕복·확정 clone에 보존된다 (spec §4 게이트 6 예외 재료)."""
    map_id, draft_id = _make_canvas(client, "FWC-GW5", "게이트웨이왕복")
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    edges = graph["edges"]
    if not edges:
        n = graph["nodes"]
        edges = [{"id": "gwedge000000000000000000000000001", "source_node_id": n[0]["id"],
                  "target_node_id": n[1]["id"], "label": "", "gateway": "parallel"}]
    else:
        edges = [dict(edges[0], gateway="parallel")] + edges[1:]
    _put_graph(client, draft_id, graph["nodes"], edges)
    got = client.get(f"/api/versions/{draft_id}/graph").json()["edges"]
    assert any(e.get("gateway") == "parallel" for e in got)
    ver = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()["version"]
    snap = client.get(f"/api/versions/{ver['id']}/graph").json()["edges"]
    assert any(e.get("gateway") == "parallel" for e in snap)
```

(`_make_canvas`가 L6 1개만 시드하면 노드가 1개라 엣지 구성이 안 될 수 있음 — 헬퍼/시드를 실측해 노드 2개 확보하도록 조정하라. `_put_graph` 시그니처는 `:304`.)

- [ ] **Step 2: RED 확인** — `pytest tests/test_framework_canvas.py -q -k gateway_roundtrip` → FAIL(gateway 필드 소실 or 422).

- [ ] **Step 3: 구현**

```python
# models.py Edge (line_style 옆) — 임포트 출처의 게이트웨이 종별. "parallel"만 앱이 해석(§4 게이트 6 예외)
    gateway: Mapped[str | None] = mapped_column(String(20), default=None)
```

```python
# db.py _ADDED_COLUMNS
    ("edges", "gateway", "VARCHAR(20)"),
```

```python
# schemas.py EdgeIn (line_style 아래)
    gateway: str | None = Field(default=None, max_length=20)
```

- graph 업서트(graph.py:438)는 `**edge.model_dump()`라 자동 반영 — 확인만.
- clone_graph(versions.py:169 부근): `line_style=edge.line_style,` 옆에 `gateway=edge.gateway,` 추가.
- FE `api.ts` Edge 인터페이스(line_style 옆): `gateway?: string | null;`
- CSV/AI 머지 이월: `git grep -n "line_style" frontend/src/lib/csv-import.ts frontend/src/lib/merge-diff.ts`로 **엣지 재생성 시 base에서 line_style을 이월하는 모든 지점**(csv-import.ts:712/727/975 + merge-diff.ts 해당부)을 찾아 gateway를 같은 방식(`src→dst` 키 맵)으로 이월. UI 표시는 없음(데이터 보존만).
- 임포터: `backend/scripts/import_consultant.py`에서 `expand_linkage_branches`(:934-958)의 반환 엣지가 실제 Edge 행으로 써지는 지점을 찾아(`rewritten` 소비처 grep), **비-fork 그룹(전부 parallel)으로 통과한 엣지에 `gateway="parallel"`을 기록**하라. 반환 튜플에 gateway를 실어 나르도록 시그니처를 `(src,dst,label,gateway)`로 확장하는 게 자연스럽다 — 소비처가 1곳인지 grep으로 확인 후 일괄 갱신.

- [ ] **Step 4: GREEN + 전체** — `pytest tests/ -q` 전건 + `ruff` + `cd frontend && npx tsc --noEmit && npx vitest run` PASS.

- [ ] **Step 5: Commit** — `feat(graph): add Edge.gateway for parallel fan-out provenance — 병행 팬아웃 판정용 gateway 컬럼`

---

### Task 2: BE — `validate_confirm_readiness` 검사기 6종

**Files:**
- Create: 검사기는 `backend/app/subprocess.py`에 추가(같은 모듈 응집 — validate_framework_canvas 아래)
- Modify: `backend/app/routers/categories.py:958-967`(missing 산식 헬퍼 추출·재사용)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Produces:
```python
@dataclass
class GateFailure:
    code: str          # 6종 고정 코드
    count: int
    node_ids: list[str]  # 위반 노드(없으면 빈 리스트)

async def validate_confirm_readiness(session: AsyncSession, found_map: ProcessMap, draft: MapVersion) -> list[GateFailure]:
    """확정 게이트 6종 — 통과면 빈 리스트 (spec §4). draft는 nodes/edges selectinload 전제."""

async def find_missing_l6_ids(session: AsyncSession, category_id: int, draft: MapVersion) -> list[int]:
    """소속 L6 중 캔버스 미배치 map_id — linkage-map 보강(categories.py)과 동일 산식."""
```
- Consumes: `Edge.gateway`(Task 1), `get_framework_category_id`(access.py:56).

- [ ] **Step 1: 실패 테스트 — 게이트별 1건씩**

`test_framework_canvas.py`에 검사기 직접 단위 테스트(라우터 경유 아님 — Task 3에서 통합):

```python
# 각 게이트를 위반 상태로 만들고 validate_confirm_readiness가 해당 code를 반환하는지.
# 셋업은 _make_canvas + _put_graph 조합. asyncio 테스트 관례는 파일 내 기존 async 사용례를
# grep해 따르되, 없으면 라우터 경유가 아닌 검사는 conftest의 세션 픽스처 관례를 확인해 작성.
def test_confirm_readiness_missing_l6(...):   # L6 하나 더 시드하고 캔버스에 미배치 → missing_l6
def test_confirm_readiness_placeholder(...):  # linked_map_id=None subprocess 노드 추가 → placeholder
def test_confirm_readiness_stale_link(...):   # 링크 L6를 소프트삭제 → stale_link
def test_confirm_readiness_l6_unpublished(...):  # 게시본 없는 L6 링크 → l6_unpublished
def test_confirm_readiness_noexit_cycle(...): # A→B→A 순환 + 밖으로 나가는 엣지 0 → noexit_cycle
def test_confirm_readiness_plain_fanout(...): # subprocess에서 엣지 2개 직접 → plain_fanout
def test_confirm_readiness_parallel_fanout_ok(...):  # 두 엣지 모두 gateway="parallel" → 통과
def test_confirm_readiness_clean_passes(...): # 정상 캔버스 → []
```

각 테스트의 셋업 그래프는 구체적으로: `_seed_l6_map`(:163)으로 L6를 늘리고, published 버전 존재 여부는 기존 시드 관례를 실측(시드 L6에 게시본이 없다면 l6_unpublished가 기본 위반 — clean 테스트는 L6에 게시본을 만들어야 함: `git grep -n "publish" backend/tests/test_framework_canvas.py`와 rename 워크플로 테스트의 게시 시퀀스 참고).

- [ ] **Step 2: RED 확인** — import 에러/미구현 FAIL.

- [ ] **Step 3: 구현**

```python
# subprocess.py — 게이트 검사기 (spec 2026-09-02 §4). 저장은 막지 않고 확정 시점에만 검사.
async def validate_confirm_readiness(session, found_map, draft) -> list[GateFailure]:
    failures: list[GateFailure] = []
    sub_nodes = [n for n in draft.nodes if n.node_type == "subprocess"]

    # 1) placeholder — linked_map_id 없는 subprocess (validate_framework_canvas와 동일 정의)
    ph = [n.id for n in sub_nodes if n.linked_map_id is None]
    if ph:
        failures.append(GateFailure("placeholder", len(ph), ph))

    linked = {n.linked_map_id: n.id for n in sub_nodes if n.linked_map_id is not None}
    # 2) missing_l6 — 소속 L6 미배치 (categories.py 보강 산식 공유)
    category_id = await get_framework_category_id(session, found_map.id)
    if category_id is not None:
        missing = await find_missing_l6_ids(session, category_id, draft)
        if missing:
            failures.append(GateFailure("missing_l6", len(missing), []))

    if linked:
        rows = (await session.execute(
            select(ProcessMap.id, ProcessMap.deleted_at, ProcessMap.retired_to_map_id)
            .where(ProcessMap.id.in_(linked.keys()))
        )).all()
        found_ids = {r[0] for r in rows}
        # 3) stale_link — 삭제/이양/실종 링크
        stale = [nid for mid, nid in linked.items()
                 if mid not in found_ids
                 or next(r for r in rows if r[0] == mid)[1] is not None
                 or next(r for r in rows if r[0] == mid)[2] is not None]
        if stale:
            failures.append(GateFailure("stale_link", len(stale), stale))
        # 4) l6_unpublished — 게시본 없는 링크 L6 (stale 제외 대상만)
        pub_ids = set((await session.execute(
            select(MapVersion.map_id).where(
                MapVersion.map_id.in_(linked.keys()), MapVersion.status == workflow.PUBLISHED
            ).distinct()
        )).scalars())
        unpub = [nid for mid, nid in linked.items()
                 if mid in found_ids and nid not in stale and mid not in pub_ids]
        if unpub:
            failures.append(GateFailure("l6_unpublished", len(unpub), unpub))

    # 5) noexit_cycle — 밖으로 나가는 엣지 0인 SCC(크기≥2 또는 자기루프)
    # 6) plain_fanout — 비-decision out-degree≥2, 단 전부 gateway=="parallel"이면 허용
    (그래프 알고리즘 — 아래 참고)
    return failures
```

SCC는 반복형(iterative) Tarjan 또는 Kosaraju로(재귀 한도 회피 — 대형 캔버스 268노드 실존). plain_fanout:

```python
    node_type_by_id = {n.id: n.node_type for n in draft.nodes}
    out_by_src: dict[str, list] = {}
    for e in draft.edges:
        out_by_src.setdefault(e.source_node_id, []).append(e)
    fanout = [
        src for src, group in out_by_src.items()
        if len(group) >= 2
        and node_type_by_id.get(src) != "decision"
        and not all(e.gateway == "parallel" for e in group)  # 병행 예외 (import_consultant.py:947과 동일)
    ]
```

`find_missing_l6_ids`는 categories.py:909-916(소속 L6 조회)+:958-967(미배치 산출)을 그대로 옮긴 것 — **`open_linkage_map`의 해당 구간도 이 헬퍼를 부르도록 교체**(중복 제거, 동작 불변 — 기존 linkage-map 테스트가 회귀 가드).

- [ ] **Step 4: GREEN** — 신규 8케이스 + 기존 linkage-map 테스트 전건 PASS, ruff 0.

- [ ] **Step 5: Commit** — `feat(framework): add confirm readiness gate checks — 확정 게이트 6종 검사기`

---

### Task 3: BE — 확정 본체 추출 + 게이트/점유/직속L5 통합 + readiness GET

**Files:**
- Create: `backend/app/framework_confirm.py` (확정 본체 — 라우터·요청 승인 공용)
- Modify: `backend/app/routers/maps.py:1200-1302`(라우터를 위임으로 축소 + readiness GET 신설), `backend/app/permissions/access.py`(is_direct_l5_admin 신설), `backend/app/routers/maps.py`의 `get_map` my_role 부근(`can_confirm` 주입 — `linkage_category_id` 주입 지점 실측), `backend/app/schemas.py`(MapOut.can_confirm, ConfirmReadinessOut)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Produces:
```python
# app/framework_confirm.py
async def perform_framework_confirm(session, found_map: ProcessMap, user: str, major: bool) -> tuple[MapVersion, list[str]]:
    """게이트 6종+점유+무변경 게이트+채번+프룬+clone까지 확정 전 과정. (snapshot, pruned_labels) 반환.
    위반 시 HTTPException(422 "confirm gates failed: ..." / 409 점유·무변경)."""
# access.py
async def is_direct_l5_admin(session, user: str, category_id: int) -> bool:
    """해당 카테고리에 직접 붙은 category_permissions 행 기준(상속 없음) — spec §5 최소형."""
# GET /api/maps/{map_id}/confirm-readiness → ConfirmReadinessOut{ready: bool, failures: [{code,count,node_ids}]}
# MapOut.can_confirm: bool = False (framework 맵에서만 의미 — sysadmin or 직속 L5 관리자)
```
- Consumes: Task 2 검사기, `is_checkout_active`(checkout.py:13).

- [ ] **Step 1: 실패 테스트**

```python
def test_confirm_blocked_by_gates(client, enforce):
    """게이트 위반 캔버스는 422 + 코드 나열 detail (spec §4 하드 블록)."""
    # placeholder 노드를 넣은 캔버스 → confirm → 422, "placeholder" in detail
def test_confirm_requires_checkout_free_or_own(client, enforce):
    """타인 점유 중 확정 409, 빈 점유는 자동 획득 후 성공 (spec §4 점유)."""
    # 다른 권한자에게 체크아웃 이전 후 confirm → 409 "another user holds the draft checkout"
    # 체크아웃 해제 후 confirm → 200, draft.checked_out_by == 확정자
def test_confirm_requires_direct_l5_admin(client, enforce):
    """상위(L4 등) 체인 관리자는 confirm 403, 직속 L5 관리자·sysadmin은 허용 (spec §5)."""
    # 부모 카테고리에 권한자 행을 단 사용자로 confirm → 403; 직속 행 사용자는 200
def test_confirm_readiness_endpoint(client, enforce):
    """GET confirm-readiness가 실패 목록을 반환하고, 해소 후 ready=true (spec §4)."""
def test_map_detail_exposes_can_confirm(client, enforce):
    """직속 L5 관리자·sysadmin만 can_confirm=true, 상위 관리자·뷰어 false."""
```

기존 확정 테스트들(`test_framework_confirm_versioning` 등)은 셋업이 게이트를 위반할 수 있다(시드 L6 게시본 부재 → l6_unpublished) — **기존 테스트 셋업을 게이트 통과형으로 보강**하는 것도 이 태스크 범위(예: `_make_canvas`에 L6 게시 시퀀스 추가 또는 게이트 통과 헬퍼 `_make_ready_canvas` 신설 후 기존 테스트 이관). 무엇을 택했는지 보고서에 명시.

- [ ] **Step 2: RED 확인** — 신규 5 FAIL(+기존 확정 테스트가 게이트에 걸려 FAIL하는 것도 RED 증거).

- [ ] **Step 3: 구현**

- `framework_confirm.py`: maps.py:1213-1298의 본체 이동. 순서 — mode 422 → **권한: `is_sysadmin(user) or is_direct_l5_admin(session, user, category_id)` 아니면 403 `"direct L5 admin or sysadmin only"`** → draft 조회(1223-1234) → **게이트: `failures = await validate_confirm_readiness(...)`; 있으면 422 `"confirm gates failed: " + ", ".join(f.code for f in failures)`** → **점유: `draft.checked_out_by`가 None이면 `user`/`now_kst()` 세팅, 타인이면 409 `"another user holds the draft checkout"`** → 무변경 게이트(major 우회) → 채번·프룬·clone·이벤트. 라우터는 얇은 위임(404/mode 체크 후 호출).
- `is_direct_l5_admin`: `category_permissions`에서 `category_id == X` 직접 행만 조회, principal user 일치 or group 멤버십(`get_user_active_group_ids` 재사용 — access.py:26).
- readiness GET: viewer 이상(맵 열람 가능자). draft 부재는 409(confirm과 동일 — 라이브 draft 영구 계약이라 실제로는 발생하지 않음). `ConfirmReadinessOut{ready, failures: list[GateFailureOut{code,count,node_ids}]}`.
- `can_confirm` 주입: `get_map`에서 framework 맵일 때 `linkage_category_id` 주입하는 기존 지점(grep `linkage_category_id` in maps.py)과 같은 블록에서 계산.

- [ ] **Step 4: GREEN + 전체 스위트** — framework 스위트 전건 + `pytest tests/ -q` PASS, ruff 0.

- [ ] **Step 5: Commit** — `feat(framework): enforce confirm gates, checkout hold and direct-L5 authority — 게이트·점유·직속 L5 확정권`

---

### Task 4: BE — fw 라이브 draft 삭제 차단

**Files:**
- Modify: `backend/app/routers/versions.py` delete_version(:399-446 부근)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:** Consumes `_assert_not_framework` 선례(같은 파일 :57-64) — 단 delete는 draft만 막으면 됨(confirmed는 이미 차단).

- [ ] **Step 1: 실패 테스트**

```python
def test_framework_live_draft_cannot_be_deleted(client, enforce):
    """캔버스의 라이브 draft 삭제 차단 — 영구 draft 계약 보호 (final review 인계)."""
    map_id, draft_id = _make_canvas(client, "FWC-DEL5", "드래프트삭제차단")
    res = client.delete(f"/api/versions/{draft_id}")
    assert res.status_code == 422 and "confirm workflow" in res.json()["detail"]
```

- [ ] **Step 2: RED** — 현재 204/403.
- [ ] **Step 3: 구현** — delete_version의 상태 차단 직후에 `await _assert_not_framework(session, version.map_id)` 추가(캔버스 버전은 draft든 뭐든 삭제 금지 — 스냅샷 정리는 major 프룬이 담당).
- [ ] **Step 4: GREEN + 전체.** — 일반 맵 draft 삭제 테스트 회귀 없음 확인.
- [ ] **Step 5: Commit** — `feat(versions): block deleting framework canvas versions — 캔버스 라이브 draft 삭제 차단`

---

### Task 5: BE — 확정 요청 워크플로 (kind='fw_confirm')

**Files:**
- Modify: `backend/app/routers/maps.py`(요청 POST — rename-requests(:759-819) 아래 병렬 신설 + 직접 확정 시 supersede), `backend/app/permissions/access.py`(get_category_admin_logins 신설), `backend/app/routers/permissions.py`(decide :581-585 kind 분기·`_apply_request` :694·`_notify_permission_decision` :750·pending 단건 노출), `backend/app/models.py:703-708`(kind/payload 주석)
- Test: `backend/tests/test_fw_confirm_workflow.py` (신규 — `test_map_rename_workflow.py` 구조 템플릿)

**Interfaces:**
- Produces: `POST /api/maps/{map_id}/fw-confirm-requests {note?}` → ApprovalRequestOut(201). `GET /api/maps/{map_id}/fw-confirm-requests/pending` → ApprovalRequestOut|None(viewer). decide는 기존 `POST /approval-requests/{id}/decide` 재사용(kind 분기). `get_category_admin_logins(session, category_id, direct_only: bool) -> list[str]`.
- Consumes: `perform_framework_confirm`(Task 3), 1맵1pending 409 선례(maps.py:788-797), supersede 선례(:733-757), 알림 `create_notifications`(workflow.py:53).

- [ ] **Step 1: 실패 테스트** (rename 워크플로 테스트 구조 준용 — `backend/tests/test_map_rename_workflow.py:84,112,212,265-341` 참고)

```python
# test_fw_confirm_workflow.py — 상위 관리자 요청 → 직속 L5/sysadmin 처리
def test_request_created_and_notifies_l5_admins(...):   # 상위 관리자 POST → 201 + fw_confirm_requested 알림(직속 L5 관리자+sysadmin, 요청자 제외)
def test_second_pending_request_conflicts(...):          # 중복 409
def test_direct_l5_admin_cannot_request(...):            # can_confirm 보유자는 요청 대신 확정 — 409 or 422 (구현 결정 명시)
def test_decide_approve_runs_confirm_with_gates(...):    # 승인 → perform_framework_confirm 실행(게이트 통과 캔버스) → 스냅샷 생성 + status="applied" + fw_confirm_done 알림
def test_decide_approve_fails_on_gate_violation(...):    # 게이트 위반 캔버스 승인 시 422 전파, 요청은 pending 유지
def test_decide_reject_records_reason(...):              # 반려 → decision_reason + fw_confirm_rejected 알림
def test_decide_requires_direct_l5_or_sysadmin(...):     # 요청자 본인/일반 editor decide → 403
def test_direct_confirm_supersedes_pending(...):         # 직접 확정 시 pending → superseded
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: 구현**

- 요청 POST(maps.py — rename 선례 복제): framework 맵 404/422 가드(일반 맵이면 422 `"not a framework linkage canvas"`), 권한 = 카테고리 관리자(체인, `is_category_admin`)이되 `can_confirm`이면 409 `"you can confirm directly"`, 중복 pending 409, `payload={"category_id": ..., "note": payload.note or ""}`, 알림 `fw_confirm_requested` → 수신자 `get_category_admin_logins(session, category_id, direct_only=True) + sysadmin 목록`... sysadmin 목록은 `logic.is_sysadmin`의 소스(BPM_SYSADMINS env+로컬 부여 — access/logic 실측)에서 수신자화 가능한 형태를 실측해 채용(불가하면 직속 L5 관리자만 수신 — 보고서에 명시).
- `get_category_admin_logins`: user 행 직접 + group 행은 그룹 멤버 login 확장(`UserGroup`/멤버십 모델 실측 — `get_user_active_group_ids`의 역방향).
- decide 확장(permissions.py): `:581-585` kind 게이트에 `elif req.kind == "fw_confirm": assert direct L5 or sysadmin(403)`; `_apply_request`(:694 앞)에 분기 — `perform_framework_confirm(session, found_map, user, major=False)` 호출(HTTPException은 그대로 전파 — pending 유지); `_notify_permission_decision`(:750 앞)에 `fw_confirm` 분기(`fw_confirm_done`/`fw_confirm_rejected`, payload에 `map_name`·`actor`·`actor_name`·`outcome`·`reason`).
- supersede: `perform_framework_confirm` 성공 직후(라우터 직접 경로) `_supersede_pending_fw_confirm(session, map_id, actor)`(maps.py:733-757 복제 — 알림 타입은 `fw_confirm_superseded`? **아니오 — 스펙 §5는 3종만. superseded는 알림 없이 status 전환만**, rename의 `rename_superseded` 알림은 복제하지 않는다. 이유를 코드 주석 1줄로).
- pending 단건 GET(maps.py:824-850 준용, viewer 게이트) — FE 카드 소스.
- 승인큐 노출: BE `list_pending_approval_requests`(permissions.py:539-563)는 sysadmin 전용 그대로 — fw_confirm 행이 자동 포함되는지 확인만(kind 필터 없으면 자동).

- [ ] **Step 4: GREEN + 전체 스위트 + ruff.**
- [ ] **Step 5: Commit** — `feat(framework): confirm request workflow for upper admins — 상위 관리자 확정 요청 워크플로`

---

### Task 6: FE — 체크리스트 UX + can_confirm + Request confirm CTA

**Files:**
- Modify: `frontend/src/lib/api.ts`(getConfirmReadiness·createFwConfirmRequest·getPendingFwConfirmRequest + MapDetail.can_confirm 타입), `frontend/src/components/framework-confirm-section.tsx`(체크리스트·CTA·onFocusNode), `frontend/src/app/maps/[mapId]/page.tsx:11343-11360`(props 배선 — canConfirm을 detail.can_confirm으로, onFocusNode 연결), `frontend/src/lib/i18n-messages.ts`
- Test: vitest(체크리스트 렌더 분기 — 컴포넌트 테스트 관례가 없으면 게이트 코드→라벨 매핑 순수 함수를 분리해 단위 테스트), tsc/lint

**Interfaces:**
- Consumes: `GET /maps/{id}/confirm-readiness`, `MapOut.can_confirm`, `POST fw-confirm-requests`.
- Produces: `FrameworkConfirmSection` 신규 props — `canConfirm`(의미 변경: 직속 L5/sysadmin), `canRequest: boolean`, `onFocusNode?: (nodeId: string) => void`.

- [ ] **Step 1: 구현 — api.ts**

```ts
export interface ConfirmGateFailure { code: string; count: number; node_ids: string[] }
export interface ConfirmReadiness { ready: boolean; failures: ConfirmGateFailure[] }
export async function getConfirmReadiness(mapId: number): Promise<ConfirmReadiness> { /* GET */ }
export async function createFwConfirmRequest(mapId: number, note: string): Promise<ApprovalRequestOut> { /* POST */ }
export async function getPendingFwConfirmRequest(mapId: number): Promise<ApprovalRequestOut | null> { /* GET */ }
```

(기존 api 함수 형식 — `confirmFrameworkVersion` :2655 스타일을 따른다. `MapDetail`에 `can_confirm?: boolean` 추가.)

- [ ] **Step 2: 체크리스트 — FrameworkConfirmSection**

- 마운트/저장 후에 `getConfirmReadiness` 조회(라이브 편집 중 과도 폴링 금지 — 열릴 때+확정 시도 전+`liveNodes/liveEdges` 변경 debounce 1회. 기존 `useChangeSummary` 소비 방식과 나란히).
- major 토글과 버튼 사이에 체크리스트 블록(`data-id="framework-gate-checklist"`): 6행 고정 — 통과 행은 `Check` 아이콘+`text-ink-tertiary`, 위반 행은 `X`+`text-error`+개수, `node_ids` 있으면 첫 노드 "Locate" 버튼(`onFocusNode`). 라벨 i18n 키 `framework.gate.missing_l6` 등 6종+제목(en 기본, ko 병기 — en 예: "All linked L6 placed"/"No placeholders"/"No stale links"/"All linked L6 published"/"No exit-less loops"/"Branches use decision nodes").
- 버튼 비활성 `:220` → `disabled={busy || (!major && !hasChanges) || !readiness?.ready}`.
- `canConfirm=false && canRequest=true`이면 확정 버튼 대신 **Request confirm** CTA(`data-id="framework-request-confirm"`) + note 입력(선택) + pending 요청 있으면 "Requested by {name}" 캡션으로 대체(`getPendingFwConfirmRequest`).
- page.tsx 배선: `canConfirm={mapDetail?.can_confirm ?? false}`(detail 소스는 기존 my_role 로딩부 실측), `canRequest={myRole === "editor" && !(mapDetail?.can_confirm ?? false)}`, `onFocusNode`는 기존 노드 포커스/선택 유틸(아웃라인 클릭이 쓰는 함수 — `git grep -n "setCenter\|focusNode" page.tsx`로 실측) 재사용.

- [ ] **Step 3: 게이트 확인** — `npx tsc --noEmit && npm run lint && npx vitest run` PASS.
- [ ] **Step 4: Commit** — `feat(fe): confirm gate checklist and request CTA — 게이트 체크리스트·확정 요청 CTA`

---

### Task 7: FE — 요청 처리 표면 (PendingApprovalsPanel·ApprovalQueue)

**Files:**
- Modify: `frontend/src/components/permissions/pending-approvals-panel.tsx`(:20-25 APPROVAL_KINDS·:136-138 canDecideKind·:141-158 renderDetail·:172-179 kindLabel — fw_confirm), `frontend/src/components/admin/approval-queue.tsx`(6지점: :52-54 유니온·:180-187 합성(특히 :183 캐스팅)·:200-221 decide·:224-250 아이콘/필·:251- brief·:385-392 버튼), `frontend/src/app/maps/[mapId]/page.tsx:11302-11309`(신규 prop 전달), `frontend/src/lib/i18n-messages.ts`
- Test: tsc/lint/vitest

**Interfaces:**
- Consumes: decide API(기존 `decideApprovalRequest` — api.ts 실측), `MapDetail.can_confirm`.
- Produces: `PendingApprovalsPanel` 신규 prop `canConfirm: boolean`(fw_confirm 카드의 결정권).

- [ ] **Step 1: PendingApprovalsPanel** — `APPROVAL_KINDS`에 `"fw_confirm"`, `canDecideKind`: `kind === "fw_confirm" ? canConfirm : (기존)`, `renderDetail`: note 표시(`req.payload.note`), kindLabel: `t("approval.kindFwConfirm")`("Confirm request"/ko "확정 요청"). page.tsx 마운트에 `canConfirm={mapDetail?.can_confirm ?? false}` 전달(항상 마운트·hidden 규약 유지 — :11289 주석 존중).
- [ ] **Step 2: ApprovalQueue** — 유니온에 `{ key; kind: "fw_confirm"; req }` 추가, **:183 캐스팅을 kind 스위치/가드로 교체**(새 kind가 조용히 오분류되지 않게), decide 분기, `kindIcon`(BadgeCheck), `kindPill`+i18n `perm.sysadmin.kindFwConfirm`, brief(맵 이름+note), 액션 버튼(승인=확정 실행이므로 툴팁/문구 "Approve & confirm").
- [ ] **Step 3: 게이트 확인 + Commit** — `feat(fe): surface fw confirm requests in approvals — 승인 표면에 확정 요청 노출`

---

### Task 8: FE — 알림 3종 등록

**Files:**
- Modify: `frontend/src/lib/notification-format.ts`(:37-45 KNOWN_TYPES·:52-58 REASON_SUFFIX_TYPES에 fw_confirm_rejected·:66-81 아이콘 BadgeCheck), `frontend/src/lib/notification-categories.ts`(:22-29 매핑 — 기존 카테고리 중 승인 계열로, 유니온 신설 없이), `frontend/src/lib/i18n-messages.ts`(notifLabel/notifBody × en/ko — 본문 템플릿은 `{actor}` 센티널 규약 :145-152 준수), `frontend/src/lib/api.ts:1847-1862`(NotificationPayload — `category_path` 등 새 키 쓰면 추가)
- Test: `notification-format.test.ts`·`notification-categories.test.ts`에 3종 케이스

- [ ] **Step 1: 구현** — 3종 등록(en 예: notifLabel.fw_confirm_requested "Confirm requested", body "{actor} requested confirmation of '{map}'" — 실제 payload 키는 Task 5가 보낸 것과 대조: `map_name`·`actor`·`actor_name`·`note`·`outcome`·`reason`. BE 메시지 문자열과 FE 템플릿 변수 일치 확인).
- [ ] **Step 2: 테스트+게이트** — vitest 신규 케이스 GREEN, tsc/lint.
- [ ] **Step 3: Commit** — `feat(fe): register fw confirm notification types — 확정 요청 알림 3종 등록`

---

### Task 9: 스모크 확장 + 전체 게이트 + PROGRESS

**Files:**
- Modify: `frontend/scripts/pw-smoke-framework-canvas.mjs`, `PROGRESS.md`

- [ ] **Step 1: 스모크 확장** — 기존 확정 단계 앞에: ① readiness GET로 게이트 상태 확인(시드 캔버스가 위반이면 — l6_unpublished 등 — 체크리스트 위반 행 노출 + 확정 버튼 disabled 단언) ② 위반 해소(L6 게시 or 그래프 정리 — 시드 실측에 맞춰) ③ 확정 성공. 요청 워크플로는 픽스처(상위 관리자 계정) 준비가 크면 BE 테스트로 갈음하고 스모크는 게이트 중심 — 택한 범위를 보고서에 명시. 서버는 워크트리 전용 포트(BE 8002·FE 3002, `PORT=3002 BACKEND_URL=http://localhost:8002 npm run dev`, 자체 dev.db reset_db 시드) — 사용자 서버(8000/3000) 무간섭, 종료까지.
- [ ] **Step 2: BE 전체** — `pytest tests/ -q` + ruff 전건 그린.
- [ ] **Step 3: FE 전체** — tsc·lint·vitest·build 전건 그린.
- [ ] **Step 4: 스모크 실행** — ALL PASS + 체크리스트/CTA 스크린샷 SHOT_DIR 보존(사용자 공유는 컨트롤러가).
- [ ] **Step 5: PROGRESS + Commit** — 상단에 2026-09-0X 항목(1-3줄: 게이트 6종+병행 예외·점유·직속 L5 확정권·요청 워크플로·Edge.gateway). `test(framework): smoke for gates and request workflow — 게이트·요청 스모크·트랙 B 마감`
