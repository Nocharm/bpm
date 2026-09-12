# Catalog Density · Note Choice · Node Tone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 설정 Catalogs 탭을 밀도 있게 재구성 ② 시스템이 `Other`로 넘어갈 때 기존 원문 메모를 교체/추가/취소 중 고르게 ③ 캔버스 노드에서 담당자를 흑백 칩(복수 나열), 역할을 플레인 텍스트로 교체 ④ 워스트 케이스 스크린샷.

**Architecture:** UI 전용 변경(백엔드 무변경). ②는 `commitSystem` 결과의 `keptNote`를 "결정 대기"로 바꿔 `SystemSuggestInput`이 선택지를 제공한다 — 행 모드는 3버튼 다이얼로그, 필드 모드는 팝오버 안 인라인 선택 줄. ③은 `process-node.tsx` `NodeFields`의 담당자 줄 렌더만 바꾼다(전환 규칙·지연은 그대로).

**Tech Stack:** Next.js + React 19 + TypeScript, Tailwind 토큰, Playwright.

**Spec:** 사용자 결정 2026-09-12: 카탈로그 탭 밀도 ↑(2열·헤더 한 줄·툴팁 힌트) · 기타 전환 시 메모 있으면 교체/추가/취소 선택 · 노드에서 담당자=흑백 칩(복수 나열), 역할=플레인 텍스트(현재 담당자 톤) · 휴식↔활성 전환 규칙·`NODE_ALT_DELAY_MS` 유지 · 워스트 케이스 화면 공유.

## Global Constraints

- 토큰 색만, 굵기 300/400/600, Lucide 1.5. 오버레이 z: 다이얼로그 1300 · 팝오버 1350 · 드롭다운 1400 → 팝오버 위엔 다이얼로그를 띄우지 않는다(인라인 선택 줄).
- i18n en+ko 동시. `data-id` 유지(`inspector-field-system`, `summary-tile-input-system`, `sp-tile-input-system`, `node-assignee-line`, `node-system-line`, `catalog-*`). 새 `data-id`: `system-note-choice`(다이얼로그/인라인 공용 컨테이너), `system-note-replace`·`system-note-append`·`system-note-cancel`, `node-assignee-chip`, `node-role-text`.
- React Compiler 린트(플레인 핸들러, effect 안 동기 setState 금지). 새 컴포넌트는 머리 주석 + `node scripts/build-component-catalog.mjs`.
- 커밋: `type(scope): English summary — 한국어 요약` + 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`; PROGRESS.md 1~3줄. 브랜치 `dev` 직접 커밋, 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`.
- 게이트: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs --check`.

---

### Task 1: 시스템 원문 메모 선택(교체/추가/취소)

**Files:**
- Modify: `frontend/src/components/system-suggest-input.tsx`
- Modify: `frontend/src/lib/catalogs.ts`(+ `catalogs.test.ts`): `appendSystemNote(existing, raw)` 순수 함수
- Modify: `frontend/src/components/node-summary-modal.tsx`(시스템 팝오버 블록, `keptNote` 안내문 제거), `frontend/src/components/permissions/subprocess-designation-modal.tsx`(동일)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- `appendSystemNote(existing: string, raw: string): string` — `existing.trimEnd() + "\n" + raw.trim()`(existing 비면 raw).
- `SystemSuggestInput` props: `confirmReplace` 제거 → 항상 선택 제공. 새 prop 없음. 결정 대기 상태에서 행 모드는 `SystemNoteChoiceDialog`(내부 컴포넌트, `ModalBackdrop` 포털 z 1300, 버튼 3개 `교체`/`추가`/`취소`), 필드 모드는 입력 아래 인라인 줄(`data-id="system-note-choice"`, 같은 3버튼, `text-fine`). `취소`는 `onCommit`을 호출하지 않고 대기만 해제(값·메모 그대로, `SuggestInput`은 부모 값이 안 바뀌었으므로 `resyncPending`으로 원래 값으로 되돌아간다).
- `onCommit(patch)` 시그니처는 유지하되 두 번째 인자 `keptNote`는 항상 `false`(호출부의 `keptNote` 사용은 제거).
- i18n: `catalog.systemNoteChoiceTitle`("Existing source note"/"기존 원문 메모가 있습니다"), `catalog.systemNoteChoiceBody`("\"{value}\" is not in the system list, so the system becomes Other. What should happen to the existing note?"/"\"{value}\"은(는) 시스템 목록에 없어 기타로 저장됩니다. 기존 원문 메모를 어떻게 할까요?"), `catalog.systemNoteReplace`("Replace"/"교체"), `catalog.systemNoteAppend`("Append"/"추가"), `catalog.systemNoteCancel`("Cancel"/"취소"). 기존 `catalog.systemReplaceNote*`·`catalog.systemKeepNote`·`catalog.systemKeptNote` 키는 사용처가 없어지면 삭제(en·ko 모두).

- [ ] Step 1: `catalogs.test.ts`에 `appendSystemNote` 케이스 3개(빈 existing → raw; 일반 → `"old\nnew"`; 양끝 공백 정리) 추가 → 실패 확인 → 구현.
- [ ] Step 2: `SystemSuggestInput` 재작성 — `pending: { raw: string } | null`; `handleCommit`: `result.keptNote`면 `setPending({raw})`, 아니면 `onCommit(patch, false)`. 선택 핸들러: replace → `{system: OTHER_SYSTEM, system_fallback: raw}`, append → `{system: OTHER_SYSTEM, system_fallback: appendSystemNote(systemFallback, raw)}`, cancel → `setPending(null)`만. 렌더: `mode === "row"`면 다이얼로그(ModalBackdrop, `data-id="system-note-choice"`, 제목·본문·버튼 3개: 교체=accent, 추가=hairline, 취소=hairline), `mode === "field"`면 입력 아래 `<div data-id="system-note-choice" className="flex items-center gap-1.5 rounded-sm border border-accent-tint-border bg-accent-tint/40 px-2 py-1 text-fine text-ink-secondary">안내문 + 버튼 3개</div>`.
- [ ] Step 3: 두 모달의 `keptNote` 안내문·`ActiveTile.keptNote` 제거(타입·setActive 호출 정리). `page.tsx`의 `confirmReplace` prop 제거.
- [ ] Step 4: 게이트 → 커밋 `feat(editor): choose replace/append/cancel for the source note when a system falls to Other — 기타 전환 시 원문 메모 교체·추가·취소 선택`.

---

### Task 2: 캔버스 담당자 흑백 칩(복수) · 역할 플레인 텍스트

**Files:**
- Modify: `frontend/src/components/process-node.tsx`(`NodeFields`)
- (유지) `role-chip.tsx`의 `tone="mono"`는 더 이상 캔버스에서 쓰지 않는다 — prop은 남겨도 되지만 사용처가 없으면 제거하고 카탈로그 재생성.

**Interfaces:**
- 담당자 표기: `parseAssignees(value)`(`@/lib/assignee`)로 나눠 이름마다 `<span data-id="node-assignee-chip" className="inline-flex max-w-full items-center gap-1 rounded-full border border-hairline bg-surface-alt px-1.5 py-0 text-[11px] leading-4 text-ink-secondary"><User size={10} strokeWidth={1.5} className="shrink-0" /><span className="min-w-0 truncate">{name}</span></span>`, 컨테이너 `flex flex-wrap items-center gap-1`. (인물 필 `AssigneePills`와 같은 중립 톤; 디렉터리 해석·호버 카드는 캔버스에선 하지 않는다 — 성능.)
- 역할 표기: `<span data-id="node-role-text" className="inline-flex items-center gap-1"><BriefcaseBusiness size={12} strokeWidth={1.5} />{role}</span>` — 줄 아이콘(User)은 유지하고 그 뒤에 역할 텍스트. 즉 담당자 줄 휴식 = `[User 아이콘] [Briefcase] Reviewer`, 활성 = `[User 아이콘] [칩 홍길동][칩 김철수]…`. 역할만 있고 담당자가 없으면 전환 없음(현행).
- 교차 페이드·`data-alt`·`NODE_ALT_DELAY_MS`는 그대로. 칩 여러 개가 줄바꿈되면 노드 높이가 늘어나는 것은 허용(최대폭 240px).

- [ ] Step 1: `NodeFields` 담당자 분기만 교체(`names`를 칩 목록으로, `rest`의 역할을 텍스트로). `RoleChip` import가 남지 않으면 제거.
- [ ] Step 2: 게이트·카탈로그 → 커밋 `feat(canvas): assignees as neutral chips, role as plain text on the node line — 담당자 흑백 칩·역할 텍스트`.

---

### Task 3: Catalogs 탭 밀도

**Files:**
- Modify: `frontend/src/components/settings/catalogs-panel.tsx`, `frontend/src/lib/i18n-messages.ts`

**Interfaces / 레이아웃:**
- 패널: `max-w-3xl` → `max-w-6xl`, 카드 컨테이너 `grid gap-4 xl:grid-cols-2`(1280px+ 2열).
- 카드 헤더 한 줄(`flex items-center gap-2`): 제목(`text-caption-strong`) + 건수 배지(`text-fine text-ink-tertiary`, `{n}`) + `HoverTip`/`title` 툴팁 아이콘(`Info` 14px, 내용 = 기존 hint + csvHint 두 줄) + 우측: 추가 입력(`w-56`, `py-1`) + `추가` + `CSV` + `저장`(dirty일 때만 accent, 아니면 hairline 비활성). 기존 `p-4 gap-3` → `p-3 gap-2`.
- 칩: `text-fine`, `px-1.5 py-0`, `gap-1`; 별칭 배지 `+n`은 유지. 편집 중 칩 강조 유지.
- 별칭 편집 줄: `py-1`, 라벨 `text-fine`, 입력 `py-1`, 버튼 `px-2 py-1 text-fine`.
- "사용 중 값" 후보: `grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-3` + `text-fine`; 항목 8개 초과 시 `max-h-24 overflow-y-auto`.
- 결과/안내 문구(`-import-note`)는 헤더 아래 한 줄 `text-fine`.
- `data-id` 전부 유지. i18n 추가: `catalog.count`("{n} items"/"{n}개") 만.

- [ ] Step 1: 레이아웃 재구성(로직 무변경 — `applyAliases`·`addValues`·resync 그대로).
- [ ] Step 2: 게이트·카탈로그 → 커밋 `feat(settings): denser Catalogs tab — two-column cards, one-line header, tooltip hints — 카탈로그 탭 밀도 재구성`.

---

### Task 4: 워스트 케이스 스크린샷(임시 스크립트, 미커밋)

**Files:** `frontend/scripts/pw-worst-role-catalog.mjs`(작업 후 삭제), 산출 `/tmp/worst/*.png`.

- 서버는 에이전트가 자기 세션에서 기동(8000/3000, 점유 시 8047/3047), PID로만 종료.
- 시드(API): 카탈로그 역할 12개(각 별칭 4~5개, 긴 값 "Senior QA Reviewer & Deviation Owner (GMP)" 포함), 시스템 6개(별칭 포함, 긴 값 "Laboratory Information Management System (LIMS v12)"). 맵 1개: process 노드 A(담당자 4명 — 디렉터리 실제 이름 4개, 역할 = 긴 역할, system = 긴 시스템), decision 노드 B(역할 "Approver", 담당자 1명), process 노드 C(system = Other, `system_fallback` 3줄 긴 메모, 역할 없음, 담당자 없음), subprocess 노드 D(링크 맵은 시드 DB의 지정 맵 "Order Fulfillment" — `GET /api/library`에서 designated 맵 id를 찾아 `linked_map_id`로; 못 찾으면 D 생략), 노드 표시 설정에서 system·department 켬(인스펙터 "노드 표시 정보"에서 토글 — 셀렉터는 `node-display-section.tsx`의 data-id를 확인해 사용).
- 브라우저: 1100×800 뷰포트, ko. 스크린샷: `01-catalogs-worst.png`(카탈로그 탭 12항목·별칭), `02-catalogs-alias-editor.png`(긴 별칭 편집), `03-canvas-rest.png`(전체), `04-node-a-rest.png`(노드 A 클립: 역할 텍스트+긴 시스템), `05-node-a-hover.png`(호버 1.3s: 담당자 칩 4개 줄바꿈), `06-node-b-decision-hover.png`, `07-node-c-other-note.png`(휴식: 3줄 메모), `08-inspector-note-choice.png`(노드 C 시스템에 "새 도구" 입력 → 다이얼로그 교체/추가/취소), `09-modal-note-choice.png`(노드 편집 모달 시스템 팝오버 인라인 선택 — 모달 여는 셀렉터는 인스펙터 "편집" 버튼 data-id를 확인), `10-canvas-1100px.png`.
- 스크린샷 경로 목록을 보고에 남긴다. 스크립트는 커밋하지 않고 삭제.

---

## Self-Review
- 결정 3건 모두 태스크에 매핑(①T3 ②T1 ③T2 ④T4). `keptNote` 개념은 T1에서 "결정 대기"로 대체되고 안내문 키는 삭제. T2는 T1과 파일이 겹치지 않음. T4는 T1~T3 이후.
