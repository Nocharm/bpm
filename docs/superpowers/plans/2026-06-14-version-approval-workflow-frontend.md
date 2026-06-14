# Version Approval Workflow — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ FRONTEND CAVEAT:** `frontend/AGENTS.md` warns "This is NOT the Next.js you know — read the relevant guide in `node_modules/next/dist/docs/` before writing code." This plan touches client components only (`"use client"` files already in the tree) and adds no new routing/server-component/data-fetching patterns, so the risk is low — but if a task requires a new Next.js construct, consult that guide first.

**Goal:** Surface the backend version approval workflow in the editor UI — status badges, role-gated action buttons (submit/approve/reject/publish/withdraw), read-only enforcement for non-editable statuses, per-map approver management, and an in-app notification bell with polling.

**Architecture:** Extend the API client with the workflow endpoints and a cross-mode identity call (`GET /api/me`). Compute the caller's role (submitter / approver / map owner) from that identity plus the version's `submitted_by`, the map's `approvers`, and the map's `created_by`. Gate action buttons and extend the existing `readOnly` flag so pending/approved/published versions lock the canvas. Add a polling notification bell to the top nav. Two small backend additions (`GET /api/me`, `MapOut.created_by`) unblock client-side role computation.

**Tech Stack:** Next.js (client components) + React + TypeScript (strict), `@xyflow/react`, Lucide icons, the project's `useI18n()` t-function, design tokens from `globals.css`. Backend: FastAPI/Pydantic (two tiny additions).

**Specs:** design `docs/superpowers/specs/2026-06-14-version-approval-workflow-design.md`; backend plan `docs/superpowers/plans/2026-06-14-version-approval-workflow-backend.md` (the API contract this consumes).

**Verification reality:** the frontend has **no JS test harness** (no jest/vitest). Per `rules/guidelines.md`, do NOT fabricate one. Each frontend task verifies with:
- `npm run lint` (eslint) — clean
- `npm run build` (next build = tsc typecheck + production build) — green
- Explicit **manual checks** listed per task (the implementer runs `npm run dev`, exercises the flow, and reports observed behavior). State plainly what was checked vs. left unchecked.

Backend tasks (Task 1) use pytest as usual.

Commands (bash / PowerShell):
- Frontend (from `frontend/`): `npm run lint` / `npm run build` / `npm run dev`
- Backend (from `backend/`): `.venv/bin/python -m pytest tests/ -q` · `.venv/bin/ruff check app/ tests/` (PowerShell: `.venv\Scripts\...`)

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/app/routers/maps.py` or `versions.py` | `GET /api/me` identity endpoint | Modify (add endpoint) |
| `backend/app/schemas.py` | `MapOut.created_by`, `MeOut` | Modify |
| `frontend/src/lib/api.ts` | Workflow + notification + me API functions and types | Modify |
| `frontend/src/components/status-badge.tsx` | Version status pill | Create |
| `frontend/src/components/workflow-actions.tsx` | Role-gated transition buttons + reject modal | Create |
| `frontend/src/components/approver-manager.tsx` | Map-owner approver assignment dialog | Create |
| `frontend/src/components/notification-bell.tsx` | Polling bell + dropdown | Create |
| `frontend/src/app/maps/[mapId]/page.tsx` | Wire workflow state, role, readOnly, badge, actions | Modify |
| `frontend/src/components/top-nav.tsx` | Mount notification bell | Modify |
| `frontend/src/lib/i18n-messages.ts` | New en/ko keys | Modify |

---

### Task 1: Backend — identity endpoint + expose map owner

**Why:** In auth-disabled local mode `getCurrentUser()` is `null` on the client, so the frontend cannot know "who am I" for role gating. A `GET /api/me` returns the effective username in BOTH modes (dev_user locally, JWT subject on the server). The map owner (`created_by`) must also be exposed to gate the approver-management UI.

**Files:** `backend/app/schemas.py`, `backend/app/routers/maps.py`, `backend/tests/test_workflow.py`

- [ ] **Step 1: Write failing tests** — append to `backend/tests/test_workflow.py`:

```python
def test_me_returns_current_user(client: TestClient) -> None:
    me = client.get("/api/me").json()
    assert me["username"] == settings.dev_user


def test_map_detail_exposes_created_by(client: TestClient) -> None:
    map_id, _version_id = _create_map_with_version(client)
    detail = client.get(f"/api/maps/{map_id}").json()
    assert detail["created_by"] == settings.dev_user
```

- [ ] **Step 2: Run, verify FAIL** — `.venv/bin/python -m pytest tests/test_workflow.py::test_me_returns_current_user -v` → 404; `...::test_map_detail_exposes_created_by` → KeyError 'created_by'.

- [ ] **Step 3: Add schemas** — in `backend/app/schemas.py`, add `created_by` to `MapOut` (it currently has id/name/description/created_at/updated_at):

```python
class MapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    created_by: str | None
    created_at: datetime
    updated_at: datetime
```

And append a `MeOut` schema at the end of the file:

```python
class MeOut(BaseModel):
    username: str
```

- [ ] **Step 4: Add the `/api/me` endpoint** — in `backend/app/routers/maps.py`, import `MeOut` and add `get_current_user` if not already imported (it is). Add this endpoint (note: the maps router prefix is `/api/maps`, so put `/api/me` on a router without that prefix — add it to `app/main.py` as a plain route instead). Simplest: add to `app/main.py` next to `check_health`:

In `backend/app/main.py`:
```python
from app.auth import get_current_user
from app.schemas import MeOut
```
and after the `check_health` function:
```python
@app.get("/api/me", response_model=MeOut)
async def get_me(user: str = Depends(get_current_user)) -> MeOut:
    return MeOut(username=user)
```
(Add `from fastapi import Depends` to the existing fastapi import in main.py.)

- [ ] **Step 5: Run tests + suite + lint**
- `.venv/bin/python -m pytest tests/test_workflow.py::test_me_returns_current_user tests/test_workflow.py::test_map_detail_exposes_created_by -v` → PASS
- `.venv/bin/python -m pytest tests/ -q` → green (existing map tests check individual keys; `created_by` is additive)
- `.venv/bin/ruff check app/ tests/` → clean

- [ ] **Step 6: Commit**
```bash
git add app/schemas.py app/main.py tests/test_workflow.py
git commit -m "feat(backend): GET /api/me + expose map created_by — 신원 조회·맵 소유자 노출"
```

---

### Task 2: API client — workflow, notification, and identity functions

**Files:** `frontend/src/lib/api.ts`

- [ ] **Step 1: Extend `VersionSummary` and `MapDetail` types** — replace the existing interfaces (around lines 11-18):

```typescript
export type VersionStatus =
  | "draft"
  | "pending"
  | "approved"
  | "published"
  | "rejected";

export interface VersionSummary {
  id: number;
  label: string;
  status: VersionStatus;
  submitted_by: string | null;
  reject_reason: string | null;
}

export interface MapSummary {
  id: number;
  name: string;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MapDetail extends MapSummary {
  versions: VersionSummary[];
}
```

(`MapSummary` previously had no `created_by` — adding it is safe; `listMaps` consumers ignore it.)

- [ ] **Step 2: Add workflow + notification + me functions** — append at the END of `frontend/src/lib/api.ts`:

```typescript
// ── Version approval workflow (design 2026-06-14) ──────────

export interface WorkflowState {
  version_id: number;
  status: VersionStatus;
  submitted_by: string | null;
  reject_reason: string | null;
  approvers: string[];
  approvals: string[];
}

export function getMe(): Promise<{ username: string }> {
  return request<{ username: string }>("/me");
}

export function getWorkflowState(versionId: number): Promise<WorkflowState> {
  return request<WorkflowState>(`/versions/${versionId}/workflow`);
}

export function submitVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/submit`, { method: "POST" });
}

export function approveVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/approve`, { method: "POST" });
}

export function rejectVersion(
  versionId: number,
  reason: string,
): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function publishVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/publish`, { method: "POST" });
}

export function withdrawVersion(versionId: number): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/withdraw`, { method: "POST" });
}

export function listApprovers(mapId: number): Promise<string[]> {
  return request<string[]>(`/maps/${mapId}/approvers`);
}

export function setApprovers(mapId: number, userIds: string[]): Promise<string[]> {
  return request<string[]>(`/maps/${mapId}/approvers`, {
    method: "PUT",
    body: JSON.stringify({ user_ids: userIds }),
  });
}

export interface NotificationItem {
  id: number;
  type: string;
  map_id: number | null;
  version_id: number | null;
  message: string;
  read: boolean;
  created_at: string;
}

export function listNotifications(unreadOnly = false): Promise<NotificationItem[]> {
  const query = unreadOnly ? "?unread_only=true" : "";
  return request<NotificationItem[]>(`/notifications${query}`);
}

export function markNotificationRead(id: number): Promise<NotificationItem> {
  return request<NotificationItem>(`/notifications/${id}/read`, { method: "POST" });
}
```

- [ ] **Step 3: Verify** — `npm run build` → green (TypeScript compiles; the new types are consumed in later tasks). `npm run lint` → clean. No manual check (types only).

- [ ] **Step 4: Commit**
```bash
git add src/lib/api.ts
git commit -m "feat(frontend): workflow/notification/me API client functions — 워크플로우·알림·신원 API"
```

---

### Task 3: Status badge component

**Files:** Create `frontend/src/components/status-badge.tsx`; add i18n keys to `frontend/src/lib/i18n-messages.ts`.

- [ ] **Step 1: Add i18n keys** — in `frontend/src/lib/i18n-messages.ts`, add to the `en` object (and the matching Korean to `ko`):

en:
```typescript
  "status.draft": "Draft",
  "status.pending": "Pending",
  "status.approved": "Approved",
  "status.published": "Published",
  "status.rejected": "Rejected",
```
ko:
```typescript
  "status.draft": "초안",
  "status.pending": "검토 대기",
  "status.approved": "승인됨",
  "status.published": "게시됨",
  "status.rejected": "반려됨",
```

- [ ] **Step 2: Create the component** — `frontend/src/components/status-badge.tsx`:

```tsx
"use client";

// 버전 라이프사이클 상태 pill — 디자인 토큰만 사용 (rules/frontend/design.md)
import type { VersionStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const STYLES: Record<VersionStatus, string> = {
  draft: "border-hairline text-ink-tertiary",
  pending: "border-changed text-changed",
  approved: "border-added text-added",
  published: "border-accent text-accent",
  rejected: "border-error text-error",
};

const LABEL_KEY: Record<VersionStatus, string> = {
  draft: "status.draft",
  pending: "status.pending",
  approved: "status.approved",
  published: "status.published",
  rejected: "status.rejected",
};

export function StatusBadge({ status }: { status: VersionStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-fine ${STYLES[status]}`}
    >
      {t(LABEL_KEY[status])}
    </span>
  );
}
```

> Note: confirm `border-changed`, `border-added`, `border-accent`, `border-error`, `text-changed`, `text-added` exist as Tailwind utilities generated from the `@theme` tokens in `globals.css`. If a `border-*` variant for a token isn't generated, use inline `style={{ borderColor: "var(--color-changed)", color: "var(--color-changed)" }}` instead (still token-based, satisfies the no-raw-hex rule). Verify by building.

- [ ] **Step 3: Render in the editor header** — in `frontend/src/app/maps/[mapId]/page.tsx`, import the badge and the current version's status. Find the version `<select>` block (renders `versions.map(...)`). Immediately before the `<select>`, render the badge for the currently selected version:

```tsx
{(() => {
  const current = versions.find((v) => v.id === versionId);
  return current ? <StatusBadge status={current.status} /> : null;
})()}
```

Add the import at the top: `import { StatusBadge } from "@/components/status-badge";`

- [ ] **Step 4: Verify**
- `npm run build` → green; `npm run lint` → clean.
- **Manual:** `npm run dev`, open a map editor. Confirm a "Draft" pill shows next to the version selector. Switch versions (if seed data has multiple) and confirm the pill reflects each version's status. Report what you saw.

- [ ] **Step 5: Commit**
```bash
git add src/components/status-badge.tsx src/lib/i18n-messages.ts src/app/maps/[mapId]/page.tsx
git commit -m "feat(frontend): version status badge in editor header — 버전 상태 배지"
```

---

### Task 4: Identity + workflow-state + role computation in the editor

**Files:** `frontend/src/app/maps/[mapId]/page.tsx`

This task adds the data the action buttons (Task 5) and read-only extension (Task 6) need. No visible UI yet beyond what Task 3 added.

- [ ] **Step 1: Hold identity, map owner, and workflow state in component state** — in `MapEditor` (page.tsx), add near the other `useState` declarations:

```tsx
const [username, setUsername] = useState<string | null>(null);
const [mapOwner, setMapOwner] = useState<string | null>(null);
const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
```

Add imports: `import { getMe, getWorkflowState, type WorkflowState } from "@/lib/api";`

- [ ] **Step 2: Fetch identity once on mount**:

```tsx
useEffect(() => {
  let alive = true;
  void getMe()
    .then((me) => {
      if (alive) setUsername(me.username);
    })
    .catch(() => undefined);
  return () => {
    alive = false;
  };
}, []);
```

- [ ] **Step 3: Capture map owner where the map detail is loaded** — in the existing `getMap(mapId)` effect (the one that does `setMapName(detail.name); setVersions(detail.versions);`), add:

```tsx
setMapOwner(detail.created_by);
```

- [ ] **Step 4: Fetch workflow state for the current version, and expose a refresh function** — add:

```tsx
const refreshWorkflow = useCallback(async () => {
  if (versionId === null) return;
  try {
    setWorkflow(await getWorkflowState(versionId));
  } catch {
    setWorkflow(null);
  }
}, [versionId]);

useEffect(() => {
  void refreshWorkflow();
}, [refreshWorkflow]);
```

- [ ] **Step 5: Derive roles (compute during render — no effect/state)**:

```tsx
const currentVersion = versions.find((v) => v.id === versionId) ?? null;
const isMapOwner = username !== null && mapOwner !== null && username === mapOwner;
const isApprover = username !== null && (workflow?.approvers ?? []).includes(username);
const isSubmitter =
  username !== null && currentVersion?.submitted_by === username;
const hasApproved =
  username !== null && (workflow?.approvals ?? []).includes(username);
```

- [ ] **Step 6: Verify** — `npm run build` → green; `npm run lint` → clean. (If lint flags the derived consts as unused until Task 5 wires them, add a temporary `void` reference or proceed directly to Task 5 in the same session so they're used. Prefer wiring Task 5 immediately.) No manual check yet.

- [ ] **Step 7: Commit**
```bash
git add src/app/maps/[mapId]/page.tsx
git commit -m "feat(frontend): editor identity + workflow-state + role derivation — 신원·워크플로우 상태·역할 판정"
```

---

### Task 5: Workflow action buttons + reject modal

**Files:** Create `frontend/src/components/workflow-actions.tsx`; wire into `frontend/src/app/maps/[mapId]/page.tsx`; i18n keys.

- [ ] **Step 1: Add i18n keys** — `en` (and `ko`):

en:
```typescript
  "wf.submit": "Submit for approval",
  "wf.approve": "Approve",
  "wf.reject": "Reject",
  "wf.publish": "Publish",
  "wf.withdraw": "Withdraw",
  "wf.approvalProgress": "{done}/{total} approved",
  "wf.rejectTitle": "Reject this version",
  "wf.rejectReason": "Reason",
  "wf.rejectConfirm": "Reject",
  "wf.rejectCancel": "Cancel",
  "wf.rejectedBanner": "Rejected: {reason}",
  "err.workflow": "Workflow action failed",
```
ko:
```typescript
  "wf.submit": "승인 요청",
  "wf.approve": "승인",
  "wf.reject": "반려",
  "wf.publish": "게시",
  "wf.withdraw": "회수",
  "wf.approvalProgress": "{done}/{total} 승인",
  "wf.rejectTitle": "이 버전 반려",
  "wf.rejectReason": "사유",
  "wf.rejectConfirm": "반려",
  "wf.rejectCancel": "취소",
  "wf.rejectedBanner": "반려됨: {reason}",
  "err.workflow": "워크플로우 작업 실패",
```

- [ ] **Step 2: Create `frontend/src/components/workflow-actions.tsx`**:

```tsx
"use client";

// 버전 상태·역할에 따라 조건부 전이 버튼을 노출 (design 2026-06-14)
import { useState } from "react";

import type { VersionStatus, WorkflowState } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface WorkflowActionsProps {
  status: VersionStatus;
  workflow: WorkflowState | null;
  isCheckoutHolder: boolean; // 편집 잠금 보유(=작성 주체)
  isApprover: boolean;
  isSubmitter: boolean;
  hasApproved: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onPublish: () => void;
  onWithdraw: () => void;
}

export function WorkflowActions({
  status,
  workflow,
  isCheckoutHolder,
  isApprover,
  isSubmitter,
  hasApproved,
  onSubmit,
  onApprove,
  onReject,
  onPublish,
  onWithdraw,
}: WorkflowActionsProps) {
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  return (
    <div className="flex items-center gap-1">
      {(status === "draft" || status === "rejected") && isCheckoutHolder && (
        <button type="button" className={btn} onClick={onSubmit}>
          {t("wf.submit")}
        </button>
      )}

      {status === "pending" && isApprover && (
        <>
          <button
            type="button"
            className={btn}
            onClick={onApprove}
            disabled={hasApproved}
          >
            {t("wf.approve")}
          </button>
          <button type="button" className={btn} onClick={() => setRejecting(true)}>
            {t("wf.reject")}
          </button>
        </>
      )}

      {status === "pending" && workflow && (
        <span className="text-fine text-ink-tertiary">
          {t("wf.approvalProgress", {
            done: workflow.approvals.length,
            total: workflow.approvers.length,
          })}
        </span>
      )}

      {status === "approved" && isSubmitter && (
        <button type="button" className={btn} onClick={onPublish}>
          {t("wf.publish")}
        </button>
      )}

      {(status === "pending" || status === "approved") && isSubmitter && (
        <button type="button" className={btn} onClick={onWithdraw}>
          {t("wf.withdraw")}
        </button>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-80 rounded-md bg-surface p-4 shadow-lg">
            <p className="text-body-strong text-ink">{t("wf.rejectTitle")}</p>
            <label className="mt-2 block text-caption text-ink-secondary">
              {t("wf.rejectReason")}
            </label>
            <textarea
              className="mt-1 w-full rounded-sm border border-hairline p-2 text-caption"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
              >
                {t("wf.rejectCancel")}
              </button>
              <button
                type="button"
                className={`${btn} text-error`}
                disabled={reason.trim().length === 0}
                onClick={() => {
                  onReject(reason.trim());
                  setRejecting(false);
                  setReason("");
                }}
              >
                {t("wf.rejectConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add transition handlers in page.tsx** — add (imports: `submitVersion, approveVersion, rejectVersion, publishVersion, withdrawVersion`):

```tsx
const runTransition = useCallback(
  async (action: (id: number) => Promise<VersionSummary>) => {
    if (versionId === null) return;
    try {
      const updated = await action(versionId);
      // 버전 목록의 상태/제출자/사유 갱신
      setVersions((prev) =>
        prev.map((v) => (v.id === updated.id ? { ...v, ...updated } : v)),
      );
      await refreshWorkflow();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.workflow"));
    }
  },
  [versionId, refreshWorkflow, t],
);
```

(`VersionSummary` and the five transition functions must be imported from `@/lib/api`.)

- [ ] **Step 4: Render `WorkflowActions`** — next to the StatusBadge / version controls in the header, render:

```tsx
{currentVersion && (
  <WorkflowActions
    status={currentVersion.status}
    workflow={workflow}
    isCheckoutHolder={checkout?.mine ?? false}
    isApprover={isApprover}
    isSubmitter={isSubmitter}
    hasApproved={hasApproved}
    onSubmit={() => void runTransition(submitVersion)}
    onApprove={() => void runTransition(approveVersion)}
    onReject={(reason) => void runTransition((id) => rejectVersion(id, reason))}
    onPublish={() => void runTransition(publishVersion)}
    onWithdraw={() => void runTransition(withdrawVersion)}
  />
)}
```

Import: `import { WorkflowActions } from "@/components/workflow-actions";`

- [ ] **Step 5: Verify**
- `npm run build` → green; `npm run lint` → clean.
- **Manual (use seeded multi-version data + local dev_user = "local-dev"):** As the map owner, set yourself ("local-dev") as an approver via the approver manager (Task 6) OR temporarily via `PUT /api/maps/{id}/approvers`. Then: hold the checkout on a draft → "Submit for approval" appears → click it → badge flips to Pending, "0/1 approved" shows, Approve/Reject appear. Click Approve → badge → Approved, Publish + Withdraw appear. Click Publish → badge → Published. Report each observed transition. (If approver setup isn't done yet, verify at least that Submit appears on a draft you hold and the reject modal opens.)

- [ ] **Step 6: Commit**
```bash
git add src/components/workflow-actions.tsx src/lib/i18n-messages.ts src/app/maps/[mapId]/page.tsx
git commit -m "feat(frontend): workflow action buttons + reject modal — 워크플로우 액션 버튼·반려 모달"
```

---

### Task 6: Read-only enforcement for non-editable statuses + rejected banner

**Files:** `frontend/src/app/maps/[mapId]/page.tsx`

- [ ] **Step 1: Extend the `readOnly` flag** — find `const readOnly = checkout !== null && !checkout.mine;`. Replace with:

```tsx
// 비편집 상태(pending/approved/published)는 캔버스 읽기 전용 — 잠금과 별개로 status 기준
const statusLocksEditing =
  currentVersion !== null &&
  currentVersion.status !== "draft" &&
  currentVersion.status !== "rejected";
const readOnly = (checkout !== null && !checkout.mine) || statusLocksEditing;
```

> Placement: `currentVersion` is derived in Task 4 Step 5. Ensure that derivation appears ABOVE this `readOnly` line (move the `currentVersion` const up if needed — it only depends on `versions` and `versionId`). Verify the file still compiles (no use-before-declaration).

- [ ] **Step 2: Guard checkout acquisition against non-editable status** — the existing checkout heartbeat effect calls `acquireCheckout(versionId)` unconditionally; the backend now returns 409 for non-editable versions, which would surface as an error toast every heartbeat. Gate it: in the `tryAcquire` effect, skip when the current version isn't editable:

```tsx
// 편집 가능 상태에서만 체크아웃 시도 (백엔드가 그 외 409)
if (currentVersion && statusLocksEditing) {
  return;
}
```

Place this guard at the top of the effect body (after the `versionId === null` check). Add `currentVersion?.status` (or `statusLocksEditing`) to the effect's dependency array. Because effects can't read render-derived locals cleanly across renders, compute the editable check inside the effect from `versions`/`versionId` if needed — keep it correct and lint-clean.

- [ ] **Step 3: Show the rejected reason banner** — near the existing "editing by other" banner in the header, add:

```tsx
{currentVersion?.status === "rejected" && currentVersion.reject_reason && (
  <span className="text-caption text-error">
    {t("wf.rejectedBanner", { reason: currentVersion.reject_reason })}
  </span>
)}
```

- [ ] **Step 4: Verify**
- `npm run build` → green; `npm run lint` → clean.
- **Manual:** Open a version that is `pending` (submit one first). Confirm: the canvas is read-only (cannot add/move nodes, Save disabled), no repeating checkout error toast appears, and the badge reads Pending. Reject it (as approver) and confirm the red "Rejected: …" banner shows and the canvas becomes editable again (draft/rejected). Report observations.

- [ ] **Step 5: Commit**
```bash
git add src/app/maps/[mapId]/page.tsx
git commit -m "feat(frontend): read-only canvas for non-editable statuses + rejected banner — 비편집 상태 읽기전용·반려 배너"
```

---

### Task 7: Approver management dialog (map owner)

**Files:** Create `frontend/src/components/approver-manager.tsx`; wire into page.tsx; i18n keys.

- [ ] **Step 1: Add i18n keys** — `en`/`ko`:

en:
```typescript
  "approvers.manage": "Manage approvers",
  "approvers.title": "Approvers",
  "approvers.hint": "One username per line. All must approve.",
  "approvers.save": "Save",
  "approvers.cancel": "Cancel",
  "err.approvers": "Failed to update approvers",
```
ko:
```typescript
  "approvers.manage": "승인자 관리",
  "approvers.title": "승인자",
  "approvers.hint": "한 줄에 한 명. 전원 승인해야 통과.",
  "approvers.save": "저장",
  "approvers.cancel": "취소",
  "err.approvers": "승인자 변경 실패",
```

- [ ] **Step 2: Create `frontend/src/components/approver-manager.tsx`**:

```tsx
"use client";

// 맵 소유자가 승인자 목록을 편집 (design 2026-06-14)
import { useEffect, useState } from "react";

import { listApprovers, setApprovers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ApproverManagerProps {
  mapId: number;
  onClose: () => void;
  onSaved: (approvers: string[]) => void;
}

export function ApproverManager({ mapId, onClose, onSaved }: ApproverManagerProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listApprovers(mapId)
      .then((ids) => {
        if (alive) setText(ids.join("\n"));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mapId]);

  const handleSave = async () => {
    const ids = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    try {
      const saved = await setApprovers(mapId, ids);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.approvers"));
    }
  };

  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="w-80 rounded-md bg-surface p-4 shadow-lg">
        <p className="text-body-strong text-ink">{t("approvers.title")}</p>
        <p className="mt-1 text-fine text-ink-tertiary">{t("approvers.hint")}</p>
        <textarea
          className="mt-2 w-full rounded-sm border border-hairline p-2 text-caption"
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {error && <p className="mt-1 text-fine text-error">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {t("approvers.cancel")}
          </button>
          <button type="button" className={btn} onClick={() => void handleSave()}>
            {t("approvers.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into page.tsx** — add state `const [managingApprovers, setManagingApprovers] = useState(false);`. Render a "Manage approvers" button only for the map owner, next to the version controls:

```tsx
{isMapOwner && (
  <button
    type="button"
    className="rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt"
    onClick={() => setManagingApprovers(true)}
  >
    {t("approvers.manage")}
  </button>
)}
{managingApprovers && versionId !== null && (
  <ApproverManager
    mapId={mapId}
    onClose={() => setManagingApprovers(false)}
    onSaved={() => void refreshWorkflow()}
  />
)}
```

Import: `import { ApproverManager } from "@/components/approver-manager";`

- [ ] **Step 4: Verify**
- `npm run build` → green; `npm run lint` → clean.
- **Manual:** As the map owner (local-dev), click "Manage approvers", enter `local-dev` (so you can self-approve in local testing) plus another name, Save. Reopen to confirm persistence. Then verify the full submit→approve flow from Task 5 now works end-to-end. Report observations.

- [ ] **Step 5: Commit**
```bash
git add src/components/approver-manager.tsx src/lib/i18n-messages.ts src/app/maps/[mapId]/page.tsx
git commit -m "feat(frontend): approver management dialog for map owner — 맵 소유자 승인자 관리"
```

---

### Task 8: Notification bell (polling) in top nav

**Files:** Create `frontend/src/components/notification-bell.tsx`; wire into `frontend/src/components/top-nav.tsx`; i18n keys.

- [ ] **Step 1: Add i18n keys** — `en`/`ko`:

en:
```typescript
  "notif.title": "Notifications",
  "notif.empty": "No notifications",
  "notif.markRead": "Mark read",
```
ko:
```typescript
  "notif.title": "알림",
  "notif.empty": "알림 없음",
  "notif.markRead": "읽음",
```

- [ ] **Step 2: Create `frontend/src/components/notification-bell.tsx`** (mirrors the comment-polling pattern: immediate fetch + 5s interval + `alive` cleanup):

```tsx
"use client";

// 인앱 알림 벨 — 5초 폴링, 미읽음 점 + 드롭다운 (design 2026-06-14)
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

import { listNotifications, markNotificationRead, type NotificationItem } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const POLL_MS = 5000;

export function NotificationBell() {
  const { t } = useI18n();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const fetchItems = async () => {
      try {
        const data = await listNotifications();
        if (alive) setItems(data);
      } catch {
        // 폴링 지속 — 일시 실패 무시
      }
    };
    void fetchItems();
    const id = setInterval(() => void fetchItems(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const unread = items.filter((item) => !item.read).length;

  const handleRead = async (id: number) => {
    try {
      await markNotificationRead(id);
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
    } catch {
      // 무시 — 다음 폴링에서 정합
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="relative flex items-center"
        aria-label={t("notif.title")}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} strokeWidth={1.5} className="text-ink-secondary" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-50 w-72 rounded-md bg-surface p-2 shadow-lg">
          <p className="px-1 pb-1 text-caption-strong text-ink">{t("notif.title")}</p>
          {items.length === 0 ? (
            <p className="px-1 py-2 text-fine text-ink-tertiary">{t("notif.empty")}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-start gap-2 rounded-sm px-1 py-1.5 text-caption ${
                    item.read ? "text-ink-tertiary" : "text-ink"
                  }`}
                >
                  <span className="flex-1">{item.message}</span>
                  {!item.read && (
                    <button
                      type="button"
                      className="text-fine text-accent"
                      onClick={() => void handleRead(item.id)}
                    >
                      {t("notif.markRead")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

> Navigation-on-click (jump to the relevant map/version) is intentionally omitted to keep scope tight — `message` already identifies the version by label. If desired later, add a `router.push(\`/maps/${item.map_id}\`)` on row click. Note this omission to the user.

- [ ] **Step 3: Mount in top-nav** — in `frontend/src/components/top-nav.tsx`, inside the right-side `<div className="flex items-center gap-3">`, before the language-toggle button, add `<NotificationBell />`. Import: `import { NotificationBell } from "@/components/notification-bell";`.

> Guard for unauthenticated/guest: the bell polls `/api/notifications` which requires auth. In local auth-disabled mode this returns the dev_user's notifications (fine). On the server, `TopNav` only renders for authenticated users (confirm by reading how TopNav/AuthGate gate rendering). If TopNav can render pre-login, wrap `<NotificationBell />` so it only mounts when `user` is non-null (the `user` from `useSyncExternalStore` already in top-nav.tsx). Implement that guard.

- [ ] **Step 4: Verify**
- `npm run build` → green; `npm run lint` → clean.
- **Manual:** With an approver assigned, submit a version (as submitter) to generate a `review_requested` notification for the approver. Confirm the bell shows an accent dot and the dropdown lists the message; click "Mark read" and confirm the dot clears (and stays cleared across the 5s poll). Report observations.

- [ ] **Step 5: Commit**
```bash
git add src/components/notification-bell.tsx src/lib/i18n-messages.ts src/components/top-nav.tsx
git commit -m "feat(frontend): in-app notification bell with polling — 인앱 알림 벨"
```

---

### Task 9: Full verification + PROGRESS

**Files:** none (verification) + `PROGRESS.md`

- [ ] **Step 1: Backend suite** (from `backend/`) — `.venv/bin/python -m pytest tests/ -q` green; `.venv/bin/ruff check app/ tests/` clean.
- [ ] **Step 2: Frontend** (from `frontend/`) — `npm run lint` clean; `npm run build` green.
- [ ] **Step 3: End-to-end manual smoke** — with seeded data and local dev_user: owner assigns approvers (incl. self) → hold checkout on a draft → Submit → (as approver) see notification, Approve to unanimous → Approved → (as submitter) Publish → prior published demoted, badge Published; verify a pending version's canvas is read-only and a rejected version shows its reason banner. Report exactly what worked and anything that didn't.
- [ ] **Step 4: Update PROGRESS.md** — add a dated entry summarizing the frontend workflow UI (what + why).
- [ ] **Step 5: Commit**
```bash
git add PROGRESS.md
git commit -m "chore: record version approval workflow frontend in PROGRESS — 진행 기록"
```

---

## Self-Review (completed during authoring)

**Spec coverage (design §7 frontend):**
- Status badges → Task 3. Action buttons (submit/approve/reject/publish/withdraw, role+status gated, n/m progress) → Task 5. Approver management (owner) → Task 7. Notification bell (polling, unread dot, dropdown, mark-read) → Task 8. Rejected banner + read-only canvas for pending/approved/published → Task 6. UI English w/ tokens + Lucide 16/1.5 → enforced in component code.
- Identity gap (auth-disabled local mode → `getCurrentUser()` null) resolved via `GET /api/me` (Task 1). Map owner exposure via `MapOut.created_by` (Task 1).

**Contract alignment:** all API functions in Task 2 match the backend exactly — `status` enum values (draft/pending/approved/published/rejected), `reject` body `{reason}`, `?unread_only=true`, `POST /notifications/{id}/read`, approvers `{user_ids}`. No speculative fields.

**Known scope trims (surfaced to user):** notification click-through navigation omitted (Task 8 note); no JS test harness so frontend verification is build/lint + manual (stated up front).

**Type consistency:** `VersionStatus` used across api.ts, status-badge, workflow-actions, page.tsx; `WorkflowState`/`NotificationItem` shapes match backend `WorkflowStateOut`/`NotificationOut`. `runTransition` returns `VersionSummary` and merges into `versions` state.

**Risk note:** Task 6 Step 2 (effect-level editable gate) is the trickiest edit — effects can't read render-derived locals across renders cleanly; the implementer must compute the editable check inside the effect from `versions`+`versionId` and keep the dependency array correct. Flagged in-step.
