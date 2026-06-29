# Editor + Comparison Redesign — Implementation Plan (In-Place Restyle)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, per-unit user review) to implement this plan unit-by-unit. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reskin the existing map editor and comparison screens to the hifi mockups, preserving ALL existing behavior, by extracting each region into a clean component and restyling it in place.

**Architecture:** Edit the existing editor `frontend/src/app/maps/[mapId]/page.tsx` (~6724 lines) region-by-region. Extract inline regions (top bar, right inspector, bottom tabs) into new components under `frontend/src/components/editor/`; restyle already-extracted components in place. Never touch the ReactFlow props/children wiring (`5653–5927`) except to ADD a MiniMap. No new route, no cutover — the app stays working at every step.

**Tech Stack:** Next.js 16 App Router (TS/React, React Compiler), `@xyflow/react`, dagre, vitest, ESLint/tsc. Backend unchanged.

## Global Constraints

From the spec (`docs/superpowers/specs/2026-06-28-editor-compare-redesign-design.md` §5). Every task implicitly includes these:

- LF endings · `genId()` from `@/lib/id` (no `crypto.randomUUID`) · design tokens only (no raw hex; node `color`/`COLOR_PRESETS`/PNG bg exempt) · UI English / data+comments Korean · Lucide 16px/1.5 · button cursor+press is global base (components add hover bg only) · KST via `formatKst` · don't lose hover hints/tooltips when moving UI · backend/DB schema change needs user confirmation.
- **React Compiler:** a `useCallback`/`useMemo` whose inferred deps differ from the declared array fails `npm run lint`/`build`. Make trivial setState-only handlers plain functions, or align deps. No synchronous setState in effects (`react-hooks/set-state-in-effect`) — use inline async + active guard, or a reloadKey bump.
- **ugrep skips bracket dirs** (`[mapId]`): use Read / Python / `find`+per-file, NOT recursive grep, for `app/maps/[mapId]/`.
- **Preservation invariants** (page.tsx): keyboard `1425–1460`, outline nav `4924–5301`, undo/redo `1180–1232`, autosave `1036–1079`, focus-camera `5675–5683`, expand anim `.bpm-expand-anim`, context menu `openMenu`, ReactFlow `5653–5927`. Verify each still works vs :3100 after every unit.

## Per-Unit Workflow (inline, user reviews each)

For every R/C unit: implement → `npx tsc --noEmit` 0 → `npx eslint .` 0 (+`vitest` if logic) → user reviews at `http://localhost:3000/maps/{id}` vs `:3100` OLD → on OK, update tracker row + PROGRESS.md → commit → next unit.

## New component locations

```
frontend/src/components/editor/
  editor-topbar.tsx          # R3  (extracted from page.tsx 5341–5559)
  map-name-dropdown.tsx      # R3
  version-pill.tsx           # R3
  add-node-menu.tsx          # R4
  inspector-panel.tsx        # R5a (extracted from 6195–6450 + 6463–6603)
  inspector/tab-properties.tsx  # R5a
  inspector/tab-map.tsx         # R5b
  inspector/tab-approval.tsx    # R5c  (wraps WorkflowDashboard)
  inspector/tab-activity.tsx    # R5d  (wraps CommentSection + version timeline)
```
Restyled in place (already components): `canvas-zoom-scale`, `editor-left-sidebar`, `context-menu`, `group-box`, `group-title-bar`, `group-bulk-modal`, `ai-chat-panel`, edge modals, `process-node`, `maps/map-detail-card`, `compare/page.tsx`.

---

## Roadmap (drive from `SCREEN-REDESIGN-EDITOR.md`)

| Unit | Region | Detail |
|------|--------|--------|
| **R1** | Canvas chrome | **detailed below** |
| R2 | Node visuals | `process-node.tsx` border/ring/shape; JIT |
| R3 | Top bar | extract `EditorTopbar`+dropdowns; JIT |
| R4 | Left sidebar | `editor-left-sidebar` + add-node menu; JIT |
| R5a–d | Right inspector 4-tab | extract `InspectorPanel`; biggest; JIT |
| R6 | Context menus | `context-menu.tsx`; JIT |
| R7 | Node edit modal | resolve double-click conflict first; JIT |
| R8 | Groups | group-box/title/bulk; JIT |
| R9 | Other modals | edge modals etc.; JIT |
| R10 | AI panel | `ai-chat-panel.tsx`; JIT |
| R11 | Drop-zone | radial ring; JIT |
| C1–C3 | Comparison | `compare/page.tsx`; JIT |

Each unit's detailed steps are authored just-in-time at its start, against the then-current code (exact JSX/line ranges shift as earlier units extract components). Unit acceptance criteria live in the tracker.

---

## R1 — Canvas chrome: MiniMap + zoom pill (detailed)

**Goal:** Add a MiniMap (bottom-left) and restyle the zoom control to the mockup pill (`- 100% +` + fullscreen, bottom-center), without changing any ReactFlow behavior.

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (ReactFlow children — ADD `<MiniMap>` near `5913–5926`)
- Modify: `frontend/src/components/canvas-zoom-scale.tsx` (restyle to pill + reposition)

**Reference:** `docs/superpowers/specs/assets/editor-compare-redesign/editor-overview.png` (minimap bottom-left, zoom pill bottom-center).

- [ ] **Step 1: Read the current zoom control + ReactFlow children**

Read `frontend/src/components/canvas-zoom-scale.tsx` in full, and `page.tsx` lines ~5905–5930 (Background/Controls/CanvasZoomScale block). Note: existing `<Controls>` has `showFitView={false}`; `CanvasZoomScale` lives in a `ViewportPortal`. Confirm whether to keep `<Controls>` (the mockup shows only the pill — likely hide default Controls and rely on the restyled pill).

- [ ] **Step 2: Add MiniMap to ReactFlow children**

Import `MiniMap` from `@xyflow/react` (add to existing xyflow import in page.tsx). Add as a ReactFlow child near Background:

```tsx
<MiniMap
  position="bottom-left"
  pannable
  zoomable
  className="!bg-surface !border !border-hairline rounded-sm shadow-md"
  maskColor="color-mix(in srgb, var(--color-ink) 6%, transparent)"
/>
```

(Tune class/tokens to match `editor-overview.png`; no raw hex — use `var(--color-*)`.)

- [ ] **Step 3: Restyle the zoom control to the mockup pill**

In `canvas-zoom-scale.tsx`: render a centered pill `[ − ] 100% [ + ] | [ ⛶ ]` using tokens (`bg-surface`, `border-hairline`, `shadow-md`, `rounded-full`, `text-caption`), Lucide `Minus`/`Plus`/`Maximize2` 16px/1.5. Reposition the container to bottom-center (`absolute bottom-3 left-1/2 -translate-x-1/2`). Keep the existing zoom/fitView handlers (zoom in/out, percent, fit) — only presentation changes. If the default `<Controls>` is now redundant, hide it (`<Controls>` removed or kept off-screen) so only the pill shows.

- [ ] **Step 4: Typecheck + lint**

Run (in `frontend/`): `npx tsc --noEmit && npx eslint . && echo OK` → `OK`.
Watch for React Compiler memo errors on any handler edits — make trivial handlers plain functions.

- [ ] **Step 5: Browser review (user) vs :3100**

At `http://localhost:3000/maps/{id}`: MiniMap renders bottom-left and tracks the canvas; zoom pill is bottom-center (`- 100% +` + fullscreen) and zoom in/out/fit still work; panning/zoom behavior unchanged vs `:3100`. Console 0 errors.

- [ ] **Step 6: Update tracker + PROGRESS, commit**

Set R1 row in `SCREEN-REDESIGN-EDITOR.md` to ✅, add a PROGRESS line, then:

```bash
git add frontend/src/app/maps/\[mapId\]/page.tsx frontend/src/components/canvas-zoom-scale.tsx \
        SCREEN-REDESIGN-EDITOR.md PROGRESS.md
git commit -m "feat(editor): canvas minimap + zoom pill restyle (R1) — 미니맵·줌 pill"
```

---

## Self-Review (plan vs spec)

- **Coverage:** R1–R11 + C1–C3 map 1:1 to spec §6 / tracker rows. R1 detailed; rest JIT (intentional — line ranges shift as extraction proceeds).
- **Placeholders:** R1 has concrete steps; R2+ are roadmap entries with files + JIT note, not silent TODOs.
- **Constraints:** preservation invariants + React Compiler + ugrep + tokens restated in Global Constraints, applied per unit.
