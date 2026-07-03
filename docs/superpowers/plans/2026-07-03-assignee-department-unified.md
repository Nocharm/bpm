# Unified Assignee/Department Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify assignee/department editing across the inspector properties tab, node edit modal, and group bulk edit — department single, assignees multiple within one department, coupled, with a drift warning.

**Architecture:** A pure-logic module `src/lib/assignee.ts` is the single source of truth (parse/format/dept-lookup/add/drift). The three UI points consume it. Assignees are stored comma-separated in the existing `assignee` string; department stays a single string — no backend change. Drift warnings are computed page-level from `eligible` and injected into node data (same pattern as `unresolvedCounts`).

**Tech Stack:** Next.js/React (TypeScript), @xyflow/react, Vitest (`npm test` → `vitest run`), Tailwind v4 tokens, Lucide 16px/1.5.

## Global Constraints
- Branch `feat/editor-redesign-r6`. No backend/DB change (reuse `assignee`/`department` string fields).
- `assignee` = comma+space separated names (`"홍길동, 김철수"`); all belong to `department`.
- Design tokens only (no raw hex except node color data); Lucide 16px strokeWidth 1.5; UI English, data/comments Korean; LF line endings.
- React Compiler: trivial handlers as plain functions; no synchronous setState in effects (use render-time state adjustment); align manual-memo deps.
- Verify each task: `npm run lint` (0 errors) + `npm run build` + `npm test` (for lib). Run from `frontend/`.
- Eligible source: `getEligibleAssignees(versionId)` → `{ users: {id,name,department}[]; departments: string[] }`.

---

### Task 1: `lib/assignee.ts` pure logic + tests

**Files:**
- Create: `frontend/src/lib/assignee.ts`
- Test: `frontend/src/lib/assignee.test.ts`

**Interfaces:**
- Consumes: `EligibleAssignees["users"]` shape `{ id: string; name: string; department: string }[]` (structurally; do not import to keep the module dependency-free — accept `users: { name: string; department: string }[]`).
- Produces:
  - `parseAssignees(s: string): string[]`
  - `formatAssignees(names: string[]): string`
  - `deptOf(name: string, users: { name: string; department: string }[]): string | null`
  - `addAssignee(department: string, assignees: string[], name: string, users: {name:string;department:string}[]): { department: string; assignees: string[] }`
  - `driftedAssignees(department: string, assignees: string[], users: {name:string;department:string}[]): string[]`

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/lib/assignee.test.ts
import { describe, expect, it } from "vitest";

import {
  addAssignee,
  deptOf,
  driftedAssignees,
  formatAssignees,
  parseAssignees,
} from "./assignee";

const USERS = [
  { name: "홍길동", department: "구매팀" },
  { name: "김철수", department: "구매팀" },
  { name: "이영희", department: "품질팀" },
];

describe("parse/format", () => {
  it("parses comma list, trims, drops blanks", () => {
    expect(parseAssignees("홍길동, 김철수 ,")).toEqual(["홍길동", "김철수"]);
    expect(parseAssignees("")).toEqual([]);
  });
  it("formats with comma-space", () => {
    expect(formatAssignees(["홍길동", "김철수"])).toBe("홍길동, 김철수");
  });
});

describe("deptOf", () => {
  it("returns current dept or null", () => {
    expect(deptOf("홍길동", USERS)).toBe("구매팀");
    expect(deptOf("없음", USERS)).toBeNull();
  });
});

describe("addAssignee", () => {
  it("sets department from the first assignee when empty", () => {
    expect(addAssignee("", [], "홍길동", USERS)).toEqual({
      department: "구매팀",
      assignees: ["홍길동"],
    });
  });
  it("adds a same-department assignee", () => {
    expect(addAssignee("구매팀", ["홍길동"], "김철수", USERS)).toEqual({
      department: "구매팀",
      assignees: ["홍길동", "김철수"],
    });
  });
  it("rejects a different-department assignee (unchanged)", () => {
    expect(addAssignee("구매팀", ["홍길동"], "이영희", USERS)).toEqual({
      department: "구매팀",
      assignees: ["홍길동"],
    });
  });
  it("de-dupes", () => {
    expect(addAssignee("구매팀", ["홍길동"], "홍길동", USERS).assignees).toEqual(["홍길동"]);
  });
});

describe("driftedAssignees", () => {
  it("flags assignees whose current dept differs or is missing", () => {
    // 이영희 was assigned but is now 품질팀 while node is 구매팀 → drift
    expect(driftedAssignees("구매팀", ["홍길동", "이영희", "없음"], USERS)).toEqual([
      "이영희",
      "없음",
    ]);
    expect(driftedAssignees("구매팀", ["홍길동", "김철수"], USERS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/lib/assignee.test.ts`
Expected: FAIL (module `./assignee` not found).

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/src/lib/assignee.ts
// 담당자/부서 통일 로직 — 순수 함수(부작용 없음). 인스펙터·노드모달·그룹벌크 3곳 공용.
// 담당자는 콤마+공백 구분 복수 이름, 모두 같은 부서. 부서는 단일.

type Person = { name: string; department: string };

export function parseAssignees(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatAssignees(names: string[]): string {
  return names.join(", ");
}

export function deptOf(name: string, users: Person[]): string | null {
  return users.find((u) => u.name === name)?.department ?? null;
}

// 부서 비면 그 인원 부서로 설정; 부서 있으면 같은 부서 인원만 추가(다르면 무시). 중복 제거.
export function addAssignee(
  department: string,
  assignees: string[],
  name: string,
  users: Person[],
): { department: string; assignees: string[] } {
  const personDept = deptOf(name, users);
  if (assignees.includes(name)) {
    return { department, assignees };
  }
  if (department === "") {
    return { department: personDept ?? "", assignees: [name] };
  }
  if (personDept !== null && personDept !== department) {
    return { department, assignees }; // 교차부서 — 무시(입력에서 차단하지만 안전망)
  }
  return { department, assignees: [...assignees, name] };
}

// 현재 부서가 노드 부서와 다르거나 디렉터리에서 사라진 담당자 = 경고 대상(드리프트).
export function driftedAssignees(
  department: string,
  assignees: string[],
  users: Person[],
): string[] {
  return assignees.filter((name) => {
    const d = deptOf(name, users);
    return d === null || d !== department;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/lib/assignee.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Lint + commit**

```bash
cd frontend && npm run lint 2>&1 | tail -3
cd /Users/hyeonjin/Documents/bpm
git add frontend/src/lib/assignee.ts frontend/src/lib/assignee.test.ts
git commit -m "feat(assignee): unified assignee/department pure logic + tests — 담당자/부서 공용 로직"
```

---

### Task 2: Node edit modal — assignee chips + department coupling + confirm

**Files:**
- Modify: `frontend/src/components/node-summary-modal.tsx`

**Interfaces:**
- Consumes: Task 1 (`parseAssignees`, `formatAssignees`, `deptOf`, `addAssignee`, `driftedAssignees`); existing `eligible` state (`EligibleAssignees`), `form` buffer, `SearchSelect`.
- Produces: buffered `form.assignee` (comma string) / `form.department` following the coupling rules; a reusable inline confirm overlay for department change.

- [ ] **Step 1: Import Task-1 helpers**

At the top imports add: `import { addAssignee, deptOf, driftedAssignees, formatAssignees, parseAssignees } from "@/lib/assignee";`

- [ ] **Step 2: Replace the department field with a coupled single picker + confirm**

Find the BPM `ATTR_FIELDS.map(...)` block. Remove `assignee`/`department` from that generic map (keep `system`/`duration` there) and render dedicated controls above it:

Department (single `SearchSelect`), on change: if `parseAssignees(form.assignee).length > 0` and the new dept differs → set `pendingDept` state (show confirm); else apply directly (`setForm(f => ({ ...f, department: value, assignee: "" }))` when clearing assignees is needed, or just set department when no assignees).

```tsx
// 상태
const [pendingDept, setPendingDept] = useState<string | null>(null);
const users = eligible?.users ?? [];
const assignees = parseAssignees(form.assignee);
const drifted = driftedAssignees(form.department, assignees, users);

const changeDept = (dept: string) => {
  if (assignees.length > 0 && dept !== form.department) {
    setPendingDept(dept); // 확인 모달
  } else {
    setForm((f) => ({ ...f, department: dept, assignee: "" }));
  }
};
```

Department control:
```tsx
<SearchSelect
  value={form.department}
  options={(eligible?.departments ?? []).map((d) => ({ value: d, label: d }))}
  emptyLabel={t("summary.none")}
  placeholder={t("field.searchPlaceholder")}
  onChange={changeDept}
/>
```

- [ ] **Step 3: Render assignee chips + a department-filtered add picker**

```tsx
<div className="flex flex-wrap items-center gap-1">
  {assignees.map((name) => {
    const isDrift = drifted.includes(name);
    return (
      <span
        key={name}
        className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
          isDrift ? "border-error/40 bg-error/10 text-error" : "border-hairline bg-surface-alt text-ink"
        }`}
      >
        {name}
        <button
          type="button"
          aria-label={t("summary.close")}
          onClick={() =>
            setForm((f) => ({ ...f, assignee: formatAssignees(parseAssignees(f.assignee).filter((n) => n !== name)) }))
          }
        >
          <X size={11} strokeWidth={1.5} />
        </button>
      </span>
    );
  })}
</div>
<SearchSelect
  value=""
  options={users
    .filter((u) => form.department === "" || u.department === form.department)
    .filter((u) => !assignees.includes(u.name))
    .map((u) => ({ value: u.name, label: u.name, sub: [u.id, u.department].filter(Boolean).join(" · ") || undefined, keywords: u.id }))}
  emptyLabel={t("field.assignee")}
  placeholder={t("field.searchPlaceholder")}
  onChange={(name) => {
    if (!name) return;
    const next = addAssignee(form.department, parseAssignees(form.assignee), name, users);
    setForm((f) => ({ ...f, department: next.department, assignee: formatAssignees(next.assignees) }));
  }}
/>
```

- [ ] **Step 4: Add the department-change confirm overlay**

Inside the modal card (like the existing `pendingNav` overlay), when `pendingDept !== null`:
```tsx
{pendingDept !== null && (
  <div className="absolute inset-0 z-10 flex items-center justify-center p-4" style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }} onClick={() => setPendingDept(null)}>
    <div className="w-full max-w-[300px] rounded-sm border border-hairline bg-surface p-4" style={{ boxShadow: "var(--shadow-lg)" }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 text-body-strong text-ink"><AlertTriangle size={18} strokeWidth={1.5} className="shrink-0 text-error" />{t("assignee.deptChangeTitle")}</div>
      <p className="mt-1.5 text-caption text-ink-secondary">{t("assignee.deptChangeBody")}</p>
      <div className="mt-3 flex justify-end gap-1.5">
        <button type="button" className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt" onClick={() => setPendingDept(null)}>{t("summary.cancel")}</button>
        <button type="button" className="rounded-sm bg-accent px-2.5 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus" onClick={() => { setForm((f) => ({ ...f, department: pendingDept, assignee: "" })); setPendingDept(null); }}>{t("editor.save")}</button>
      </div>
    </div>
  </div>
)}
```
Add i18n keys `assignee.deptChangeTitle` = "Change department" / "부서 변경", `assignee.deptChangeBody` = "Changing the department clears the current assignees." / "부서를 바꾸면 담당자가 초기화됩니다." to both `en` and `ko` blocks in `src/lib/i18n-messages.ts`.

- [ ] **Step 5: Verify + commit**

```bash
cd frontend && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3
cd /Users/hyeonjin/Documents/bpm
git add frontend/src/components/node-summary-modal.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(editor): node modal assignee chips + department coupling + confirm — 노드모달 담당자 칩·부서 연동"
```

---

### Task 3: Inspector properties tab — same coupling

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (the InspectorPanel `propertiesSlot` node form — locate the assignee/department `SearchSelect`s / BPM fields for the selected node).

**Interfaces:**
- Consumes: Task 1 helpers; `selectedNode.data.assignee/department`; existing `patchNode` / `handleSearchSelect`; `eligible` (add an eligible load here if the inspector does not already have one — load once via `getEligibleAssignees(versionId)` in a `useEffect` keyed on `versionId`).
- Produces: inspector edits the selected node via `patchNode(selectedId, { department, assignee })` following the same rules.

- [ ] **Step 1:** Read the inspector node form in `propertiesSlot` and identify how assignee/department are currently edited (they were wired in R5a). Add the Task-1 import and (if missing) a page-level `eligible` state + `useEffect` load.

- [ ] **Step 2:** Replace the department control with a single `SearchSelect` + confirm (reuse a small confirm; can be a `ConfirmDialog` — check `src/components/confirm-dialog.tsx`); on change with existing assignees, confirm then `patchNode(id, { department, assignee: "" })`.

- [ ] **Step 3:** Replace the assignee control with chips (removable) + a department-filtered add `SearchSelect`, mirroring Task 2 but writing through `patchNode(id, { assignee: formatAssignees(...) , department: next.department })`. Drift chips use `border-error/40 bg-error/10 text-error`.

- [ ] **Step 4: Verify + commit**

```bash
cd frontend && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3
cd /Users/hyeonjin/Documents/bpm
git add "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(editor): inspector properties assignee chips + department coupling — 인스펙터 담당자 칩·부서 연동"
```

---

### Task 4: Group bulk — combined assignee+department set + conflict rules

**Files:**
- Modify: `frontend/src/components/group-bulk-modal.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (the `onApplyAttribute` handler must support a combined update).

**Interfaces:**
- Consumes: Task 1 helpers; existing bulk `field`/`action`/`value`/`policy`/wizard; `eligible`.
- Produces: when the target is people, applies `{ department, assignee }` together per the rules; `system`/`duration` unchanged.

- [ ] **Step 1:** Replace the single `field` selector's `assignee`/`department` options with a combined "부서 + 담당자" mode (keep `system`/`duration`). Add a mode toggle or a dedicated section: department `SearchSelect` + assignee `SearchSelect` (dept-filtered).

- [ ] **Step 2:** Compute available conflict options from state:
  - assignee empty (department only) → `["replace", "individual", "skip"]` (no `append` — department is single).
  - assignee set → `["replace", "append", "skip", "individual"]`.
  Render only the available `POLICY_META` entries.

- [ ] **Step 3:** Update `apply`/`finish` and `onApplyAttribute` to write a combined update per member:
  - **replace**: member `department` = new dept (assignee's dept if set, else chosen dept), `assignee` = new value (or cleared if department-only).
  - **append** (assignee set): if the new assignee's dept === member's current dept → append to member's assignees; **if different → the append forces a department change + clearing existing assignees, so route that member into the individual wizard** (per-member confirm), effectively individual.
  - **skip**: leave conflicting members.
  - **individual**: wizard as today, but each step applies the combined `{department, assignee}`.
  Extend the `Update`/apply types so `onApplyAttribute` can set both fields (e.g. `onApplyPeople(updates: { id: string; department: string; assignee: string }[])`).

- [ ] **Step 4: Verify + commit**

```bash
cd frontend && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3
cd /Users/hyeonjin/Documents/bpm
git add frontend/src/components/group-bulk-modal.tsx "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(editor): group bulk combined assignee+department set + conflict rules — 그룹벌크 담당자+부서 결합"
```

---

### Task 5: Drift warning — page-level compute + node injection + UI

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (load `eligible` page-level; compute per-node drift; inject into node data at render like `unresolvedCounts`).
- Modify: `frontend/src/components/process-node.tsx` (render a warning icon when the injected flag is set).

**Interfaces:**
- Consumes: Task 1 `driftedAssignees`; page `eligible`; `NodeData`.
- Produces: `node.data.assigneeWarning: boolean` (or a count) injected at render; `ProcessNode` shows an `AlertTriangle` badge when true.

- [ ] **Step 1:** Ensure a page-level `eligible` state + `useEffect(getEligibleAssignees(versionId))` exists (shared with Task 3).

- [ ] **Step 2:** Where nodes are prepared for `<ReactFlow nodes={...}>` (the same place `unresolvedCounts`/measured data is injected), compute `assigneeWarning = driftedAssignees(n.data.department, parseAssignees(n.data.assignee), eligible?.users ?? []).length > 0` and add it to each node's `data`. Do NOT setState in an effect — derive during the render/`useMemo` that builds the rendered nodes.

- [ ] **Step 3:** In `process-node.tsx`, read `data.assigneeWarning` and render a small `AlertTriangle size={12} strokeWidth={1.5} className="text-error"` badge (e.g., top-right of the node) with a `title` (i18n `assignee.driftWarn` = "Assignee department mismatch" / "담당자 부서 불일치"). Add the i18n keys.

- [ ] **Step 4: Verify + commit**

```bash
cd frontend && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3
cd /Users/hyeonjin/Documents/bpm
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/components/process-node.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(editor): assignee department drift warning on nodes — 담당자 부서 드리프트 경고"
```

---

## Self-Review

- **Spec coverage:** §3 data (Task 1 storage) · §4 lib (Task 1) · §5 rules (Tasks 2/3) · §6.1 UI 1·2 (Tasks 3/2) · §6.2 bulk (Task 4) · §7 warning (Task 5). All covered.
- **Placeholders:** Task 1 fully coded/tested. Tasks 2–5 reference exact files + give the key JSX/logic; the executing subagent reads current component state (buffered `form`, inspector node form, bulk apply) which is stateful and must be read live — instructions are specific enough to implement without ambiguity.
- **Type consistency:** `parseAssignees`/`formatAssignees`/`deptOf`/`addAssignee`/`driftedAssignees` signatures identical across tasks; `assignee` always comma string, `department` single.
- **Note:** Tasks 2 and 3 duplicate chip/confirm UI — acceptable (two different host files); if a shared `<AssigneePicker>` component emerges naturally, extract it, but do not over-abstract before the second use is in place.
