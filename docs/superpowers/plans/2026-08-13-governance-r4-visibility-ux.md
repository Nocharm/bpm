# Governance R4: 가시성 UX 4건 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 사용자 피드백 4건 — 승인자 모달 가시성 배지 · 동봉 UI 드롭다운화("공개 범위"+Current 필) · 인스펙터 가시성 3:1+워크플로 시작 모달 · 협업자 제거 X를 권한 필 hover 스왑으로.

**Architecture:** 전부 프론트엔드(+i18n). 백엔드 무변경 — 기존 `requestVisibilityChange`/`getPendingVisibilityRequest`/`listApprovers` API 재사용.

**Tech Stack:** Next.js/TS/React(React Compiler), vitest.

## Global Constraints

- 브랜치 `feat/governance-r4`(기점 dev 0b38371), 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/governance-r4`.
- FE 게이트 4종(각 태스크): `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`. BE는 U5에서만(무변경 확인).
- i18n 신설/변경 키는 EN/KO 양쪽. raw hex 금지(토큰만). data-id `surface-role`. React Compiler — 수동 memo 금지. Lucide 아이콘 strokeWidth 1.5.
- 커밋: `type(scope): English — 한국어` + PROGRESS.md `## 2026-08-13 — 거버넌스 R4` 섹션 한 줄 APPEND(U1이 섹션 신설) 동일 커밋.
- 모달 디자인은 기존 컨벤션(압축형: 아이콘+요약 박스+필, 산문 최소 — ConfirmDialog `badge`/`sections`/`highlight` props 참조).

---

### Task U1: 승인자 관리 모달 — 현재 가시성 배지 (우측 위)

**Files:** Modify `frontend/src/components/approver-manager.tsx` · `frontend/src/app/maps/[mapId]/page.tsx`(마운트 :7388 부근)

1. `ApproverManagerProps`에 `visibility: "public" | "private"` 추가. page.tsx 마운트에서 `visibility={mapVisibility}` 전달(라이브 state — `setMapVisibility`로 검색해 실제 state명 확인).
2. 모달 헤더(:88-91 `<div><p>{t("approvers.title")}</p><p>hint</p></div>`)를 `flex items-start justify-between`으로 — 좌측 기존 타이틀+힌트, **우측 위에 가시성 배지**: `<span data-id="approver-manager-visibility" className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">` + Globe/Lock `size={12}` + `t("perm.visibilityPublic"|"perm.visibilityPrivate")`.
3. 게이트 4종 → 커밋 `feat(approvers): show current map visibility in manager modal — 승인자 모달에 현재 가시성 배지`

### Task U2: 동봉 UI — "공개 범위" 라벨 + 우측 드롭다운 + Current 하이라이트 필

**Files:** Modify `frontend/src/components/visibility-bundle-picker.tsx` · `frontend/src/lib/i18n-messages.ts`

1. **라벨 문구**: `approval.bundleVisibilityTitle`(:619 EN "Also change visibility" / :2223 KO "공개 범위도 함께 변경") → EN `"Visibility"` / KO `"공개 범위"`.
2. **레이아웃**: 세로(라벨 위·pill 아래) → **한 행**: 좌측 라벨(`text-caption text-ink`), 우측 드롭다운 트리거. props `{current, value, onChange}` 및 의미(선택=동봉, current 선택/재선택=해제 null)는 불변 — 3 사용처(에디터 모달·패널·셀프 게시 팝오버) 배선 무변경.
3. **드롭다운**(같은 파일 내부 구현, 라이브러리 금지):
   - 트리거 버튼(`data-id="bundle-visibility-trigger"`): 유효 대상 `value ?? current`의 아이콘(Globe=public/Lock=private, size 14)+라벨, 우측 ChevronDown(size 14). `rounded-sm border border-hairline px-2 py-1 text-caption` + value 선택 중이면 `border-accent bg-accent-tint text-accent`(동봉 선택됨 시각화).
   - 메뉴: 트리거 아래 `absolute` 패널(`relative` 래퍼 기준, `z-[1320] rounded-md border border-hairline bg-surface p-1 shadow-lg`, 최소폭 트리거 이상). 옵션 2개(private/public — 각 `data-id="bundle-opt-private"|"bundle-opt-public"`): 아이콘+라벨 행(`flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-caption hover:bg-surface-alt`), 선택 중(value===v)이면 `text-accent`.
   - **Current 필**: current에 해당하는 옵션 행 우측 끝에 하이라이트 필 — **한/영 무관 리터럴 `Current`**: `<span className="ml-auto rounded-full bg-accent-tint px-1.5 py-px text-fine font-medium text-accent">Current</span>`. 기존 `· current` 텍스트 표기는 폐기. (`perm.visibilityCurrent` 키는 다른 사용처를 `grep`으로 확인 — 이 컴포넌트가 마지막 사용처였으면 EN/KO 제거, 아니면 유지하고 report에 기록.)
   - 동작: 옵션 클릭 → `onChange(v === current ? null : v)` + 메뉴 닫힘. 바깥 mousedown(capture)·Esc로 닫힘. 트리거 재클릭 토글. 다이얼로그/팝오버 내부라 포털 불요(absolute로 충분 — 잘림 발생 시에만 createPortal 전환하고 report에 기록).
4. 게이트 4종 → 커밋 `feat(version): bundle visibility as dropdown with Current pill — 동봉 UI 드롭다운화·Current 필 강조`

### Task U3: 인스펙터 맵 탭 가시성 — 3:1 + 워크플로 시작 모달

**Files:** Modify `frontend/src/components/map-inspector-tab.tsx` · `frontend/src/lib/i18n-messages.ts`(신설 키)

1. **3:1 비율**: 가시성 그리드(:46 `grid grid-cols-2`) → `grid-cols-4`: 현재(active) 버튼 `col-span-3`, 비현재 `col-span-1`(비현재는 좁아지므로 아이콘만 표시, `title`로 라벨 제공 — 텍스트는 현재 쪽만).
2. **인터랙션 게이트**: `getMap` detail에서 `my_role`도 저장. **오너(my_role==="owner")만** 비현재 버튼 클릭 가능(`<button>`화) — 비오너는 현행 정적 `<div>` 유지. 마운트 시 `getPendingVisibilityRequest(mapId)`(api.ts :978)로 pending 조회(state) — pending이면 비현재 버튼 disabled + 우측에 `border-changed text-changed text-fine` 필 `t("perm.pending.tag")` 표시.
3. **워크플로 시작 모달**(비현재 클릭 시): `ConfirmDialog`(`@/components/confirm-dialog` — `badge`/`sections` props 활용, 모달 컨벤션 준수) 재사용:
   - 타이틀: `t("inspector.visibilityChangeTitle")` 신설 — EN "Change visibility"/KO "공개 범위 변경".
   - 요약 박스(sections): ① 전환 라인 — 현재 아이콘+라벨 → 대상 아이콘+라벨(대상은 accent 강조) ② **승인 정보** — `listApprovers(mapId)`(api.ts :857)로 승인자 id 목록 조회 후 `getDirectory()`로 이름 해석: 라벨 `t("inspector.visibilityApprovers")`(EN "Approvers who can decide"/KO "결정 권한이 있는 승인자") + 이름 필 목록(각 `rounded-full bg-surface-alt px-2 py-0.5 text-fine`). 안내 한 줄 `t("inspector.visibilityApprovalNote")`(EN "One of the approvers must approve this change before it applies."/KO "지정 승인자 중 1명이 승인하면 적용됩니다.").
   - **승인자 0명**: confirm 비활성 + 경고 라인 `t("inspector.visibilityNoApprovers")`(EN "This map has no approvers — assign approvers first."/KO "지정된 승인자가 없습니다 — 먼저 승인자를 지정하세요.") `text-error`.
   - 확인 → `requestVisibilityChange(mapIdNum, target)`(api.ts :967) → 성공 시 pending state 갱신+모달 닫힘. 409 등 에러는 `humanizeApiError(err, t)`를 모달 내 에러 라인으로 표시하고 pending 재조회(막다른 상태 금지 — R2 계약).
   - data-id: 모달 `inspector-visibility-dialog`, 확인 버튼은 ConfirmDialog 기본.
4. 주의: 설정 화면 visibility-control(스테이징+Apply)과 같은 kind의 standalone 요청 — 중복 pending은 백엔드 409가 처리(humanize 문구 존재). 게이트 4종 → 커밋 `feat(inspector): visibility 3:1 with workflow start modal — 인스펙터 가시성 3:1·변경 요청 모달`

### Task U4: 협업자 제거 — hover 스왑 Remove 필(카드) + 패널 X 정렬 교정

**Files:** Modify `frontend/src/components/maps/map-detail-card.tsx`(renderMemberRow :541-586) · `frontend/src/components/permissions/collaborators-panel.tsx`(:199-208) · `frontend/src/lib/i18n-messages.ts`(1키)

1. **카드(renderMemberRow) — hover 스왑**: 별도 X 버튼(:573-585 `map-detail-remove-member-*`) 제거. RoleBadge를 래퍼로 감싸고 제거 가능 조건(`canManageMembers && perm.role !== "owner" && !stagedRemove`)일 때 **행 hover(`group-hover`)·focus 시 같은 자리에 같은 크기의 빨간 Remove 필 버튼**이 RoleBadge를 대체:
   ```tsx
   <span className="relative inline-flex">
     <span className={removable ? "group-hover:invisible group-focus-within:invisible" : ""}>
       <RoleBadge role={perm.role as MapRole} pending={perm.pending_change != null} />
     </span>
     {removable && (
       <button
         type="button"
         data-id={`map-detail-remove-member-${perm.id}`}
         aria-label="Remove member"
         className="absolute inset-0 hidden items-center justify-center gap-0.5 rounded-full border border-error bg-surface text-fine text-error hover:bg-error/10 group-hover:inline-flex group-focus-within:inline-flex"
         onClick={(e) => { e.stopPropagation(); handleRemoveMember(perm); }}
       >
         {t("perm.removePill")} <X size={10} strokeWidth={1.5} />
       </button>
     )}
   </span>
   ```
   - RoleBadge의 실제 모양(rounded-full 여부·패딩)을 열어 확인해 Remove 필 클래스를 **동일 기하**로 맞춘다(`inset-0` 오버레이라 크기는 자동 일치).
   - **폭 통일**: `Remove ×`가 badge보다 넓어 잘리면 래퍼에 `min-w-[…]`(실측값)를 줘 Viewer/Editor/Remove 세 상태의 필 폭을 통일 — 행 간 정렬이 흔들리지 않게. 값은 실측으로 정하고 report에 기록.
   - i18n `perm.removePill` 신설: EN "Remove"/KO "제거" (필 안 텍스트 — X 아이콘 동반).
   - stagedRemove 행(스택 태그+개별취소 X)·pending 상세 태그는 현행 유지. 인스펙터 멤버는 MapDetailCard 재사용이라 자동 적용.
2. **패널(collaborators-panel) — 정렬만 교정**(사용자 확정): 제거 X 버튼(:199-208)은 유지하되 **공간을 차지하지 않게** — 행 컨테이너(renderRow 루트)에 `relative` + X를 `absolute right-0(적절 오프셋) opacity-0 group-hover:opacity-100`으로 전환(행에 `group` 클래스 확인/추가). 우측 끝 요소(select/badge)가 X와 겹치지 않게 행에 우측 패딩(`pr-6`류)을 **모든 행 공통**으로 부여 — 오너/본인 행과 편집 행의 select·badge 좌우 정렬이 일치해야 함.
3. 게이트 4종 → 커밋 `feat(permissions): hover-swap remove pill on member rows — 제거 X를 권한 필 hover 스왑으로(패널은 정렬 교정)`

### Task U5: 최종 게이트 + QA R4 소섹션 + PROGRESS 마감

**Files:** Modify `docs/qa/governance-ux-checklist.md` · `PROGRESS.md`

1. BE 전체(`AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + ruff — 무변경 확인) + FE 4종, 수치 실측.
2. QA 문서 `## R3 (후속 정비)` 뒤(`## 회귀 스팟` 앞)에 `## R4 (가시성 UX)` 추가 — 5항목: R4-1 승인자 모달 우측 위 가시성 배지 · R4-2 동봉 드롭다운(라벨 "공개 범위"·아이콘·Current 필, 3표면) · R4-3 인스펙터 가시성 3:1 + 오너 클릭 시 승인자 정보 모달 → 요청 생성·pending 필(비오너는 정적) · R4-4 멤버 행 hover 시 권한 필 자리에 빨간 Remove 필(오너/본인 행 정렬 불변, 클릭=제거/스택 적립) · R4-5 협업자 패널 X가 hover 표시로 바뀌어도 select/badge 정렬 일치. 헤더 게이트 수치 갱신.
3. PROGRESS R4 한 줄 마감 + 플랜 파일(`docs/superpowers/plans/2026-08-13-governance-r4-visibility-ux.md`) git add → 커밋 `docs(qa): R4 visibility UX verification checklist — R4 가시성 UX 검증 체크리스트`

실행 순서: U1→U2→U3→U4→U5.

## Self-Review 결과

- 피드백 매핑: ①승인자 모달 배지=U1 ②"공개 범위"+우측 드롭다운+아이콘+Current 필=U2 ③3:1+워크플로 모달=U3 ④X hover 스왑(카드)+패널 정렬(사용자 확정)=U4.
- U2는 공용 컴포넌트 1곳 수정으로 3표면 동시 반영(배선 무변경) — 사용자가 지목한 승인 요청 모달 외 표면도 일관 적용(문서화된 가정).
- U3 모달은 ConfirmDialog 재사용 — 신규 모달 컴포넌트 금지(YAGNI).
