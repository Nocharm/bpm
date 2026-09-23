"use client";

// 캠페인 ③ 연결 캔버스 — FwCanvas를 ReactFlow로 직접 편집(핸들 드래그로 엣지, 엣지 클릭으로 라벨, 우클릭으로 분기 추가/제거). relations-step 전용.

import { useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type NodeChange,
  type NodeTypes,
  Panel,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AtSign, Copy, GitBranch, LayoutTemplate, Maximize2, Trash2, Undo2 } from "lucide-react";

import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { ProcessNode } from "@/components/process-node";
import type { FwCanvas } from "@/lib/api";
import type { AppNode } from "@/lib/canvas";
import { copyText } from "@/lib/clipboard";
import { autoLayoutFlow } from "@/lib/flow-layout";
import { useI18n } from "@/lib/i18n";
import {
  addBranchAfter,
  canvasToFlow,
  connectNodes,
  flowToCanvas,
  moveNode,
  removeBranch,
  removeEdge,
  setEdgeLabel,
} from "@/lib/relations-canvas";

const nodeTypes: NodeTypes = { process: ProcessNode };
// 임포트 리포트 미리보기 툴바와 같은 칩(map-preview ZOOM_BTN) — 캔버스 위에 얹는 작은 액션
const TOOL_BTN =
  "inline-flex h-5 w-5 items-center justify-center rounded-sm border border-hairline bg-surface/90 text-ink-secondary hover:bg-accent-tint hover:text-accent disabled:opacity-40";

// 캔버스 엣지엔 핸들 개념이 없다 — 표시 단계에서 4변 핸들(sideHandles) + 우→좌로 못 박아 LR 흐름을 고정한다.
function buildFlow(canvas: FwCanvas): { nodes: AppNode[]; edges: Edge[] } {
  const { nodes, edges } = canvasToFlow(canvas);
  return {
    nodes: nodes.map((node) => ({ ...node, data: { ...node.data, sideHandles: true } })),
    edges: edges.map((edge) => ({ ...edge, sourceHandle: "s-right", targetHandle: "t-left" })),
  };
}

interface RelationsCanvasProps {
  canvas: FwCanvas;
  taskNames: Map<string, string>;  // task_id → L6 카드 이름(캔버스 title보다 우선)
  onChange: (next: FwCanvas) => void;  // 부모가 300ms 디바운스로 PUT /canvas
  onMention: (taskId: string, name: string) => void;
  busy: boolean;
}

export function RelationsCanvas(props: RelationsCanvasProps) {
  // fitView(useReactFlow)를 쓰려면 툴바가 Provider 안쪽에 있어야 한다 → 내부 컴포넌트로 한 겹 감싼다
  return (
    <ReactFlowProvider>
      <RelationsFlow {...props} />
    </ReactFlowProvider>
  );
}

function RelationsFlow({ canvas, taskNames, onChange, onMention, busy }: RelationsCanvasProps) {
  const { t } = useI18n();
  const { fitView } = useReactFlow();
  // RF 상태가 편집 중 진실 — 드래그는 여기에만 쌓이고, 구조 변경은 flowToCanvas로 캔버스를 만들어 되돌려 받는다.
  // 부모는 session.canvas가 바뀔 때만 이 서브트리를 리마운트하므로 초기화 1회로 충분하다.
  const [nodes, setNodes] = useState<AppNode[]>(() => buildFlow(canvas).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => buildFlow(canvas).edges);
  const [undoSnapshot, setUndoSnapshot] = useState<FwCanvas | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [labelEdit, setLabelEdit] = useState<{ edgeId: string; x: number; y: number; value: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Escape 취소 — 입력이 사라지며 뒤늦게 blur가 오면 취소한 값이 저장돼 버린다
  const cancelledRef = useRef(false);

  // 현재 화면(위치 포함)을 캔버스로 — 모든 편집 연산의 기준
  function readCanvas(): FwCanvas {
    return flowToCanvas(nodes, edges, canvas);
  }

  function commit(prev: FwCanvas, next: FwCanvas) {
    const flow = buildFlow(next);
    // 실측(measured) 이월 — 노드 객체를 통째로 갈면 한 프레임 동안 엣지가 엉뚱한 자리에 붙는다
    const measured = new Map(nodes.map((node) => [node.id, node.measured]));
    setNodes(flow.nodes.map((node) => {
      const size = measured.get(node.id);
      return size ? { ...node, measured: size } : node;
    }));
    setEdges(flow.edges);
    setUndoSnapshot(prev);
    onChange(next);
  }

  function handleNodesChange(changes: NodeChange<AppNode>[]) {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }

  // 드롭 시점에만 좌표를 커밋 — 되돌리기 스냅샷은 남기지 않는다(구조 변경·자동 정렬 전용)
  function handleNodeDragStop(_event: unknown, _node: AppNode, dragged: AppNode[]) {
    let next = readCanvas();
    for (const node of dragged) next = moveNode(next, node.id, node.position.x, node.position.y);
    onChange(next);
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const base = readCanvas();
    commit(base, connectNodes(base, connection.source, connection.target));
  }

  function handleEdgesDelete(deleted: Edge[]) {
    const base = readCanvas();
    commit(base, deleted.reduce((acc, edge) => removeEdge(acc, edge.id), base));
  }

  function handleEdgeClick(event: React.MouseEvent, edge: Edge) {
    const rect = wrapRef.current?.getBoundingClientRect();
    cancelledRef.current = false;
    setLabelEdit({
      edgeId: edge.id,
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
      value: typeof edge.label === "string" ? edge.label : "",
    });
  }

  function saveLabel() {
    if (!labelEdit || cancelledRef.current) return;
    const base = readCanvas();
    commit(base, setEdgeLabel(base, labelEdit.edgeId, labelEdit.value.trim()));
    setLabelEdit(null);
  }

  function handleAutoLayout() {
    const base = readCanvas();
    const laid = autoLayoutFlow(nodes, edges, "LR");
    let next = base;
    for (const node of laid.nodes) next = moveNode(next, node.id, node.position.x, node.position.y);
    commit(base, next);
    window.requestAnimationFrame(() => void fitView({ padding: 0.2 }));
  }

  function handleUndo() {
    if (!undoSnapshot) return;
    const flow = buildFlow(undoSnapshot);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setUndoSnapshot(null);
    onChange(undoSnapshot);
  }

  function handleNodeContextMenu(event: React.MouseEvent, node: AppNode) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }

  function buildMenuItems(nodeId: string): ContextMenuItem[] {
    const base = readCanvas();
    const node = base.nodes.find((x) => x.id === nodeId);
    if (!node) return [];
    const taskId = node.task_id ?? node.id;
    const name = (node.task_id ? taskNames.get(node.task_id) : undefined) ?? node.title;
    const items: ContextMenuItem[] = [{ title: name }];
    if (node.node_type === "subprocess") {
      items.push(
        { label: t("fwConsult.menuMention"), icon: AtSign, onSelect: () => onMention(taskId, name) },
        { label: t("fwConsult.menuCopyId"), icon: Copy, onSelect: () => void copyText(taskId) },
        { label: t("fwConsult.menuAddBranch"), icon: GitBranch, onSelect: () => commit(base, addBranchAfter(base, nodeId)) },
      );
    } else if (node.node_type === "decision") {
      items.push({
        label: t("fwConsult.menuRemoveBranch"),
        icon: Trash2,
        danger: true,
        onSelect: () => commit(base, removeBranch(base, nodeId)),
      });
    } else {
      items.push({ note: t(node.node_type === "start" ? "nodeType.start" : "nodeType.end") });
    }
    return items;
  }

  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden bg-canvas" data-id="fw-consult-relations-canvas">
      {/* Turbopack이 dev에서 .react-flow__* 규칙을 purge해 raw <style>로 둔다(lessons canvas §5) */}
      <style>{`.react-flow__node{z-index:2 !important}`}</style>
      <div className={`h-full w-full ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable
          nodesDraggable
          elementsSelectable
          onNodesChange={handleNodesChange}
          onNodeDragStop={handleNodeDragStop}
          onConnect={handleConnect}
          onEdgesDelete={handleEdgesDelete}
          onEdgeClick={handleEdgeClick}
          onNodeContextMenu={handleNodeContextMenu}
          fitView
          minZoom={0.2}
          /* 에디터와 동일한 휠/팬 맵핑 — 휠=팬, Ctrl/⌘+휠=줌 */
          panOnDrag
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          zoomOnScroll={false}
          zoomActivationKeyCode={["Control", "Meta"]}
          deleteKeyCode="Delete"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.8} color="var(--color-canvas-dot)" />
          <Panel position="top-right" className="flex gap-1">
            <button
              type="button"
              className={TOOL_BTN}
              data-id="fw-relations-auto-layout"
              title={t("fwConsult.canvasAutoLayout")}
              aria-label={t("fwConsult.canvasAutoLayout")}
              onClick={handleAutoLayout}
            >
              <LayoutTemplate size={12} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className={TOOL_BTN}
              data-id="fw-relations-undo"
              disabled={undoSnapshot === null}
              title={t("fwConsult.canvasUndo")}
              aria-label={t("fwConsult.canvasUndo")}
              onClick={handleUndo}
            >
              <Undo2 size={12} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className={TOOL_BTN}
              data-id="fw-relations-fit"
              title={t("fwConsult.canvasFit")}
              aria-label={t("fwConsult.canvasFit")}
              onClick={() => void fitView({ padding: 0.2 })}
            >
              <Maximize2 size={12} strokeWidth={1.5} />
            </button>
          </Panel>
        </ReactFlow>
      </div>
      {labelEdit && (
        // 캔버스 안쪽 절대 배치 — 포털 없이도 노드(z-2) 위에 뜬다
        <input
          data-id="fw-relations-edge-label"
          autoFocus
          className="absolute z-[5] w-40 rounded-sm border border-accent bg-surface px-1.5 py-1 text-fine text-ink outline-none"
          style={{ left: labelEdit.x, top: labelEdit.y }}
          placeholder={t("fwConsult.edgeLabel")}
          value={labelEdit.value}
          onChange={(event) => setLabelEdit({ ...labelEdit, value: event.target.value })}
          onBlur={saveLabel}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              saveLabel();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelledRef.current = true;
              setLabelEdit(null);
            }
          }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={buildMenuItems(menu.nodeId)} onClose={() => setMenu(null)} />}
    </div>
  );
}
