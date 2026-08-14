# Governance R5: Remove 필 스왑 폴리시 (사용자 피드백 5건) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** R4 U4(멤버 행 hover 스왑)의 시각 결함 5건 정비 — 필 크기 불변 스왑·X 아이콘 제거·페이드 전환·인스펙터 전 행 동시 스왑 버그·제거 예정 태그 소속 행 재배치.

**Architecture:** `map-detail-card.tsx` `renderMemberRow` 단일 함수 + `role-badge.tsx` optional className prop. 인스펙터는 MapDetailCard 재사용이라 자동 반영. 백엔드 무변경.

## Global Constraints

- 브랜치 `feat/governance-r5`(기점 dev f0d6595), 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/governance-r5`.
- FE 게이트 4종: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`. BE 무변경(마감 시 확인만).
- 토큰만·Lucide strokeWidth 1.5·React Compiler(수동 memo 금지)·i18n EN/KO 양쪽.
- 커밋: `type(scope): English — 한국어` + PROGRESS.md `## 2026-08-13 — 거버넌스 R5` 섹션 신설 1줄 동일 커밋.

---

### Task V1: 멤버 행 Remove 스왑 재작업 (5건 일괄)

**Files:** Modify `frontend/src/components/maps/map-detail-card.tsx`(renderMemberRow :495-600) · `frontend/src/components/permissions/role-badge.tsx`(optional prop) · `frontend/src/lib/i18n-messages.ts`(필요 시) · `docs/qa/governance-ux-checklist.md` · `PROGRESS.md`

**진단(실측 완료 — 그대로 신뢰):**
- 크기 커짐+비호버 삐짐 진범 = removable 행에만 붙는 wrapper `min-w-[72px]`(:549) — 배지가 72px 박스 중앙에 떠서 owner 행과 어긋나고, hover 시 `inset-0` 오버레이가 72px 전폭으로 확장.
- 인스펙터 전 행 동시 스왑 진범 = 행 루트의 `group` 클래스(:521)가 인스펙터 `map-inspector-tab.tsx`의 `<details className="group ...">` 조상과 겹침 — Tailwind `group-hover:`는 조상 아무 `.group`이나 hover면 발화.
- 제거 예정 커짐 = staged 태그+취소 X(:583-599)가 1행 우측 클러스터에 인라인이라 랩.

**요구(사용자 지시 매핑):**

1. **필 크기 불변 스왑** — `RoleBadge`에 `className?: string` optional prop 추가(두 span 모두에 merge, 기본 "" — 타 호출처 무영향). renderMemberRow의 **모든** RoleBadge(제거 가능 여부·owner 무관)에 uniform 고정폭을 적용해 pill 자체가 같은 크기가 되게: wrapper `min-w` 방식 폐기 → RoleBadge에 `className="w-[N] inline-flex items-center justify-center text-center"` 전달. N은 Owner/Editor/Viewer/Remove 라벨(EN 기준이 최장) text-fine 실측 최대폭+px-1.5 여유로 산정(예상 w-14=56px — 실측해 기록). pending 배지(RoleBadge pending)는 문구가 길어 고정폭 예외(콘텐츠 폭 유지) — 그 행의 Remove 오버레이는 `inset-0`이라 자동으로 같은 박스.
2. **Remove 필 = X 아이콘 제거·색상만** — 오버레이 버튼(:556-570) 내용에서 `<X size={10}/>` 제거, `{t("perm.removePill")}` 텍스트만. 스타일은 RoleBadge와 동일 기하(`rounded-sm border px-1.5 py-0.5 text-fine` + 위 고정폭과 동일 박스 — `inset-0` 유지) + 빨간 토큰(`border-error text-error bg-surface hover:bg-error/10`). "Remove"/"제거"가 고정폭 N에 들어가는지 실측 — 안 맞으면 N을 키우지 말고 라벨을 조정(EN 후보 "Remove" 유지 우선, N 재산정 허용 시 기록).
3. **페이드 크로스전환** — 배지 layer `invisible` 토글 폐기 → 두 layer 모두 `transition-opacity duration-150`: 배지 `group-hover/member:opacity-0`(+focus-within variant), 오버레이 기존 opacity 패턴 유지. pointer-events 로직은 현행 유지(a11y 결정 보존 — Tab 도달·focus 시 표시).
4. **행 단위 hover 스코프(named group)** — 행 루트 `group` → `group/member`로 개명하고 renderMemberRow 안의 모든 `group-hover:`/`group-focus-within:` variant를 `group-hover/member:`/`group-focus-within/member:`로 이행. 대상: 오버레이·배지 페이드·부서 행 `hidden truncate group-hover:inline`(:491 — 같은 조상 누수 버그의 동류라 함께 이행). **함수 밖의 group 사용은 건드리지 않는다.**
5. **제거 예정 태그 재배치** — 우측 클러스터(:543 `flex items-center gap-1`)를 `flex flex-col items-end gap-0.5`로 재구성:
   - 1행: [RoleBadge(항상 유지 — staged여도) + pending 상세 태그].
   - 2행(stagedRemove일 때만): [staged 필 + 취소 X] — 좌측 이름 컬럼의 소속(부서) 줄과 같은 높이 대역에 오도록. staged 필은 role 필과 **같은 크기**(같은 고정폭 N·같은 기하, `border-error text-error`) — 현재 라벨 `perm.staged.remove` 문구가 N에 안 들어가면 EN/KO 라벨을 짧게 조정(예: EN "Removing"/KO "제거 예정" — 실측 후 결정·기록). 취소 X는 staged 필 **우측**에 항상 공간을 점유하되(`opacity-0` 기본) 행 hover/focus 시 페이드 인(`group-hover/member:opacity-100` + pointer-events 토글) — hover로 레이아웃이 안 밀리게 자리 예약 방식. 기존 취소 핸들러(`handleCancelStaged`)·stopPropagation 유지.
   - staged 행에서 removable=false(스왑 없음) 불변식 유지 — 권한 태그는 그대로 보임(사용자 지시).
6. **QA 갱신** — `docs/qa/governance-ux-checklist.md`: R4-4 항목을 새 동작으로 교정(X 아이콘 없음·색/문구만 페이드 전환·크기 불변) + `## R5 (Remove 필 폴리시)` 섹션 4항목 신설: R5-1 스왑 전후 필 크기·위치 완전 동일(좌우상하 무변화, 페이드) · R5-2 인스펙터에서 특정 행 hover 시 **그 행만** 스왑(전 행 동시 X) · R5-3 비호버 시 owner/editor/viewer 필 우측 정렬 일치(삐짐 없음) · R5-4 제거 예정 시 권한 필 유지+소속 줄 우측에 같은 크기 staged 필, 행 hover 시 그 우측 취소 X 페이드 인(레이아웃 안 밀림). 헤더 게이트 수치 갱신.
7. 게이트 4종 그린 후 커밋(플랜 파일 `docs/superpowers/plans/2026-08-13-governance-r5-remove-pill-polish.md` 포함):
   ```bash
   git add frontend/src/components/maps/map-detail-card.tsx frontend/src/components/permissions/role-badge.tsx frontend/src/lib/i18n-messages.ts docs/qa/governance-ux-checklist.md docs/superpowers/plans/2026-08-13-governance-r5-remove-pill-polish.md PROGRESS.md
   git commit -m "fix(permissions): size-stable fade remove swap + per-row hover scope — Remove 스왑 크기 불변·페이드·행 단위 hover·제거 예정 소속줄 재배치"
   ```
   (i18n 무변경이면 해당 파일 제외.)

## Self-Review 결과

- 피드백 매핑: 크기 동일=1·2, X 제외+색만+페이드=2·3, 인스펙터 동시 스왑+비호버 삐짐=4·1, 제거 예정 재배치(권한 태그 유지·소속 줄 우측·hover X)=5.
- RoleBadge className은 dialogId 선례와 같은 additive optional prop — 타 호출처 무영향을 리뷰 포인트로.
- collaborators-panel은 스코프 밖(사용자 확정 범위 — R4에서 정렬만).
