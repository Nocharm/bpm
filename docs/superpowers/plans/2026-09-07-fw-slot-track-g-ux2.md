# Framework Slot Governance — Track G (UX round 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the user's 2026-09-07 UX round: accordion motion + single-child auto-drill in every framework tree, placeholder creation from the L5 library, and persistent filter pills in the normal-map subprocess library.

**Architecture:** Frontend-first with one small backend addition (`my_role` on library rows). Reuse the home tree's accordion pattern (`lib/use-closing-keys.ts` + `.accordion-open/.accordion-close/.accordion-static` in `globals.css`) and the tree picker's existing `autoDrillIn`. Placeholder creation goes through a new `FrameworkTreePicker` footer → page.tsx node factory (same shape as `addLinkNodeFromMap`, but `linkedMapId: null`). Library filters are pills over the existing `filterByQuery` list, persisted in `localStorage`.

**Tech Stack:** Next.js/React (React Compiler), Tailwind v4 tokens, Lucide, vitest; FastAPI for the one row field.

**Spec:** user instruction 2026-09-07 (verbatim below) on top of `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md` §7/§8.

## Global Constraints

- Tokens only (no raw hex); Lucide 16px/1.5 (12–14 inside pills); motion only via the existing accordion classes or `ease-smooth/spring` + `duration-150/350/450`, all `prefers-reduced-motion`-guarded; hyphens not em dashes in UI strings; i18n en + ko for every key.
- React Compiler rules (no manual-memo mismatch, no setState-in-effect); `genId()` for ids; `data-id` on new interactive elements.
- Shared components: `FrameworkTreePicker` has three consumers (L5 canvas library mount in `page.tsx` ~9348, `framework-connect-dialog.tsx`, and none else — verify in `frontend/COMPONENTS.md`); `SubprocessPreviewPeek` unchanged; keep every existing `data-id` (`framework-picker-node-<id>`, `framework-picker-map-<id>`, `framework-pick-<id>`, `library-unregistered-toggle`, `library-new-map`, `framework-tree-picker`, `framework-connect-dialog`).
- Gates: `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npx vitest run`, catalog regen when component usage/headers change; backend `pytest` + `ruff` when touched; Python 3.11 syntax.
- Smokes that must stay green: `pw-smoke-framework-slot.mjs` (20), `pw-smoke-framework-canvas.mjs` seed step, `pw-smoke-framework-delegation.mjs`.

## User request (2026-09-07, verbatim)

> ui 개선 조금만 하고 마무리 하자 LV5기준 서브프로세스라이브러리처럼 아래쪽에 플레이스 홀더를 만들 수 있게해줘(워크플로우는 기존 서브프로세스 플레이스홀더 참고하여 확인 후 구현 진행)
> 1. 슬롯이양 모달 드릴인 선택지가 1개이면 끝까지 펼쳐지게하고 아코디언 펼쳐지거나 닫힐땐 애니메이션 넣어서 시각적으로 따라가도록 유도할것
> 2. 1번효과를 플레이스홀더 연결의 드릴인에도 적용하고, 업무체계 L6목록에도 적용할것
> 3. 일반맵 기준 서브프로세스 라이브러리 목록에 필터 만들어줘 (부서/ 권한/ 미등록 맵 표시도 필터 필 형식으로/ 필터일괄삭제& 각각 필터 삭제) - 영속성 가지게 할것

Controller interpretation: "업무체계 L6 목록" = the `FrameworkTreePicker` ("Framework L6" list on the L5 canvas; the connect dialog embeds the same component). "권한" filter = the caller's effective role on each library map (owner / editor / viewer). "플레이스홀더" on the L5 canvas = an unlinked subprocess node (title only, `placeholder_category_id` null) that the confirm gate flags until connected via the existing connect dialog.

---

### Task 1: Accordion motion + single-child auto-drill in both trees

**Files:**
- Modify: `frontend/src/components/maps/framework-assign-modal.tsx` (`handleNodeClick`, `renderNode`, `openIds`/`childrenByParent`), `frontend/src/components/framework-tree-picker.tsx` (`renderNode`, `handleToggle`, existing `autoDrillIn`)
- Reuse: `frontend/src/lib/use-closing-keys.ts`, `.accordion-open/.accordion-close/.accordion-static` in `frontend/src/app/globals.css` (read `frontend/src/components/maps/framework-tree.tsx` ~140-260 for the reference wiring: state commits immediately, a ghost render plays `accordion-close`, `getSectionClass` picks open/static/close)
- Test: `frontend/src/lib/framework-tree-state.test.ts` if a pure helper is added (e.g. `shouldAutoDrill(children, maps)`); otherwise none.

**Interfaces:**
- Produces: no new public props. Optional pure helper `shouldAutoDrill(kids: CategoryNode[], mapCount: number): boolean` in `lib/framework-tree-state.ts` shared by both trees.

- [ ] **Step 1 — assign modal auto-drill**: after loading a node's children (`listCategoryNodes`), if exactly one child and it is not a leaf, open it too and keep drilling (cap 6 hops, like the picker's `AUTO_DRILL_MAX`); stop at an L5 (selectable) or a fork. Cached path applies the same rule. Auto-opened nodes get the static class (no "pop"), the user-clicked node animates open.
- [ ] **Step 2 — assign modal motion**: wrap each node's children `<ul>`/loading row in a grid container with `getSectionClass(node.id, open)` (`accordion-open` on user open, `accordion-static` for auto/initial, `accordion-close` ghost while closing); chevron gets `transition-transform duration-150 ease-smooth` and rotates instead of swapping icons if that reads better (keep `aria-expanded`).
- [ ] **Step 3 — tree picker motion**: same wrapper around the picker's children + map rows block (`framework-tree-picker.tsx` ~351-363); `autoDrillIn` hops use the static class; `handleToggle` close uses the ghost close. Keep `data-id`s and the peek/drag handlers intact. The connect dialog inherits this automatically.
- [ ] **Step 4 — gates + commit**: tsc/lint/vitest; commit `feat(framework): accordion motion and single-child auto-drill in the slot trees — 체계 트리 아코디언 모션·단일 후보 자동 펼침`.

### Task 2: Placeholder creation from the L5 library footer

**Files:**
- Modify: `frontend/src/components/framework-tree-picker.tsx` (footer under the tree, standalone mount only), `frontend/src/app/maps/[mapId]/page.tsx` (new `addPlaceholderNode(title)` next to `addLinkNodeFromMap` ~4987; pass `onCreatePlaceholder` at the picker mount ~9348 only — NOT in the connect dialog), `frontend/src/lib/i18n-messages.ts`, `frontend/COMPONENTS.md` (regen)
- Reference: `frontend/src/components/process-library-panel.tsx` footer (~356-377, `library-new-map`) for the visual pattern; placeholder rendering in `frontend/src/components/process-node.tsx` (`data.undesignated`/`spLinkDeleted` CTA, `sp-banner-undesignated`) and the `placeholder` gate in `backend/app/subprocess.py`.

**Interfaces:**
- Produces: `FrameworkTreePickerProps.onCreatePlaceholder?: (title: string) => void` (footer rendered only when provided and `!readOnly`); page.tsx `addPlaceholderNode(title)` creates a subprocess node with `linkedMapId: null`, `linkedVersionId: null`, `followLatest: true`, `placeholderCategoryId: null`, `subEnds: []`, label = title, at the viewport centre free spot, then `scheduleAutoSave()` + flash + toast (`editor.placeholderAdded` "Placeholder added" / "플레이스홀더 추가됨").

- [ ] **Step 1**: footer UI — a `border-t` strip with a text input (`data-id="framework-placeholder-name"`, placeholder "Placeholder name") and a `Plus` button (`data-id="framework-placeholder-create"`, label `framework.createPlaceholder` "Create placeholder" / "플레이스홀더 만들기"); Enter submits; empty/whitespace disabled; clear after create. Hidden when `readOnly` or when `onCreatePlaceholder` is absent (connect dialog).
- [ ] **Step 2**: page.tsx factory + wiring; confirm the saved graph carries `linked_map_id: null` + `placeholder_category_id: null` for the new node (see graph save ~897) and the node renders the placeholder look with the "Connect a map" CTA; the confirm checklist shows the `placeholder` violation until connected.
- [ ] **Step 3**: gates + catalog + commit `feat(canvas): create placeholders from the L5 library footer — L5 라이브러리 하단에서 플레이스홀더 생성`.

### Task 3: Library filter pills (department / role / unregistered) with persistence

**Files:**
- Modify (backend): `backend/app/routers/library.py` (`list_processes` — add `my_role` per row reusing the batch role resolution already in `_filter_visible_map_ids`; refactor that helper into a `_resolve_roles(session, user, candidates) -> dict[int, str | None]` so both paths share it), `backend/tests/test_library.py` or the existing library test file (measure with `git grep -l "library/processes" backend/tests`)
- Modify (frontend): `frontend/src/lib/api.ts` (`LibraryProcess.my_role: "owner" | "editor" | "viewer" | null`), `frontend/src/components/process-library-panel.tsx` (filter bar + pills), new `frontend/src/lib/library-filters.ts` (+ `library-filters.test.ts`): `LibraryFilters { departments: string[]; roles: Role[]; showUnregistered: boolean }`, `applyLibraryFilters(rows, filters)`, `readLibraryFilters()/writeLibraryFilters()` (key `bpm.library.filters`, try/catch, defaults), `frontend/src/lib/i18n-messages.ts`, `frontend/COMPONENTS.md`

**Interfaces:**
- Produces: `my_role` on `/api/library/processes` rows; `lib/library-filters.ts` pure helpers; the existing `library-unregistered-toggle` becomes the "Unregistered maps" filter pill (keep the `data-id` on the pill so the smoke/QA selectors still work).

- [ ] **Step 1 (backend)**: `my_role` per row (sysadmin → "owner"); test asserts owner/editor/viewer/null shapes.
- [ ] **Step 2 (lib)**: filters helpers + tests (department match on leaf or full path, roles any-of, unregistered pass-through, persistence roundtrip with corrupted storage tolerated).
- [ ] **Step 3 (UI)**: under the search box a filter row: a `Filter` button (`data-id="library-filter-open"`) opening a small popover with a department picker (distinct departments from rows; leaf names via `formatDeptName`), role checkboxes (Owner/Editor/Viewer), and the unregistered toggle; active filters render as removable pills (`data-id="library-filter-pill-<kind>-<value>"`, × removes one) plus a "Clear filters" pill (`data-id="library-filter-clear"`). Filters persist across panel opens; `showUnregistered` still drives the `include_undesignated` refetch. Result count line "N of M".
- [ ] **Step 4**: gates (backend + frontend), catalog, commit `feat(library): persistent department/role/unregistered filter pills — 라이브러리 필터 필(부서·권한·미등록) 영속`.
