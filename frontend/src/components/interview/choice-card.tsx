"use client";

// 선택지 플로팅 창 — 안마다 팬/줌 가능한 읽기전용 ReactFlow + 선택 버튼 (실사용 피드백 2차: 채팅 밖 메인 영역에 크게)
// 부모(InterviewPreview)의 NodeActionsContext 안에서 렌더 — ProcessNode 요구 context 충족.

import { useEffect, useMemo } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { NodeTypes } from "@xyflow/react";
import { Check } from "lucide-react";

import type { ChoiceOption } from "@/lib/api";
import { layoutWorkingGraph } from "@/lib/interview";
import { EDGE_DEFAULTS } from "@/lib/canvas";
import { ProcessNode } from "@/components/process-node";

const nodeTypes: NodeTypes = { process: ProcessNode };

interface ChoiceWindowProps {
  option: ChoiceOption;
  disabled: boolean;
  onChoose: (id: string) => void;
  // 다른 안에는 없는 이 안만의 노드 키 — diffStatus 하이라이트(복수 안 비교용)
  highlight: Set<string>;
}

function ChoiceCanvas({ option, highlight }: { option: ChoiceOption; highlight: Set<string> }) {
  const { nodes, edges } = useMemo(() => {
    const laid = layoutWorkingGraph(option.graph, highlight);
    return { nodes: laid.nodes, edges: laid.edges.map((e) => ({ ...EDGE_DEFAULTS, ...e })) };
  }, [option.graph, highlight]);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodes.length > 0) fitView({ duration: 300, padding: 0.15 });
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
      minZoom={0.15}
      panOnDrag
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomActivationKeyCode={["Control", "Meta"]}
    />
  );
}

export function ChoiceWindow({ option, disabled, onChoose, highlight }: ChoiceWindowProps) {
  return (
    <div
      className="flex h-[min(420px,70%)] w-[min(440px,42%)] min-w-72 shrink-0 flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
      data-id="iv-choice-card"
    >
      <div className="border-b border-hairline px-3 py-2">
        <div className="text-caption-strong text-ink">{option.title}</div>
        {option.summary ? (
          <div className="mt-0.5 line-clamp-2 text-fine text-ink-tertiary">{option.summary}</div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 bg-canvas">
        <ReactFlowProvider>
          <ChoiceCanvas option={option} highlight={highlight} />
        </ReactFlowProvider>
      </div>
      <div className="border-t border-hairline p-2">
        <button
          className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-accent py-1.5 text-caption-strong text-on-accent disabled:opacity-40"
          disabled={disabled}
          onClick={() => onChoose(option.id)}
          data-id="iv-choice-pick"
        >
          <Check size={16} strokeWidth={1.5} />
          Use this option
        </button>
      </div>
    </div>
  );
}
