"use client";

// 선택지 플로팅 창 + 오버레이 레이아웃 — 안마다 팬/줌 가능한 읽기전용 ReactFlow + 선택 버튼.
// 3안: 좌측 큰 창 1 + 우측 작은 창 2(탭/헤더 클릭으로 큰 창 교체), 2안: 1:1, 1안: 큰 창 하나
// (실사용 피드백 2026-07-27). 부모(InterviewPreview)의 NodeActionsContext 안에서 렌더.

import { useEffect, useMemo, useState } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { NodeTypes } from "@xyflow/react";
import { Check, Maximize2 } from "lucide-react";

import type { ChoiceOption } from "@/lib/api";
import { distinctiveNodeKeys, layoutWorkingGraph } from "@/lib/interview";
import { EDGE_DEFAULTS } from "@/lib/canvas";
import { ProcessNode } from "@/components/process-node";

const nodeTypes: NodeTypes = { process: ProcessNode };

interface ChoiceWindowProps {
  option: ChoiceOption;
  disabled: boolean;
  onChoose: (id: string) => void;
  // 다른 안에는 없는 이 안만의 노드 키 — diffStatus 하이라이트(복수 안 비교용)
  highlight: Set<string>;
  // 크기·배치는 오버레이가 결정 — 창은 구조만 책임진다
  className: string;
  // 작은 창 헤더 클릭 → 큰 창으로 승격 (3안 레이아웃)
  onFocus?: () => void;
  focused?: boolean;
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

export function ChoiceWindow({
  option, disabled, onChoose, highlight, className, onFocus, focused,
}: ChoiceWindowProps) {
  return (
    <div
      className={
        "flex flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg " +
        className
      }
      data-id="iv-choice-card"
      data-focused={focused ? "true" : undefined}
    >
      <div
        className={"border-b border-hairline px-3 py-2 " + (onFocus ? "cursor-pointer hover:bg-surface-alt" : "")}
        onClick={onFocus}
        title={onFocus ? "Enlarge this option" : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-caption-strong text-ink">{option.title}</div>
          {onFocus ? (
            <Maximize2 size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          ) : null}
        </div>
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

interface ChoiceOverlayProps {
  choices: ChoiceOption[];
  busy: boolean;
  onChoose: (id: string) => void;
}

export function ChoiceOverlay({ choices, busy, onChoose }: ChoiceOverlayProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // 복수 안일 때 안 간 차이 노드(모든 안에 공통이 아닌 제목)를 하이라이트
  const highlight = useMemo(() => distinctiveNodeKeys(choices), [choices]);
  // 새 선택지 세트가 오면 stale id는 find 실패 → 첫 안으로 폴백 (effect 없이 파생)
  const focused = choices.find((o) => o.id === focusedId) ?? choices[0];
  const rest = choices.filter((o) => o.id !== focused.id);

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-ink/10 p-6"
      data-id="iv-choice-overlay"
    >
      {choices.length >= 3 ? (
        <>
          <div
            className="flex shrink-0 gap-1 rounded-md border border-hairline bg-surface p-1 shadow-md"
            data-id="iv-choice-tabs"
          >
            {choices.map((o) => (
              <button
                key={o.id}
                className={
                  "max-w-56 truncate rounded-sm px-2.5 py-1 text-caption " +
                  (o.id === focused.id
                    ? "bg-accent-tint text-accent"
                    : "text-ink-secondary hover:bg-surface-alt")
                }
                onClick={() => setFocusedId(o.id)}
                data-id="iv-choice-tab"
              >
                {o.title}
              </button>
            ))}
          </div>
          <div className="flex max-h-[78%] min-h-0 w-full max-w-5xl flex-1 items-stretch justify-center gap-3">
            <ChoiceWindow
              option={focused}
              disabled={busy}
              onChoose={onChoose}
              highlight={highlight.get(focused.id) ?? new Set()}
              className="h-full min-w-0 flex-[2]"
              focused
            />
            <div className="flex h-full w-72 shrink-0 flex-col gap-3">
              {rest.map((o) => (
                <ChoiceWindow
                  key={o.id}
                  option={o}
                  disabled={busy}
                  onChoose={onChoose}
                  highlight={highlight.get(o.id) ?? new Set()}
                  className="min-h-0 flex-1"
                  onFocus={() => setFocusedId(o.id)}
                />
              ))}
            </div>
          </div>
        </>
      ) : choices.length === 2 ? (
        <div className="flex max-h-[80%] min-h-0 w-full flex-1 items-center justify-center gap-4">
          {choices.map((o) => (
            <ChoiceWindow
              key={o.id}
              option={o}
              disabled={busy}
              onChoose={onChoose}
              highlight={highlight.get(o.id) ?? new Set()}
              className="h-[min(480px,100%)] w-[min(460px,44%)] min-w-72"
            />
          ))}
        </div>
      ) : (
        <div className="flex max-h-[84%] min-h-0 w-full flex-1 items-center justify-center">
          <ChoiceWindow
            option={focused}
            disabled={busy}
            onChoose={onChoose}
            highlight={highlight.get(focused.id) ?? new Set()}
            className="h-[min(560px,100%)] w-[min(760px,72%)] min-w-72"
            focused
          />
        </div>
      )}
    </div>
  );
}
