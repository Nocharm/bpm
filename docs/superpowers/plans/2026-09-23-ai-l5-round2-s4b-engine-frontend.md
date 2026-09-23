# AI L5 2라운드 스프린트 ④b 캠페인 엔진(프론트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **④a(백엔드) 플랜이 먼저 끝나 있어야 한다** — `canvas`/`feedback_log`/`POST /feedback`/`PUT /canvas`/`Question.section`을 소비한다.

**Goal:** 연결 단계를 "AI가 먼저 제안한 L5 맵을 ReactFlow 캔버스에서 마우스로 고치고, 채팅으로도 고치는" 화면으로 바꾸고(B4·B5), 보드의 모든 행을 클릭 가능하게 상태별 패널을 두며(B9), 설문을 섹션으로 묶는다(B12 FE).

**Architecture:** `RelationsCanvas`(`components/framework-interview/relations-canvas.tsx`)는 compare 페이지 선례대로 `ReactFlow` + `nodeTypes={{ process: ProcessNode }}`를 두 번째 인스턴스로 띄운다(에디터 12,500줄 비의존). 세션 `canvas` JSON ↔ RF nodes/edges 변환은 순수 함수(`lib/relations-canvas.ts`)로 두고 vitest로 고정. 편집은 300ms 디바운스로 `PUT /canvas`, 확정은 `PUT /relations {canvas}`. `FeedbackChat`은 scope만 다른 공용 컴포넌트로 연결 단계(relations)와 완료 카드(task)에 붙는다. `TaskPanel`이 `AnswerStep`을 흡수해 상태별 뷰를 낸다.

**Tech Stack:** Next.js/React, `@xyflow/react`(nodesConnectable·onConnect·onEdgesDelete), Tailwind 토큰, vitest, Playwright + `scripts/fake-ai-server.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-23-ai-l5-campaign-round2-design.md` §4.5·4.7·4.8, §5

## Global Constraints

- 색은 토큰만. 아이콘 Lucide 14/16 strokeWidth 1.5. 모션 `ease-smooth`, reduced-motion 가드. UI 문구 긴 대시(—) 금지, i18n en/ko 동시.
- 오버레이 z 사다리: 모달 1200·컨텍스트 메뉴 1200·토스트 1300·포털 드롭다운 1350.
- 인터랙티브 요소 `data-id`. 컴포넌트 추가·삭제 시 `node scripts/build-component-catalog.mjs` 재생성, 머리 주석 한 줄.
- `ProcessNode`를 에디터 밖에서 쓸 때: `NodeActionsContext` 기본값으로 충분(compare와 같음), subprocess 노드 data에 `linkedMapId`를 **넣지 않는다**(null이면 플레이스홀더 룩). `isConnectable`은 RF `nodesConnectable`이 준다.
- 캔버스 좌표·id 계약은 ④a `canvas.py`와 동일: subprocess id=task_id, 분기 `__branch__*`, `__start__`/`__end__`.
- 커밋: `type(scope): English — 한국어` + `PROGRESS.md` 1~3줄 같은 커밋 + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`.
- 게이트(frontend/): `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check`. 검증 서버: 가짜 AI 9999 · backend 8048(`AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="" DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS=""`) · frontend 3047(`--webpack`). 서버는 PID로 회수. `.next/dev/types`가 tsc를 깨면 지우고 재실행.
- 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 서브에이전트는 `pwd`·`git branch --show-current`를 먼저 확인. 복합 Bash는 나눈다. 광범위 `pkill` 금지.
- Playwright 함정: `isVisible({timeout})`은 기다리지 않는다(`waitFor`), `[data-id^=…]` 접두 매칭은 래퍼를 먼저 잡을 수 있다, 프리뷰 안 `svg`는 아이콘까지 잡힌다(`[data-id="scope-preview-pane"] > svg`).

---

### Task 1: 캔버스 ↔ ReactFlow 변환 (순수)

**Files:**
- Create: `frontend/src/lib/relations-canvas.ts`, `frontend/src/lib/relations-canvas.test.ts`

**Interfaces:**
```ts
import type { FwCanvas } from "./api";           // ④a가 정의: { nodes: FwCanvasNode[]; edges: FwCanvasEdge[] }
export const START_ID = "__start__"; export const END_ID = "__end__"; export const BRANCH_PREFIX = "__branch__";
export function canvasToFlow(canvas: FwCanvas): { nodes: AppNode[]; edges: Edge[] }   // ProcessNode용 AppNode(type "process", data=buildNodeData(nodeType, title)), 엣지 type "smoothstep", label
export function flowToCanvas(nodes: AppNode[], edges: Edge[], prev: FwCanvas): FwCanvas   // task_id는 prev에서 id로 되찾는다, 라벨 문자열화
export function addBranchAfter(canvas: FwCanvas, nodeId: string): FwCanvas   // nodeId의 나가는 엣지를 새 분기 노드 `__branch__{nodeId}` 뒤로 이관(이미 있으면 `__branch__{nodeId}__2`…), 분기 노드 위치 = nodeId 오른쪽 +220
export function removeBranch(canvas: FwCanvas, branchId: string): FwCanvas   // 분기 노드 제거: 들어오는 src마다 나가는 엣지를 src에서 직접 잇는다(라벨 유지)
export function connectNodes(canvas: FwCanvas, sourceId: string, targetId: string): FwCanvas   // 중복 쌍이면 그대로, id `e-${genId()}`
export function setEdgeLabel(canvas: FwCanvas, edgeId: string, label: string): FwCanvas
export function removeEdge(canvas: FwCanvas, edgeId: string): FwCanvas
export function moveNode(canvas: FwCanvas, nodeId: string, x: number, y: number): FwCanvas
```

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/lib/relations-canvas.test.ts
import { describe, expect, it } from "vitest";
import { addBranchAfter, canvasToFlow, connectNodes, flowToCanvas, removeBranch, removeEdge, setEdgeLabel } from "./relations-canvas";
import type { FwCanvas } from "./api";

const base: FwCanvas = {
  nodes: [
    { id: "__start__", node_type: "start", title: "Start", task_id: null, pos_x: 0, pos_y: 0 },
    { id: "t1", node_type: "subprocess", title: "접수", task_id: "t1", pos_x: 200, pos_y: 0 },
    { id: "t2", node_type: "subprocess", title: "검토", task_id: "t2", pos_x: 400, pos_y: 0 },
    { id: "__end__", node_type: "end", title: "End", task_id: null, pos_x: 600, pos_y: 0 },
  ],
  edges: [
    { id: "e0", source_node_id: "__start__", target_node_id: "t1", label: "" },
    { id: "e1", source_node_id: "t1", target_node_id: "t2", label: "" },
    { id: "e2", source_node_id: "t2", target_node_id: "__end__", label: "" },
  ],
};

describe("relations canvas", () => {
  it("round-trips canvas → flow → canvas keeping task ids and positions", () => {
    const flow = canvasToFlow(base);
    expect(flow.nodes.find((n) => n.id === "t1")?.data.nodeType).toBe("subprocess");
    expect(flow.edges.map((e) => e.id)).toEqual(["e0", "e1", "e2"]);
    expect(flowToCanvas(flow.nodes, flow.edges, base)).toEqual(base);
  });
  it("addBranchAfter moves outgoing edges behind a new decision node", () => {
    const withBranch = addBranchAfter(base, "t1");
    const branch = withBranch.nodes.find((n) => n.node_type === "decision");
    expect(branch?.id).toBe("__branch__t1");
    expect(withBranch.edges.some((e) => e.source_node_id === "t1" && e.target_node_id === "__branch__t1")).toBe(true);
    expect(withBranch.edges.some((e) => e.source_node_id === "__branch__t1" && e.target_node_id === "t2")).toBe(true);
    expect(removeBranch(withBranch, "__branch__t1")).toEqual(base);
  });
  it("connectNodes ignores duplicates, setEdgeLabel and removeEdge are immutable", () => {
    const same = connectNodes(base, "t1", "t2");
    expect(same.edges).toHaveLength(3);
    const labeled = setEdgeLabel(base, "e1", "승인");
    expect(labeled.edges[1].label).toBe("승인");
    expect(base.edges[1].label).toBe("");
    expect(removeEdge(base, "e1").edges.map((e) => e.id)).toEqual(["e0", "e2"]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/relations-canvas.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `buildNodeData(normalizeNodeType(node.node_type), node.title)`로 data, `position: {x: pos_x, y: pos_y}`, `type: "process"`; 엣지 `{ id, source, target, label: label || undefined, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }`. `flowToCanvas`는 `prev`의 노드로 `task_id`·`node_type`·`title`을 되찾고 위치만 flow에서. 모든 함수는 새 객체 반환.

- [ ] **Step 4: 통과·커밋**

```bash
git add frontend/src/lib/relations-canvas.ts frontend/src/lib/relations-canvas.test.ts PROGRESS.md
git commit -m "feat(fw-consult): pure canvas<->flow helpers for the relations editor — 연결 캔버스 변환 헬퍼"
```

---

### Task 2: `FeedbackChat` 공용 컴포넌트

**Files:**
- Create: `frontend/src/components/framework-interview/feedback-chat.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (en·ko 각 5키)
- Regenerate: `frontend/COMPONENTS.md`

**Interfaces:**
```tsx
interface FeedbackChatProps {
  log: FwFeedbackEntry[];            // session.feedback_log, scope로 필터해 보여준다(task면 task_pk 일치만)
  scope: "relations" | "task";
  taskPk?: number;
  busy: boolean;
  draft: string; onDraftChange(v): void;   // 우클릭 "피드백에 언급"이 밖에서 텍스트를 끼워 넣을 수 있게 제어형
  onSend(message: string): void;
  placeholder: string;
}
export function FeedbackChat(props): JSX.Element
```
- 렌더: 최근 항목 목록(`fw-feedback-entry-${i}`, 시각 `at` HH:mm) + textarea(`fw-feedback-input`, Enter=전송·Shift+Enter 줄바꿈) + `AiButton variant="inline"`(`fw-feedback-send`, busy면 disabled + `Loader2` 아이콘). 빈 메시지는 전송 안 함.
- i18n: `fwConsult.feedbackTitle` "Ask the AI to change it" / "AI에게 수정 요청", `fwConsult.feedbackSend` "Send" / "보내기", `fwConsult.feedbackRelationsPlaceholder` "e.g. Put B before A, add a branch after review" / "예: B를 A 앞에, 검토 뒤에 분기 추가", `fwConsult.feedbackTaskPlaceholder` "e.g. Split the second step into two" / "예: 두 번째 활동을 둘로 나눠", `fwConsult.feedbackEmpty` "No requests yet" / "아직 요청이 없습니다".

- [ ] **Step 1: 컴포넌트 작성 + i18n + 카탈로그** (순수 로직이 없어 vitest 대상은 없음 — Task 5 스모크가 검증)
- [ ] **Step 2: tsc·eslint·catalog → 커밋**

```bash
git add frontend/src/components/framework-interview/feedback-chat.tsx frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(fw-consult): FeedbackChat shared by the relations canvas and drawn cards — 피드백 채팅 공용 컴포넌트"
```

---

### Task 3: 연결 단계 재작성 — 자동 제안 + `RelationsCanvas` + 우측 패널 (B4·B5)

**Files:**
- Create: `frontend/src/components/framework-interview/relations-canvas.tsx`
- Rewrite: `frontend/src/components/framework-interview/relations-step.tsx`
- Modify: `frontend/src/app/framework/consult/[sessionId]/page.tsx:200-215` (RelationsStep props), `frontend/src/lib/api.ts` (`saveFrameworkCanvas`, `generateFrameworkRelations(id, comment?)`, `confirmFrameworkRelations(id, { canvas })`)
- Modify: `frontend/src/lib/i18n-messages.ts` (en·ko 각 9키)
- Regenerate: `frontend/COMPONENTS.md`

**Interfaces:**
- api: `generateFrameworkRelations(id: number, comment = ""): Promise<FwInterviewSession>`(POST body `{comment}`), `saveFrameworkCanvas(id: number, canvas: FwCanvas): Promise<FwInterviewSession>`(PUT `/canvas`), `confirmFrameworkRelations(id: number, body: { canvas: FwCanvas }): Promise<FwInterviewSession>`(PUT `/relations`), `sendFrameworkFeedback`(④a).
- `RelationsCanvas` props: `{ canvas: FwCanvas; taskNames: Map<string,string>; onChange(next: FwCanvas): void; onMention(taskId: string, name: string): void; busy: boolean }`.
  - `<ReactFlowProvider><ReactFlow nodes edges nodeTypes={{process: ProcessNode}} nodesConnectable nodesDraggable elementsSelectable onNodesChange(로컬 position만) onNodeDragStop→moveNode onConnect→connectNodes onEdgesDelete→removeEdge onEdgeClick→라벨 팝오버(입력+저장, `fw-relations-edge-label`) onNodeContextMenu→ContextMenu fitView minZoom={0.2} panOnDrag panOnScroll zoomOnScroll={false} zoomActivationKeyCode={["Control","Meta"]} deleteKeyCode="Delete" /></ReactFlowProvider>`. 배경 `bg-canvas` + `<Background variant="dots">`(에디터와 같은 dot-grid).
  - 컨텍스트 메뉴 항목(`ContextMenuItem`): `{title: 노드 이름}`, subprocess면 `피드백에 언급`(`onMention`), `taskId 복사`(`copyText`), `뒤에 분기 추가`(`addBranchAfter`); decision이면 `분기 제거`(`removeBranch`); start/end는 `{note}`만.
  - 툴바(우상단, `ZOOM_BTN` 스타일): 자동 정렬(`autoLayoutFlow(nodes, edges, "LR")` → `moveNode` 일괄), 되돌리기 1단계(직전 canvas 스냅샷), 맞춤(`fitView`).
  - 변경은 즉시 `onChange`(부모가 300ms 디바운스로 `saveFrameworkCanvas`). busy 동안 `pointer-events-none opacity-60` 오버레이.
- `RelationsStep` props: `{ session; busy; onPropose(comment: string): void; onSaveCanvas(canvas): void; onConfirm(canvas): void; onFeedback(message: string): void; onPreviewTask; onReopenTask }`.
  - 마운트 시 `session.relations === null && session.canvas === null`이면 `onPropose("")` 1회(부모 `run`이 busy). 오버레이 링: `proposing` 상태 = `Promise.all([call, delay(1500)])`은 **부모 page의 run 래퍼가 아니라 RelationsStep 내부 상태**로 — `onPropose` 호출 시 `setOverlay(true)`, `useEffect`로 `session.canvas` 갱신 && 1.5s 경과 후 `setOverlay(false)`(타이머 ref). 오버레이 `data-id="fw-consult-relations-proposing"`(`Loader2` + "AI가 흐름을 제안하는 중").
  - 헤더: 제목 · 코멘트 input(`fw-consult-propose-comment`) · `AiButton`[다시 제안](`fw-consult-propose-relations`, `onPropose(comment)`) · [확정](`fw-consult-confirm-relations`, `onConfirm(canvas)`).
  - 본문: 좌 `RelationsCanvas`(남은 높이 전부, `fw-consult-relations-canvas`) / 디바이더(`useResizableWidth({storageKey:"bpm.fwRelationsPanelWidth", min:320, max:560, fallback:400, edge:"right"})`, `fw-consult-relations-divider`) / 우 패널(`fw-consult-relations-panel`): 상단 L6 카드 목록(기존 `fw-consult-relations-cards`·미리보기·정정 버튼 유지) + 하단 `FeedbackChat scope="relations"`(`onMention`이 draft에 `@이름 ` 끼워 넣음).
  - 로컬 `canvas` 상태는 `session.canvas`로 초기화하고, 부모가 `key={JSON.stringify(session.canvas)}`로 리마운트(피드백/재제안 결과 반영) — 편집 중 폴링이 덮어쓰지 않도록 디바운스 저장 결과는 key에 영향 없음(`PUT /canvas` 응답도 같은 내용).
  - 기존 엣지 표(`fw-consult-edges`·`fw-consult-edge-*`·`fw-consult-entry*`)는 제거. 스모크 `pw-fw-consult.mjs`가 `fw-consult-edge-0`을 기다리므로 Task 5에서 `fw-consult-relations-canvas .react-flow__edge`로 이식.
- page.tsx: `RelationsStep` key를 `JSON.stringify(session.canvas ?? session.relations ?? null)`로, `onPropose={(c) => void run(() => generateFrameworkRelations(session.id, c))}`, `onSaveCanvas={(cv) => void saveFrameworkCanvas(session.id, cv).then(applySession).catch(e => setError(getApiErrorDetail(e)))}`(busy 안 올림 — 편집 중 잠금 방지), `onConfirm={(cv) => void run(() => confirmFrameworkRelations(session.id, { canvas: cv }))}`, `onFeedback={(m) => void run(() => sendFrameworkFeedback(session.id, { scope: "relations", message: m }))}`.
- i18n: `fwConsult.proposing` "AI is proposing the flow" / "AI가 흐름을 제안하는 중", `fwConsult.proposeComment` "Add a note for the AI (optional)" / "AI에게 남길 메모(선택)", `fwConsult.canvasAutoLayout` "Auto layout" / "자동 정렬", `fwConsult.canvasUndo` "Undo" / "되돌리기", `fwConsult.canvasFit` "Fit" / "맞춤", `fwConsult.menuMention` "Mention in feedback" / "피드백에 언급", `fwConsult.menuCopyId` "Copy task id" / "taskId 복사", `fwConsult.menuAddBranch` "Add a branch after" / "뒤에 분기 추가", `fwConsult.menuRemoveBranch` "Remove branch" / "분기 제거", `fwConsult.edgeLabel` "Condition" / "조건", `fwConsult.resizeRelationsPanel` "Resize panel" / "패널 폭 조절".

- [ ] **Step 1: api.ts 배선 + RelationsCanvas 작성 + RelationsStep 재작성 + page 배선 + i18n**
- [ ] **Step 2: tsc·eslint(`react-hooks/set-state-in-effect` — 오버레이 해제는 타이머 콜백 안에서)·catalog 재생성**
- [ ] **Step 3: 수동 확인** — 가짜 AI로 세션을 연결 단계까지 진행(pw-fw-consult.mjs 흐름), 브라우저에서 진입 즉시 링→캔버스, 핸들 드래그로 엣지 추가, 엣지 클릭 라벨, 우클릭 분기 추가, 확정 → 등록 리포트 도달. 캡처 `docs/qa/screens/fw-consult-relations-canvas.png`.
- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/framework-interview/relations-canvas.tsx frontend/src/components/framework-interview/relations-step.tsx "frontend/src/app/framework/consult/[sessionId]/page.tsx" frontend/src/lib/api.ts frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md docs/qa/screens/fw-consult-relations-canvas.png PROGRESS.md
git commit -m "feat(fw-consult): editable L5 relations canvas with auto proposal and feedback chat — 연결 캔버스·자동 제안·피드백"
```

---

### Task 4: 보드 전 행 클릭 + `TaskPanel` + 설문 섹션 (B9·B12 FE)

**Files:**
- Create: `frontend/src/components/framework-interview/task-panel.tsx`
- Modify: `frontend/src/components/framework-interview/task-board.tsx:55-70` (`activate` — 전 상태 클릭), `questionnaire-form.tsx`(섹션 그룹 + `AnswerStep`을 `TaskPanel`로 이관), `answer-review.tsx`(섹션 그룹), `frontend/src/app/framework/consult/[sessionId]/page.tsx:143-150, 190-200` (선택 유지·TaskPanel 배선)
- Modify: `frontend/src/lib/framework-interview.ts` (`groupQuestionsBySection`), `frontend/src/lib/framework-interview.test.ts`
- Modify: `frontend/src/lib/i18n-messages.ts` (섹션 4키 + 상태 안내 3키)
- Regenerate: `frontend/COMPONENTS.md`

**Interfaces:**
- `groupQuestionsBySection(questions: FwQuestion[]): { section: FwQuestionSection; questions: FwQuestion[] }[]` — 순서 basic→activities→exceptions→io, 빈 섹션 생략.
- `TaskBoard.onSelect`는 모든 행에서 호출(`role=button` 전 행). `title`은 상태별.
- page: `selectedTaskId`가 가리키는 카드가 어떤 상태든 `TaskPanel`을 그 카드로 렌더(`step`이 relations/register여도 선택이 있으면 우측은 TaskPanel — 단, 연결/등록 단계 진입 시 `selectedTaskId`를 null로 초기화하고, 보드 클릭이 다시 선택). 선택이 없으면 기존 `deriveStep` 흐름.
- `TaskPanel` props `{ session; task: FwInterviewTask; busy; onSubmit; onFeedback(taskPk, message); onRetry; onSkip; onClose(): void }`, 상태별:
  | status | 뷰 |
  |---|---|
  | pending/generating | `fw-consult-task-waiting` 링 + `fwConsult.panelPreparing` |
  | ready | 기존 설문 폼(섹션 헤더 그룹) |
  | submitted/drawing | `AnswerReview`(제출 답, detail.answers의 value) + 하단 링 `fwConsult.panelDrawing` |
  | drawn | `AnswerReview` + `ImportMapPreview source={{taskId, ...row}} scope="map"` + `FeedbackChat scope="task" taskPk` |
  | failed | 에러 + 재시도/건너뛰기 버튼 |
  상단에 `[닫기]`(`fw-consult-task-close`, `onClose` → 선택 해제 → 자동 흐름 복귀).
- 섹션 헤더: `fwConsult.sectionBasic` "Basics" / "기본 정보", `…Activities` "Activities" / "활동", `…Exceptions` "Exceptions and branches" / "예외·분기", `…Io` "Inputs and outputs" / "입출력". 안내: `fwConsult.panelPreparing` "Preparing the questionnaire" / "설문을 만드는 중", `fwConsult.panelDrawing` "Drawing the map from your answers" / "답을 바탕으로 맵을 그리는 중", `fwConsult.panelClose` "Back to the flow" / "흐름으로 돌아가기".

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/lib/framework-interview.test.ts
it("groupQuestionsBySection orders basic→activities→exceptions→io and drops empty sections", () => {
  const q = (id: string, section: FwQuestionSection) => ({ id, kind: "text" as const, maps_to: "conditions" as const, text: id, options: [], suggested: "", section });
  const groups = groupQuestionsBySection([q("a", "io"), q("b", "basic"), q("c", "activities"), q("d", "basic")]);
  expect(groups.map((g) => g.section)).toEqual(["basic", "activities", "io"]);
  expect(groups[0].questions.map((x) => x.id)).toEqual(["b", "d"]);
});
```

- [ ] **Step 2: 실패 확인 → 구현** — `groupQuestionsBySection` + `QuestionnaireForm`이 그룹별 `<section>`(`fw-consult-section-${section}`, 헤더 `text-caption text-ink-tertiary`)으로 렌더(그리드 2열 유지, activities 섹션은 전폭). `AnswerReview`도 같은 그룹. `TaskPanel`은 `AnswerStep`의 설문 로딩 로직(`getFrameworkInterviewTask`)을 흡수하고 상태별 분기를 추가. `TaskBoard` 전 행 클릭. page 배선.

- [ ] **Step 3: tsc·eslint·vitest·catalog → 수동 확인**(대기 카드 클릭 → 준비 중 패널, 제출 카드 클릭 → 답+링, 완료 카드 클릭 → 답+미리보기+채팅) → 캡처 `docs/qa/screens/fw-consult-task-panel.png` → 커밋

```bash
git add frontend/src/components/framework-interview/task-panel.tsx frontend/src/components/framework-interview/task-board.tsx frontend/src/components/framework-interview/questionnaire-form.tsx frontend/src/components/framework-interview/answer-review.tsx "frontend/src/app/framework/consult/[sessionId]/page.tsx" frontend/src/lib/framework-interview.ts frontend/src/lib/framework-interview.test.ts frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md docs/qa/screens/fw-consult-task-panel.png PROGRESS.md
git commit -m "feat(fw-consult): every board row opens a state-aware task panel; questionnaire sections — 보드 전 행 클릭·설문 섹션"
```

---

### Task 5: 스모크 이식·신규 + 매뉴얼 + 마감

**Files:**
- Create: `frontend/scripts/pw-fw-consult-canvas.mjs`
- Modify: `frontend/scripts/pw-fw-consult.mjs`(`fw-consult-edge-0` → `.react-flow__edge` 대기, 확정 전 자동 제안이므로 [제안] 클릭 제거), `pw-fw-consult-existing.mjs`(같은 이식), `pw-fw-consult-ux.mjs`(`fw-consult-propose-relations` 클릭 제거 → 자동 제안 대기)
- Modify: `docs/manual/admin-manual-ko.md:351-`·`admin-manual-en.md:351-`("AI로 L5 채우기" 절에 연결 캔버스·피드백·전 행 클릭·섹션 문단), `CLAUDE.md`(⑫ 상태 줄 뒤에 ⑬ 2라운드 한 줄)

**Interfaces(스모크 흐름):** 세션 → 계획 → 설문 2장(섹션 헤더 `fw-consult-section-basic` 존재 확인) → 대기 카드 클릭 시 `fw-consult-task-waiting` → 연결 단계 진입 즉시 `fw-consult-relations-proposing` 가시 → 1.5s 이상 뒤 캔버스 `.react-flow__node` ≥ 4(start·2 subprocess·end) → 우클릭 첫 subprocess → `뒤에 분기 추가` → decision 노드 +1 → 엣지 클릭 → 라벨 "승인" 입력 → `PUT /canvas` 200(네트워크 응답 대기) → 피드백 채팅 "B를 먼저" 전송 → 캔버스 리마운트(가짜 AI가 뒤집은 엣지 존재) → 확정 → 등록 리포트 → 보드 완료 카드 클릭 → `fw-consult-task-panel`에 미리보기+채팅 → task 피드백 전송 → 행 `l6`에 "(수정)" 반영(`GET /tasks/{pk}`).

- [ ] **Step 1: 스모크 작성·이식** — `check` 패턴, 네트워크 대기는 `page.waitForResponse((r) => r.url().includes("/canvas") && r.request().method() === "PUT")`.
- [ ] **Step 2: 실행** — 신규 + `pw-fw-consult.mjs`·`pw-fw-consult-existing.mjs`·`pw-fw-consult-ux.mjs`·`pw-fw-consult-pick-card.mjs` green. 캡처 `fw-consult-canvas-feedback.png`.
- [ ] **Step 3: 매뉴얼·CLAUDE.md** — 관리자 매뉴얼 ko/en "AI로 L5 채우기" 절에 (1) 관리 패널 타일 진입 (2) 연결 단계: AI가 먼저 제안, 캔버스에서 드래그·우클릭·엣지 라벨로 수정, 채팅으로 자연어 수정, 확정 (3) 보드 어느 카드든 클릭해 상태 확인, 완료 카드는 미리보기+수정 요청 (4) 주관식 [AI 제안]. CLAUDE.md 상태 줄에 `⑬(dev, 2026-09-23) AI L5 2라운드 — 관리 패널 타일 진입·AiButton·플랜 카드 FLIP·주관식 타이핑·연결 캔버스(세션 canvas↔relations)·피드백 엔드포인트·IO 배열·질문 섹션·러너 병렬·비교 diff 토큰/인스펙터 폭·L5 드롭존` 한 줄.
- [ ] **Step 4: 게이트 전체 + 커밋 + 푸시 + 캡처 공유 + 서버 회수**

```bash
git add frontend/scripts/pw-fw-consult-canvas.mjs frontend/scripts/pw-fw-consult.mjs frontend/scripts/pw-fw-consult-existing.mjs frontend/scripts/pw-fw-consult-ux.mjs docs/manual/admin-manual-ko.md docs/manual/admin-manual-en.md CLAUDE.md docs/qa/screens/fw-consult-canvas-feedback.png PROGRESS.md
git commit -m "test(fw-consult): canvas/feedback smoke, port smokes, manual for round 2 — 캔버스·피드백 스모크·매뉴얼"
git push origin dev
```
