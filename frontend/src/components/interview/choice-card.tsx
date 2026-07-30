"use client";

// 선택지 플로팅 창 + 오버레이 레이아웃 — 안마다 팬/줌 가능한 읽기전용 ReactFlow + 선택 버튼.
// 3안: 좌측 큰 창 1 + 우측 작은 창 2(탭/헤더 클릭으로 큰 창 교체), 2안: 1:1, 1안: 큰 창 하나
// (실사용 피드백 2026-07-27). 부모(InterviewPreview)의 NodeActionsContext 안에서 렌더.

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { NodeTypes } from "@xyflow/react";
import { Check, Layers, Maximize2 } from "lucide-react";

import type { ChoiceOption } from "@/lib/api";
import { distinctiveNodeKeys, layoutWorkingGraph } from "@/lib/interview";
import { EDGE_DEFAULTS } from "@/lib/canvas";
import { ProcessNode } from "@/components/process-node";

const nodeTypes: NodeTypes = { process: ProcessNode };

// 하이라이트 없음 — 렌더마다 new Set()이면 ChoiceCanvas useMemo가 매번 재레이아웃한다
const NO_HIGHLIGHT = new Set<string>();

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
  // 노드 클릭 포커스 — 창별 독립 선택 링 + 카메라 센터/줌 (프리뷰와 동일 UX, 2026-07-30)
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const { nodes, edges } = useMemo(() => {
    const laid = layoutWorkingGraph(option.graph, highlight);
    return {
      nodes: laid.nodes.map((n) => ({ ...n, selected: n.id === focusedKey })),
      edges: laid.edges.map((e) => ({ ...EDGE_DEFAULTS, ...e })),
    };
  }, [option.graph, highlight, focusedKey]);
  const { fitView, setCenter, getZoom } = useReactFlow();
  // fitView는 그래프가 바뀔 때 1회만 — 포커스 클릭(nodes identity 변경)이 카메라를 되돌리지 않게
  const fitForRef = useRef<unknown>(null);
  useEffect(() => {
    if (nodes.length > 0 && fitForRef.current !== option.graph) {
      fitForRef.current = option.graph;
      fitView({ duration: 300, padding: 0.15 });
    }
  }, [nodes, option.graph, fitView]);
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
      onNodeClick={(_, node) => {
        setFocusedKey(node.id);
        const width = node.measured?.width ?? node.width ?? 120;
        const height = node.measured?.height ?? node.height ?? 40;
        void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
          zoom: Math.max(getZoom(), 1.1),
          duration: 400,
        });
      }}
      onPaneClick={() => setFocusedKey(null)}
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
          <div className="flex shrink-0 items-center gap-1.5">
            {option.lint && option.lint.length > 0 ? (
              <span
                className="rounded-sm bg-changed/10 px-1.5 py-0.5 text-fine text-changed"
                title={option.lint.join("\n")}
                data-id="iv-choice-lint"
              >
                Tone check {option.lint.length}
              </span>
            ) : null}
            {onFocus ? (
              <Maximize2 size={16} strokeWidth={1.5} className="text-ink-muted" />
            ) : null}
          </div>
        </div>
        {option.summary ? (
          <div className="mt-0.5 line-clamp-2 text-fine text-ink-tertiary">{option.summary}</div>
        ) : null}
      </div>
      <div className="iv-choice-flow relative min-h-0 flex-1 bg-canvas">
        {option.same_as_current ? (
          <>
            <span
              className="absolute left-2 top-2 z-10 rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary"
              data-id="iv-choice-current-badge"
            >
              Same as current
            </span>
            {/* 현재맵 워터마크 — 노드 위 투과, 배지만으론 놓치기 쉬워 이중 표기 (2026-07-30) */}
            <div
              className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center overflow-hidden"
              data-id="iv-choice-current-watermark"
            >
              <span className="-rotate-[18deg] select-none whitespace-nowrap text-[36px] font-semibold uppercase tracking-widest text-ink-secondary opacity-[0.08]">
                Current map
              </span>
            </div>
          </>
        ) : null}
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
  // Escape로 접기 — 안 고르고 캔버스/채팅을 먼저 보고 싶을 때의 탈출구. pending은 서버에
  // 남아 있어 칩으로 재열기 (hardening T15). 새 선택지 세트가 오면 identity가 달라 자동 복귀.
  const [dismissedFor, setDismissedFor] = useState<ChoiceOption[] | null>(null);
  const dismissed = dismissedFor === choices;
  useEffect(() => {
    if (dismissed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissedFor(choices);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choices, dismissed]);
  // 복수 안일 때 안 간 차이 노드(모든 안에 공통이 아닌 제목)를 하이라이트.
  // '현재 맵 유지' 안은 비교 모수에서 제외 — 포함하면 무변경인 현재맵 노드가 '추가'로
  // 표시되고 다른 안들의 차이 판정도 오염된다 (실사용 피드백 2026-07-30)
  const highlight = useMemo(
    () => distinctiveNodeKeys(choices.filter((option) => !option.same_as_current)),
    [choices],
  );
  // 새 선택지 세트가 오면 stale id는 find 실패 → 첫 안으로 폴백 (effect 없이 파생)
  const focused = choices.find((o) => o.id === focusedId) ?? choices[0];
  const rest = choices.filter((o) => o.id !== focused.id);

  if (dismissed) {
    return (
      <button
        className="iv-pop absolute bottom-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-caption text-ink-secondary shadow-lg hover:bg-surface-alt"
        onClick={() => setDismissedFor(null)}
        data-id="iv-choice-reopen"
      >
        <Layers size={16} strokeWidth={1.5} className="text-accent" />
        View proposals ({choices.length})
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Map proposals"
      className="iv-pop absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-ink/10 p-6"
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
          {/* 좌우로 넓게 — 오버레이 뒤 캔버스는 어차피 안 보는 영역이라 가리는 게 낫다 (실사용 피드백 2026-07-28) */}
          <div className="flex max-h-[80%] min-h-0 w-full flex-1 items-stretch justify-center gap-3">
            <ChoiceWindow
              option={focused}
              disabled={busy}
              onChoose={onChoose}
              highlight={focused.same_as_current ? NO_HIGHLIGHT : highlight.get(focused.id) ?? NO_HIGHLIGHT}
              className="h-full min-w-0 flex-[2]"
              focused
            />
            <div className="flex h-full w-80 shrink-0 flex-col gap-3">
              {rest.map((o) => (
                <ChoiceWindow
                  key={o.id}
                  option={o}
                  disabled={busy}
                  onChoose={onChoose}
                  highlight={o.same_as_current ? NO_HIGHLIGHT : highlight.get(o.id) ?? NO_HIGHLIGHT}
                  className="min-h-0 flex-1"
                  onFocus={() => setFocusedId(o.id)}
                />
              ))}
            </div>
          </div>
        </>
      ) : choices.length === 2 ? (
        <div className="flex max-h-[84%] min-h-0 w-full flex-1 items-center justify-center gap-4">
          {choices.map((o) => (
            <ChoiceWindow
              key={o.id}
              option={o}
              disabled={busy}
              onChoose={onChoose}
              highlight={o.same_as_current ? NO_HIGHLIGHT : highlight.get(o.id) ?? NO_HIGHLIGHT}
              className="h-[min(600px,100%)] w-[min(680px,48%)] min-w-72"
            />
          ))}
        </div>
      ) : (
        <div className="flex max-h-[88%] min-h-0 w-full flex-1 items-center justify-center">
          <ChoiceWindow
            option={focused}
            disabled={busy}
            onChoose={onChoose}
            highlight={focused.same_as_current ? NO_HIGHLIGHT : highlight.get(focused.id) ?? NO_HIGHLIGHT}
            className="h-[min(640px,100%)] w-[min(1100px,92%)] min-w-72"
            focused
          />
        </div>
      )}
    </div>
  );
}
