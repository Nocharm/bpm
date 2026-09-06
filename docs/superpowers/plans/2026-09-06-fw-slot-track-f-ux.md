# Framework Slot Governance — Track F (UX polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the user's 2026-09-06 UX round to the surfaces created by tracks A–D: clearer, more legible slot modals; a hover info panel that only appears when it has slot history and sits at the top-right L5 tag position; a tree-based placeholder connect flow with a preview flyout.

**Architecture:** Frontend only. Restyle the three slot dialogs/banners with the design tokens (icons, pills, entrance motion). Move `L5NodeInfoPanel` to the `framework-l5-tag` anchor and gate it on slot-history rows. Rebuild `FrameworkConnectDialog`'s body around the existing `FrameworkTreePicker` + `SubprocessPreviewPeek` (the subprocess picker), relabelled for "connect".

**Tech Stack:** Next.js/React (React Compiler), Tailwind v4 tokens (`rules/frontend/design.md`), Lucide, vitest, Playwright smoke.

**Spec:** user instruction 2026-09-06 (verbatim in §User request) on top of `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md` §7.

## Global Constraints

- Tokens only (no raw hex); Lucide 16px / strokeWidth 1.5 (12–14px inside pills); type scale `text-body-strong/caption/fine`; motion only `ease-spring|overshoot|smooth` with `duration-150/350/450`; buttons get hover background only (global base handles cursor/press).
- Short hyphen "-" in user-facing strings, never an em dash "—" (project rule since b786f282). UI English + `ko` parity for every new key (`ko: Record<MessageKey, string>`).
- `data-id`s already asserted by tests/smokes must survive: `slot-change-dialog`, `slot-change-note`, `slot-change-submit`, `slot-change-cancel`, `slot-change-close`, `slot-pending-banner`, `slot-withdraw-btn`, `slot-delete-dialog`, `slot-delete-next`, `copy-retire-mode-unassign|replace`, `copy-retire-checkbox`, `l5-node-info-panel`, `framework-l5-tag`, `framework-connect-dialog`, `framework-connect-close`, `framework-connect-successor`, `sp-banner-slot-missing`, `sp-banner-undesignated`.
- React Compiler: no manual memo mismatches; no setState-in-effect; shared `ModalBackdrop`; `genId()` not `crypto.randomUUID`.
- Gates: `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npx vitest run`; catalog regenerated when a component's role/usage changes (`node scripts/build-component-catalog.mjs`); smokes `pw-smoke-framework-slot.mjs` (20 checks) and the controller's verify scripts must still pass — keep data-ids.

## User request (2026-09-06, verbatim)

> 이번세션에서 생성한 모달 들 가시성, 시인성 개선 작업 진행, 아이콘, 필과 필요시 애니메이션적용, 긴 대시대신 짧은 대시 사용
> 왼쪽아래 호버패드는 정보가있을때만 뜨는걸로하고 위치는 오른쪽 위 레벨5맵을 대체하는걸로 해줘(호버시에만 대체), 투명도는 조금 늘릴것
> 플레이스홀더 연결은 선택을 트리식으로 할 수 있게하고 선택하면 해당 맵의 정보를 우측에(서브프로세스 피커모달 참고해서 디자인) 플라이아웃 나타낸뒤 선택 하게할것

Controller interpretation (documented assumptions): "정보가 있을 때" = at least one slot-history timestamp (`succeededAt` or `changedAt`); "Map updated" alone does not count. "투명도를 조금 늘릴 것" = slightly more transparent background (`bg-surface/95` → `bg-surface/80` + `backdrop-blur-sm`). "서브프로세스 피커 모달" = `FrameworkTreePicker` + `SubprocessPreviewPeek` (the library/framework picker with its preview peek).

---

### Task 1: Slot dialogs and banners — legibility pass

**Files:**
- Modify: `frontend/src/components/maps/slot-change-dialog.tsx`, `frontend/src/components/maps/slot-delete-dialog.tsx`, `frontend/src/components/maps/framework-assign-modal.tsx` (pending banner block only), `frontend/src/components/permissions/create-map-dialog.tsx` (retire radio block only), `frontend/src/lib/i18n-messages.ts`, `frontend/COMPONENTS.md` (regen)
- Test: `frontend/src/lib/framework-slot-state.test.ts` (extend if a pure helper is added)

**Interfaces:**
- Consumes: `SlotChangeOut` (`sides[].approvers`, `impact`), `SLOT_ACTION_KEY`, `UserPill`, `PendingSlotChange`.
- Produces: no new public props; optional pure helper `getSlotActionTone(action) -> "danger" | "accent"` in `lib/framework-slot-state.ts` if it removes duplication.

- [ ] **Step 1: `SlotChangeDialog`** — header: 40px icon disc tinted by tone (danger actions `bg-error/10 text-error`, else `bg-accent-tint text-accent`), action title + a mode pill under it (`ShieldCheck` "Applies now" / `Clock` "Needs approval", tokens `bg-changed/10 text-changed` for approval, `bg-added/10 text-added` for immediate); impact as three inline stat chips with icons (`Workflow` home canvas nodes, `Network` other canvases, `Link2` referencing maps) using `text-fine`; sides as one card per side: `FolderTree` icon + category path (truncate, title attr) + approver `UserPill`s or "No approvers" pill; note textarea gets a `text-fine` label ("Note to approvers"); submit button keeps tone; add entrance motion on the dialog card (`animate-[modal-pop_...]` — reuse the existing modal pop-in class if `globals.css` defines one; otherwise `transition` with `ease-spring duration-350` on mount via a `data-[state]` class, no new keyframes unless needed). Keep every existing `data-id` and the busy/close logic untouched.
- [ ] **Step 2: `SlotDeleteDialog`** — same header pattern (`Trash2` in `bg-error/10 text-error`), one-line explanation under the title, successor picker labelled "Successor (optional)" with a helper line, "Next" button keeps `slot-delete-next`.
- [ ] **Step 3: assign modal pending banner** — `Clock` icon disc, action pill + progress pill `n/m` (`bg-changed/10 text-changed`), "requested by" with `UserPill` (name-first) instead of the raw login (closes deferred item 8; split the i18n string into parts: `slot.pendingBannerLead` "{action} is waiting for approval" + `slot.pendingBannerProgress` "{done}/{total} sides" + `slot.pendingBannerBy` "requested by"), withdraw as a secondary text button with `Undo2` icon. Keep `slot-pending-banner`, `slot-withdraw-btn`.
- [ ] **Step 4: copy-retire radios** — each option as a selectable card row: icon (`ArrowRightLeft` inherit slot / `Unlink` free slot), title, one-line description (`text-fine text-ink-secondary`), selected state `border-accent bg-accent-tint`; keep the `<input type="radio">` and data-ids.
- [ ] **Step 5: strings** — grep the new keys (`slot.*`, `framework.slotState.*`, `framework.nodeInfo.*`, `framework.canvasChangedReload`, `perm.createDialog.copyRetireSlotNameHint`) in both languages for "—" and replace with "-"; any new copy uses "-".
- [ ] **Step 6: gates + screenshots** — tsc/lint/vitest; run `node scripts/build-component-catalog.mjs`; commit `style(slot): legibility pass on slot dialogs and banners - icons, pills, motion — 슬롯 모달·배너 시인성 개선`.

### Task 2: Hover info panel — show only with slot history, at the top-right L5 tag

**Files:**
- Modify: `frontend/src/components/l5-node-info-panel.tsx`, `frontend/src/app/maps/[mapId]/page.tsx` (~9472 `framework-l5-tag` block, ~10056 panel mount, ~9612 hover handler)
- Test: none (visual) — smoke `pw-smoke-framework-slot.mjs` check "panel shows a real handed-over KST timestamp" must still pass.

**Interfaces:**
- Consumes: `L5NodeInfo`.
- Produces: `hasSlotHistory(info: L5NodeInfo | null): boolean` exported from `l5-node-info-panel.tsx` (true when `succeededAt` or `changedAt` is set).

- [ ] **Step 1** — `L5NodeInfoPanel`: return `null` unless `hasSlotHistory(info)`; drop the empty-state branch; position `absolute right-5 top-5 z-20` (same anchor as `framework-l5-tag`), `w-72`, `bg-surface/80 backdrop-blur-sm border-hairline shadow-md`, entrance `animate` fade+slide from the tag (`ease-smooth duration-150`); header shows the node name with `Info`; rows keep the `dl` (Handed over / Map updated / Unassigned·Deleted·…).
- [ ] **Step 2** — page.tsx: render `framework-l5-tag` only when `!hasSlotHistory(hoverNodeInfo)` (the panel replaces it while hovering a node with history; when the hover ends the tag returns). Keep the panel mount guard `index === 0 && isFrameworkMap`. Hover handler unchanged (it already sets `null` on leave).
- [ ] **Step 3** — gates; `node scripts/pw-smoke-framework-slot.mjs` still 20/20 (controller runs it); commit `feat(canvas): hover info replaces the L5 tag only when the node has slot history — 호버 패널 우상단 대체·이력 있을 때만`.

### Task 3: Placeholder connect — tree selection + preview flyout

**Files:**
- Modify: `frontend/src/components/framework-connect-dialog.tsx`, `frontend/src/components/framework-tree-picker.tsx` (+ `subprocess-preview-peek.tsx` only for the CTA label prop), `frontend/src/app/maps/[mapId]/page.tsx` (~9369 `<FrameworkConnectDialog>` call site), `frontend/src/lib/i18n-messages.ts`, `frontend/COMPONENTS.md`
- Test: `frontend/src/lib/framework-connect.test.ts` (keep `rankConnectCandidates` tests green)

**Interfaces:**
- Consumes: `FrameworkTreePicker` props (`currentMapId, linkedMapIds, readOnly, nodeDisplayFields, linkageCategoryId, onClose, onPeekAdd(payload: PeekAddPayload), onPeekOpenMap, onFocusLinkedNode`), `SubprocessPreviewPeek` (`onAdd`, `addDisabledReason`).
- Produces: `FrameworkTreePicker` + `SubprocessPreviewPeek` new optional prop `ctaLabelKey?: MessageKey` (default the existing "Add to map" key) so the peek's primary button reads "Connect" (`framework.connectCta`); `FrameworkConnectDialog` new props `nodeDisplayFields: NodeDisplayToggle[]`, `linkageCategoryId: number | null`.

- [ ] **Step 1** — Dialog body: keep the header (node title, guided-origin hint, close), keep the successor recommendation row (`framework-connect-successor`) at the top when present; replace the list/search/drill body with `<FrameworkTreePicker>` embedded (not a second modal) with `linkedMapIds` = maps already on the canvas (rows disabled with the existing "already placed" state), `linkageCategoryId` = current canvas L5, `readOnly=false`, `ctaLabelKey="framework.connectCta"`, `onPeekAdd={(p) => pick({ id: p.linkedMapId, name: p.name }, origin from p.categoryId/categoryPath)}` — `pick` keeps the existing out-of-origin `ConfirmDialog` gate (path comparison) before calling `onConnect`; `onPeekOpenMap` → no-op or the existing open-map prompt; `onFocusLinkedNode` → close + focus as the library panel does (reuse the callback the page already passes to the library panel). The peek (flyout on the right of the tree, as in the library panel) is where the user reviews the map before pressing Connect.
- [ ] **Step 2** — Layout: dialog widens to `max-w-3xl`, tree on the left (`min-w-[20rem]`), the peek is the existing portal flyout anchored to the hovered/clicked row; initial tree state expands to the guided origin L5 when `originCategoryId` is set (use `framework-tree-state` helpers; `fetchCategoryChildren` for the chain from `/categories/{id}/chain`).
- [ ] **Step 3** — page.tsx call site passes `nodeDisplayFields` and `linkageCategoryId` (same values as the library panel receives). i18n: `framework.connectCta` "Connect" / "연결", `framework.connectTreeHint` "Browse the framework and pick the map for this placeholder" / "업무체계에서 이 플레이스홀더에 연결할 맵을 고르세요".
- [ ] **Step 4** — gates; catalog regen; controller re-runs `verify-s8.mjs`-style check (placeholder → connect via tree → node linked); commit `feat(canvas): tree + preview flyout for placeholder connect — 플레이스홀더 연결을 트리 선택·미리보기 플라이아웃으로`.
