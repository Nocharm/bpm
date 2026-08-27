"use client";

// 좌측 메인 프리뷰 — 읽기전용 캔버스(워터마크·핸들 숨김) + 체크포인트 스택(좌상단)
// + 선택지 플로팅 창 오버레이 + 노드 호버 멘션 버튼 (design 2026-07-23 §6, 실사용 피드백 2차)

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { Node, NodeTypes } from "@xyflow/react";
import { CheckCheck, MessageSquarePlus, PenLine, Table2, Undo2, Workflow, X } from "lucide-react";
import "@xyflow/react/dist/style.css";

import {
  acceptSpSuggestion, completeInterview, getApiErrorDetail, getGraph, postInterviewRevert,
  saveGraph, type ChoiceOption, type InterviewState, type WorkingGraph,
} from "@/lib/api";
import { addedNodeKeys, getGraphSignature, layoutWorkingGraph, stagesForMode, highlightConnectedEdges } from "@/lib/interview";
import { PARAM_FIELDS, formatParamValue } from "@/lib/params";
import { buildGraphFromAiProposal } from "@/lib/csv-import";
import { EDGE_DEFAULTS } from "@/lib/canvas";
import { NodeActionsContext, type IoListDisplayState, type NodeActions } from "@/lib/node-actions";
import { ProcessNode } from "@/components/process-node";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChoiceOverlay } from "@/components/interview/choice-card";
import { InterviewOutline } from "@/components/interview/interview-outline";
import { MENTION_EVENT } from "@/components/interview/interview-panel";

const nodeTypes: NodeTypes = { process: ProcessNode };

// 체크포인트 프리뷰 중 신규 하이라이트 억제용 — 렌더마다 새 Set이면 재레이아웃이 돈다
const NO_ADDED = new Set<string>();
// 포커스 없음 — 렌더마다 새 Set이면 엣지 재계산이 돈다
const EMPTY_KEYS = new Set<string>();

// compare의 COMPARE_NODE_ACTIONS와 동일 — ProcessNode가 요구하는 읽기전용 context
const PREVIEW_NODE_ACTIONS: NodeActions = {
  onToggleExpand: null,
  expandedInlineIds: new Set<string>(),
  displayFields: ["params"],
  editingNodeId: null,
  onStartRename: null,
  onRename: null,
  onCancelRename: null,
  ctrlDragIds: new Set<string>(),
  onEditGmp: null,
  ioChecks: new Set<string>(),
  onToggleIoCheck: null,
  ioListStates: new Map<string, IoListDisplayState>(),
  onSetIoListState: null,
  ioCheckPulse: null,
  onHoverIoLink: null,
};

interface InterviewPreviewProps {
  interview: InterviewState | null;
  onUpdated: (state: InterviewState) => void;
  mapId: number;
  choices: ChoiceOption[] | null;
  // 낙관적 수락 그래프 — 서버 응답 전에 선택한 안을 즉시 표시 (수락 지연 체감 제거)
  optimisticGraph?: WorkingGraph | null;
  busy: boolean;
  onChoose: (choiceId: string) => void;
  // 그리기 이벤트(speed redesign §4) — 진행 오버레이·Draw map 버튼·에러 Retry·취소 탈출구
  drawBusy: false | "multi" | "single";
  drawError: string | null;
  onDraw: (variants: "multi" | "single") => void;
  onDrawRetry: () => void;
  onDrawClearError: () => void;
  onDrawCancel: () => void;
  // params 표 확정 — 수집분이 있으면 액션바에서 언제든 재오픈 (speed redesign 후속)
  paramsAvailable: boolean;
  onOpenParams: () => void;
}

// 오버레이 경과초 — 마운트 시점부터 카운트(드로잉 중에만 마운트되므로 리셋 자연 처리)
function DrawTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)), 500,
    );
    return () => window.clearInterval(timer);
  }, []);
  return <span data-id="iv-draw-elapsed">{elapsed}s</span>;
}

interface HoveredNode {
  label: string;
  x: number;
  y: number;
}

// 인스펙터 카드의 파라미터 행 라벨 — PARAM_FIELDS 순서와 동기
const PARAM_LABELS: Record<(typeof PARAM_FIELDS)[number], string> = {
  duration: "Duration",
  touch_time: "Touch time",
  cost_krw: "Cost (KRW)",
  cost_usd: "Cost (USD)",
  headcount: "Headcount",
  annual_count: "Annual count",
  fte: "FTE",
};

function PreviewCanvas({
  graph, added, wrapperRef, onNodeClick, focusedKey,
}: {
  graph: WorkingGraph | null;
  added: Set<string>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  onNodeClick: (key: string | null) => void;
  // 클릭 포커스 노드(=인스펙터 대상) — 선택 링 표시 + 클릭 시 카메라 센터/줌 (2026-07-30)
  focusedKey: string | null;
}) {
  const { nodes, edges } = useMemo(() => {
    const laid = layoutWorkingGraph(graph, added);
    // layoutWorkingGraph의 엣지는 스타일 미지정(화살표 없음) — 에디터/비교와 동일한 기본 엣지 스타일을 입힌다.
    // selected 주입 — elementsSelectable=false라 RF 대신 우리가 관리(ProcessNode 선택 링 재사용).
    return {
      nodes: laid.nodes.map((n) => ({ ...n, selected: n.id === focusedKey })),
      // 포커스 노드의 입출 엣지는 액센트 강조 — 선택 링과 세트 (2026-07-30)
      edges: highlightConnectedEdges(
        laid.edges.map((e) => ({ ...EDGE_DEFAULTS, ...e })),
        focusedKey ? new Set([focusedKey]) : EMPTY_KEYS,
      ),
    };
  }, [graph, added, focusedKey]);
  const { fitView, flowToScreenPosition, setCenter, getZoom } = useReactFlow();
  // 구조가 실제로 바뀐 때만 카메라 리셋 — 맵이 안 변한 텍스트 턴마다 fitView가
  // 사용자 팬/줌 시점을 뺏지 않게 서명으로 게이팅 (hardening T12)
  const signature = useMemo(() => getGraphSignature(graph), [graph]);
  const lastFitRef = useRef<string | null>(null);
  useEffect(() => {
    if (nodes.length > 0 && signature !== lastFitRef.current) {
      lastFitRef.current = signature;
      fitView({ duration: 400, padding: 0.2 });
    }
  }, [nodes, signature, fitView]);

  // 노드 호버 멘션 버튼 — leave 후 300ms 유예(버튼으로 마우스 이동 허용), 팬/줌 시 즉시 숨김
  const [hovered, setHovered] = useState<HoveredNode | null>(null);
  const leaveTimer = useRef<number | null>(null);

  function cancelLeave() {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }

  function handleNodeEnter(_: React.MouseEvent, node: Node) {
    cancelLeave();
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const corner = flowToScreenPosition({
      x: node.position.x + (node.width ?? 120),
      y: node.position.y,
    });
    setHovered({
      label: String((node.data as { label?: string }).label ?? node.id),
      x: corner.x - rect.x,
      y: corner.y - rect.y,
    });
  }

  function handleNodeLeave() {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => setHovered(null), 300);
  }

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        fitView
        minZoom={0.2}
        panOnDrag
        panOnScroll
        zoomOnScroll={false}
        zoomActivationKeyCode={["Control", "Meta"]}
        onNodeMouseEnter={handleNodeEnter}
        onNodeMouseLeave={handleNodeLeave}
        onNodeClick={(_, node) => {
          onNodeClick(node.id);
          // 포커스 줌 — 클릭 노드를 중앙으로 부드럽게(축소돼 있으면 1.1까지 확대, 확대 상태는 유지)
          const width = node.measured?.width ?? node.width ?? 120;
          const height = node.measured?.height ?? node.height ?? 40;
          void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
            zoom: Math.max(getZoom(), 1.1),
            duration: 400,
          });
        }}
        onPaneClick={() => onNodeClick(null)}
        onMoveStart={() => setHovered(null)}
      />
      {/* 점 격자 미사용 — 프리뷰는 민무늬 캔버스(실사용 피드백 2026-07-24) */}
      {hovered ? (
        <button
          className="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-secondary shadow-md hover:bg-accent-tint hover:text-accent"
          style={{ left: hovered.x, top: hovered.y - 4 }}
          onMouseEnter={cancelLeave}
          onMouseLeave={() => setHovered(null)}
          onClick={() => {
            window.dispatchEvent(new CustomEvent(MENTION_EVENT, { detail: hovered.label }));
            setHovered(null);
          }}
          title="Mention this node in chat"
          data-id="iv-node-mention"
        >
          <MessageSquarePlus size={16} strokeWidth={1.5} />
          Ask about this
        </button>
      ) : null}
    </>
  );
}

export function InterviewPreview({
  interview, onUpdated, mapId, choices, optimisticGraph = null, busy, onChoose,
  drawBusy, drawError, onDraw, onDrawRetry, onDrawClearError, onDrawCancel,
  paramsAvailable, onOpenParams,
}: InterviewPreviewProps) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 체크포인트 클릭 = 맵만 먼저 프리뷰, 확정 버튼으로 실제 revert (실사용 피드백 2026-07-27)
  const [previewStage, setPreviewStage] = useState<string | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  // 새 메시지·낙관 수락이 오면 프리뷰 자동 해제 — 옛 스냅샷이 최신 캔버스를 가리지 않게 (hardening T15)
  const messages = interview?.messages ?? [];
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;
  const [seenSeq, setSeenSeq] = useState(lastSeq);
  if (lastSeq !== seenSeq) {
    setSeenSeq(lastSeq);
    if (previewStage) setPreviewStage(null);
  }
  const [seenOptimistic, setSeenOptimistic] = useState<WorkingGraph | null>(optimisticGraph);
  if (optimisticGraph !== seenOptimistic) {
    setSeenOptimistic(optimisticGraph);
    if (optimisticGraph && previewStage) setPreviewStage(null);
  }
  // 노드 클릭 인스펙터 — 파라미터·담당 정보를 컨설턴트 모드 안에서 확인 (실사용 피드백 2026-07-24)
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const graph = interview?.working_graph ?? null;
  // 이전 그래프 대비 신규 노드 하이라이트 — ref 대신 React 공식 "렌더 중 상태 조정" 패턴
  // (react-hooks/refs가 useMemo 안에서의 ref.current 읽기를 렌더 중 접근으로 금지하므로 회피).
  const [prevGraph, setPrevGraph] = useState<WorkingGraph | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  if (graph !== prevGraph) {
    setAdded(addedNodeKeys(prevGraph, graph));
    setPrevGraph(graph);
  }

  const conflict =
    interview?.version_updated_at != null &&
    interview?.base_graph_updated_at != null &&
    interview.version_updated_at !== interview.base_graph_updated_at;

  async function handleApply() {
    if (!interview || !graph) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      const base = await getGraph(interview.version_id);
      const outcome = buildGraphFromAiProposal(
        { nodes: graph.nodes, edges: graph.edges, groups: graph.groups },
        { base },
      );
      const builtGraph = outcome.graph;
      if (!builtGraph) {
        setApplyError(outcome.errors.map((e) => e.message).join(", ") || "Failed to build the graph.");
        return;
      }
      await saveGraph(interview.version_id, builtGraph);
      const done = await completeInterview(interview.id);
      onUpdated(done);
      router.push(`/maps/${mapId}?version=${interview.version_id}`);
    } catch (err) {
      // 423/409 = 점유 없음 — 에디터에서 checkout 후 재시도 안내
      setApplyError(getApiErrorDetail(err) || "Failed to apply. Check out the draft in the editor first.");
    } finally {
      setApplyBusy(false);
      setApplyOpen(false);
    }
  }

  async function handleRevert() {
    if (!interview || !previewStage || revertBusy) return;
    setRevertBusy(true);
    try {
      const state = await postInterviewRevert(interview.id, previewStage);
      onUpdated(state);
      setPreviewStage(null);
    } catch (err) {
      // 무음 실패 방지 — handleApply와 동일하게 액션 바 에러로 표면화 (final review)
      setApplyError(getApiErrorDetail(err) || "Failed to go back to the checkpoint.");
    } finally {
      setRevertBusy(false);
    }
  }

  // 유사 SP 제안 카드 — 최신 라이브 제안 메시지 1건, Dismiss는 로컬(재제안 방지는 서버 dedupe)
  const spMessage = interview
    ? [...interview.messages].reverse().find((m) => !m.superseded && m.kind === "sp_suggestion") ?? null
    : null;
  const spData = (spMessage?.payload ?? null) as
    | { map_id?: number; map_name?: string; node_keys?: string[] }
    | null;
  const [spDismissed, setSpDismissed] = useState<Set<number>>(new Set());
  const [spBusy, setSpBusy] = useState(false);

  async function handleSpAccept(messageId: number) {
    if (!interview || spBusy) return;
    setSpBusy(true);
    try {
      onUpdated(await acceptSpSuggestion(interview.id, messageId));
    } catch (err) {
      setApplyError(getApiErrorDetail(err) || "Failed to apply the suggestion.");
    } finally {
      setSpBusy(false);
    }
  }

  // 맵 기준 배지 — "맵 = 마지막으로 수락한 안" 규칙의 가시화 (speed redesign §6)
  const liveMessages = interview ? interview.messages.filter((m) => !m.superseded) : [];
  let lastChoiceIdx = -1;
  for (let i = liveMessages.length - 1; i >= 0; i -= 1) {
    if (liveMessages[i].role === "user" && liveMessages[i].kind === "choice") {
      lastChoiceIdx = i;
      break;
    }
  }
  const userTurnsSinceMap = liveMessages.filter(
    (m, i) => i > lastChoiceIdx && m.role === "user",
  ).length;
  const hasMap = !!graph && graph.nodes.length > 0;
  // Apply 노출 기준 — start/end 시드뿐인 백지는 반영할 내용이 없다
  const hasDrawnMap =
    !!graph && graph.nodes.some((n) => n.node_type !== "start" && n.node_type !== "end");
  const baselineText = !hasMap
    ? "Map not drawn yet"
    : lastChoiceIdx === -1
      ? "Map from the existing draft"
      : userTurnsSinceMap === 0
        ? "Map up to date"
        : `Map from ${userTurnsSinceMap} turn${userTurnsSinceMap > 1 ? "s" : ""} ago`;

  // 최근 체크포인트가 맨 위 — 새 항목이 위로 들어오며 아래로 밀리는 스택 (요구 6).
  // N개 초과는 "+N older"로 접는다 — fast-forward가 5개를 한 번에 만들면 좌하 아웃라인과
  // 충돌하던 문제 (P0 #1). 코너 소유권: 좌상=체크포인트 / 중상=프리뷰 바 / 우상=인스펙터 /
  // 좌하=아웃라인 / 중하=SP 카드 / 우하=선택지 재열기 칩. 새 플로팅은 빈 코너만 사용할 것.
  const CP_VISIBLE = 3;
  const [cpExpanded, setCpExpanded] = useState(false);
  const checkpointsNewestFirst = [...(interview?.checkpoints ?? [])].reverse();
  const visibleCheckpoints = cpExpanded
    ? checkpointsNewestFirst
    : checkpointsNewestFirst.slice(0, CP_VISIBLE);
  const hiddenCpCount = checkpointsNewestFirst.length - CP_VISIBLE;
  // 프리뷰 대상 — 같은 스테이지가 여럿이면 최신(백엔드 revert 대상 선택과 동일 규칙)
  const previewCp = previewStage
    ? checkpointsNewestFirst.find((c) => c.stage === previewStage) ?? null
    : null;
  const previewLabel = previewCp
    ? stagesForMode(interview?.mode).find((s) => s.key === previewCp.stage)?.label ?? previewCp.stage
    : "";
  // 프리뷰 중엔 체크포인트 스냅샷 > 낙관적 수락 그래프 > 서버 작업본 순
  const displayGraph = previewCp ? previewCp.working_graph : optimisticGraph ?? graph;

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" data-id="interview-preview">
      {/* 핸들(히트스팟) 숨김 — 실서비스 읽기전용(비교화면)과 동일 raw <style> (lessons canvas §5).
          체크포인트 스택 진입 애니메이션도 여기서(max-height로 아래 항목이 밀리는 느낌). */}
      <style>{`
.iv-preview-flow .react-flow__handle{opacity:0;pointer-events:none}
.iv-preview-flow .react-flow__node{z-index:2 !important;cursor:pointer}
.iv-choice-flow .react-flow__node{cursor:pointer}
/* 노드 호버 강조 — 에디터의 bpm-node-emph 글로우와 동일 룰(ProcessNode 공유) */
.iv-preview-flow .react-flow__node:hover .bpm-node-emph,.iv-choice-flow .react-flow__node:hover .bpm-node-emph{box-shadow:0 0 0 3px color-mix(in srgb,var(--nc) 42%,transparent)}
/* 선택 링 — 래퍼 outline은 추정 높이 박스라 도형과 어긋남 → 실제 도형(bpm-node-emph)의
   box-shadow 이중 링(마름모는 회전까지 따라감). 이웃 가림 방지 z 상승. 호버 룰보다 뒤=우선 */
.iv-preview-flow .react-flow__node.selected,.iv-choice-flow .react-flow__node.selected{z-index:3 !important}
.iv-preview-flow .react-flow__node.selected .bpm-node-emph,.iv-choice-flow .react-flow__node.selected .bpm-node-emph{box-shadow:0 0 0 2px var(--color-surface),0 0 0 4px var(--color-accent)}
@keyframes iv-cp-in{from{opacity:0;max-height:0;transform:translateY(-6px)}to{opacity:1;max-height:40px;transform:translateY(0)}}
.iv-cp-chip{overflow:hidden;animation:iv-cp-in .45s cubic-bezier(0.34,1.3,0.64,1)}
@keyframes iv-pop-in{from{opacity:0;transform:scale(0.98)}to{opacity:1;transform:none}}
.iv-pop{animation:iv-pop-in 150ms var(--ease-smooth)}
@media(prefers-reduced-motion:reduce){.iv-cp-chip,.iv-pop{animation:none}}
      `}</style>
      <ReactFlowProvider>
        <NodeActionsContext.Provider value={PREVIEW_NODE_ACTIONS}>
          <div ref={wrapperRef} className="iv-preview-flow relative min-h-0 flex-1">
            {displayGraph && displayGraph.nodes.length > 0 ? (
              <PreviewCanvas
                graph={displayGraph}
                added={previewCp ? NO_ADDED : added}
                wrapperRef={wrapperRef}
                onNodeClick={setInspectedKey}
                focusedKey={inspectedKey}
              />
            ) : (
              /* 빈 캔버스 첫 화면 — 고스트 노드 미니 프리뷰 + 패스트트랙 CTA (P1 #7) */
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <div className="flex items-center gap-2 opacity-70" aria-hidden>
                  <span className="h-9 w-9 rounded-full border-[1.5px] border-dashed border-ink-tertiary/60 bg-surface" />
                  <span className="h-px w-7 bg-ink-tertiary/50" />
                  <span className="h-9 w-24 rounded-sm border-[1.5px] border-dashed border-accent/50 bg-accent-tint/40" />
                  <span className="h-px w-7 bg-ink-tertiary/50" />
                  <span className="h-9 w-9 rounded-full border-[1.5px] border-dashed border-ink-tertiary/60 bg-surface" />
                </div>
                {previewCp ? (
                  <div className="text-caption text-ink-muted">This checkpoint has no map yet.</div>
                ) : (
                  <>
                    <div className="text-caption text-ink-secondary">
                      Answer a few questions - the map draws itself.
                    </div>
                    <div className="text-fine text-ink-muted">
                      Attach a document in chat to draw right away (fast track).
                    </div>
                  </>
                )}
              </div>
            )}
            {/* 워터마크 — 노드(z-2) 아래(z-1)로 깔아 파스텔 색을 탁하게 만들지 않는다 (P1 #7) */}
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden">
              <span className="-rotate-[18deg] select-none whitespace-nowrap text-[72px] font-semibold uppercase tracking-widest text-accent opacity-[0.07]">
                AI Consultant
              </span>
            </div>
            {/* 체크포인트 스택 — 좌상단, 최근이 맨 위 */}
            {checkpointsNewestFirst.length > 0 ? (
              <div className="absolute left-3 top-3 z-10 flex w-44 flex-col gap-1.5" data-id="iv-checkpoints">
                {visibleCheckpoints.map((cp, i) => {
                  const label =
                    stagesForMode(interview?.mode).find((s) => s.key === cp.stage)?.label ?? cp.stage;
                  const active = cp.stage === previewStage;
                  return (
                    <button
                      key={`${cp.stage}-${cp.message_seq}`}
                      className={
                        "iv-cp-chip flex items-center gap-1.5 rounded-sm border px-2 py-1 text-fine shadow-sm " +
                        (active
                          ? "border-accent bg-accent-tint text-accent"
                          : "border-hairline bg-surface hover:bg-surface-alt " +
                            (i === 0 ? "text-ink" : "text-ink-tertiary"))
                      }
                      onClick={() => setPreviewStage(active ? null : cp.stage)}
                      title={`Preview the map at ${label}`}
                      data-id={`iv-checkpoint-${cp.stage}`}
                    >
                      <Undo2 size={16} strokeWidth={1.5} className="shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
                {hiddenCpCount > 0 || cpExpanded ? (
                  <button
                    className="iv-cp-chip rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink-tertiary shadow-sm hover:bg-surface-alt"
                    onClick={() => setCpExpanded((v) => !v)}
                    data-id="iv-cp-toggle"
                  >
                    {cpExpanded ? "Show less" : `+${hiddenCpCount} older`}
                  </button>
                ) : null}
              </div>
            ) : null}
            {/* 체크포인트 프리뷰 바 — 맵만 먼저 되돌려 보여주고, 확정해야 실제 revert */}
            {previewCp ? (
              <div
                className="iv-pop absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-14rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-1.5 shadow-md"
                data-id="iv-cp-preview"
              >
                <Undo2 size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
                <span className="truncate text-caption text-ink-secondary">
                  Previewing “{previewLabel}” - going back sets aside later messages and map changes.
                </span>
                <button
                  className="shrink-0 rounded-sm px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setPreviewStage(null)}
                  data-id="iv-cp-cancel"
                >
                  Keep current
                </button>
                <button
                  className="shrink-0 rounded-sm bg-accent px-2.5 py-0.5 text-caption-strong text-on-accent disabled:opacity-40"
                  disabled={revertBusy}
                  onClick={() => {
                    void handleRevert();
                  }}
                  data-id="iv-cp-confirm"
                >
                  Go back here
                </button>
              </div>
            ) : null}
            {/* 노드 인스펙터 — 클릭한 노드의 담당·시스템·회당 파라미터 확인 (읽기전용) */}
            {(() => {
              const node = inspectedKey
                ? displayGraph?.nodes.find((n) => n.key === inspectedKey)
                : undefined;
              if (!node) return null;
              const attrs = node.attributes;
              // 값 있는 행만 — 인터뷰 초반 노드가 대시 9줄이 되지 않게 (P1 #9)
              const rows: [string, string][] = ([
                ["Assignee", attrs?.assignee || ""],
                ["Department", attrs?.department || ""],
                ["System", attrs?.system || ""],
                ...PARAM_FIELDS.map((field): [string, string] => [
                  PARAM_LABELS[field],
                  attrs?.[field] ? formatParamValue(field, attrs[field] ?? "") : "",
                ]),
              ] as [string, string][]).filter(([, value]) => value !== "");
              return (
                <div
                  className="iv-pop absolute right-3 top-3 z-10 w-64 rounded-md border border-hairline bg-surface shadow-md"
                  data-id="iv-node-inspector"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-hairline px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-caption-strong text-ink">{node.title}</div>
                      <div className="text-fine text-ink-muted">{node.node_type}</div>
                    </div>
                    <button
                      className="shrink-0 rounded-xs p-0.5 text-ink-muted hover:text-ink"
                      onClick={() => setInspectedKey(null)}
                      title="Close"
                      data-id="iv-node-inspector-close"
                    >
                      <X size={16} strokeWidth={1.5} />
                    </button>
                  </div>
                  {node.description ? (
                    <div className="max-h-24 overflow-y-auto break-words border-b border-hairline px-3 py-2 text-fine text-ink-secondary">
                      {node.description}
                    </div>
                  ) : null}
                  {rows.length > 0 ? (
                    <dl className="px-3 py-2">
                      {rows.map(([label, value]) => (
                        <div key={label} className="flex items-baseline justify-between gap-2 py-0.5">
                          <dt className="shrink-0 text-fine text-ink-muted">{label}</dt>
                          <dd className="truncate text-fine text-ink-secondary">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : !node.description ? (
                    <div className="px-3 py-2 text-fine text-ink-muted">No details collected yet.</div>
                  ) : null}
                </div>
              );
            })()}
            {/* facts 아웃라인 — 매 턴 즉시 갱신되는 수집 정보(AI 0콜, speed redesign §6) */}
            <InterviewOutline facts={interview?.facts} mode={interview?.mode} />
            {/* 유사 SP 제안 카드 — 수락 시 구간을 서브프로세스 링크로 치환 (design §7 P2) */}
            {spMessage && spData?.map_id && !spDismissed.has(spMessage.id) &&
            interview?.status === "active" ? (
              <div
                className="iv-pop absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-2 shadow-lg"
                data-id="iv-sp-card"
              >
                <Workflow size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
                <span className="min-w-0 truncate text-caption text-ink-secondary">
                  Similar published map{" "}
                  <a
                    className="text-accent hover:underline"
                    href={`/maps/${spData.map_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {spData.map_name || "map"}
                  </a>{" "}
                  - replace {spData.node_keys?.length ?? 0} steps with a subprocess link?
                </span>
                <button
                  className="shrink-0 rounded-sm px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setSpDismissed((prev) => new Set(prev).add(spMessage.id))}
                  data-id="iv-sp-dismiss"
                >
                  Dismiss
                </button>
                <button
                  className="shrink-0 rounded-sm bg-accent px-2.5 py-0.5 text-caption-strong text-on-accent disabled:opacity-40"
                  disabled={spBusy}
                  onClick={() => {
                    void handleSpAccept(spMessage.id);
                  }}
                  data-id="iv-sp-accept"
                >
                  Replace
                </button>
              </div>
            ) : null}
            {/* draw 진행 오버레이 — 동기 대기의 가시화(스켈레톤+경과초), 실패 시 Retry (speed redesign §4) */}
            {drawBusy || drawError ? (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center bg-ink/10"
                data-id="iv-draw-overlay"
              >
                <div className="iv-pop flex w-96 max-w-[calc(100%-2rem)] flex-col items-center gap-3 rounded-md border border-hairline bg-surface p-6 shadow-lg">
                  {drawError ? (
                    <>
                      <span className="text-center text-caption text-error">{drawError}</span>
                      <div className="flex gap-2">
                        <button
                          className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
                          onClick={onDrawClearError}
                          data-id="iv-draw-close"
                        >
                          Close
                        </button>
                        <button
                          className="rounded-sm bg-accent px-2.5 py-1 text-caption-strong text-on-accent"
                          onClick={onDrawRetry}
                          data-id="iv-draw-retry"
                        >
                          Retry
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex w-full gap-2">
                        {(drawBusy === "multi" ? [0, 1] : [0]).map((i) => (
                          <div key={i} className="h-24 flex-1 animate-pulse rounded-sm bg-surface-alt" />
                        ))}
                      </div>
                      <span className="flex items-center gap-2 text-caption text-ink-secondary">
                        {drawBusy === "multi" ? "Drawing proposals…" : "Drawing the map…"}
                        <DrawTimer />
                      </span>
                      {/* 탈출구 — 행이 걸려도 새로고침 없이 채팅으로 복귀(서버 작업은 계속되며 결과는 다음 동기화 때 표시) */}
                      <button
                        className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
                        onClick={onDrawCancel}
                        data-id="iv-draw-cancel"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
            {/* 선택지 플로팅 창 — 복수 안을 캔버스 위에, 3안은 큰 창 1+작은 창 2(탭 전환), 선택하면 모두 닫힘 */}
            {choices && choices.length > 0 && !drawBusy ? (
              <ChoiceOverlay choices={choices} currentGraph={graph} busy={busy} onChoose={onChoose} />
            ) : null}
          </div>
        </NodeActionsContext.Provider>
      </ReactFlowProvider>
      <div className="flex items-center gap-1.5 border-t border-hairline bg-surface px-3 py-1.5" data-id="iv-actionbar">
        {interview?.status === "active" ? (
          <button
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
            disabled={busy || !!drawBusy}
            onClick={() => onDraw("single")}
            title="Draw the map from what we've discussed so far"
            data-id="iv-draw"
          >
            <PenLine size={16} strokeWidth={1.5} />
            Draw map
          </button>
        ) : null}
        {interview?.status === "active" && paramsAvailable ? (
          <button
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
            disabled={busy || !!drawBusy}
            onClick={onOpenParams}
            title="Review and apply collected parameters"
            data-id="iv-params-open"
          >
            <Table2 size={16} strokeWidth={1.5} />
            Params
          </button>
        ) : null}
        {/* baseline은 좌측 버튼 그룹에 구분선으로 소속 — 버튼 사이 부유 방지 (P1 #8) */}
        <span className="ml-1 border-l border-divider pl-2 text-fine text-ink-muted" data-id="iv-map-baseline">
          {baselineText}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {applyError ? (
            <span className="flex min-w-0 items-center gap-1 text-fine text-error" data-id="iv-apply-error">
              <span className="truncate">{applyError}</span>
              <button
                className="shrink-0 rounded-xs p-0.5 hover:bg-error/10"
                onClick={() => setApplyError(null)}
                title="Dismiss"
                data-id="iv-apply-error-dismiss"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </span>
          ) : null}
          {/* review까지 안 가도 맵이 그려진 시점부터 언제든 반영·종료 가능 (실사용 피드백 2026-07-28) */}
          {interview?.status === "active" && hasDrawnMap ? (
            <button
              className="flex shrink-0 items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption-strong text-on-accent disabled:opacity-40"
              disabled={applyBusy || !graph || graph.nodes.length === 0}
              onClick={() => setApplyOpen(true)}
              data-id="iv-apply"
            >
              <CheckCheck size={16} strokeWidth={1.5} />
              Apply & finish
            </button>
          ) : null}
        </div>
      </div>
      {applyOpen ? (
        <ConfirmDialog
          title="Apply the interview result to the draft?"
          message={
            (conflict
              ? "Warning: the draft has been edited since this interview started. Applying will merge onto the latest draft."
              : "The working map will be merged into the draft version.") +
            " This also finishes the interview session." // 상시 노출로 바뀐 뒤 멘탈 모델 명시 (T20)
          }
          confirmLabel={applyBusy ? "Applying…" : "Apply"}
          cancelLabel="Cancel"
          danger={conflict}
          confirmDisabled={applyBusy}
          onConfirm={() => {
            void handleApply();
          }}
          onClose={() => setApplyOpen(false)}
        />
      ) : null}
    </div>
  );
}
