"use client";

// 실행 모드 노드 버튼 줄 — 맵 화면(page.tsx) 실행 모드 전용. 선택한 노드 위(자리가 없으면 아래)에 그 상태에서 할 수 있는
// 동작만 한 줄로 띄우고(모달 없음), 먼저 끝낼 단계·문제 메모·코멘트·하위 맵 기록 취소 확인을 작은 팝오버로 연다
// (design run-check §4.3, 목업 buildBarHtml·buildPopHtml·placeBar). NodeActionBar처럼 ViewportPortal 안에서 선택 노드
// 위치를 store로 읽되, 줌과 무관하게 화면 크기 그대로 보이게 1/zoom으로 되돌린다. 팝오버·선택·반짝임은 맵 화면이 들고
// (Esc·빈 캔버스로 닫기, 먼저 끝낼 단계 점선 data.runHint) 여기서는 콜백으로만 바꾼다. 버튼 계산은 lib/run-actions.

import { useStore, useStoreApi, type ReactFlowState } from "@xyflow/react";
import { AlertCircle, ArrowRight, Check, ChevronsDownUp, LogIn, MessageCircle, Play, Undo2, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { addRunComment, listRunComments, type RunActionName, type RunComment, type RunDetail } from "@/lib/api";
import type { NodeData } from "@/lib/canvas";
import { formatKstShort } from "@/lib/datetime";
import { useDirectoryState } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { useNodeActions } from "@/lib/node-actions";
import {
  buildRunBarButtons,
  findRunBlockerKeys,
  getBranchLabel,
  getExitLabels,
  getRunScopeLock,
  hasRunChildProgress,
  isRunCanvasEnterTarget,
  isRunKeyAutoRepeat,
  pickAutoAdvance,
  placeRunBar,
  placeRunPop,
  type RunBarButton,
  type RunBarPlacement,
  type RunBarTone,
  type RunPop,
  type RunRect,
  type RunSize,
} from "@/lib/run-actions";
import { findOpenedNodeIds, getBranchOptions, type RunGraph, type RunNodeStatus } from "@/lib/run-graph";
import { buildRunView, humanizeRunError, splitRunNodeKey, type RunView } from "@/lib/run-view";
import type { SubEnd } from "@/lib/subprocess-embed";
import type { RunSession } from "@/lib/use-run-session";

// 캔버스 플로팅 크롬 단(오버레이 z 사다리 1100) — 선택 노드(1000/1001) 위
const RUN_BAR_Z = 1100;
// 코멘트·문제 메모 길이 상한 — BE RunCommentIn max_length와 같다
const RUN_COMMENT_MAX = 2000;
const NO_ENDS: readonly SubEnd[] = [];

type ToastFn = (msg: string, tone?: "error") => void;
type ActionButton = Extract<RunBarButton, { kind: "action" }>;

export interface RunActionBarProps {
  session: RunSession;
  view: RunView;
  // 범위 경로 → 그 범위 실행 그래프(맵 화면 합성 트리에서 나눈 것, lib/run-view splitRunScopeGraphs)
  graphs: ReadonlyMap<string, RunGraph>;
  selectedKey: string | null;
  pop: RunPop | null;
  onPopChange: (pop: RunPop | null) => void;
  onSelect: (key: string, opts: { flash: boolean; reveal: boolean }) => void;
  // 제자리에서 반짝일 노드들 — 병렬로 여러 단계가 열렸을 때
  onFlash: (keys: string[]) => void;
  // 하위 맵 펼치기·접기(펼칠 때 그 범위 그래프를 실행 기준으로 받는다)
  onEnterSubprocess: (key: string) => void;
  onToast: ToastFn;
}

interface NodeGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  // 캔버스에 보이는 이름 — 하위프로세스는 저장 제목이 아니라 연결된 맵의 지금 이름이다
  label: string;
  subEnds: readonly SubEnd[];
  // 하위 맵을 펼칠 수 있는 하위프로세스 — NodeActionBar 펼침 게이트와 같다(끝 있음·잠김·지정 해제 아님)
  expandable: boolean;
}

interface Viewport {
  tx: number;
  ty: number;
  zoom: number;
}

function readNodeGeom(lookup: ReactFlowState["nodeLookup"], key: string | null): NodeGeom | null {
  if (key === null) return null;
  const node = lookup.get(key);
  if (!node || node.hidden) return null;
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  if (!w || !h) return null;
  const data = node.data as NodeData;
  const subEnds = data.subEnds ?? NO_ENDS;
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    w,
    h,
    label: data.label,
    subEnds,
    expandable: data.nodeType === "subprocess" && subEnds.length > 0 && !data.locked && !data.undesignated,
  };
}

function isSameGeom(a: NodeGeom | null, b: NodeGeom | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.label === b.label &&
    a.subEnds === b.subEnds &&
    a.expandable === b.expandable
  );
}

function readNodeLabel(lookup: ReactFlowState["nodeLookup"], key: string): string {
  const data = lookup.get(key)?.data as NodeData | undefined;
  return data?.label ?? "";
}

/** 화면 px 자리 → ViewportPortal(흐름 좌표) 안의 transform — 1/zoom으로 되돌려 줌과 무관하게 같은 크기로 보인다. */
function toFlowTransform(left: number, top: number, viewport: Viewport): string {
  const { tx, ty, zoom } = viewport;
  return `translate(${(left - tx) / zoom}px, ${(top - ty) / zoom}px) scale(${1 / zoom})`;
}

/** 요소의 화면 크기(변환 전 레이아웃 px) — 처음 잴 때까지 null이라 그동안은 보이지 않게 둔다. */
function useElementSize(ref: RefObject<HTMLElement | null>): RunSize | null {
  const [size, setSize] = useState<RunSize | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function RunActionBar(props: RunActionBarProps) {
  const { selectedKey, view } = props;
  const geom = useStore((s) => readNodeGeom(s.nodeLookup, selectedKey), isSameGeom);
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const paneWidth = useStore((s) => s.width);
  const paneHeight = useStore((s) => s.height);
  if (selectedKey === null || geom === null) return null;
  const status = view.statusByKey.get(selectedKey);
  // 실행 그래프에 없는 노드(펼침 게이트웨이·Ctrl 고스트 등)는 버튼 줄이 없다
  if (status === undefined) return null;
  const { scopePath, nodeId } = splitRunNodeKey(selectedKey);
  const graph = props.graphs.get(scopePath);
  const graphNode = graph?.nodes.find((node) => node.id === nodeId);
  if (!graph || !graphNode) return null;
  const nodeRect: RunRect = { left: geom.x * zoom + tx, top: geom.y * zoom + ty, width: geom.w * zoom, height: geom.h * zoom };
  return (
    <RunActionBarBody
      key={selectedKey}
      {...props}
      nodeKey={selectedKey}
      scopePath={scopePath}
      nodeId={nodeId}
      graph={graph}
      nodeType={graphNode.nodeType}
      status={status}
      geom={geom}
      nodeRect={nodeRect}
      pane={{ width: paneWidth, height: paneHeight }}
      viewport={{ tx, ty, zoom }}
    />
  );
}

interface BodyProps extends RunActionBarProps {
  nodeKey: string;
  scopePath: string;
  nodeId: string;
  graph: RunGraph;
  nodeType: string;
  status: RunNodeStatus;
  geom: NodeGeom;
  nodeRect: RunRect;
  pane: RunSize;
  viewport: Viewport;
}

const ACTION_LABEL: Record<RunActionName, MessageKey> = {
  complete: "run.act.complete",
  start: "run.act.start",
  problem: "run.act.problem",
  resolve: "run.act.resolve",
  unstart: "run.act.unstart",
  undo: "run.act.undo",
};

const ACTION_ICON: Record<RunActionName, LucideIcon> = {
  complete: Check,
  start: Play,
  problem: AlertCircle,
  resolve: Check,
  unstart: Undo2,
  undo: Undo2,
};

const TONE_CLASS: Record<RunBarTone, string> = {
  go: "bg-run-done font-semibold text-on-accent hover:bg-run-done/85",
  branch: "bg-accent font-semibold text-on-accent hover:bg-accent-focus",
  bad: "text-run-problem hover:bg-run-problem-fill",
  quiet: "text-ink-tertiary hover:bg-surface-alt",
  default: "text-ink hover:bg-surface-alt",
};

const BUTTON_BASE =
  "inline-flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-caption " +
  "transition-colors duration-150 disabled:cursor-wait disabled:opacity-60";

function getActionDataId(button: ActionButton): string {
  if (button.edgeId !== undefined) return `run-act-branch-${button.edgeId}`;
  if (button.exitKey !== undefined) return `run-act-exit-${button.exitKey}`;
  return `run-act-${button.action}`;
}

/** 노드 이름 — 캔버스에 보이는 이름이 먼저(하위프로세스는 연결된 맵의 지금 이름), 없으면 실행 그래프의 저장 제목. */
function getRunNodeTitle(graphs: ReadonlyMap<string, RunGraph>, key: string, label: string): string {
  if (label.trim()) return label;
  const { scopePath, nodeId } = splitRunNodeKey(key);
  return graphs.get(scopePath)?.nodes.find((node) => node.id === nodeId)?.title ?? "";
}

function RunActionBarBody({
  session,
  view,
  graphs,
  pop,
  onPopChange,
  onSelect,
  onFlash,
  onEnterSubprocess,
  onToast,
  nodeKey,
  scopePath,
  nodeId,
  graph,
  nodeType,
  status,
  geom,
  nodeRect,
  pane,
  viewport,
}: BodyProps) {
  const { t } = useI18n();
  const { expandedInlineIds } = useNodeActions();
  const storeApi = useStoreApi();
  const [busy, setBusy] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const barSize = useElementSize(barRef);
  // 팝오버를 닫고 포커스를 버튼으로 돌리는 동안 — 꺼진 완료가 그 포커스로 팝오버를 다시 열지 않게 잠깐 막는다
  const quietFocusRef = useRef(false);
  const { detail } = session;

  // 캔버스에서 Enter — 선택한 노드의 버튼 줄 첫 버튼으로 들어온다(R31). 다른 노드에 포커스가 있으면 React Flow가 그 노드를 고른다
  useEffect(() => {
    const handleEnter = (event: KeyboardEvent) => {
      // 눌러 둔 Enter의 반복은 버튼 줄로 다시 들어가지 않는다 — 다음 단계의 완료까지 이어 눌렀다
      if (event.key !== "Enter" || event.repeat || event.defaultPrevented || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!isRunCanvasEnterTarget(event.target)) return;
      const focusedNode = event.target instanceof Element ? event.target.closest(".react-flow__node") : null;
      if (focusedNode !== null && focusedNode.getAttribute("data-id") !== nodeKey) return;
      const first = barRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])");
      if (!first) return;
      event.preventDefault();
      first.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", handleEnter);
    return () => window.removeEventListener("keydown", handleEnter);
  }, [nodeKey]);

  const openPop = pop !== null && pop.key === nodeKey ? pop : null;
  const options = getBranchOptions(graph, nodeId);
  const branchLabels = Object.fromEntries(
    graph.edges.filter((edge) => edge.source === nodeId).map((edge) => [edge.id, getBranchLabel(edge, graph)]),
  );
  const endTitleByKey = Object.fromEntries(geom.subEnds.map((end) => [end.key, end.title]));
  const exitLabels = options.kind === "exit" ? getExitLabels(graph, nodeId, options.exitKeys, endTitleByKey) : {};
  const lock = getRunScopeLock(detail, view, scopePath);
  const commentCount =
    detail.comment_counts.find((row) => row.scope_path === scopePath && row.node_id === nodeId)?.count ?? 0;
  const buttons = buildRunBarButtons({
    status,
    nodeType,
    options,
    branchLabels,
    exitLabels,
    runOpen: detail.status === "open",
    canAct: detail.can_act,
    commentCount,
    parentBlocked: lock.parentBlocked,
    scopeClosed: lock.scopeClosed,
    // 잠긴·지정 해제된 하위프로세스는 펼칠 수 없어 들어가기를 뺀다(캔버스 펼침 게이트와 같다)
  }).filter((button) => button.kind !== "enter" || geom.expandable);

  const openCascade = (action: "unstart" | "undo") => onPopChange({ key: nodeKey, kind: "cascade", action });

  // 동작 하나 — 서버 응답으로 실행 상세가 바뀐 뒤 완료면 이어 밟기(하나 열리면 그 노드로, 여럿이면 제자리 반짝임)
  const runAct = async (button: ActionButton, cascade = false): Promise<void> => {
    if (busy) return;
    const { action } = button;
    const isClear = action === "unstart" || action === "undo";
    // 하위 맵 기록이 있는 하위프로세스 취소 — 보이는 기록으로 먼저 묻는다(못 보는 하위 범위는 서버 409가 같은 확인을 띄운다)
    if (isClear && !cascade && nodeType === "subprocess" && hasRunChildProgress(detail, nodeKey)) {
      openCascade(action);
      return;
    }
    const before = Object.fromEntries(view.statusByKey);
    setBusy(true);
    const next = await session.act(
      { scopePath, nodeId, action, edgeId: button.edgeId, exitKey: button.exitKey, cascade: cascade || undefined },
      isClear ? { onNeedsCascade: () => openCascade(action) } : undefined,
    );
    setBusy(false);
    if (next === null) return;
    if (action === "problem") {
      onPopChange({ key: nodeKey, kind: "note" });
      return;
    }
    if (openPop !== null) onPopChange(null);
    if (action === "complete") advanceAfterComplete(before, next);
  };

  const advanceAfterComplete = (before: Record<string, RunNodeStatus>, next: RunDetail) => {
    const after = buildRunView(next, graphs).statusByKey;
    // 하위 맵 끝에 닿아 바깥 하위프로세스가 자동 완료됐으면 알린다(목업 syncSubprocess)
    if (scopePath !== "" && before[scopePath] !== "done" && after.get(scopePath) === "done") {
      const hostLabel = readNodeLabel(storeApi.getState().nodeLookup, scopePath);
      onToast(t("run.act.hostDone", { title: getRunNodeTitle(graphs, scopePath, hostLabel) }));
    }
    const advance = pickAutoAdvance(findOpenedNodeIds(before, Object.fromEntries(after)));
    if (advance.select !== null) {
      onSelect(advance.select, { flash: true, reveal: true });
    } else if (advance.flash.length > 0) {
      onFlash(advance.flash);
      onToast(t("run.act.opened", { n: advance.flash.length }));
    }
  };

  const openWhy = () => {
    if (quietFocusRef.current) return;
    if (openPop?.kind !== "why") onPopChange({ key: nodeKey, kind: "why" });
  };

  // 버튼 줄의 버튼에 포커스 — 그 data-id가 없으면 첫 버튼
  const focusBarButton = (dataId: string | null) => {
    const bar = barRef.current;
    const named = dataId === null ? null : bar?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(dataId)}"]`);
    const target = named ?? bar?.querySelector<HTMLButtonElement>("button:not([disabled])");
    if (!target) return;
    quietFocusRef.current = true;
    target.focus({ preventScroll: true });
    quietFocusRef.current = false;
  };

  // 팝오버 안 Esc — 닫고 그 팝오버를 연 버튼으로 포커스를 돌린다(R31). 문제 메모는 문제 버튼이 사라져 첫 버튼으로
  const handlePopKeyDown = (event: ReactKeyboardEvent) => {
    if (isRunKeyAutoRepeat(event)) {
      event.preventDefault(); // 눌러 둔 키의 반복이 팝오버 버튼(하위 맵 기록 취소 확인 등)을 다시 누르지 않게
      return;
    }
    if (event.key !== "Escape" || openPop === null) return;
    event.preventDefault();
    const returnTo =
      openPop.kind === "cascade" ? `run-act-${openPop.action}` : openPop.kind === "note" ? null : `run-act-${openPop.kind}`;
    onPopChange(null);
    focusBarButton(returnTo);
  };

  // 버튼 줄 위 Esc — 열린 팝오버가 있으면 닫고, 없으면 포커스를 캔버스의 그 노드로 돌린다(선택은 그대로, R31).
  // 눌러 둔 Enter·Space의 반복은 막는다 — 버튼의 기본 동작(누르기)이 반복마다 일어나 단계가 이어 완료됐다
  const handleBarKeyDown = (event: ReactKeyboardEvent) => {
    if (isRunKeyAutoRepeat(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (openPop !== null) {
      onPopChange(null);
      return;
    }
    const nodeElement = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeKey)}"]`);
    if (nodeElement) nodeElement.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  // 꺼진 완료에서 Tab — 열린 "먼저 끝내야 할 단계"의 첫 줄로 바로 들어간다
  const handleWhyKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Tab" || event.shiftKey || openPop?.kind !== "why") return;
    const first = popRef.current?.querySelector<HTMLButtonElement>("button");
    if (!first) return;
    event.preventDefault();
    first.focus({ preventScroll: true });
  };

  const renderButton = (button: RunBarButton, index: number): ReactNode => {
    switch (button.kind) {
      case "action": {
        const Icon = button.edgeId === undefined && button.exitKey === undefined ? ACTION_ICON[button.action] : null;
        const label = button.label || t(ACTION_LABEL[button.action]);
        return (
          <button
            key={getActionDataId(button)}
            type="button"
            data-id={getActionDataId(button)}
            disabled={busy}
            title={button.label ? label : undefined}
            className={`${BUTTON_BASE} ${TONE_CLASS[button.tone]}`}
            onClick={() => void runAct(button)}
          >
            {Icon && <Icon size={16} strokeWidth={1.5} className="shrink-0" />}
            <span className="min-w-0 truncate">{label}</span>
          </button>
        );
      }
      case "why":
        // 꺼진 완료 — aria-disabled라 올려 두기·포커스·누르기는 받아서 먼저 끝낼 단계를 보여 준다
        return (
          <button
            key="why"
            type="button"
            data-id="run-act-why"
            aria-disabled="true"
            aria-expanded={openPop?.kind === "why"}
            className={`${BUTTON_BASE} cursor-not-allowed bg-surface-alt text-ink-muted`}
            onMouseEnter={openWhy}
            onFocus={openWhy}
            onClick={openWhy}
            onKeyDown={handleWhyKeyDown}
          >
            <Check size={16} strokeWidth={1.5} className="shrink-0" />
            {t("run.act.complete")}
          </button>
        );
      case "enter": {
        const expanded = expandedInlineIds.has(nodeKey);
        const labelKey: MessageKey = expanded ? "run.act.collapse" : status === "done" ? "run.act.enterDone" : "run.act.enter";
        const Icon = expanded ? ChevronsDownUp : LogIn;
        return (
          <button
            key="enter"
            type="button"
            data-id="run-act-enter"
            aria-expanded={expanded}
            className={`${BUTTON_BASE} ${TONE_CLASS.default}`}
            onClick={() => onEnterSubprocess(nodeKey)}
          >
            <Icon size={16} strokeWidth={1.5} className="shrink-0" />
            {t(labelKey)}
          </button>
        );
      }
      case "comments": {
        const isOpen = openPop?.kind === "comments";
        return (
          <span key="comments" className="contents">
            {index > 0 && <span aria-hidden className="mx-0.5 w-px self-stretch bg-hairline" />}
            <button
              type="button"
              data-id="run-act-comments"
              aria-label={t("run.act.comments", { n: button.count })}
              aria-expanded={isOpen}
              className={`${BUTTON_BASE} ${TONE_CLASS.quiet}`}
              onClick={() => onPopChange(isOpen ? null : { key: nodeKey, kind: "comments" })}
            >
              <MessageCircle size={16} strokeWidth={1.5} className="shrink-0" />
              {button.count > 0 && <span className="tabular-nums text-fine">{button.count}</span>}
            </button>
          </span>
        );
      }
      case "note":
        return (
          <span key="note" data-id="run-act-note" className="whitespace-nowrap px-2 text-fine text-ink-tertiary">
            {t(button.messageKey)}
          </span>
        );
    }
  };

  const barPlace = barSize !== null ? placeRunBar(nodeRect, barSize, pane) : null;
  const stateRow = detail.states.find((row) => row.scope_path === scopePath && row.node_id === nodeId) ?? null;
  const title = getRunNodeTitle(graphs, nodeKey, geom.label);

  return (
    <>
      <div
        ref={barRef}
        className="nopan nodrag nowheel absolute left-0 top-0 w-max"
        style={placedStyle(barPlace, viewport)}
      >
        <div
          role="toolbar"
          aria-label={t("run.act.toolbar")}
          data-id="run-action-bar"
          data-node={nodeKey}
          data-status={status}
          className="glass glass-dense bpm-run-pop-in flex items-center gap-0.5 rounded-md border p-1"
          onKeyDown={handleBarKeyDown}
        >
          {buttons.map(renderButton)}
        </div>
      </div>
      {openPop !== null && barPlace !== null && barSize !== null && (
        <RunPopFrame
          key={openPop.kind}
          contentRef={popRef}
          onKeyDown={handlePopKeyDown}
          kind={openPop.kind}
          nodeRect={nodeRect}
          barPlace={barPlace}
          barSize={barSize}
          pane={pane}
          viewport={viewport}
        >
          {openPop.kind === "why" && (
            <WhyPop
              keys={findRunBlockerKeys(detail, graphs, view, nodeKey)}
              view={view}
              graphs={graphs}
              onSelect={onSelect}
            />
          )}
          {openPop.kind === "note" && (
            <NotePop
              runId={detail.id}
              scopePath={scopePath}
              nodeId={nodeId}
              title={title}
              isSolo={detail.scope === "solo"}
              session={session}
              onClose={() => onPopChange(null)}
              onToast={onToast}
            />
          )}
          {openPop.kind === "comments" && (
            <CommentsPop
              runId={detail.id}
              scopePath={scopePath}
              nodeId={nodeId}
              title={title}
              isSolo={detail.scope === "solo"}
              status={status}
              stateRow={stateRow}
              canWrite={detail.can_act}
              session={session}
              onToast={onToast}
            />
          )}
          {openPop.kind === "cascade" && (
            <CascadePop
              busy={busy}
              onCancel={() => onPopChange(null)}
              onConfirm={() => void runAct({ kind: "action", action: openPop.action, label: "", tone: "quiet" }, true)}
            />
          )}
        </RunPopFrame>
      )}
    </>
  );
}

/** 잴 때까지는 투명·클릭 불가(포커스는 받는다 — 메모 칸이 열리자마자 입력을 받게), 자리가 나오면 화면 크기 그대로 붙인다. */
function placedStyle(place: { left: number; top: number } | null, viewport: Viewport): CSSProperties {
  return {
    transform: place ? toFlowTransform(place.left, place.top, viewport) : undefined,
    transformOrigin: "0 0",
    opacity: place ? 1 : 0,
    pointerEvents: place ? "auto" : "none",
    zIndex: RUN_BAR_Z,
  };
}

const POP_LABEL: Record<RunPop["kind"], MessageKey> = {
  why: "run.pop.whyTitle",
  note: "run.pop.noteLabel",
  comments: "run.pop.commentLabel",
  cascade: "run.cascade.title",
};

function RunPopFrame({
  kind,
  contentRef,
  onKeyDown,
  nodeRect,
  barPlace,
  barSize,
  pane,
  viewport,
  children,
}: {
  kind: RunPop["kind"];
  // 팝오버 본문 — 버튼 줄이 Tab으로 첫 줄에 들어갈 때 쓴다
  contentRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: ReactKeyboardEvent) => void;
  nodeRect: RunRect;
  barPlace: RunBarPlacement;
  barSize: RunSize;
  pane: RunSize;
  viewport: Viewport;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(frameRef);
  const place = size !== null ? placeRunPop(nodeRect, barPlace, barSize, size, pane) : null;
  return (
    <div ref={frameRef} className="nopan nodrag nowheel absolute left-0 top-0 w-[300px]" style={placedStyle(place, viewport)}>
      <div
        ref={contentRef}
        data-id={kind === "cascade" ? "run-pop-cascade" : "run-pop"}
        data-kind={kind}
        role={kind === "cascade" ? "alertdialog" : "dialog"}
        aria-label={t(POP_LABEL[kind])}
        onKeyDown={onKeyDown}
        className="glass glass-dense bpm-run-pop-in flex flex-col gap-2 rounded-md border p-3 text-caption"
      >
        {children}
      </div>
    </div>
  );
}

// 상태 이름 필 — 상태 색(globals.css --color-run-*)의 옅은 채움·테두리
const PILL_COLOR: Record<RunNodeStatus, string> = {
  waiting: "var(--color-run-wait-ink)",
  ready: "var(--color-accent)",
  active: "var(--color-accent)",
  done: "var(--color-run-done)",
  problem: "var(--color-run-problem)",
  skipped: "var(--color-run-skip-ink)",
};

function RunStatusPill({ status }: { status: RunNodeStatus }) {
  const { t } = useI18n();
  const color = PILL_COLOR[status];
  return (
    <span
      data-run-status={status}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-fine font-semibold leading-5"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, white)`,
        borderColor: `color-mix(in srgb, ${color} 35%, white)`,
      }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {t(`run.status.${status}`)}
    </span>
  );
}

function WhyPop({
  keys,
  view,
  graphs,
  onSelect,
}: {
  keys: string[];
  view: RunView;
  graphs: ReadonlyMap<string, RunGraph>;
  onSelect: RunActionBarProps["onSelect"];
}) {
  const { t } = useI18n();
  // 갈 곳 노드들의 캔버스 이름 — 한 문자열로 묶어 구독해야 바뀔 때만 다시 그린다(이름에 줄바꿈이 있을 수 있어 NUL로 묶는다)
  const labels = useStore((s) => keys.map((key) => readNodeLabel(s.nodeLookup, key)).join("\u0000")).split("\u0000");
  return (
    <>
      <h5 className="text-fine font-semibold text-ink-tertiary">{t("run.pop.whyTitle")}</h5>
      {keys.length === 0 ? (
        <span data-id="run-pop-why-empty" className="text-fine text-ink-tertiary">
          {t("run.pop.whyEmpty")}
        </span>
      ) : (
        keys.map((key, index) => {
          const status = view.statusByKey.get(key);
          return (
            <button
              key={key}
              type="button"
              data-id={`run-pop-goto-${key}`}
              className="flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-left text-ink transition-colors duration-150 hover:border-accent-tint-border hover:bg-accent-tint"
              onClick={() => onSelect(key, { flash: true, reveal: true })}
            >
              {status !== undefined && <RunStatusPill status={status} />}
              <span className="min-w-0 flex-1 truncate font-semibold">
                {getRunNodeTitle(graphs, key, labels[index] ?? "")}
              </span>
              <ArrowRight size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
            </button>
          );
        })
      )}
    </>
  );
}

/** 한 줄 입력 + 남기기 — Enter로 보낸다(한글 조합 중 제외). 열리자마자 입력을 받는다. onSend가 true면 칸을 비운다. */
function RunLineInput({
  dataId,
  label,
  placeholder,
  onSend,
  skip,
}: {
  dataId: string;
  label: string;
  placeholder: string;
  onSend: (body: string) => Promise<boolean>;
  skip?: { label: string; onSkip: () => void };
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 캔버스가 스크롤로 밀리지 않게 — 캔버스 래퍼는 overflow hidden이라 포커스가 내부 스크롤을 만들 수 있다
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  const send = async () => {
    const body = draft.trim();
    if (!body) {
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (sending) return;
    setSending(true);
    const ok = await onSend(body);
    setSending(false);
    if (ok) setDraft("");
  };
  return (
    <>
      <input
        ref={inputRef}
        type="text"
        data-id={`${dataId}-input`}
        aria-label={label}
        placeholder={placeholder}
        maxLength={RUN_COMMENT_MAX}
        autoComplete="off"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        className="w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink outline-none focus:border-accent"
      />
      <div className="flex justify-end gap-1.5">
        {skip && (
          <button
            type="button"
            data-id={`${dataId}-skip`}
            className="rounded-sm border border-hairline bg-surface px-2.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
            onClick={skip.onSkip}
          >
            {skip.label}
          </button>
        )}
        <button
          type="button"
          data-id={`${dataId}-submit`}
          disabled={sending || draft.trim() === ""}
          className="rounded-sm bg-accent px-2.5 py-1 text-fine font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
          onClick={() => void send()}
        >
          {t("run.pop.send")}
        </button>
      </div>
    </>
  );
}

interface CommentTarget {
  runId: number;
  scopePath: string;
  nodeId: string;
  title: string;
  // 개인 실행 — 알림 자체가 없으니(방치 알림만) "알림에 같이 간다"는 문구를 쓰지 않는다
  isSolo: boolean;
  session: RunSession;
  onToast: ToastFn;
}

// 문제를 표시한 직후의 한 줄 메모 — 공유 실행은 1분 안에 남긴 말을 서버가 그 문제 알림에 붙인다(design §4.5)
function NotePop({
  runId,
  scopePath,
  nodeId,
  title,
  isSolo,
  session,
  onToast,
  onClose,
}: CommentTarget & { onClose: () => void }) {
  const { t } = useI18n();
  const sendNote = async (body: string): Promise<boolean> => {
    try {
      await addRunComment(runId, { scope_path: scopePath, node_id: nodeId, body });
    } catch (err) {
      onToast(humanizeRunError(err, t), "error");
      return false;
    }
    onToast(t(isSolo ? "run.pop.noteSentSolo" : "run.pop.noteSent"));
    onClose();
    void session.reload(); // 말풍선 개수(comment_counts)
    return true;
  };
  return (
    <>
      <h5 className="text-fine font-semibold text-ink-tertiary">{t("run.pop.noteTitle", { title })}</h5>
      <RunLineInput
        dataId="run-pop-note"
        label={t("run.pop.noteLabel")}
        placeholder={t(isSolo ? "run.pop.notePlaceholderSolo" : "run.pop.notePlaceholder")}
        onSend={sendNote}
        skip={{ label: t("run.pop.noteSkip"), onSkip: onClose }}
      />
    </>
  );
}

// 코멘트 목록 + "누가 언제"(상태 행) + 한 줄 입력(상태를 바꿀 수 있는 사람만, 닫힌 실행은 읽기만)
function CommentsPop({
  runId,
  scopePath,
  nodeId,
  title,
  isSolo,
  status,
  stateRow,
  canWrite,
  session,
  onToast,
}: CommentTarget & {
  status: RunNodeStatus;
  stateRow: RunDetail["states"][number] | null;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const { users } = useDirectoryState();
  const [comments, setComments] = useState<RunComment[] | null>(null);
  const reportError = useEffectEvent((err: unknown) => onToast(humanizeRunError(err, t), "error"));
  useEffect(() => {
    let alive = true;
    listRunComments(runId, scopePath, nodeId)
      .then((rows) => {
        if (alive) setComments(rows);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setComments([]);
        reportError(err);
      });
    return () => {
      alive = false;
    };
  }, [runId, scopePath, nodeId]);
  const nameOf = (login: string) => users.get(login)?.name ?? login;
  const sendComment = async (body: string): Promise<boolean> => {
    try {
      const created = await addRunComment(runId, { scope_path: scopePath, node_id: nodeId, body });
      setComments((prev) => [...(prev ?? []), created]);
    } catch (err) {
      onToast(humanizeRunError(err, t), "error");
      return false;
    }
    onToast(t(isSolo ? "run.pop.commentSentSolo" : "run.pop.commentSent"));
    void session.reload(); // 말풍선 개수, 처음 남긴 코멘트가 고정한 하위 범위
    return true;
  };
  return (
    <>
      <h5 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-fine text-ink-tertiary">
        <span className="font-semibold text-ink">{title}</span>
        <RunStatusPill status={status} />
        <span data-id="run-pop-touched">
          {stateRow ? `${nameOf(stateRow.updated_by)} · ${formatKstShort(stateRow.updated_at)}` : t("run.pop.untouched")}
        </span>
      </h5>
      <div data-id="run-pop-comments" className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
        {comments === null ? (
          <span className="text-fine text-ink-tertiary">{t("run.pop.commentsLoading")}</span>
        ) : comments.length === 0 ? (
          <span data-id="run-pop-comments-empty" className="text-fine text-ink-tertiary">
            {t("run.pop.commentsEmpty")}
          </span>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} data-id={`run-pop-comment-${comment.id}`} className="rounded-sm bg-surface-alt px-2 py-1.5">
              <div className="flex gap-2 text-fine text-ink-tertiary">
                <span className="font-semibold text-ink">{nameOf(comment.author)}</span>
                <time dateTime={comment.created_at}>{formatKstShort(comment.created_at)}</time>
              </div>
              <p className="whitespace-pre-wrap break-words text-caption text-ink">{comment.body}</p>
            </div>
          ))
        )}
      </div>
      {canWrite && (
        <RunLineInput
          dataId="run-pop-comment"
          label={t("run.pop.commentLabel")}
          placeholder={t("run.pop.commentPlaceholder")}
          onSend={sendComment}
        />
      )}
    </>
  );
}

// 하위 맵 기록이 있는 하위프로세스의 시작 취소·완료 취소 확인(R5) — 확인하면 cascade로 다시 보낸다
function CascadePop({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <p className="font-semibold text-ink">{t("run.cascade.title")}</p>
      <p className="text-fine text-ink-secondary">{t("run.cascade.desc")}</p>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          data-id="run-pop-cascade-cancel"
          className="rounded-sm border border-hairline bg-surface px-2.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
          onClick={onCancel}
        >
          {t("run.cascade.cancel")}
        </button>
        <button
          type="button"
          data-id="run-pop-cascade-confirm"
          disabled={busy}
          className="rounded-sm bg-run-problem px-2.5 py-1 text-fine font-semibold text-on-accent hover:bg-run-problem/85 disabled:opacity-50"
          onClick={onConfirm}
        >
          {t("run.cascade.confirm")}
        </button>
      </div>
    </>
  );
}
