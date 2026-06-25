# Process Flow & RBAC Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the process-map editor (flow-integrity rules, flow-stepping UX) and the RBAC/version-lifecycle model (assignee restriction, role simplification, group self-management, owner downgrade, draft guard, approved-map copy, loading UX, AD exclusions) across 15 prioritized requests.

**Architecture:** Frontend changes concentrate in the editor (`frontend/src/app/maps/[mapId]/page.tsx`, ~5000 lines) and `frontend/src/lib/canvas.ts` (pure graph helpers — vitest-tested), plus the permission/settings components under `frontend/src/components/permissions/`. Backend changes are in FastAPI routers (`backend/app/routers/`), permission logic (`backend/app/permissions/`), AD sync (`backend/app/ad/`), and Pydantic schemas — all pytest-tested with the `enforce`/`act_as`/`seed_map` fixtures.

**Tech Stack:** Next.js 16 (React 19) + @xyflow/react 12, vitest (pure-logic unit tests only). FastAPI + SQLAlchemy (async) + Pydantic, pytest + TestClient. SQLite (local) / Postgres (server).

## Global Constraints

- **LF line endings only** — Windows PC is in the deploy path; CRLF breaks Linux/Docker. (`.gitattributes` enforces.)
- **No `crypto.randomUUID()` / Web Crypto in frontend** — server runs plain HTTP (insecure context). Use `genId()` from `@/lib/id`.
- **`grep` is ugrep here and silently skips bracket dirs** (`[mapId]`). Search that file via `find`+per-file grep, Python, or Read directly.
- **No hardcoded env/addresses** — all deployment-varying values via `.env` + Settings.
- **Frontend vitest tests pure logic only** (node env, `src/**/*.test.ts`). Component/UI behavior is verified manually in the browser against a **server/remote IP** (localhost is a secure context and won't reproduce HTTP-only bugs).
- **Backend tests** follow AAA, use `enforce`/`act_as`/`seed_map` from `test_permission_endpoints.py`/`test_permission_gates.py` for permission-gated paths; pure functions test directly (`test_org.py` style).
- **Run before every commit:** update `PROGRESS.md`; backend `ruff check app/ tests/` + `python -m pytest tests/ -q`; frontend `npm run lint` + `npm run test`.
- **Commit convention:** `type(scope): English summary — 한국어 요약`, ending each commit body per `rules/common/git.md`.

---

## Roadmap — 15 requests, prioritized

| # | Request | Tier | Size | Risk | Notes |
|---|---------|:----:|:----:|:----:|-------|
| 15 | AD sync exclusion list (org_l1) | **P0** | S | Low | Pure frozenset addition. Verify exact AD casing live |
| 2 | Prevent 1:1 reciprocal edge (A↔B) | **P0** | S | Low | Pure helper + `withEdge`/`isValidConnection` wiring |
| 10 | Owner downgrade w/o approval + show approvers | **P0** | S | Low | Flips 2 existing tests (intended); approver display = frontend |
| 11 | Block new version when a draft exists | **P0\*** | S | **Med** | **DECISION REQUIRED** — initial version defaults to `draft`; conflicts with 5 clone tests |
| 1 | Node output fixed to 1 (auto-swap + toast) | P1 | M | Med | Decision made: **auto-swap + toast**. Both edge paths |
| 6 | Simplify admin (system admin absorbs admin) | P1 | S | Med | Logic already unified under `is_sysadmin()`; audit `Employee.role` |
| 9 | Public map viewer override via settings | P1 | S~M | Low | Mostly UI (`visibility-control`) |
| 14 | Flow-following highlight (stepper) | P2 | S | Low | New state on existing selection/edge-style infra |
| 8 | Map-settings skeleton loading | P2 | M | Low | `isLoading` + skeleton; split loading vs empty |
| 12 | Copy map from approved version | P2 | M | Med | Reuse `_clone_graph`; new endpoint |
| 5 | Assignee/department restricted to viewers | P2 | M | Med | Picker + permission-user query + migration of free text |
| 7 | User-group self-management + approval rules | P3 | M~L | Med | Net-new manager-change approval workflow |
| 4 | Backward flow guided through Decision | P3 | L | High | No "forward" concept exists; depends on #1, #2 |
| 13 | Read-only node drag (no persist) | P3 | M~L | Med | **Defer** — `readOnly` flag entangled ~30 sites |
| 3 | Outline focus + keyboard nav | Done | ~0 | — | Already implemented; only "focus transfer on click" gap |

`*` P0 except F11 is gated on a lifecycle decision (see Task 4).

---

# Part 0 — P0 Tasks (execute now)

Order: Task 1 (F15) → Task 2 (F2) → Task 3 (F10) → Task 4 (F11, after decision).

---

### Task 1: AD sync exclusion list (Request #15)

**Files:**
- Modify: `backend/app/ad/org.py:11-13` (`EXCLUDED_ORG_L1`)
- Test: `backend/tests/test_org.py` (append one test)

**Interfaces:**
- Consumes: `is_excluded(org_l1: str | None, login_id: str, name: str) -> bool` (existing, unchanged signature).
- Produces: nothing new — purely widens the org_l1 blocklist.

**Context:** `is_excluded` returns `True` when `org_l1 in EXCLUDED_ORG_L1`. Current set: `{"Partners", "Partner", "External users", "delete", "Client", "TEST", "View"}`. Matching is **exact case**. The request adds `External Users` (capital U — note the existing entry is lowercase `External users`), `Application Users`, `HR`, `Service`. Add all four (a redundant-case "External Users" is a harmless no-op if AD only emits the lowercase form, and correct if it emits the capitalized form).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_org.py`:

```python
def test_is_excluded_added_org_l1_blocklist() -> None:
    # 신규 제외 조직 — AD 동기화 대상에서 빠져야 한다 (request #15)
    assert is_excluded("Application Users", "a.b", "Name") is True
    assert is_excluded("HR", "a.b", "Name") is True
    assert is_excluded("Service", "a.b", "Name") is True
    assert is_excluded("External Users", "a.b", "Name") is True
    # 기존 비제외 조직은 그대로 통과
    assert is_excluded("Sales", "a.b", "Good Name") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_org.py::test_is_excluded_added_org_l1_blocklist -q`
Expected: FAIL — `Application Users`/`HR`/`Service`/`External Users` not yet in the set (assert returns False).

- [ ] **Step 3: Widen the blocklist**

In `backend/app/ad/org.py`, replace lines 11-13:

```python
# org_l1이 이 중 하나면 동기화 제외 — 대소문자 정확 일치
EXCLUDED_ORG_L1 = frozenset(
    {
        "Partners",
        "Partner",
        "External users",
        "External Users",
        "Application Users",
        "HR",
        "Service",
        "delete",
        "Client",
        "TEST",
        "View",
    }
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_org.py -q`
Expected: PASS (all org tests).

- [ ] **Step 5: Lint + commit**

```bash
.venv/bin/ruff check app/ tests/
git add app/ad/org.py tests/test_org.py ../PROGRESS.md
git commit -m "feat(ad): exclude Application Users/HR/Service/External Users from sync — AD 동기화 제외항 추가"
```

**Post-deploy verification (manual, not in test):** after the next `run_full_sync`, confirm the `SyncSummary.excluded` count rises and the excluded orgs vanish from the directory picker. **Verify the exact AD casing** of these OUs against the live directory and adjust the set if the real values differ.

---

### Task 2: Prevent 1:1 reciprocal edge (Request #2)

**Files:**
- Modify: `frontend/src/lib/canvas.ts:457-474` (add `hasReciprocalEdge`, use it in `withEdge`)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:2135-2141` (`isValidConnection`)
- Test: `frontend/src/lib/canvas.test.ts` (append)

**Interfaces:**
- Produces: `export function hasReciprocalEdge(edges: Edge[], source: string, target: string): boolean` — true when an edge `target→source` already exists (i.e. adding `source→target` would form a 2-node cycle).
- Consumes (page.tsx): `edgesRef.current` (existing ref, mirrored at line 845) and `hasReciprocalEdge`.

**Context:** Two edge-creation paths. Drop-zone insertion funnels through `withEdge` (canvas.ts) — already rejects self-loops and exact duplicates. Handle-drag funnels through `onConnect` → `createEdge` → `addEdge`, gated by `isValidConnection` (page.tsx), which currently only checks the terminal rule. Both must reject reciprocal edges.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/canvas.test.ts` (add `hasReciprocalEdge` and `insertNodeAfter` to the existing import from `@/lib/canvas`, and `import type { Edge } from "@xyflow/react";`):

```ts
describe("hasReciprocalEdge (prevents A↔B 2-node cycle)", () => {
  const edges = [{ id: "e1", source: "A", target: "B" }] as Edge[];

  it("detects that B→A would be reciprocal of existing A→B", () => {
    expect(hasReciprocalEdge(edges, "B", "A")).toBe(true);
  });

  it("allows a non-reciprocal edge A→C", () => {
    expect(hasReciprocalEdge(edges, "A", "C")).toBe(false);
  });

  it("withEdge (via insertNodeAfter) refuses to create the reverse edge", () => {
    // insertNodeAfter(edges, 'A', 'B') builds B→A, the reciprocal of A→B → rejected
    expect(insertNodeAfter(edges, "A", "B", false)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- canvas`
Expected: FAIL — `hasReciprocalEdge` is not exported; reference error / undefined.

- [ ] **Step 3: Add the helper and wire it into `withEdge`**

In `frontend/src/lib/canvas.ts`, add above `withEdge` (after `getOutgoingEdges`, ~line 455):

```ts
/** source→target 추가 시 A↔B 2노드 사이클이 되는지 — 이미 target→source 엣지가 있으면 true. */
export function hasReciprocalEdge(edges: Edge[], source: string, target: string): boolean {
  return edges.some((edge) => edge.source === target && edge.target === source);
}
```

Then update the guard in `withEdge` (line 460):

```ts
function withEdge(edges: Edge[], source: string, target: string): Edge[] {
  if (
    source === target ||
    edges.some((edge) => edge.source === source && edge.target === target) ||
    hasReciprocalEdge(edges, source, target)
  ) {
    return edges;
  }
  return [
    ...edges,
    {
      ...EDGE_DEFAULTS,
      id: genId(),
      source,
      target,
      sourceHandle: sourceHandleId("right"),
      targetHandle: targetHandleId("left"),
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- canvas`
Expected: PASS.

- [ ] **Step 5: Wire the handle-drag path (`isValidConnection`)**

In `frontend/src/app/maps/[mapId]/page.tsx`, add `hasReciprocalEdge` to the existing `@/lib/canvas` import, then replace `isValidConnection` (lines 2135-2141):

```tsx
  // 연결 제약 — 시작 노드 도착 불가/끝 노드 출발 불가(터미널 규칙) + A↔B 2노드 회귀 금지(분기는 Decision 사용)
  const isValidConnection = useCallback((connection: Connection | Edge): boolean => {
    const sourceType = nodesRef.current.find((node) => node.id === connection.source)?.data
      .nodeType;
    const targetType = nodesRef.current.find((node) => node.id === connection.target)?.data
      .nodeType;
    if (violatesTerminalRule(sourceType, targetType)) {
      return false;
    }
    if (
      connection.source &&
      connection.target &&
      hasReciprocalEdge(edgesRef.current, connection.source, connection.target)
    ) {
      return false;
    }
    return true;
  }, []);
```

- [ ] **Step 6: Verify the page wiring**

Run: `npm run lint`
Expected: clean (no unused import, no type error).
Manual (browser, against server IP): with A→B present, dragging a handle B→A shows React Flow's invalid-connection state and drops nothing; dropping node A onto B's reverse zone leaves edges unchanged.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/canvas.ts frontend/src/lib/canvas.test.ts "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "feat(editor): reject 1:1 reciprocal edges (A↔B) on both connect paths — 노드간 1:1 회귀 방지"
```

---

### Task 3: Owner downgrade without approval + show approvers (Request #10)

**Files:**
- Modify: `backend/app/routers/permissions.py` (`update_permission` ~126, `delete_permission` ~167; add `get_effective_role` import)
- Modify: `backend/tests/test_permission_endpoints.py` (change 2 actors, add 2 tests)
- Modify: `frontend/src/components/permissions/collaborators-panel.tsx` (fetch approvers, surface in pending toast)
- Modify: `frontend/src/i18n-messages.ts` (new `perm.toastGatedBy` key)

**Interfaces:**
- Consumes: `get_effective_role(session, login_id, map_id) -> str | None` from `app.permissions.access` (sysadmin resolves to `"owner"` here, per `permissions/deps.py` doc).
- Consumes (frontend): `listApprovers(mapId: number): Promise<string[]>` (existing, `api.ts:416`).
- Behavior change: when the acting user's effective role is `"owner"`, `editor→viewer` and `editor` removal apply immediately (no approval request). Non-owner actors still defer.

**Context:** `requires_downgrade_approval(from_role, to_role)` returns True only for `editor→viewer`/removal and is role-of-target based, ignoring the actor. The request: an **owner** acting needs no approval; for the deferred case, the UI must show **who can approve** (the map's approver list; sysadmins can also approve).

- [ ] **Step 1: Update existing deferral tests to use a non-owner actor + add owner-bypass tests**

In `backend/tests/test_permission_endpoints.py`, change the two deferral tests so a **non-owner editor** is the actor (preserving deferral coverage), and add two new owner-bypass tests. Replace `test_change_role_downgrade_deferred` (line ~166) and `test_remove_editor_deferred_grant_present` (line ~177) and append the new tests:

```python
def test_change_role_downgrade_deferred_non_owner(client: TestClient, enforce: None) -> None:
    """비-오너(editor) 행위자의 editor→viewer 는 pending approval_request 만 만든다."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200
    assert r.json()["pending"] is True


def test_remove_editor_deferred_non_owner(client: TestClient, enforce: None) -> None:
    """비-오너(editor) 행위자의 editor 제거는 승인 지연 — 행 유지."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    r = client.delete(f"/api/maps/{map_id}/permissions/{gid}")
    assert r.status_code == 200
    assert r.json()["pending"] is True


def test_owner_downgrade_editor_immediate(client: TestClient, enforce: None) -> None:
    """오너가 editor→viewer 다운그레이드 시 승인 없이 즉시 적용 (request #10)."""
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")])
    gid = grant_id(map_id, "ed")
    act_as("owner.u")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200
    assert r.json()["pending"] is False
    assert r.json()["permission"]["role"] == "viewer"


def test_owner_remove_editor_immediate(client: TestClient, enforce: None) -> None:
    """오너가 editor 제거 시 승인 없이 즉시 삭제 (request #10)."""
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")])
    gid = grant_id(map_id, "ed")
    act_as("owner.u")
    r = client.delete(f"/api/maps/{map_id}/permissions/{gid}")
    assert r.status_code == 200
    assert r.json()["pending"] is False
```

(If a `grant_id(map_id, login_id)` helper is not already present in this file, derive the id the same way the existing tests do — confirm by reading the file's helpers near line 100-120 before writing; the existing `test_owner_grant_change_refused_409` uses `grant_id(map_id, "owner.u")`, so it exists.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `.venv/bin/python -m pytest tests/test_permission_endpoints.py -q`
Expected: the two `*_immediate` tests FAIL with `pending is True` (owner currently still deferred); the two `*_non_owner` tests PASS.

- [ ] **Step 3: Add the owner bypass in the backend**

In `backend/app/routers/permissions.py`, ensure the import (top of file) includes:

```python
from app.permissions.access import get_effective_role
```

In `update_permission`, replace the gate (lines 126-144) so owner applies immediately:

```python
    actor_role = await get_effective_role(session, user, map_id)
    if logic.requires_downgrade_approval(grant.role, new_role) and actor_role != "owner":
        req = ApprovalRequest(
            map_id=map_id,
            kind="permission_downgrade",
            payload={
                "permission_id": permission_id,
                "principal_type": grant.principal_type,
                "principal_id": grant.principal_id,
                "from_role": grant.role,
                "to_role": new_role,
            },
            requested_by=user,
            status="pending",
        )
        session.add(req)
        await session.commit()
        await session.refresh(req)
        # 지연 — 아직 적용 안 됨. pending 마커로 응답
        return {"pending": True, "approval_request": _serialize_request(req)}
    grant.role = new_role
    await session.commit()
    await session.refresh(grant)
    return {"pending": False, "permission": PermissionOut.model_validate(grant).model_dump()}
```

In `delete_permission`, replace the gate (lines 167-184) the same way:

```python
    actor_role = await get_effective_role(session, user, map_id)
    if logic.requires_downgrade_approval(grant.role, None) and actor_role != "owner":
        req = ApprovalRequest(
            map_id=map_id,
            kind="permission_downgrade",
            payload={
                "permission_id": permission_id,
                "principal_type": grant.principal_type,
                "principal_id": grant.principal_id,
                "from_role": grant.role,
                "to_role": None,
            },
            requested_by=user,
            status="pending",
        )
        session.add(req)
        await session.commit()
        await session.refresh(req)
        return {"pending": True, "approval_request": _serialize_request(req)}
    await session.delete(grant)
    await session.commit()
    return {"pending": False, "deleted": True}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `.venv/bin/python -m pytest tests/test_permission_endpoints.py -q`
Expected: PASS (4 relevant tests + the rest).

- [ ] **Step 5: Lint + commit backend**

```bash
.venv/bin/ruff check app/ tests/
git add app/routers/permissions.py tests/test_permission_endpoints.py ../PROGRESS.md
git commit -m "feat(perm): owner skips downgrade approval; non-owner still deferred — 오너 다운그레이드 무승인"
```

- [ ] **Step 6: Frontend — surface approvers on the pending path**

In `frontend/src/i18n-messages.ts`, add a key alongside the existing `perm.toastGated` (look it up first to match the file's nesting/format):

```ts
// en
"perm.toastGatedBy": "Change pending approval from: {names}",
// ko
"perm.toastGatedBy": "승인 대기 — 승인 가능: {names}",
```

In `frontend/src/components/permissions/collaborators-panel.tsx`:
1. Add `listApprovers` to the `@/lib/api` import.
2. Add state next to `pendingIds` (line ~265): `const [approverIds, setApproverIds] = useState<string[]>([]);`
3. In the existing data-load `useEffect` (the `Promise.all` around line 286-308), also `listApprovers(mapIdNum)` and `setApproverIds(...)` under the same `active` guard.
4. In `handleChangeRole` and `handleRemove`, when `result.pending`, replace the toast with the approver-aware one:

```tsx
        if (result.pending) {
          setPendingIds((prev) => new Set(prev).add(perm.id));
          const names = approverIds.length > 0 ? approverIds.join(", ") : t("perm.approversNone");
          onToast(t("perm.toastGatedBy", { names }));
        } else {
          await reload();
        }
```

(Use the existing `perm.approversNone`/equivalent empty key if present; otherwise fall back to `t("perm.toastGated")` when `approverIds` is empty. Confirm the message-format helper signature — whether `t(key, params)` interpolates `{names}` — by checking another call site in this file before writing.)

- [ ] **Step 7: Verify frontend**

Run: `npm run lint && npm run test`
Expected: clean; vitest unaffected (no pure-logic change).
Manual (browser, server IP): as a non-owner editor, downgrading another editor shows a toast naming the approvers; as the owner, the same action applies immediately with no pending badge.

- [ ] **Step 8: Commit frontend**

```bash
git add frontend/src/components/permissions/collaborators-panel.tsx frontend/src/i18n-messages.ts PROGRESS.md
git commit -m "feat(perm): show approver names when a downgrade is gated — 승인 대기 시 승인자 표시"
```

---

### Task 4: Block new version when a draft exists (Request #11) — DECISION REQUIRED

**Status:** Blocked on a version-lifecycle decision. Do **not** implement until resolved.

**The problem:** `MapVersion.status` defaults to `"draft"` (`backend/app/models.py:53`). Every map's initial "As-Is" version is therefore a draft. A naive guard ("409 if any version has status `draft`") on `POST /api/maps/{map_id}/versions` would reject the legitimate flows that 5 existing tests in `test_versions.py` exercise — `test_create_plain_version`, `test_create_version_clones_graph`, `test_clone_preserves_groups_and_membership`, `test_clone_records_source_lineage`, `test_clone_leaves_source_untouched` — all create a second version while the initial one is still a draft.

**Options (pick one, then this task gets full TDD steps):**
- **(A) One draft per map.** Guard: `409` if a `draft` version exists. Requires reworking the 5 clone-test fixtures to submit+approve the source first, and aligns with "only one in-progress revision at a time." Highest fidelity to the request, most test churn.
- **(B) One draft *beyond the baseline*.** Allow creating a version when the map has exactly its single initial draft; block a *third* concurrent draft. Lower churn, fuzzier semantics.
- **(C) Guard at the "create revision" UI action only**, not the raw `POST /versions` (which stays open for clone/seed). Block in the frontend revise button when `getWorkflowState` shows an editable (`draft`/`rejected`) version. No backend test churn; weaker server-side guarantee.

**Recommendation:** (A) — it matches the request literally and keeps the rule server-enforced; the 5-fixture rework is mechanical (check out, submit, approve before cloning). Confirm before implementing.

---

# Part 1 — P1 Roadmap (detailed plan to follow per item)

These are scoped, not yet step-by-step. Each gets its own detailed TDD expansion before execution.

### Request #1 — Node output fixed to 1 (auto-swap + toast)
**Decision made:** when a node that already has an outgoing edge gets a second one, **auto-swap** (replace the existing outgoing edge) and **`showToast`** to inform the user; Decision nodes are exempt (they branch).
- **Files:** `frontend/src/lib/canvas.ts` (new pure `swapOutgoingEdge`/extend `withEdge`), `page.tsx` `createEdge`/`onConnect` (~2087-2132) and `applyFlowEdges` (~2301-2326), `showToast` (line 611).
- **Approach:** pure helper `replaceOutgoingEdge(edges, source, target)` returning new edges with the prior `source→*` edge removed; vitest it. Wire both creation paths; exempt `nodeType === "decision"`. Toast key in `i18n-messages.ts`.
- **Verify:** vitest for the helper; manual browser for both paths.

### Request #6 — Simplify admin (system admin absorbs admin)
- **Files:** `backend/app/permissions/logic.py` (`is_sysadmin`), `backend/app/settings.py` (`system_admin_login_ids` vs `bpm_sysadmins`), `backend/app/auth.py` (`require_admin`), `backend/app/models.py` (`Employee.role`), `backend/app/routers/groups.py` + any `require_admin` callers, frontend admin UI.
- **Approach:** audit all `Employee.role == "admin"` and `require_admin` uses; route everything through `is_sysadmin()`/`require_sysadmin`. Decide whether to drop `Employee.role` or keep it for audit. Update tests in `test_admin_*`, `test_auth.py`, `test_groups.py`.
- **Verify:** pytest across admin/auth/groups suites.

### Request #9 — Public map viewer override via settings
- **Files:** `frontend/src/components/permissions/visibility-control.tsx`, `collaborators-panel.tsx` (`viewerGrantDisabled` ~line 58/176), `create-map-dialog.tsx` (~136, 328-333); optional backend validation in `permissions.py` add-grant.
- **Approach:** in map settings, allow setting viewers when visibility is private (and/or a new `test` state) but not public; keep create-dialog's public→editor-only. Optional server check rejecting viewer grant on public maps.
- **Verify:** manual browser; optional pytest for the server check.

---

# Part 2 — P2 Roadmap

### Request #14 — Flow-following highlight (stepper)
- **Files:** `page.tsx` selection state (`selectedId` 591), `styledEdges` memo (4107-4185), `getOutgoingEdges` (canvas.ts). New `stepperPath` state + advance/retreat handlers + a third edge-style layer; keyboard (→/←) or toolbar buttons.
- **Verify:** manual browser; optional vitest for a pure "next edge along flow" selector.

### Request #8 — Map-settings skeleton loading
- **Files:** `collaborators-panel.tsx` (286-370), `approvers-panel.tsx` (66-110); a small skeleton component using `bg-surface`/`--shadow-sm`/`border-hairline` tokens.
- **Approach:** add `isLoading`; render skeleton while loading, empty-state only when `!isLoading && length === 0`.
- **Verify:** manual browser.

### Request #12 — Copy map from approved version
- **Files:** new `POST /api/maps/from-approved` in `backend/app/routers/maps.py`, reusing `_clone_graph` (`versions.py:42`); new `CreateMapFromApprovedIn` schema; frontend "Copy from Approved" action + `api.ts` call.
- **Approach:** validate source version is `approved`/`published`, create new map + initial version, `_clone_graph` into it, grant owner. ~60 backend LOC.
- **Verify:** pytest (4 cases: explicit approved, latest-approved auto, not-approved 409, not-found 404).

### Request #5 — Assignee/department restricted to viewers
- **Files:** `backend/app/models.py:115-116` + `schemas.py` node fields; new endpoint listing users/depts with ≥viewer on the map (build on `permissions.py`/`get_effective_role`); `frontend/src/components/node-summary-modal.tsx:219-234` (replace free-text with picker).
- **Approach:** server endpoint returns eligible principals; frontend picker; validate on graph save. Handle existing free-text values (migration/back-compat).
- **Verify:** pytest for the endpoint + validation; manual browser for the picker.

---

# Part 3 — P3 Roadmap (large / deferred)

### Request #7 — User-group self-management + approval rules
- **Files:** `backend/app/models.py` (`UserGroup*`), `routers/groups.py` (179-255), `schemas.py`; reuse `ApprovalRequest` pattern. New manager-change-request workflow: promote up to a cap without approval; demote requires all-managers (≥3) or sysadmin approval.
- **Verify:** pytest for the new workflow + thresholds.

### Request #4 — Backward flow guided through Decision (depends on #1, #2)
- **Files:** `page.tsx` `applyFlowEdges` (2301-2326), `flowZoneViolates` (2145-2158), `canvas.ts` layout/rank. Define "forward" (dagre rank), intercept backward drop, auto-insert a Decision node.
- **Verify:** vitest for the rank/backward predicate; manual browser for the insertion.

### Request #13 — Read-only node drag (no persist) — **DEFER**
- **Files:** `page.tsx` `readOnly` (692), `nodesDraggable` (5274), save path (964-989, already `readOnly`-guarded).
- **Why defer:** `readOnly` gates ~30 sites; safely splitting "viewer may drag locally" from "locked by checkout/status" needs a `readOnlyReason`/`viewerMode` flag + full audit. Revisit after P0-P2.

### Request #3 — Outline focus + keyboard nav — **MOSTLY DONE**
- **State:** Tab/Shift+Tab/arrows/expand-collapse already implemented in `editor-left-sidebar.tsx`; canvas click → outline select wired in `page.tsx:5280-5303`.
- **Decision made (focus transfer on click):** the one gap — `onNodeClick` calls `setSelectedId` but does not move keyboard focus to the outline list. Add `listRef.current?.focus()` on canvas-node click (via a callback prop or by triggering the existing outline-select handler) so Tab/arrows work immediately after clicking.
- **Files:** `page.tsx` `onNodeClick` (5280-5303), `editor-left-sidebar.tsx` (expose/trigger `listRef.focus()`).
- **Verify:** manual browser.

---

## Self-Review Notes
- **Spec coverage:** all 15 requests mapped to a task or roadmap entry; F11 explicitly gated on a decision; F3 marked already-implemented with the one remaining gap.
- **Test honesty:** F15/F2 are vitest/pytest-true; F10 backend is pytest-true (with documented test-expectation flips); F10 frontend display, F8, F14, F9, F13, F3-gap are manual/browser — stated as such, not faked as unit tests.
- **Type consistency:** `hasReciprocalEdge(edges, source, target)` used identically in canvas.ts and page.tsx; `get_effective_role(session, user, map_id)` matches `access.py:52`.
