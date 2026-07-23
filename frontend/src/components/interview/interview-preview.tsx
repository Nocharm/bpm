"use client";

// 우측 프리뷰 — 작업본 그래프 읽기전용 렌더 + 변경 하이라이트(diffStatus) + 체크포인트/적용 바

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { NodeTypes } from "@xyflow/react";
import { CheckCheck, Undo2 } from "lucide-react";
import "@xyflow/react/dist/style.css";

import {
  completeInterview, getApiErrorDetail, getGraph, postInterviewRevert, saveGraph,
  type InterviewState, type WorkingGraph,
} from "@/lib/api";
import { addedNodeKeys, layoutWorkingGraph, INTERVIEW_STAGES } from "@/lib/interview";
import { buildGraphFromAiProposal } from "@/lib/csv-import";
import { EDGE_DEFAULTS } from "@/lib/canvas";
import { NodeActionsContext, type NodeActions } from "@/lib/node-actions";
import { ProcessNode } from "@/components/process-node";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
}

function PreviewCanvas({ graph, added }: { graph: WorkingGraph | null; added: Set<string> }) {
  const { nodes, edges } = useMemo(() => {
    const laid = layoutWorkingGraph(graph, added);
    // layoutWorkingGraph의 엣지는 스타일 미지정(화살표 없음) — 에디터/비교와 동일한 기본 엣지 스타일을 입힌다.
    return { nodes: laid.nodes, edges: laid.edges.map((e) => ({ ...EDGE_DEFAULTS, ...e })) };
  }, [graph, added]);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodes.length > 0) fitView({ duration: 400, padding: 0.2 });
  }, [nodes, fitView]);
  return (
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
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color="var(--color-canvas-dot)" />
    </ReactFlow>
  );
}

export function InterviewPreview({ interview, onUpdated, mapId }: InterviewPreviewProps) {
  const router = useRouter();
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

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" data-id="interview-preview">
      <ReactFlowProvider>
        <NodeActionsContext.Provider value={PREVIEW_NODE_ACTIONS}>
          <div className="min-h-0 flex-1">
            {graph && graph.nodes.length > 0 ? (
              <PreviewCanvas graph={graph} added={added} />
            ) : (
              <div className="flex h-full items-center justify-center text-caption text-ink-muted">
                The map will appear here as the interview progresses.
              </div>
            )}
          </div>
        </NodeActionsContext.Provider>
      </ReactFlowProvider>
      <div className="flex items-center gap-1.5 border-t border-hairline bg-surface px-3 py-1.5" data-id="iv-checkpoints">
        {(interview?.checkpoints ?? []).map((cp) => {
          const label = INTERVIEW_STAGES.find((s) => s.key === cp.stage)?.label ?? cp.stage;
          return (
            <button
              key={`${cp.stage}-${cp.message_seq}`}
              className="flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
              onClick={() => setRevertStage(cp.stage)}
              title={`Go back to ${label}`}
              data-id={`iv-checkpoint-${cp.stage}`}
            >
              <Undo2 size={16} strokeWidth={1.5} />
              {label}
            </button>
          );
        })}
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
        ) : null}
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
