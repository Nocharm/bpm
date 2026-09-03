# Import Governance Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-importing a consultant delivery only changes a map's owner / owning department / approvers when a person ticked that change in the dry-run report; the "owner unconfirmed" flag is visible and cleared by manual transfer.

**Architecture:** The import engine computes per-map governance diffs on every run (dry-run and apply) and applies only the `(code, field)` pairs passed as `decisions`. The API carries diffs out and decisions in; the settings Framework panel renders a checkbox review section under the dry-run report with a sticky Cancel/Apply bar replacing the confirm dialog.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), Next.js/React + vitest + playwright-core (frontend).

**Spec:** `docs/superpowers/specs/2026-09-03-import-governance-review-design.md`

## Global Constraints

- Backend must stay Python 3.11-compatible (`backend/ruff.toml` target py311 — no PEP 695 syntax).
- No raw hex in TSX — tokens only (`text-changed`, `bg-changed/10`, `border-hairline`, `bg-surface`, `text-accent`…). Icons: Lucide 14–16px strokeWidth 1.5. UI copy in English with ko i18n pair.
- Every interactive element gets a `data-id` (`surface-role`, list items keyed).
- Commit message format: `type(scope): English summary — 한국어 요약`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01VK3ihKeCoUuDTrnisbmL5P`. Update `PROGRESS.md` in the final task's commit.
- Run backend tests as `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest <path> -q -p no:cacheprovider`; lint `.venv/bin/ruff check app/ tests/ scripts/`.
- Frontend gates: `cd frontend && npx vitest run <file>`, `npx tsc --noEmit`, `npm run lint`.
- Work in worktree `/Users/hyeonjin/Documents/bpm/.claude/worktrees/consultant-import-fallbacks` on branch `feat/consultant-import-fallbacks`.

---

### Task 1: Backend — governance diffs + decisions in the import engine and API

**Files:**
- Modify: `backend/app/schemas.py` (near `FrameworkImportRow` ~line 1019, `InterviewImportIn` ~1049, `InterviewImportOut` ~1077)
- Modify: `backend/scripts/import_consultant.py` (`ImportReport` ~470, `import_delivery` signature 635, existing-map branch 738–772)
- Modify: `backend/app/routers/categories.py` (`import_interview_delivery` 713–830)
- Create: `backend/tests/test_import_governance.py`

**Interfaces:**
- Consumes: `tests.test_consultant_interview._interview()` fixture (0.4 payload with one row `task-prep-0001`), employees seeded by `conftest` (`a`, `b`, `boss`, `lead`, `x`, `appr`).
- Produces: `GovernanceDecisionIn {code, field}`, `GovernanceDiffOut {code, name, field, current, delivered, applied}`, `InterviewImportIn.decisions`, `InterviewImportOut.governance`, engine `GovernanceDiff` dataclass, `import_delivery(..., governance_decisions: set[tuple[str, str]] | None = None)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_import_governance.py`:

```python
"""재임포트 거버넌스 확인 적용 — dry-run이 오너·오우닝 부서·승인자 차이를 내고, apply는 체크한 것만 교체.

설계: docs/superpowers/specs/2026-09-03-import-governance-review-design.md §3·§4.
"""

from fastapi.testclient import TestClient

from tests.test_consultant_interview import _interview
from tests.test_interview_import_api import _map_row, _run


def _delivery(code: str, *, owner: str | None, approvers: list[str], department: str | None) -> dict:
    data = _interview()
    row = data["rows"][0]
    row["taskId"] = code
    row["owner"] = owner
    row["approvers"] = approvers
    row["department"] = department
    return data


def _post(client: TestClient, data: dict, *, apply: bool, decisions: list[dict] | None = None):
    body = {"files": [{"name": f"{data['rows'][0]['taskId']}.json", "content": data}],
            "apply": apply, "label": "gov"}
    if decisions is not None:
        body["decisions"] = decisions
    return client.post("/api/categories/import-interview", json=body)


def _approvers(map_id: int) -> list[str]:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapApprover

    async def _load():
        async with SessionLocal() as session:
            return sorted((await session.scalars(
                select(MapApprover.user_id).where(MapApprover.map_id == map_id))).all())

    return _run(_load())


def _owner_grants(map_id: int) -> list[str]:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapPermission

    async def _load():
        async with SessionLocal() as session:
            return sorted((await session.scalars(select(MapPermission.principal_id).where(
                MapPermission.map_id == map_id, MapPermission.role == "owner"))).all())

    return _run(_load())


def _gov(body: dict, field: str) -> dict | None:
    return next((g for g in body["governance"] if g["field"] == field), None)


def test_dry_run_lists_diffs_for_confirmed_owner_without_writing(client: TestClient) -> None:
    code = "task-gov-0001"
    assert _post(client, _delivery(code, owner="a", approvers=["boss"], department=None),
                 apply=True).status_code == 200
    m = _map_row(code)
    assert m.owner_id == "a" and m.consultant_owner_pending is False

    body = _post(client, _delivery(code, owner="b", approvers=["lead"], department=None),
                 apply=False).json()
    owner = _gov(body, "owner")
    assert owner == {"code": code, "name": "교정 준비", "field": "owner",
                     "current": "a", "delivered": "b", "applied": False}
    approvers = _gov(body, "approvers")
    assert approvers["current"] == "boss" and approvers["delivered"] == "lead"
    assert _gov(body, "department") is None  # 전달 부서 없음 = 차이 아님
    m2 = _map_row(code)
    assert m2.owner_id == "a" and _approvers(m2.id) == ["boss"]


def test_apply_without_decisions_keeps_current_even_when_pending(client: TestClient) -> None:
    code = "task-gov-0002"
    assert _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=True).status_code == 200
    m = _map_row(code)
    assert m.consultant_owner_pending is True
    importer = m.owner_id

    body = _post(client, _delivery(code, owner="a", approvers=["boss"], department="QA/Calibration"),
                 apply=True).json()
    assert body["applied"] is True
    assert {g["field"] for g in body["governance"]} == {"owner", "approvers", "department"}
    assert all(g["applied"] is False for g in body["governance"])
    m2 = _map_row(code)
    assert m2.owner_id == importer and m2.consultant_owner_pending is True
    assert m2.owning_department is None and _approvers(m2.id) == []


def test_apply_with_owner_decision_replaces_owner_and_clears_pending(client: TestClient) -> None:
    code = "task-gov-0003"
    assert _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=True).status_code == 200
    body = _post(client, _delivery(code, owner="a", approvers=["boss"], department=None),
                 apply=True, decisions=[{"code": code, "field": "owner"}]).json()
    assert _gov(body, "owner")["applied"] is True
    assert _gov(body, "approvers")["applied"] is False
    m = _map_row(code)
    assert m.owner_id == "a" and m.consultant_owner_pending is False
    assert _owner_grants(m.id) == ["a"]
    assert _approvers(m.id) == []  # 미체크 필드는 유지
    assert any(r["action"] == "governance" and "owner a assigned" in r["detail"] for r in body["rows"])


def test_apply_with_approvers_and_department_decisions(client: TestClient) -> None:
    code = "task-gov-0004"
    assert _post(client, _delivery(code, owner="a", approvers=[], department=None),
                 apply=True).status_code == 200
    body = _post(
        client, _delivery(code, owner="a", approvers=["boss", "lead", "boss"], department="QA/Calibration"),
        apply=True,
        decisions=[{"code": code, "field": "approvers"}, {"code": code, "field": "department"}],
    ).json()
    dept = _gov(body, "department")
    assert dept["current"] == "" and dept["delivered"] == "QA/Calibration" and dept["applied"] is True
    assert any("registered as delivered" in r["detail"] for r in body["rows"] if r["action"] == "warning")
    m = _map_row(code)
    assert m.owning_department == "QA/Calibration"
    assert _approvers(m.id) == ["boss", "lead"]
    assert m.owner_id == "a"


def test_unknown_decision_is_422_and_writes_nothing(client: TestClient) -> None:
    code = "task-gov-0005"
    assert _post(client, _delivery(code, owner="a", approvers=[], department=None),
                 apply=True).status_code == 200
    resp = _post(client, _delivery(code, owner="b", approvers=[], department=None),
                 apply=True, decisions=[{"code": "task-nope", "field": "owner"}])
    assert resp.status_code == 422
    assert "unknown governance decision task-nope/owner" in resp.json()["detail"]
    assert _map_row(code).owner_id == "a"


def test_empty_delivered_values_are_not_diffs(client: TestClient) -> None:
    code = "task-gov-0006"
    assert _post(client, _delivery(code, owner="a", approvers=["boss"], department=None),
                 apply=True).status_code == 200
    body = _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=False).json()
    assert body["governance"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_import_governance.py -q -p no:cacheprovider`
Expected: FAIL — `KeyError: 'governance'` on the dry-run test and the 422 test returns 200.

- [ ] **Step 3: Add the schemas**

In `backend/app/schemas.py`, make sure `Literal` is imported from `typing` (add it to the existing `from typing import ...` line if missing). Right after `class FrameworkImportRow` add:

```python
GovernanceField = Literal["owner", "department", "approvers"]


class GovernanceDecisionIn(BaseModel):
    """apply 때 체크한 거버넌스 항목 — dry-run 응답 governance[]의 (code, field)와 1:1 (spec 2026-09-03 §3)."""

    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    field: GovernanceField


class GovernanceDiffOut(BaseModel):
    """기존 맵 거버넌스 필드 차이 1건 — 체크한 것만 apply가 교체한다 (spec 2026-09-03 §3)."""

    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    field: GovernanceField
    current: str
    delivered: str
    applied: bool
```

In `InterviewImportIn` add after `label`:

```python
    # apply 때만 의미 — dry-run은 무시. 전달분 차이에 없는 항목은 422 (spec 2026-09-03 §3)
    decisions: list[GovernanceDecisionIn] = []
```

In `InterviewImportOut` add after `truncated`:

```python
    governance: list[GovernanceDiffOut] = []
```

- [ ] **Step 4: Add the engine dataclass and review helper**

In `backend/scripts/import_consultant.py`, directly above `class ImportReport` add:

```python
@dataclass
class GovernanceDiff:
    """기존 맵 거버넌스 3필드(owner/department/approvers) 차이 1건 — 응답 GovernanceDiffOut과 동형."""

    code: str
    name: str
    field: str
    current: str
    delivered: str
    applied: bool = False
```

Inside `ImportReport` add a field after `drafts`:

```python
    # 기존 맵 거버넌스 차이 — dry-run·apply 동일 산출, applied는 체크돼 교체된 것만 True (spec 2026-09-03 §4)
    governance: list[GovernanceDiff] = field(default_factory=list)
```

Change the `import_delivery` signature to add a keyword parameter after `linkage_placed`:

```python
    governance_decisions: set[tuple[str, str]] | None = None,
```

and right after `report = ImportReport()` add `decisions = governance_decisions or set()`.

Add this helper above `import_delivery`:

```python
async def _review_governance(
    session: AsyncSession,
    found: ProcessMap,
    cmap: "CanonicalMap",
    report: ImportReport,
    *,
    known: set[str],
    dept_index: DeptIndex,
    dept_chains: list[list[str]],
    known_logins: set[str],
    actor: str,
    decisions: set[tuple[str, str]],
) -> None:
    """기존 맵 거버넌스 3필드 차이 산출 — 체크된 (code, field)만 교체한다 (spec 2026-09-03 §4).

    dry-run과 apply가 같은 차이를 내야 화면 체크박스가 서버 결정과 1:1이다. 전달값이 비어 있으면
    (owner None·department ""·approvers []) 차이가 아니다 — 임포트로 "지우기"는 없다.
    종전의 "오너 대기 맵은 무조건 교체" 예외는 이 규칙으로 대체됐다(대기 맵도 체크 필요).
    """
    delivered_owner = cmap.owner
    if delivered_owner is not None and delivered_owner != found.owner_id:
        checked = (cmap.code, "owner") in decisions
        report.governance.append(GovernanceDiff(
            cmap.code, found.name, "owner", found.owner_id or "", delivered_owner, checked))
        if delivered_owner not in known_logins:
            report.add(cmap.code, "warning", f"owner {delivered_owner!r} not found in employees")
        if checked:
            found.owner_id = delivered_owner
            found.consultant_owner_pending = False
            for perm in await session.scalars(select(MapPermission).where(
                    MapPermission.map_id == found.id, MapPermission.role == "owner")):
                perm.principal_id = delivered_owner
                perm.granted_by = actor
            report.add(cmap.code, "governance", f"owner {delivered_owner} assigned")

    if cmap.department.strip():
        owner_for_dept = delivered_owner or found.owner_id or actor
        delivered_dept, note = await resolve_owning_department(
            session, known, dept_index, cmap.department, owner_for_dept, dept_chains)
        if delivered_dept is not None and delivered_dept != (found.owning_department or None):
            checked = (cmap.code, "department") in decisions
            report.governance.append(GovernanceDiff(
                cmap.code, found.name, "department", found.owning_department or "",
                delivered_dept, checked))
            if note:
                report.add(cmap.code, "warning", note)
            if checked:
                found.owning_department = delivered_dept
                report.add(cmap.code, "governance", f"owning department {delivered_dept} assigned")

    delivered_approvers = list(dict.fromkeys(cmap.approvers))
    if delivered_approvers:
        current = sorted((await session.scalars(
            select(MapApprover.user_id).where(MapApprover.map_id == found.id))).all())
        if sorted(delivered_approvers) != current:
            checked = (cmap.code, "approvers") in decisions
            report.governance.append(GovernanceDiff(
                cmap.code, found.name, "approvers", ", ".join(current),
                ", ".join(delivered_approvers), checked))
            for approver in delivered_approvers:
                if approver not in known_logins:
                    report.add(cmap.code, "warning", f"approver {approver!r} not found in employees")
            if checked:
                await session.execute(delete(MapApprover).where(MapApprover.map_id == found.id))
                for approver in delivered_approvers:
                    session.add(MapApprover(map_id=found.id, user_id=approver, assigned_by=actor))
                report.add(cmap.code, "governance", "approvers replaced")
```

`DeptIndex` is the type returned by `load_dept_index` — import it from `app.orgchart` alongside the existing orgchart imports if it is not already imported (check the `from app.orgchart import (...)` block at the top of the file).

- [ ] **Step 5: Replace the existing-map branch in `import_delivery`**

Replace the whole block starting at `if cmap.code in existing:` (the one containing `if found.consultant_owner_pending and assigned_owner is not None:` and the `elif found.consultant_owner_pending and found.owning_department is None:` branch) with:

```python
        if cmap.code in existing:
            # 거버넌스 3필드는 체크한 것만 교체 — 오너 대기 예외 분기는 폐지 (spec 2026-09-03 §4)
            await _review_governance(
                session, existing[cmap.code], cmap, report,
                known=known, dept_index=dept_index, dept_chains=dept_chains,
                known_logins=known_logins, actor=actor, decisions=decisions,
            )
            continue
```

Leave the new-map path (`owner_login = cmap.owner … session.add(new_map)`) unchanged.

- [ ] **Step 6: Wire the router**

In `backend/app/routers/categories.py` `import_interview_delivery`, add `GovernanceDiffOut` to the `from app.schemas import (...)` list. Change the `import_delivery(...)` call to pass decisions only on apply:

```python
    decisions = {(d.code, d.field) for d in payload.decisions} if payload.apply else set()
    report = await import_delivery(
        session, categories=list(merged_cats.values()), maps=merged_maps,
        actor=login_id, label=label, commit_every=None,
        # 연계 캔버스에 놓일 맵은 annual_count/fte 착지면이 있다 — "갈 곳 없음" 경고 대상 아님
        linkage_placed={code for lk in merged_linkages for code in lk.map_codes},
        governance_decisions=decisions,
    )
```

Directly after the `apply_interview_linkage(...)` call and before `if payload.apply:` add:

```python
    # 체크 목록이 이번 전달분 차이와 안 맞으면 stale 리포트 — commit 전에 통째로 거부 (spec §3)
    unknown = decisions - {(g.code, g.field) for g in report.governance}
    if unknown:
        await session.rollback()
        code, fld = sorted(unknown)[0]
        raise HTTPException(status_code=422, detail=f"unknown governance decision {code}/{fld}")
```

(`HTTPException` is already imported in this router; verify with `grep -n "HTTPException" backend/app/routers/categories.py`.) In the `return InterviewImportOut(...)` add:

```python
        governance=[GovernanceDiffOut.model_validate(g) for g in report.governance],
```

- [ ] **Step 7: Run the tests**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_import_governance.py tests/test_interview_import_api.py tests/test_consultant_import.py -q -p no:cacheprovider`
Expected: all PASS. If a pre-existing test in `test_consultant_import.py` asserts the old pending auto-replace (search for `consultant_owner_pending` there), rewrite that assertion to expect "kept unless decided" and add the decision to the call that needs the replacement — the old behaviour is removed by design.

- [ ] **Step 8: Lint and commit**

Run: `cd backend && .venv/bin/ruff check app/ tests/ scripts/`

```bash
git add backend/app/schemas.py backend/scripts/import_consultant.py backend/app/routers/categories.py backend/tests/test_import_governance.py backend/tests/test_consultant_import.py
git commit -m "feat(import): gate governance changes behind explicit decisions — 재임포트 거버넌스 3필드는 체크한 것만 교체"
```

---

### Task 2: Backend — expose `consultant_owner_pending` and clear it on manual transfer

**Files:**
- Modify: `backend/app/schemas.py` (`MapOut` ~line 694, next to `consultant_code`)
- Modify: `backend/app/routers/permissions.py:438` (`transfer-owner`)
- Test: `backend/tests/test_permission_endpoints.py` (section "B. Owner transfer"), `backend/tests/test_import_governance.py`

**Interfaces:**
- Produces: `MapOut.consultant_owner_pending: bool` in every map list/detail response.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_import_governance.py`:

```python
def test_map_detail_exposes_owner_pending_flag(client: TestClient) -> None:
    code = "task-gov-0007"
    assert _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=True).status_code == 200
    m = _map_row(code)
    body = client.get(f"/api/maps/{m.id}").json()
    assert body["consultant_owner_pending"] is True
```

In `backend/tests/test_permission_endpoints.py` after `test_owner_transfer_invariant` add:

```python
def test_owner_transfer_clears_consultant_owner_pending(client: TestClient, enforce: None) -> None:
    """임포트 오너 대기 플래그는 수동 이전으로도 내려간다 — 안 그러면 재전달 체크 목록에 유령 차이가 남는다."""
    map_id = seed_map(
        grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")],
        owner_id="owner.u",
    )

    async def _mark(session) -> None:
        m = await session.get(ProcessMap, map_id)
        m.consultant_owner_pending = True

    run_db(_mark)
    act_as("owner.u")
    assert client.post(f"/api/maps/{map_id}/transfer-owner", json={"new_owner": "ed"}).status_code == 200

    async def _flag(session) -> bool:
        return (await session.get(ProcessMap, map_id)).consultant_owner_pending

    assert run_db(_flag) is False
```

Check the helper names at the top of `test_permission_endpoints.py` (`grep -n "^def \|^async def " backend/tests/test_permission_endpoints.py | head -20`): use the file's existing "run a coroutine against `SessionLocal`" helper instead of `run_db` if it is named differently (e.g. `_run(_with_session(...))`), and make sure `ProcessMap` is imported there.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_import_governance.py::test_map_detail_exposes_owner_pending_flag tests/test_permission_endpoints.py::test_owner_transfer_clears_consultant_owner_pending -q -p no:cacheprovider`
Expected: FAIL (`KeyError: 'consultant_owner_pending'`, and the flag stays `True`).

- [ ] **Step 3: Implement**

In `MapOut` (schemas.py) after `consultant_code: str | None = None` add:

```python
    # 오너 없이 임포트된 맵 — 배지 표시용. 재전달 owner 결정 적용 또는 수동 이전이 내린다 (spec 2026-09-03 §5)
    consultant_owner_pending: bool = False
```

In `permissions.py` transfer handler, right after `found_map.owner_id = new_owner` add:

```python
    found_map.consultant_owner_pending = False  # 사람이 오너를 정했다 — 임포트 대기 표식 해제 (spec 2026-09-03 §5)
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_import_governance.py tests/test_permission_endpoints.py -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: PASS, ruff clean.

```bash
git add backend/app/schemas.py backend/app/routers/permissions.py backend/tests/test_permission_endpoints.py backend/tests/test_import_governance.py
git commit -m "feat(maps): expose owner-pending flag and clear it on transfer — 오너 대기 플래그 노출·수동 이전 시 해제"
```

---

### Task 3: Frontend — API types and `groupGovernanceDiffs` helper

**Files:**
- Modify: `frontend/src/lib/api.ts` (`MapSummary` ~line 89 next to `consultant_code`, `InterviewImportResult` ~2873, `importInterview` ~2883)
- Modify: `frontend/src/lib/interview-report.ts` (append exports)
- Test: `frontend/src/lib/interview-report.test.ts`

**Interfaces:**
- Produces: `GovernanceField`, `GovernanceDiff`, `GovernanceDecision` types; `governanceKey(d)`, `parseGovernanceKey(key)`, `groupGovernanceDiffs(diffs): GovernanceMapGroup[]`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/interview-report.test.ts`:

```ts
import { governanceKey, groupGovernanceDiffs, parseGovernanceKey } from "./interview-report";
import type { GovernanceDiff } from "./api";

describe("groupGovernanceDiffs", () => {
  const diff = (code: string, field: GovernanceDiff["field"], name = `map ${code}`): GovernanceDiff => ({
    code, name, field, current: "x", delivered: "y", applied: false,
  });

  it("groups by map in first-seen order and orders fields owner→department→approvers", () => {
    const groups = groupGovernanceDiffs([
      diff("t2", "approvers"), diff("t1", "department"), diff("t2", "owner"), diff("t1", "owner"),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["t2", "t1"]);
    expect(groups[0].name).toBe("map t2");
    expect(groups[0].diffs.map((d) => d.field)).toEqual(["owner", "approvers"]);
    expect(groups[1].diffs.map((d) => d.field)).toEqual(["owner", "department"]);
  });

  it("round-trips keys even when the code contains a colon", () => {
    const key = governanceKey({ code: "a:b", field: "owner" });
    expect(key).toBe("a:b:owner");
    expect(parseGovernanceKey(key)).toEqual({ code: "a:b", field: "owner" });
  });
});
```

(If the file already imports `describe/it/expect` from vitest, do not duplicate; otherwise add `import { describe, expect, it } from "vitest";`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/interview-report.test.ts`
Expected: FAIL — `groupGovernanceDiffs` is not exported.

- [ ] **Step 3: Add the types to `api.ts`**

In `MapSummary` after `consultant_code?: string | null;`:

```ts
  // 오너 없이 임포트된 맵 — "Owner unconfirmed" 배지 (spec 2026-09-03 §5)
  consultant_owner_pending?: boolean;
```

Above `export interface InterviewImportResult` add:

```ts
export type GovernanceField = "owner" | "department" | "approvers";

// dry-run 응답의 기존 맵 거버넌스 차이 — 체크한 (code, field)만 apply가 교체 (spec 2026-09-03 §3)
export interface GovernanceDiff {
  code: string;
  name: string;
  field: GovernanceField;
  current: string;
  delivered: string;
  applied: boolean;
}

export interface GovernanceDecision {
  code: string;
  field: GovernanceField;
}
```

In `InterviewImportResult` add `governance: GovernanceDiff[];`. In `importInterview` body type add `decisions?: GovernanceDecision[];`.

- [ ] **Step 4: Add the helper to `interview-report.ts`**

Append:

```ts
// ── 거버넌스 확인 섹션 — dry-run governance[]를 맵 단위로 묶고 체크 키를 왕복한다 (spec 2026-09-03 §6)
import type { GovernanceDecision, GovernanceDiff, GovernanceField } from "./api";

export interface GovernanceMapGroup {
  code: string;
  name: string;
  diffs: GovernanceDiff[];
}

const GOVERNANCE_FIELD_ORDER: GovernanceField[] = ["owner", "department", "approvers"];

// 체크 상태 키 — 코드에 ':'가 있어도 필드는 콜론이 없으니 마지막 ':'에서 자르면 복원된다
export function governanceKey(d: GovernanceDecision): string {
  return `${d.code}:${d.field}`;
}

export function parseGovernanceKey(key: string): GovernanceDecision {
  const at = key.lastIndexOf(":");
  return { code: key.slice(0, at), field: key.slice(at + 1) as GovernanceField };
}

export function groupGovernanceDiffs(diffs: GovernanceDiff[]): GovernanceMapGroup[] {
  const groups = new Map<string, GovernanceMapGroup>();
  for (const d of diffs) {
    const group = groups.get(d.code) ?? { code: d.code, name: d.name, diffs: [] };
    group.diffs.push(d);
    groups.set(d.code, group);
  }
  for (const group of groups.values()) {
    group.diffs.sort(
      (a, b) => GOVERNANCE_FIELD_ORDER.indexOf(a.field) - GOVERNANCE_FIELD_ORDER.indexOf(b.field),
    );
  }
  return [...groups.values()];
}
```

Move the `import type` line up to the file's import block (imports must precede code).

- [ ] **Step 5: Run test, tsc, commit**

Run: `cd frontend && npx vitest run src/lib/interview-report.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

```bash
git add frontend/src/lib/api.ts frontend/src/lib/interview-report.ts frontend/src/lib/interview-report.test.ts
git commit -m "feat(fe): governance diff types and grouping helper — 거버넌스 차이 타입·맵 단위 그룹 헬퍼"
```

---

### Task 4: Frontend — governance review section + sticky Apply bar in the Framework panel

**Files:**
- Create: `frontend/src/components/admin/import-governance-review.tsx`
- Modify: `frontend/src/components/admin/framework-panel.tsx` (state ~159–165, handlers ~236–300, buttons ~871–891, report tail ~1035–1040, ConfirmDialog ~1047–1058)
- Modify: `frontend/src/lib/i18n-messages.ts` (en block near line 2059, ko block near 4180)

**Interfaces:**
- Consumes: `GovernanceDiff`, `groupGovernanceDiffs`, `governanceKey`, `parseGovernanceKey` from Task 3.
- Produces: `<ImportGovernanceReview diffs checked onToggle onToggleAll applied />`.

- [ ] **Step 1: Add i18n keys**

In the en block, replace `framework.importApplyTitle` / `framework.importApplyMessage` (now unused) with:

```ts
  "framework.importApplyBar": "{maps} maps · {changes} governance changes checked",
  "framework.governance.title": "Governance changes",
  "framework.governance.hint": "Checked items replace the current value on apply. Unchecked items keep the current value.",
  "framework.governance.none": "No governance changes in this delivery.",
  "framework.governance.checkAll": "Check all",
  "framework.governance.clear": "Clear",
  "framework.governance.field.owner": "Owner",
  "framework.governance.field.department": "Owning dept",
  "framework.governance.field.approvers": "Approvers",
  "framework.governance.keep": "Keep current",
  "framework.governance.replace": "Replace",
  "framework.governance.applied": "Applied",
  "framework.governance.kept": "Kept",
  "framework.governance.empty": "(none)",
```

ko block, same keys:

```ts
  "framework.importApplyBar": "맵 {maps}건 · 거버넌스 변경 {changes}건 체크",
  "framework.governance.title": "거버넌스 변경",
  "framework.governance.hint": "체크한 항목만 적용 시 교체되고, 체크하지 않은 항목은 현재값을 유지합니다.",
  "framework.governance.none": "이번 전달물에 거버넌스 변경이 없습니다.",
  "framework.governance.checkAll": "모두 체크",
  "framework.governance.clear": "모두 해제",
  "framework.governance.field.owner": "오너",
  "framework.governance.field.department": "오우닝 부서",
  "framework.governance.field.approvers": "승인자",
  "framework.governance.keep": "현재값 유지",
  "framework.governance.replace": "교체",
  "framework.governance.applied": "적용됨",
  "framework.governance.kept": "유지됨",
  "framework.governance.empty": "(없음)",
```

- [ ] **Step 2: Create the component**

`frontend/src/components/admin/import-governance-review.tsx`:

```tsx
// 재임포트 거버넌스 확인 — dry-run governance[]를 맵별로 묶어 "현재 → 전달" + 체크박스로 보여준다.
// 체크한 (code, field)만 apply가 교체하고 나머지는 현재값 유지 (spec 2026-09-03 §6).
// apply 결과 보기(applied=true)는 체크박스 대신 적용/유지 배지.
"use client";

import { ArrowRight } from "lucide-react";

import type { GovernanceDiff } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { governanceKey, groupGovernanceDiffs } from "@/lib/interview-report";

interface ImportGovernanceReviewProps {
  diffs: GovernanceDiff[];
  checked: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (next: boolean) => void;
  applied: boolean;
}

export function ImportGovernanceReview({ diffs, checked, onToggle, onToggleAll, applied }: ImportGovernanceReviewProps) {
  const { t } = useI18n();
  const groups = groupGovernanceDiffs(diffs);
  const allChecked = diffs.length > 0 && diffs.every((d) => checked.has(governanceKey(d)));

  return (
    <div data-id="import-governance-review" className="flex flex-col gap-1.5 rounded-sm border border-hairline">
      <div className="flex items-center gap-2 border-b border-divider bg-surface-alt px-2 py-1.5">
        <span className="text-caption-strong text-ink">{t("framework.governance.title")}</span>
        <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{t("framework.governance.hint")}</span>
        {!applied && diffs.length > 0 && (
          <button
            type="button"
            data-id="import-governance-check-all"
            className="shrink-0 rounded-sm px-2 py-0.5 text-fine text-accent hover:bg-accent-tint"
            onClick={() => onToggleAll(!allChecked)}
          >
            {allChecked ? t("framework.governance.clear") : t("framework.governance.checkAll")}
          </button>
        )}
      </div>
      {groups.length === 0 ? (
        <p data-id="import-governance-none" className="px-2 pb-1.5 text-fine text-ink-tertiary">
          {t("framework.governance.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 px-2 pb-2">
          {groups.map((group) => (
            <li key={group.code} data-id={`import-governance-map-${group.code}`} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-caption text-ink">{group.name}</span>
                <span className="shrink-0 font-mono text-fine text-ink-tertiary">{group.code}</span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.diffs.map((d) => {
                  const key = governanceKey(d);
                  const on = applied ? d.applied : checked.has(key);
                  return (
                    <li
                      key={key}
                      data-id={`import-governance-row-${d.code}-${d.field}`}
                      className={`flex items-center gap-2 rounded-sm px-2 py-1 text-fine ${
                        on ? "bg-changed/10" : "bg-surface"
                      }`}
                    >
                      {applied ? (
                        <span
                          data-id={`import-governance-result-${d.code}-${d.field}`}
                          className={`w-16 shrink-0 rounded-sm border px-1 text-center ${
                            d.applied
                              ? "border-changed/40 text-changed"
                              : "border-hairline text-ink-tertiary"
                          }`}
                        >
                          {d.applied ? t("framework.governance.applied") : t("framework.governance.kept")}
                        </span>
                      ) : (
                        <label className="flex w-16 shrink-0 items-center gap-1">
                          <input
                            type="checkbox"
                            data-id={`import-governance-check-${d.code}-${d.field}`}
                            className="accent-[var(--color-accent)]"
                            checked={on}
                            onChange={() => onToggle(key)}
                          />
                          <span className={on ? "text-changed" : "text-ink-tertiary"}>
                            {on ? t("framework.governance.replace") : t("framework.governance.keep")}
                          </span>
                        </label>
                      )}
                      <span className="w-24 shrink-0 text-ink-secondary">
                        {t(`framework.governance.field.${d.field}`)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-tertiary" title={d.current}>
                        {d.current || t("framework.governance.empty")}
                      </span>
                      <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                      <span
                        className={`min-w-0 flex-1 truncate ${on ? "text-changed" : "text-ink"}`}
                        title={d.delivered}
                      >
                        {d.delivered}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

The `t(\`framework.governance.field.${d.field}\`)` call must satisfy the i18n key type — if `t` only accepts literal keys, replace it with a small map: `const FIELD_LABEL: Record<GovernanceField, MessageKey> = { owner: "framework.governance.field.owner", department: "framework.governance.field.department", approvers: "framework.governance.field.approvers" }` (use whatever key type `useI18n` exports; check `frontend/src/lib/i18n.ts`).

- [ ] **Step 3: Integrate into `framework-panel.tsx`**

State — replace `const [confirmInterviewApply, setConfirmInterviewApply] = useState(false);` with:

```ts
  // 거버넌스 체크 키(`code:field`) — dry-run 결과마다 비우고, 파일 변경 시 리포트와 함께 무효화 (spec 2026-09-03 §6)
  const [governanceChecked, setGovernanceChecked] = useState<Set<string>>(new Set());
```

Add imports: `import { ImportGovernanceReview } from "@/components/admin/import-governance-review";` and add `governanceKey, parseGovernanceKey` to the existing `@/lib/interview-report` import (keep whatever is already imported from it).

Handlers — in `handleInterviewFiles` and `handleRemoveInterviewFile`, after `setInterviewResult(null);` add `setGovernanceChecked(new Set());`. In `handleInterviewDryRun` after `setInterviewResult(result);` add `setGovernanceChecked(new Set());`. Replace `handleInterviewApply` with:

```ts
  async function handleInterviewApply() {
    if (!interviewResult) return;
    setInterviewBusy(true);
    try {
      const result = await importInterview({
        files: getInterviewPayloadFiles(),
        apply: true,
        decisions: [...governanceChecked].map(parseGovernanceKey),
      });
      setInterviewResult(result);
      setGovernanceChecked(new Set());
      await refreshTree();
      onToast(t("framework.importApplySuccess"));
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setInterviewBusy(false);
    }
  }

  function toggleGovernance(key: string) {
    setGovernanceChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllGovernance(next: boolean) {
    setGovernanceChecked(
      next && interviewResult ? new Set(interviewResult.governance.map(governanceKey)) : new Set(),
    );
  }
```

Buttons — delete the top `interview-import-apply` button (keep the Dry-run button). Report tail — after the `{interviewResult.truncated && (...)}` paragraph, still inside the `interview-import-report` div, add:

```tsx
            <ImportGovernanceReview
              diffs={interviewResult.governance}
              checked={governanceChecked}
              onToggle={toggleGovernance}
              onToggleAll={toggleAllGovernance}
              applied={interviewResult.applied}
            />
            <div
              data-id="interview-import-actions"
              className="sticky bottom-0 z-[1] flex items-center gap-2 border-t border-hairline bg-surface py-2"
            >
              <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">
                {t("framework.importApplyBar", {
                  maps: (interviewResult.summary.created ?? 0) + (interviewResult.summary.updated ?? 0),
                  changes: governanceChecked.size,
                })}
              </span>
              <button
                type="button"
                data-id="interview-import-cancel"
                disabled={interviewBusy}
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
                onClick={() => {
                  setInterviewResult(null);
                  setGovernanceChecked(new Set());
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="interview-import-apply"
                disabled={interviewBusy || interviewResult.applied}
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
                onClick={() => void handleInterviewApply()}
              >
                {t("framework.importApply")}
              </button>
            </div>
```

Delete the `{confirmInterviewApply && interviewResult && (<ConfirmDialog …/>)}` block. If `ConfirmDialog` is no longer referenced anywhere in the file, remove its import (lint will flag it).

- [ ] **Step 4: Gates**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: clean. Fix any i18n key typing issue per the note in Step 2.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/import-governance-review.tsx frontend/src/components/admin/framework-panel.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(fe): governance review section with sticky apply bar — 임포트 거버넌스 체크 섹션·하단 적용 바"
```

---

### Task 5: Frontend — "Owner unconfirmed" pill on map cards

**Files:**
- Modify: `frontend/src/components/maps/map-card.tsx` (`renderOwnerAndTime` ~line 115–128 and the owner card ~line 330–341)
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: i18n keys**

en:

```ts
  "map.ownerPending": "Owner unconfirmed",
  "map.ownerPendingHint": "Imported without an owner — the importer holds it until handover",
```

ko:

```ts
  "map.ownerPending": "오너 미확정",
  "map.ownerPendingHint": "오너 없이 임포트됨 — 인수인계 전까지 임포트한 사람이 보유",
```

- [ ] **Step 2: Render the pill in both owner spots**

In `renderOwnerAndTime`, after the departed badge block (`{!map.owner_name && (map.owner_id ?? map.created_by) && (...)}`) add:

```tsx
          {map.consultant_owner_pending && (
            <span
              data-id="map-owner-pending"
              title={t("map.ownerPendingHint")}
              className="shrink-0 rounded-sm border border-changed/40 bg-changed/10 px-1 text-fine text-changed"
            >
              {t("map.ownerPending")}
            </span>
          )}
```

In the owner card (`{/* 오너 카드 / owner card */}`), after the departed badge inside the same `<span className="truncate text-caption text-ink">` add:

```tsx
                  {map.consultant_owner_pending && (
                    <span
                      data-id="map-owner-pending"
                      title={t("map.ownerPendingHint")}
                      className="ml-1.5 rounded-sm border border-changed/40 bg-changed/10 px-1 text-fine text-changed"
                    >
                      {t("map.ownerPending")}
                    </span>
                  )}
```

- [ ] **Step 3: Gates and commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`

```bash
git add frontend/src/components/maps/map-card.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(fe): owner-unconfirmed pill on map cards — 오너 미확정 배지"
```

---

### Task 6: Browser verification, screenshots, docs, PROGRESS

**Files:**
- Modify: `frontend/scripts/pw-smoke-interview-import.mjs`
- Modify: `docs/qa/interview-import-field-map.md` (§1 rows table: `owner`/`approvers`/`department`; §4 rows "owner/approvers가 employees에 없음", "이미 오너가 확정된 맵에 새 owner/approvers")
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update the smoke script for the new apply bar**

Replace

```js
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
```

with

```js
  await page.locator('[data-id="interview-import-apply"]').click();
```

Then add a governance scenario after the idempotency check (`check("re-import idempotent", …)`):

```js
  // ── 2b) 거버넌스 확인 — 오너가 다른 재전달은 체크한 것만 교체 ─────────────
  const raw = JSON.parse(await fs.readFile(path.join(SAMPLE_DIR, "calibration-l5.json"), "utf8"));
  raw.rows[0].owner = GOV_OWNER;
  const govFile = path.join(SCRATCH, "calibration-gov.json");
  await fs.writeFile(govFile, JSON.stringify(raw));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-id="interview-import-files"]').setInputFiles([govFile]);
  await page.locator('[data-id="interview-import-dryrun"]').click();
  await page.waitForSelector('[data-id="import-governance-review"]', { timeout: 15000 });
  const govCode = raw.rows[0].taskId;
  const ownerRow = page.locator(`[data-id="import-governance-row-${govCode}-owner"]`);
  check("governance owner diff listed", await ownerRow.isVisible());
  check("owner diff shows delivered login", (await ownerRow.textContent())?.includes(GOV_OWNER) ?? false);
  await page.locator('[data-id="interview-import-actions"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SCRATCH, "import-governance-unchecked.png") });
  await page.locator(`[data-id="import-governance-check-${govCode}-owner"]`).check();
  check("apply bar counts checked change",
    ((await page.locator('[data-id="interview-import-actions"]').textContent()) ?? "").includes("1 governance"));
  await page.screenshot({ path: path.join(SCRATCH, "import-governance-checked.png") });
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.waitForSelector(`[data-id="import-governance-result-${govCode}-owner"]`, { timeout: 20000 });
  const applied = (await page.locator(`[data-id="import-governance-result-${govCode}-owner"]`).textContent()) ?? "";
  check("owner decision applied", applied.includes("Applied"));
  await page.screenshot({ path: path.join(SCRATCH, "import-governance-applied.png") });
```

Add at the top of the script:

```js
import fs from "node:fs/promises";
const SCRATCH = process.env.SCRATCH_DIR ?? "/tmp";
// 재전달 오너 — 시드 직원 중 임포터(admin.sys)가 아닌 로그인. 시드 목록 확인:
//   grep -n "login_id=" backend/scripts/*.py | head
const GOV_OWNER = process.env.GOV_OWNER ?? "hong.gd";
```

Before running, confirm the seeded login with `grep -rn "login_id=\"" backend/scripts/reset_db.py backend/scripts/seed*.py | head -5` and set `GOV_OWNER` to an existing one. Also update the home-side assertions in the script if the map card now shows the "Owner unconfirmed" pill (`[data-id="map-owner-pending"]`) — add `check("owner pending pill on card", await page.locator('[data-id="map-owner-pending"]').first().isVisible())` right after the map card is visible in section 3, because the sample maps have `owner: null`.

- [ ] **Step 2: Run backend + frontend natively and execute the smoke**

From the worktree, seed and start servers in the background (backend on 8000 with sqlite dev db, frontend on 3000):

```bash
cd backend && AI_ENABLED=false .venv/bin/python -m scripts.reset_db && AI_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000 &
cd frontend && BACKEND_URL=http://localhost:8000 npm run dev &
```

(Consult `docs/lessons/browser-verification.md` first: kill zombie `next dev` on 3000, use `frontend/` as node cwd.) Then:

```bash
cd frontend && SCRATCH_DIR=/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/2e8e1e95-8217-45cb-a6eb-286a516f8f7e/scratchpad GOV_OWNER=<seeded login> BASE_URL=http://localhost:3000 node scripts/pw-smoke-interview-import.mjs
```

Expected: `N/N passed`, three PNGs written. Send `import-governance-checked.png` and `import-governance-applied.png` to the user with SendUserFile.

- [ ] **Step 3: Update the field map doc**

In `docs/qa/interview-import-field-map.md` §1 `rows[]` table replace the `owner`, `approvers`, `department` rows with:

```
| `owner` | 신규 맵: 맵 오너(null이면 **실행자 폴백 + `consultant_owner_pending=True`**). 기존 맵: 현재값과 다르면 dry-run `governance[]` 차이 행 — **체크한 것만 교체**(체크 시 대기 플래그 해제) |
| `ownerRole` | 맵 설명 `[Interview]` 섹션 `Owner role:` 줄 |
| `approvers[]` | 신규 맵: `map_approvers`. 기존 맵: 비어 있지 않고 집합이 다르면 governance 차이 행 — 체크 시 전부 교체 |
| `department` | `sp_department`(항상) + 신규 맵 `owning_department`. 기존 맵: 해석 결과가 현재 owning과 다르면 governance 차이 행 — 체크 시 교체 |
```

In §4 replace the two rows `owner/approvers가 employees에 없음` (keep) and `**이미 오너가 확정된 맵에 새 owner/approvers**` with:

```
| **기존 맵에 새 owner/department/approvers** | 자동 적용되지 않는다 — 리포트 "Governance changes"에서 체크한 것만 교체, 나머지는 현재값 유지(오너 대기 맵도 동일) | governance 행 + `governance` 리포트 행 |
```

- [ ] **Step 4: PROGRESS entry and final gates**

Add under a new heading at the top of `PROGRESS.md`:

```
## 2026-09-03 — 인터뷰 임포트 거버넌스 확인 적용 (feat/consultant-import-fallbacks)
- 재임포트가 오너·오우닝 부서·승인자를 바꾸려면 dry-run 리포트의 "Governance changes"에서 체크한 항목만 교체(`decisions` 동봉, 미매칭 422) — "오너 대기 맵 무조건 교체" 예외 폐지, 수동 오너 이전이 대기 플래그를 내림, 카드에 "Owner unconfirmed" 필. 확인 다이얼로그 → 리포트 하단 고정 [Cancel][Apply] 바. 배경 조사: 폴백 6종·노트·값 대체 전수(아티팩트 "임포트 폴백 지도"), 후속 5건(폴백 노출·노트 CRUD·SP 연간횟수/FTE·지정 모달·인스펙터 줄바꿈) 대기.
```

Run the full gates: backend `pytest tests/ -q` (with the env vars) + ruff, frontend `vitest run` + `tsc --noEmit` + `lint`. Expected: all green.

```bash
git add frontend/scripts/pw-smoke-interview-import.mjs docs/qa/interview-import-field-map.md PROGRESS.md
git commit -m "test(import): smoke governance review flow + docs — 거버넌스 확인 스모크·필드맵·PROGRESS"
```
