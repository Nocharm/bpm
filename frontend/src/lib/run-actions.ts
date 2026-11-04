// 실행 모드 노드 버튼 줄의 순수 계산 — 상태·노드 유형·갈래에서 보일 버튼(목업 buildBarHtml()), 갈래·출구 이름,
// 완료 뒤 이어 밟기(목업 runAction()), 먼저 끝낼 단계의 노드 키(목업 getFrontier()), 하위 범위 잠김·기록 판정,
// 버튼 줄·팝오버 자리(목업 placeBar()). 화면은 components/run/run-action-bar.tsx.
// 설계: docs/superpowers/specs/2026-11-04-run-check-design.md §4.2–§4.3.

import type { RunActionName, RunDetail } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";
import { getOutputKey } from "@/lib/output-rules";
import {
  findRunFrontier,
  getRunTopoOrder,
  type BranchOptions,
  type RunGraph,
  type RunGraphEdge,
  type RunNodeStatus,
  type RunScopeState,
} from "@/lib/run-graph";
import { buildRunScopeStates, splitRunNodeKey, toRunNodeKey, type RunView } from "@/lib/run-view";
import { EMBED_SEP, PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

export type RunBarTone = "go" | "default" | "bad" | "quiet" | "branch";

// label은 갈래·출구 버튼의 이름 — 빈 문자열이면 화면이 동작 이름(i18n)을 쓴다
export type RunBarButton =
  | { kind: "action"; action: RunActionName; edgeId?: string; exitKey?: string; label: string; tone: RunBarTone }
  | { kind: "why" }
  | { kind: "enter" }
  | { kind: "comments"; count: number }
  | { kind: "note"; messageKey: MessageKey };

export interface RunBarInput {
  status: RunNodeStatus;
  nodeType: string;
  options: BranchOptions;
  // 연결선 id → 갈래 버튼 이름(getBranchLabel), 출구 키 → 출구 버튼 이름(getExitLabels)
  branchLabels: Record<string, string>;
  exitLabels: Record<string, string>;
  runOpen: boolean;
  // 상태를 바꿀 수 있는 사람(서버 can_act) — 아니면 동작 버튼을 뺀다
  canAct: boolean;
  commentCount: number;
  // 하위 범위의 바깥(호스트)이 대기·건너뜀이거나 그 범위가 닫힘 — 서버가 그 안 동작을 409로 막는다(R9)
  parentBlocked: boolean;
  // 그 하위 범위가 닫힘(호스트를 바로 완료) — 안내 문구만 가른다
  scopeClosed: boolean;
}

// 버튼 줄 아래에 여는 작은 팝오버 — 맵 화면이 들고 있어 Esc·빈 캔버스로 닫고, 먼저 끝낼 단계에 점선을 그린다
export type RunPop =
  | { key: string; kind: "why" | "note" | "comments" }
  | { key: string; kind: "cascade"; action: "unstart" | "undo" };

export interface RunRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RunSize {
  width: number;
  height: number;
}

export interface RunBarPlacement {
  left: number;
  top: number;
  // 노드 위에 자리가 없어 아래로 내려갔는지 — 팝오버가 버튼 줄 밑으로 붙는다
  below: boolean;
}

// 화면 px — 노드↔버튼 줄 간격, 위 여백이 이보다 작으면 노드 아래로, 캔버스 가장자리 여유
const BAR_GAP = 8;
const BAR_MIN_TOP = 40;
const EDGE_MARGIN = 6;
// 팝오버 — 노드 아래 간격, 버튼 줄 아래 간격, 옆자리 간격, 캔버스 위·아래 여유
const POP_NODE_GAP = 8;
const POP_BAR_GAP = 6;
const POP_SIDE_GAP = 12;
const POP_EDGE_MARGIN = 4;

// 대표 끝 제목이 비었을 때의 출구 이름 — 캔버스 끝 노드 표기(End, 영어 고정)와 같다
const UNTITLED_EXIT_LABEL = "End";

const EMPTY_SCOPE_STATE: RunScopeState = { manual: {}, choice: {}, exit: {}, closed: false };

function makeAction(action: RunActionName, tone: RunBarTone): RunBarButton {
  return { kind: "action", action, label: "", tone };
}

/** 완료 자리 — 갈래 노드면 갈래 이름 버튼들(한 번에 완료 + 선택), 출구가 여럿인 하위프로세스면 출구 버튼들, 아니면 완료 하나. */
function buildChoiceButtons(input: RunBarInput, choiceTone: RunBarTone, plainTone: RunBarTone): RunBarButton[] {
  const { options } = input;
  if (options.kind === "edge") {
    return options.edgeIds.map((edgeId) => ({
      kind: "action",
      action: "complete",
      edgeId,
      label: input.branchLabels[edgeId] ?? "→",
      tone: choiceTone,
    }));
  }
  if (options.kind === "exit") {
    return options.exitKeys.map((exitKey) => ({
      kind: "action",
      action: "complete",
      exitKey,
      label: input.exitLabels[exitKey] ?? exitKey,
      tone: choiceTone,
    }));
  }
  return [makeAction("complete", plainTone)];
}

/** 상태별 버튼(설계 §4.2 전이표) — 동작 가능 여부는 서버가 다시 판정한다. */
function buildStatusButtons(input: RunBarInput): RunBarButton[] {
  const enter: RunBarButton[] = input.nodeType === "subprocess" ? [{ kind: "enter" }] : [];
  switch (input.status) {
    case "waiting":
      return [{ kind: "why" }];
    case "done":
      return [...enter, makeAction("undo", "quiet")];
    case "problem":
      // 하위프로세스는 완료 전 어느 상태든 하위 맵에서 밟을 수 있다(§4.2, R32)
      return [makeAction("resolve", "branch"), ...buildChoiceButtons(input, "default", "default"), ...enter];
    default:
      return [
        ...buildChoiceButtons(input, "branch", "go"),
        ...enter,
        ...(input.status === "ready" ? [makeAction("start", "default")] : []),
        makeAction("problem", "bad"),
        ...(input.status === "active" ? [makeAction("unstart", "quiet")] : []),
      ];
  }
}

/**
 * 노드 버튼 줄 — 닫힌 실행·시작/끝·건너뜀·막힌 하위 범위는 안내만(시작/끝 말고는 말풍선으로 코멘트를 읽는다),
 * 나머지는 상태별 동작 + 말풍선. 상태를 못 바꾸는 사람은 동작 버튼을 빼고 이동·보기·말풍선만 남긴다.
 */
export function buildRunBarButtons(input: RunBarInput): RunBarButton[] {
  const talk: RunBarButton = { kind: "comments", count: input.commentCount };
  const note = (messageKey: MessageKey): RunBarButton => ({ kind: "note", messageKey });
  if (!input.runOpen) return [note("run.act.noteClosed"), talk];
  if (input.nodeType === "start" || input.nodeType === "end") return [note("run.act.noteTerminal")];
  // 막힌 바깥이 먼저 — 건너뛴 호스트 아래 단계도 건너뜀으로 읽히지만 이유는 "고르지 않은 갈래"가 아니라 바깥이다
  if (input.parentBlocked) {
    if (!input.scopeClosed) return [note("run.act.noteParentBlocked"), talk];
    return [note(input.status === "skipped" ? "run.act.noteSkippedClosed" : "run.act.noteScopeClosed"), talk];
  }
  if (input.status === "skipped") return [note("run.act.noteSkipped"), talk];
  const buttons = buildStatusButtons(input);
  return [...(input.canAct ? buttons : buttons.filter((button) => button.kind !== "action")), talk];
}

/** 갈래 버튼 이름 — 연결선 라벨, 비면 도착 노드 제목, 그것도 비면 "→". */
export function getBranchLabel(edge: RunGraphEdge, graph: RunGraph): string {
  const label = edge.label.trim();
  if (label) return label;
  return graph.nodes.find((node) => node.id === edge.target)?.title.trim() || "→";
}

/**
 * 출구 버튼 이름 — 그 출구로 나가는 연결선 라벨, 없으면 하위 맵 끝 제목(캔버스 출구 라벨 미러와 같다), 대표 끝이 아닌 출구는
 * 끝 제목이 곧 출구 키다. endTitleByKey는 노드의 subEnds(키 → 끝 제목).
 */
export function getExitLabels(
  graph: RunGraph,
  nodeId: string,
  exitKeys: readonly string[],
  endTitleByKey: Readonly<Record<string, string>>,
): Record<string, string> {
  const nodeType = graph.nodes.find((node) => node.id === nodeId)?.nodeType ?? "subprocess";
  const outgoing = graph.edges.filter((edge) => edge.source === nodeId);
  return Object.fromEntries(
    exitKeys.map((exitKey) => {
      const labeled = outgoing.find(
        (edge) => getOutputKey(nodeType, edge.sourceHandle) === exitKey && edge.label.trim() !== "",
      );
      const endTitle = (Object.hasOwn(endTitleByKey, exitKey) ? endTitleByKey[exitKey] : "").trim();
      const fallback = endTitle || (exitKey === PRIMARY_END_HANDLE ? UNTITLED_EXIT_LABEL : exitKey);
      return [exitKey, labeled?.label.trim() ?? fallback];
    }),
  );
}

/**
 * 완료 뒤 이어 밟기 — 새로 열린 단계가 하나면 그 노드를 고르고, 여럿이면 제자리에서 열린 노드만 반짝인다.
 * 펼친 하위프로세스가 열리면 그 하위 맵 첫 단계도 같이 열려 보이므로, 바깥 호스트가 함께 열린 하위 단계는 세지 않는다.
 */
export function pickAutoAdvance(opened: readonly string[]): { select: string | null; flash: string[] } {
  const openedSet = new Set(opened);
  const steps = opened.filter((key) => !getRunScopeHostKeys(splitRunNodeKey(key).scopePath).some((host) => openedSet.has(host)));
  if (steps.length === 1) return { select: steps[0], flash: [] };
  return { select: null, flash: steps };
}

/**
 * 먼저 끝낼 단계(노드 키) — 대기 노드에서 산 연결선을 거슬러 올라가 지금 손댈 수 있는 노드를 같은 범위에서 찾는다.
 * 상태는 화면의 실행 보기(R22 막힌 하위 범위 반영)를 쓴다. 그 범위 그래프가 없으면 빈 목록.
 */
export function findRunBlockerKeys(
  detail: RunDetail,
  graphs: ReadonlyMap<string, RunGraph>,
  view: RunView,
  key: string,
): string[] {
  const { scopePath, nodeId } = splitRunNodeKey(key);
  const graph = graphs.get(scopePath);
  if (!graph) return [];
  const state = buildRunScopeStates(detail).get(scopePath) ?? EMPTY_SCOPE_STATE;
  const statuses: Record<string, RunNodeStatus> = {};
  for (const node of graph.nodes) {
    const status = view.statusByKey.get(toRunNodeKey(scopePath, node.id));
    if (status !== undefined) statuses[node.id] = status;
  }
  return findRunFrontier(graph, state, statuses, nodeId).map((id) => toRunNodeKey(scopePath, id));
}

/**
 * 하위 범위 잠김 — 그 범위와 바깥 하위 범위 중 하나라도 호스트가 대기·건너뜀이거나 닫혔으면(고정된 범위의 closed,
 * 고정 전이면 호스트를 바로 완료함) 그 안은 읽기 전용이다(서버 `_assert_hosts_reachable`이 사슬 전체를 보는 것과 같은 판정).
 * 닫힌 바깥 범위 안에서 끝난 손자 맵은 닫히지 않은 채 남으므로 바로 위 범위만 보면 완료 취소가 열려 보였다.
 * 범위 경로는 바깥에서 호스트의 노드 키다.
 */
export function getRunScopeLock(
  detail: RunDetail,
  view: RunView,
  scopePath: string,
): { parentBlocked: boolean; scopeClosed: boolean } {
  let parentBlocked = false;
  let scopeClosed = false;
  for (const hostKey of getRunScopeHostKeys(scopePath)) {
    const hostStatus = view.statusByKey.get(hostKey);
    const pinned = detail.scopes.find((scope) => scope.scope_path === hostKey);
    const isClosed = pinned ? pinned.closed : hostStatus === "done";
    scopeClosed ||= isClosed;
    parentBlocked ||= isClosed || hostStatus === "waiting" || hostStatus === "skipped";
  }
  return { parentBlocked, scopeClosed };
}

/** 범위 경로의 바깥 호스트 노드 키(바깥부터) — "h1/h2" → ["h1", "h1/h2"]. 펼치지 않은 하위 범위 노드로 갈 때 펼칠 호스트들. */
export function getRunScopeHostKeys(scopePath: string): string[] {
  if (scopePath === "") return [];
  const parts = scopePath.split(EMBED_SEP);
  return parts.map((_, index) => parts.slice(0, index + 1).join(EMBED_SEP));
}

// 버튼 줄·팝오버 표면 — 이 안의 키는 버튼 줄이 맡고 캔버스 키(Tab 흐름 이동·Esc 단계 닫기)는 손대지 않는다(R31)
const RUN_BAR_SURFACES = '[data-id="run-action-bar"], [data-id="run-pop"], [data-id="run-pop-cascade"]';
// 자기 키를 가진 곳 — 입력 칸·대화창·메뉴·목록(그리고 버튼 줄·팝오버)에서 누른 Esc/Enter는 그쪽 몫이다
const KEY_OWNERS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], ' +
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], ' +
  RUN_BAR_SURFACES;
// Enter를 스스로 받는 것 — 캔버스 크롬 버튼(줌·범례 등)에서 누른 Enter는 그 버튼을 누른다
const ENTER_OWNERS = 'button, a[href], [role="button"]';

export function isInRunBarSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(RUN_BAR_SURFACES) !== null;
}

/**
 * 캔버스에서 누른 키인지 — 문서 본문(빈 곳을 눌러 포커스가 풀린 상태)이거나 캔버스(.react-flow) 안에서 키를 따로 갖지 않는 곳.
 * 실행 모드의 Esc 단계 닫기가 이때만 움직인다(실행 바 ⋯ 메뉴·대화창·입력 칸·버튼 줄은 각자 Esc를 맡는다).
 */
export function isRunCanvasKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const doc = target.ownerDocument;
  if (target === doc.body || target === doc.documentElement) return true;
  return target.closest(".react-flow") !== null && target.closest(KEY_OWNERS) === null;
}

/** 캔버스의 Enter(선택한 노드의 버튼 줄로 들어가기)를 받을 곳 — 위와 같되 버튼·링크에서 누른 Enter는 그 버튼 몫이다. */
export function isRunCanvasEnterTarget(target: EventTarget | null): boolean {
  return isRunCanvasKeyTarget(target) && !(target instanceof Element && target.closest(ENTER_OWNERS) !== null);
}

/**
 * 눌러 둔 Enter·Space의 자동 반복인지 — 버튼 줄은 이 키다운을 막아(preventDefault) 반복이 버튼을 다시 누르지 않게 하고,
 * 캔버스의 Enter(버튼 줄로 들어가기)도 반복이면 무시한다. 막지 않으면 Enter를 누르고 있는 동안 완료 → 다음 단계 선택 →
 * 그 버튼 줄 첫 버튼(완료) → 완료가 이어져 여러 단계가 한 번에 끝났다.
 */
export function isRunKeyAutoRepeat(event: Pick<KeyboardEvent, "key" | "repeat">): boolean {
  return event.repeat && (event.key === "Enter" || event.key === " ");
}

/** 하위프로세스 노드의 하위 맵(그 아래 하위 맵 포함)에 기록이 있는지 — 있으면 취소 전에 확인을 받는다(R5). */
export function hasRunChildProgress(detail: RunDetail, hostKey: string): boolean {
  const prefix = hostKey + EMBED_SEP;
  return detail.states.some((row) => row.scope_path === hostKey || row.scope_path.startsWith(prefix));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** 버튼 줄 자리(화면 px) — 노드 위 가운데, 위 여백이 모자라면 노드 아래. 가로는 캔버스 안으로 당긴다. */
export function placeRunBar(node: RunRect, bar: RunSize, pane: RunSize): RunBarPlacement {
  const left = clamp(node.left + node.width / 2 - bar.width / 2, EDGE_MARGIN, pane.width - bar.width - EDGE_MARGIN);
  const above = node.top - bar.height - BAR_GAP;
  if (above >= BAR_MIN_TOP) return { left, top: above, below: false };
  return { left, top: node.top + node.height + BAR_GAP, below: true };
}

/**
 * 팝오버 자리(화면 px) — 노드 아래(버튼 줄이 아래면 그 밑) → 노드 오른쪽 → 왼쪽 → 버튼 줄 위. 갈 곳 노드를 덮지 않게
 * 옆자리를 위보다 먼저 쓴다(목업 placeBar()).
 */
export function placeRunPop(
  node: RunRect,
  bar: RunBarPlacement,
  barSize: RunSize,
  pop: RunSize,
  pane: RunSize,
): { left: number; top: number } {
  const left = clamp(node.left + node.width / 2 - pop.width / 2, EDGE_MARGIN, pane.width - pop.width - EDGE_MARGIN);
  const top = bar.below ? bar.top + barSize.height + POP_BAR_GAP : node.top + node.height + POP_NODE_GAP;
  if (top + pop.height <= pane.height - POP_EDGE_MARGIN) return { left, top };
  const sideTop = clamp(
    node.top + node.height / 2 - pop.height / 2,
    POP_EDGE_MARGIN,
    pane.height - pop.height - POP_EDGE_MARGIN,
  );
  const right = node.left + node.width + POP_SIDE_GAP;
  if (right + pop.width <= pane.width - EDGE_MARGIN) return { left: right, top: sideTop };
  const leftSide = node.left - POP_SIDE_GAP - pop.width;
  if (leftSide >= EDGE_MARGIN) return { left: leftSide, top: sideTop };
  return { left, top: Math.max(POP_EDGE_MARGIN, bar.top - pop.height - POP_BAR_GAP) };
}

// ── 키보드 이동(실행 모드 캔버스) ──

export type RunArrowDirection = "left" | "right" | "up" | "down";

export const RUN_ARROW_KEYS: Readonly<Record<string, RunArrowDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** 화면에 그려진 실행 노드 하나의 자리(플로우 좌표, 좌상단 + 크기). */
export interface RunNodeBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 옆으로 어긋난 정도에 주는 가중치 — 클수록 "그 방향 똑바로"의 노드를 먼 노드보다 먼저 고른다
const ARROW_CROSS_WEIGHT = 2;
// 진행 거리의 이 배수보다 옆으로 더 어긋난 노드는 그 방향으로 치지 않는다(약 63도) — 같은 줄의 키 차이(몇 px)로
// ↓를 눌렀는데 멀리 옆 노드로 튀지 않게
const ARROW_CONE = 2;

/**
 * 방향키로 고를 이웃 노드 — 현재 노드 가운데에서 그 방향 부채꼴 안의 노드 중 (진행 거리 + 옆 어긋남×2)가 가장 작은 것.
 * 같으면 가로 이동은 위쪽, 세로 이동은 왼쪽을 먼저. 그 방향에 노드가 없으면 null.
 */
export function findRunNodeInDirection(
  boxes: readonly RunNodeBox[],
  fromKey: string,
  direction: RunArrowDirection,
): string | null {
  const from = boxes.find((box) => box.key === fromKey);
  if (!from) return null;
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  let best: { key: string; score: number; tie: number } | null = null;
  for (const box of boxes) {
    if (box.key === fromKey) continue;
    const dx = box.x + box.width / 2 - cx;
    const dy = box.y + box.height / 2 - cy;
    const main = (horizontal ? dx : dy) * sign;
    const cross = Math.abs(horizontal ? dy : dx);
    if (main <= 1 || cross > main * ARROW_CONE) continue;
    const score = main + cross * ARROW_CROSS_WEIGHT;
    const tie = horizontal ? dy : dx;
    if (best === null || score < best.score || (score === best.score && tie < best.tie)) {
      best = { key: box.key, score, tie };
    }
  }
  return best?.key ?? null;
}

/** 실행 흐름 순서의 노드 키 — 범위마다 위상 순서이고, 그래프가 실린 하위 범위의 노드는 그 호스트 바로 뒤에 끼운다. */
export function listRunFlowKeys(graphs: ReadonlyMap<string, RunGraph>): string[] {
  const keys: string[] = [];
  const visit = (scopePath: string) => {
    const graph = graphs.get(scopePath);
    if (!graph) return;
    for (const nodeId of getRunTopoOrder(graph)) {
      const key = toRunNodeKey(scopePath, nodeId);
      keys.push(key);
      visit(key); // 하위프로세스 노드 키 = 그 하위 범위 경로
    }
  };
  visit("");
  return keys;
}

const TODO_STATUSES: ReadonlySet<RunNodeStatus> = new Set(["active", "problem", "ready"]);

/**
 * 지금 손댈 단계(진행 중·문제·시작 가능) 중 현재 키 다음 것 — 흐름 순서로 돌아 감는다(reverse면 이전 것).
 * 현재 키가 없거나 순서에 없으면 처음(reverse면 마지막) 할 단계. 할 단계가 없으면 null.
 */
export function findNextRunTodoKey(
  order: readonly string[],
  statusByKey: ReadonlyMap<string, RunNodeStatus>,
  currentKey: string | null,
  reverse: boolean,
): string | null {
  const todo = order.filter((key) => TODO_STATUSES.has(statusByKey.get(key) ?? "waiting"));
  if (todo.length === 0) return null;
  const at = currentKey === null ? -1 : order.indexOf(currentKey);
  if (at < 0) return reverse ? todo[todo.length - 1] : todo[0];
  const rank = new Map(order.map((key, index) => [key, index]));
  if (reverse) {
    const before = todo.filter((key) => (rank.get(key) ?? 0) < at);
    return before.length > 0 ? before[before.length - 1] : todo[todo.length - 1];
  }
  return todo.find((key) => (rank.get(key) ?? 0) > at) ?? todo[0];
}

/** 하위 범위가 끝났는지(그 범위 바로 아래 노드가 전부 완료·건너뜀) — 호스트가 여전히 안 끝났으면 갈래를 골라야 한다. */
export function isRunScopeAllDone(statusByKey: ReadonlyMap<string, RunNodeStatus>, scopePath: string): boolean {
  let seen = false;
  for (const [key, status] of statusByKey) {
    if (splitRunNodeKey(key).scopePath !== scopePath) continue;
    seen = true;
    if (status !== "done" && status !== "skipped") return false;
  }
  return seen;
}
