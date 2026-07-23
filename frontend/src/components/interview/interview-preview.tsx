"use client";

// 좌측 메인 프리뷰 — 읽기전용 캔버스(워터마크·핸들 숨김) + 체크포인트 스택(좌상단)
// + 선택지 플로팅 창 오버레이 + 노드 호버 멘션 버튼 (design 2026-07-23 §6, 실사용 피드백 2차)

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { Node, NodeTypes } from "@xyflow/react";
import { CheckCheck, MessageSquarePlus, Undo2 } from "lucide-react";
import "@xyflow/react/dist/style.css";

import {
  completeInterview, getApiErrorDetail, getGraph, postInterviewRevert, saveGraph,
  type ChoiceOption, type InterviewState, type WorkingGraph,
} from "@/lib/api";
import { addedNodeKeys, layoutWorkingGraph, INTERVIEW_STAGES } from "@/lib/interview";
import { buildGraphFromAiProposal } from "@/lib/csv-import";
import { EDGE_DEFAULTS } from "@/lib/canvas";
import { NodeActionsContext, type NodeActions } from "@/lib/node-actions";
import { ProcessNode } from "@/components/process-node";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChoiceWindow } from "@/components/interview/choice-card";
import { MENTION_EVENT } from "@/components/interview/interview-panel";

const nodeTypes: NodeTypes = { process: ProcessNode };

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
};

interface InterviewPreviewProps {
  interview: InterviewState | null;
  onUpdated: (state: InterviewState) => void;
  mapId: number;
  choices: ChoiceOption[] | null;
  busy: boolean;
  onChoose: (choiceId: string) => void;
}

interface HoveredNode {
  label: string;
  x: number;
  y: number;
}

function PreviewCanvas({
  graph, added, wrapperRef,
}: {
  graph: WorkingGraph | null;
  added: Set<string>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { nodes, edges } = useMemo(() => {
    const laid = layoutWorkingGraph(graph, added);
    // layoutWorkingGraph의 엣지는 스타일 미지정(화살표 없음) — 에디터/비교와 동일한 기본 엣지 스타일을 입힌다.
    return { nodes: laid.nodes, edges: laid.edges.map((e) => ({ ...EDGE_DEFAULTS, ...e })) };
  }, [graph, added]);
  const { fitView, flowToScreenPosition } = useReactFlow();
  useEffect(() => {
    if (nodes.length > 0) fitView({ duration: 400, padding: 0.2 });
  }, [nodes, fitView]);

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
        onMoveStart={() => setHovered(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color="var(--color-canvas-dot)" />
      </ReactFlow>
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
  interview, onUpdated, mapId, choices, busy, onChoose,
}: InterviewPreviewProps) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [revertStage, setRevertStage] = useState<string | null>(null);
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
    if (!interview || !revertStage) return;
    const state = await postInterviewRevert(interview.id, revertStage);
    onUpdated(state);
    setRevertStage(null);
  }

  // 최근 체크포인트가 맨 위 — 새 항목이 위로 들어오며 아래로 밀리는 스택 (요구 6)
  const checkpointsNewestFirst = [...(interview?.checkpoints ?? [])].reverse();

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" data-id="interview-preview">
      {/* 핸들(히트스팟) 숨김 — 실서비스 읽기전용(비교화면)과 동일 raw <style> (lessons canvas §5).
          체크포인트 스택 진입 애니메이션도 여기서(max-height로 아래 항목이 밀리는 느낌). */}
      <style>{`
.iv-preview-flow .react-flow__handle{opacity:0;pointer-events:none}
.iv-preview-flow .react-flow__node{z-index:2 !important}
@keyframes iv-cp-in{from{opacity:0;max-height:0;transform:translateY(-6px)}to{opacity:1;max-height:40px;transform:translateY(0)}}
.iv-cp-chip{overflow:hidden;animation:iv-cp-in .45s cubic-bezier(0.34,1.3,0.64,1)}
      `}</style>
      <ReactFlowProvider>
        <NodeActionsContext.Provider value={PREVIEW_NODE_ACTIONS}>
          <div ref={wrapperRef} className="iv-preview-flow relative min-h-0 flex-1">
            {graph && graph.nodes.length > 0 ? (
              <PreviewCanvas graph={graph} added={added} wrapperRef={wrapperRef} />
            ) : (
              <div className="flex h-full items-center justify-center text-caption text-ink-muted">
                The map will appear here as the interview progresses.
              </div>
            )}
            {/* 워터마크 — 비교화면 read-only 워터마크 재활용(z-4, 노드 위 투과) */}
            <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center overflow-hidden">
              <span className="-rotate-[18deg] select-none whitespace-nowrap text-[110px] font-semibold uppercase tracking-widest text-accent opacity-[0.10]">
                AI Consultant
              </span>
            </div>
            {/* 체크포인트 스택 — 좌상단, 최근이 맨 위 */}
            {checkpointsNewestFirst.length > 0 ? (
              <div className="absolute left-3 top-3 z-10 flex w-44 flex-col gap-1.5" data-id="iv-checkpoints">
                {checkpointsNewestFirst.map((cp, i) => {
                  const label = INTERVIEW_STAGES.find((s) => s.key === cp.stage)?.label ?? cp.stage;
                  return (
                    <button
                      key={`${cp.stage}-${cp.message_seq}`}
                      className={
                        "iv-cp-chip flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2 py-1 text-fine shadow-sm hover:bg-surface-alt " +
                        (i === 0 ? "text-ink" : "text-ink-tertiary")
                      }
                      onClick={() => setRevertStage(cp.stage)}
                      title={`Go back to ${label}`}
                      data-id={`iv-checkpoint-${cp.stage}`}
                    >
                      <Undo2 size={16} strokeWidth={1.5} className="shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {/* 선택지 플로팅 창 — 복수 안을 캔버스 위에 나란히, 선택하면 모두 닫힘 (요구 2) */}
            {choices && choices.length > 0 ? (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center gap-4 overflow-auto bg-ink/10 p-6"
                data-id="iv-choice-overlay"
              >
                {choices.map((option) => (
                  <ChoiceWindow key={option.id} option={option} disabled={busy} onChoose={onChoose} />
                ))}
              </div>
            ) : null}
          </div>
        </NodeActionsContext.Provider>
      </ReactFlowProvider>
      <div className="flex items-center gap-1.5 border-t border-hairline bg-surface px-3 py-1.5" data-id="iv-actionbar">
        {interview?.current_stage === "review" && interview.status === "active" ? (
          <button
            className="ml-auto flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption-strong text-on-accent disabled:opacity-40"
            disabled={applyBusy || !graph || graph.nodes.length === 0}
            onClick={() => setApplyOpen(true)}
            data-id="iv-apply"
          >
            <CheckCheck size={16} strokeWidth={1.5} />
            Apply to draft
          </button>
        ) : (
          <span className="text-fine text-ink-muted">Read-only preview — the map updates as you talk.</span>
        )}
        {applyError ? (
          <span className="ml-auto text-fine text-error" data-id="iv-apply-error">{applyError}</span>
        ) : null}
      </div>
      {revertStage ? (
        <ConfirmDialog
          title="Go back to a previous stage?"
          message="Messages and map changes after this checkpoint will be set aside."
          confirmLabel="Go back"
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            void handleRevert();
          }}
          onClose={() => setRevertStage(null)}
        />
      ) : null}
      {applyOpen ? (
        <ConfirmDialog
          title="Apply the interview result to the draft?"
          message={
            conflict
              ? "Warning: the draft has been edited since this interview started. Applying will merge onto the latest draft."
              : "The working map will be merged into the draft version."
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
