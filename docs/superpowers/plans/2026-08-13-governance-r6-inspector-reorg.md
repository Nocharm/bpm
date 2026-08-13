# Governance R6: 인스펙터 재정비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 사용자 피드백 6묶음 — 맵 탭 섹션 기본 접힘+아이콘 · 협업자 3.3행 클램프 · 승인 탭 재배치(pending 최상단·버전 선택 이동·드래프트 CTA·체크아웃 draft 전용·워크플로 접힘) · 전 접힘에 아코디언 효과 · SP 카드 버튼 재배치+아이콘.

**Architecture:** 에디터 `page.tsx`(mapTabSlot·approvalSlot) + `map-detail-card.tsx`(멤버 클램프) + `subprocess-inspector-card.tsx`(버튼 행). 접힘 애니는 기존 `accordion-open/close`(globals.css :226-278) + `useClosingKeys`(`@/lib/use-closing-keys`) + 고스트 렌더 패턴(`org-accordion.tsx` :71-117 참조) 재사용. 백엔드 무변경.

## Global Constraints

- 브랜치 `feat/governance-r6`(기점 dev 3653895), 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/governance-r6`.
- FE 게이트 4종(각 태스크): `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`. BE는 W5에서 무변경 확인만.
- **접힘/펼침 공통 계약**: 이 라운드에서 만들거나 바꾸는 모든 접힘 섹션은 `accordion-open`(펼침)·`accordion-close`(고스트 렌더 후 언마운트, `useClosingKeys`) 애니메이션을 적용한다. `<details>`는 close 애니가 불가하므로 **컨트롤드 헤더 버튼+조건부 콘텐츠 div** 구조로 구현(기존 org-accordion 패턴). 헤더는 ChevronRight 회전(`transition-transform`, open 시 rotate-90) 유지.
- 토큰만·Lucide strokeWidth 1.5·i18n EN/KO 양쪽·data-id `surface-role`·React Compiler(수동 memo 금지).
- 커밋: `type(scope): English — 한국어` + PROGRESS.md `## 2026-08-13 — 거버넌스 R6` 섹션(W1이 신설) 1줄 APPEND 동일 커밋.
- page.tsx 작업 전 `frontend/AGENTS.md` + `docs/lessons/react-ts-patterns.md` 필독.

---

### Task W1: 맵 탭 — 버전 선택 행 이동 + 노드 디스플레이/엣지 스타일 기본 접힘 + 항목 아이콘

**Files:** Modify `frontend/src/app/maps/[mapId]/page.tsx`(mapTabSlot :9047-9110대·approvalSlot :9197-9320대) · `frontend/src/lib/i18n-messages.ts`(필요 키만)

1. **버전 선택 행 이동**: approvalSlot 최상단의 버전 행(:9201-9315 — `VersionPill`+우측 아이콘 클러스터[새 버전·이전·이름변경·삭제·편집권한 요청·재게시] 전체)을 **mapTabSlot의 가장 위**(`<MapInspectorTab/>` 위)로 옮긴다. 로직·조건·핸들러 무변경(JSX 블록 이동) — approvalSlot에서는 제거(대체 UI는 W2).
2. **노드 디스플레이 접힘**: `inspector.nodeDisplay` 박스(:9051-9092)를 컨트롤드 접힘 섹션으로 — **기본 접힘**, 헤더(ChevronRight+타이틀+`· mapWide` 캡션) 클릭 토글, 콘텐츠는 accordion-open/close. 각 토글 행 라벨 왼쪽에 아이콘 추가(가시성): assignee=`UserRound`, department=`Building2`, system=`Server`, url=`Link`, params=`SlidersHorizontal` — `size={14}` `text-ink-muted`. data-id `inspector-node-display-section`.
3. **엣지 스타일 접힘**: `inspector.edgeStyle` 섹션(:9094-9110대)도 동일 패턴 — **기본 접힘**, accordion, data-id `inspector-edge-style-section`. (내부 3버튼 그리드는 이미 아이콘 있음 — 무변경.)
4. 접힘 상태는 세션 영속 불요(요구 없음) — 마운트마다 접힘. `useClosingKeys`는 페이지에 이미 import돼 있으면 재사용, 없으면 추가.
5. 게이트 4종 → 커밋 `feat(editor): move version row to map tab + collapse display/edge sections — 버전 행 맵탭 이동·표시/엣지 섹션 기본 접힘(아이콘)`

### Task W2: 승인 탭 재배치 — pending 최상단 · 드래프트 CTA · 워크플로 접힘 · 체크아웃 draft 전용

**Files:** Modify `frontend/src/app/maps/[mapId]/page.tsx`(approvalSlot) · `frontend/src/components/approval-panel.tsx`(:113 1줄) · `frontend/src/lib/i18n-messages.ts`

1. **순서 재배치**: approvalSlot을 위에서부터 ① `editor-approvals-section`(결재 대기 — 최상단으로 이동, 기본 접힘 유지+카운트 필, `<details>`→컨트롤드+accordion 전환) ② **드래프트 CTA 행**(신설, 옛 버전 행 자리) ③ ApprovalPanel(워크플로) ④ SubprocessInspectorCard ⑤ MapDetailCard only="versions" 순으로.
2. **드래프트 CTA**(오너/에디터용 직관 배선 — `isEditorRole`일 때만, 현재 버전이 draft가 아닐 때만 노출):
   - `hasDraft`(:1218)면: 버튼 `t("approval.goDraftCta")` EN "Switch to draft for approval"/KO "승인을 위해 드래프트로 전환" → `switchVersion(draftId)`(versions에서 status==="draft" find). 아이콘 `FileEdit`(또는 PencilLine) 14.
   - 드래프트 없으면: 버튼 `t("approval.createDraftCta")` EN "Create draft for approval"/KO "승인을 위해 드래프트 생성" → `handleCreateVersion`(:2889). 아이콘 `Plus` 14.
   - 스타일: 눈에 띄는 풀폭 보더 버튼(`flex w-full items-center justify-center gap-1.5 rounded-sm border border-accent bg-accent-tint/40 px-3 py-2 text-caption text-accent hover:bg-accent-tint`), data-id `approval-draft-cta`. 현재가 draft면 CTA 미노출(워크플로가 바로 보임).
3. **워크플로 접힘**: ApprovalPanel 전체를 접힘 섹션으로 감싼다 — 헤더 `t("approval.workflowSection")` EN "Approval workflow"/KO "승인 워크플로" + ChevronRight, **기본 펼침**(탭의 본론), accordion-open/close, data-id `approval-workflow-section`. ApprovalPanel 내부는 무변경(래핑만).
4. **체크아웃 draft 전용**: `approval-panel.tsx` :113 `showCheckout = status === "draft" || status === "rejected"` → `status === "draft"`(사용자 지시: 현재가 드래프트일 때만 체크아웃 표시). 주석도 갱신. rejected에서 체크아웃 UI가 사라지는 영향은 report에 기록(rejected는 재편집 가능 상태지만 사용자 지시가 draft 한정 — 문제 소지 있으면 report에 flag만, 구현은 지시대로).
5. 게이트 4종 → 커밋 `feat(editor): approval tab reorder + draft CTA + collapsible workflow — 승인 탭 재배치·드래프트 CTA·워크플로 접힘(체크아웃 draft 전용)`

### Task W3: 협업자 개인 목록 3.3행 클램프 + 전체 펼치기

**Files:** Modify `frontend/src/components/maps/map-detail-card.tsx`(members user 그룹 렌더) · `frontend/src/lib/i18n-messages.ts`(1키)

1. 멤버 목록의 **개인(user) 그룹**(오너 섹션 제외, MEMBER_GROUPS의 user 그룹 행 컨테이너)에 1차 높이 클램프: 행 높이 실측 기반 `max-h-[N]`(**3.3행** — 3행 온전+0.3행 살짝 잘려 "더 있음"을 암시, 홈 3.5클램프 선례) + `overflow-y-auto scroll-soft`(숨김 스크롤바 — 기존 유틸 확인, 없으면 홈 구현 참조). 행 수가 클램프 이하이면 클램프·버튼 미적용.
2. 클램프 상태일 때 그룹 하단에 **전체 펼치기** 버튼: `t("home.membersShowAll")` EN "Show all ({count})"/KO "전체 펼치기 ({count})" — 클릭 시 클램프 해제(컴포넌트 state, 세션 영속 불요), accordion-open으로 자연 확장, 해제 후 버튼은 "접기"(`home.membersCollapse` EN "Collapse"/KO "접기")로 토글. data-id `map-detail-members-expand`.
3. 부서/그룹 그룹·오너 섹션은 클램프 대상 아님. 인스펙터(only="members")도 동일 적용(같은 렌더 경로).
4. 게이트 4종 → 커밋 `feat(home): clamp member user list at 3.3 rows with show-all — 개인 목록 3.3행 클램프+전체 펼치기`

### Task W4: SP 카드 — 버튼 행 재배치 + 아이콘

**Files:** Modify `frontend/src/components/subprocess-inspector-card.tsx` · `frontend/src/lib/i18n-messages.ts`(변경 없을 수도)

1. **버튼 행 통합**: 카드 본문의 액션 영역을 한 행으로 — 좌측 `Designate as subprocess`(:280 부근, 지정/수정 버튼)에 아이콘 추가(`Workflow` 14 — SP 도상 기존 컨벤션 확인 후 동일 아이콘), 우측 정렬(`ml-auto`)로:
   - kind==="needPublished"면 **게시본 가기** 버튼(현재 reason 행 우측 :R10 배치에서 이동) + `ArrowRight`(또는 `ExternalLink`) 14 아이콘.
   - kind==="ownerOnly"&&!designated면 **등록 요청** 버튼(동일 이동) + `BadgeCheck`(승인 아이콘) 14. pending이면 기존 disabled+툴팁 로직 그대로.
   - canManage=false라 designate 버튼이 없던 상태에서도 이 행은 유지(좌측 자리는 비고 우측 버튼만) — 행 자체가 액션 앵커.
2. **그 아래엔 안내 노트만**: reason 텍스트(`sp-inspector-reason`)는 버튼 없는 순수 노트 행으로 남긴다(`text-fine text-ink-tertiary`) — R10의 justify-between 행에서 버튼 제거. `spRequestError` 인라인 에러 표시는 유지.
3. 기존 계약 보존: data-id(`sp-go-published`/`sp-request-registration`/`sp-inspector-designate`)·disabled 조건·툴팁·핸들러·`disabledReasonKind` 분기 전부 무변경(위치와 아이콘만).
4. 게이트 4종 → 커밋 `feat(inspector): SP action buttons on one row with icons — SP 버튼 행 통합(우측 정렬)·아이콘 추가`

### Task W5: 최종 게이트 + QA R6 섹션 + PROGRESS 마감

**Files:** Modify `docs/qa/governance-ux-checklist.md` · `PROGRESS.md`

1. BE 전체(env 핀 커맨드)+FE 4종 실측.
2. QA `## R5` 뒤에 `## R6 (인스펙터 재정비)` 추가 — 7항목: R6-1 노드 디스플레이 기본 접힘+항목 아이콘·아코디언 · R6-2 엣지 스타일 기본 접힘·아코디언 · R6-3 버전 선택 행이 맵 탭 최상단(승인 탭엔 없음) · R6-4 승인 탭 순서(결재 대기 최상단→드래프트 CTA→워크플로→SP→타임라인) + CTA 두 상태(드래프트 有=전환/無=생성, 현재=draft면 미노출) · R6-5 체크아웃 UI가 draft에서만(rejected에선 안 보임) · R6-6 협업자 개인 목록 3.3행 클램프+전체 펼치기/접기 · R6-7 SP 버튼 행(designate 좌+go-published/등록요청 우측 정렬·아이콘) 아래엔 노트만. 헤더 게이트 수치 갱신.
3. PROGRESS 마감 1줄 + 플랜 파일 git add → 커밋 `docs(qa): R6 inspector reorg verification checklist — R6 인스펙터 재정비 검증 체크리스트`

실행 순서: W1→W2→W3→W4→W5.

## Self-Review 결과

- 피드백 매핑: 노드 디스플레이 접힘+아이콘=W1.2, 엣지 스타일 접힘=W1.3, 3.3 클램프+전체 펼치기=W3, pending 최상단=W2.1, 버전 선택 맵탭 이동=W1.1, 드래프트 CTA=W2.2, 체크아웃 draft 전용=W2.4, 워크플로 접힘=W2.3, 아코디언 전 적용=공통 계약, SP 버튼 재배치+아이콘=W4.
- W1이 버전 행을 옮긴 뒤 W2가 그 자리에 CTA를 넣음 — 순서 의존 명시.
- rejected 상태 체크아웃 소실은 사용자 지시 우선·report flag(설계 우려 기록).
