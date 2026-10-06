"use client";

// 캠페인 ③ 연결 캔버스 — FwCanvas를 ReactFlow로 직접 편집(핸들 드래그로 엣지, 엣지 클릭=선택·더블클릭=라벨·우클릭=라벨/삭제,
// Delete/Backspace로 엣지 삭제, 노드 우클릭으로 분기 추가/제거). relations-step 전용.
// 분기 노드가 아닌 노드는 나가는 엣지가 하나뿐이다(서버 collapse 규칙) — 이미 있는 노드에서 새로 끌면 기존 엣지를 붉게 표시하고
// 확인을 받은 뒤 교체한다(사용자 결정 2026-09-28).

import { useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  Panel,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AtSign, Copy, GitBranch, LayoutTemplate, Maximize2, PenLine, Trash2, Undo2 } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { EDITOR_EDGE_TYPES } from "@/components/multiline-edge";
import { ProcessNode } from "@/components/process-node";
import type { FwCanvas, FwPlanCard } from "@/lib/api";
import { type AppNode, getExternalL5ColorByCode, styleEdgeLabelPill } from "@/lib/canvas";
import { copyText } from "@/lib/clipboard";
import { buildFanGeom, injectFanLanes } from "@/lib/edge-fanout";
import { deriveFlowSideHandles } from "@/lib/flow-side-handles";
import { buildFlowHandleStyle } from "@/lib/flow-handle-style";
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
const WRAP_CLASS = "bpm-fw-relations-flow";
const REPLACING_CLASS = "fw-edge-replacing";  // 교체 확인 중인 기존 엣지 — 붉은 점선
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1.2 };

// 선택 엣지는 액센트, 교체 대기 엣지는 error 점선 — RF 기본 선택 스타일이 서비스 룩과 어긋난다
function buildEdgeStateStyle(scope: string): string {
  return (
    `${scope} .react-flow__edge.selected .react-flow__edge-path{stroke:var(--color-accent) !important;stroke-width:2 !important}` +
    `${scope} .react-flow__edge.${REPLACING_CLASS} .react-flow__edge-path{stroke:var(--color-error) !important;stroke-width:2 !important;stroke-dasharray:6 4}`
  );
}

interface PendingConnect {
  source: string;
  target: string;
  replaceEdgeId: string;  // 같은 노드에서 이미 나가는 엣지 — 확인 후 지우고 새 엣지를 잇는다
}

// 캔버스 엣지엔 핸들 개념이 없다 — 표시 단계에서 4변 핸들(sideHandles)에 자동정렬과 같은 규칙(역행=위, 곁가지=위·아래,
// 그 외 우→좌)으로 변을 고른다(flow-side-handles). 자동정렬 직후·새로고침 뒤에도 같은 좌표면 같은 변이다.
// 라벨은 에디터와 같은 알약(styleEdgeLabelPill) — 엣지 타입이 에디터 HTML 라벨(EDITOR_EDGE_TYPES)이라 배경이 따로 필요하다.
// deletable=false — L6 카드는 캔버스에 늘 남아야 하고 분기 마름모는 컨텍스트 메뉴로만 걷는다. Delete가
// 노드까지 지우면 deleteElements가 연결 엣지를 먼저 떼어내 서버엔 고아 노드가, 화면엔 없는 노드가 남는다.
// 라벨은 L6 카드 이름(taskNames)이 캔버스 title보다 우선 — 카드를 고쳐 부르면 노드도 새 이름으로 보인다.
// 카드의 요약·역할·부서는 L5 맵의 L6 노드가 SP 지정값으로 보여주는 자리(sp*)에 넣어 같은 룩으로 읽힌다 —
// 등록 전이라 링크 맵이 없으니 그 외 파라미터(Σ 등)는 비어 있다.
function buildFlow(
  canvas: FwCanvas,
  taskNames: Map<string, string>,
  taskCards: Map<string, FwPlanCard>,
  // 실측 크기 — 이월하면 변 판정(중심점)이 자동정렬과 같은 박스를 본다
  measured?: ReadonlyMap<string, AppNode["measured"]>,
): { nodes: AppNode[]; edges: Edge[] } {
  const { nodes, edges } = canvasToFlow(canvas);
  const taskIdByNode = new Map(canvas.nodes.map((node) => [node.id, node.task_id]));
  const flowNodes = nodes.map((node): AppNode => {
    const taskId = taskIdByNode.get(node.id);
    const name = taskId ? taskNames.get(taskId) : undefined;
    const card = taskId ? taskCards.get(taskId) : undefined;
    return {
      ...node,
      deletable: false,
      data: {
        ...node.data,
        ...(name ? { label: name } : {}),
        ...(card ? { description: card.summary, spAssigneeRole: card.owner_role || null, spDepartment: card.department || null } : {}),
        // 외부 참조 카드는 연계 캔버스의 외부 L6 룩(출처 L5 배지·외부 스타일)으로 — 등록 후 플레이스홀더/링크가 되는 자리(2026-09-29)
        ...(card?.mode === "external" && card.external
          ? { spOriginPath: card.external.l5_label || card.external.l5_code, color: getExternalL5ColorByCode(card.external.l5_code) }
          : {}),
        sideHandles: true,
        hideLinkBanner: true,
      },
      ...(measured?.get(node.id) ? { measured: measured.get(node.id) } : {}),
    };
  });
  return { nodes: flowNodes, edges: deriveFlowSideHandles(flowNodes, edges).map(styleEdgeLabelPill) };
}

interface RelationsCanvasProps {
  canvas: FwCanvas;
  taskNames: Map<string, string>;  // task_id → L6 카드 이름(캔버스 title보다 우선)
  taskCards: Map<string, FwPlanCard>;  // task_id → 계획 카드(요약·역할·부서를 노드에 표시)
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

function RelationsFlow({ canvas, taskNames, taskCards, onChange, onMention, busy }: RelationsCanvasProps) {
  const { t } = useI18n();
  const { fitView } = useReactFlow();
  // RF 상태가 편집 중 진실 — 드래그는 여기에만 쌓이고, 구조 변경은 flowToCanvas로 캔버스를 만들어 되돌려 받는다.
  // 부모는 session.canvas가 바뀔 때만 이 서브트리를 리마운트하므로 초기화 1회로 충분하다.
  const [nodes, setNodes] = useState<AppNode[]>(() => buildFlow(canvas, taskNames, taskCards).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => buildFlow(canvas, taskNames, taskCards).edges);
  const [undoSnapshot, setUndoSnapshot] = useState<FwCanvas | null>(null);
  // 엣지 메뉴는 캔버스 기준 좌표(localX/Y)도 들고 있다 — 메뉴 항목(렌더 중 생성)이 ref 없이 라벨 입력 위치를 정하게
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string; edgeId?: string; localX?: number; localY?: number } | null>(null);
  const [labelEdit, setLabelEdit] = useState<{ edgeId: string; x: number; y: number; value: string } | null>(null);
  const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Escape 취소 — 입력이 사라지며 뒤늦게 blur가 오면 취소한 값이 저장돼 버린다
  const cancelledRef = useRef(false);

  // 현재 화면(위치 포함)을 캔버스로 — 모든 편집 연산의 기준
  function readCanvas(): FwCanvas {
    return flowToCanvas(nodes, edges, canvas);
  }

  function commit(prev: FwCanvas, next: FwCanvas) {
    // 실측(measured) 이월 — 노드 객체를 통째로 갈면 한 프레임 동안 엣지가 엉뚱한 자리에 붙는다
    const measured = new Map(nodes.map((node) => [node.id, node.measured]));
    const flow = buildFlow(next, taskNames, taskCards, measured);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setUndoSnapshot(prev);
    onChange(next);
  }

  function handleNodesChange(changes: NodeChange<AppNode>[]) {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }

  // 제어형 edges는 onEdgesChange 없이는 select 변경이 버려진다 — 그러면 어떤 엣지도 selected가 안 되고
  // Delete 경로(선택 엣지 수집)가 영원히 비어 onEdgesDelete가 불리지 않는다.
  function handleEdgesChange(changes: EdgeChange<Edge>[]) {
    setEdges((eds) => applyEdgeChanges(changes, eds));
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
    const sourceNode = base.nodes.find((node) => node.id === connection.source);
    const duplicate = base.edges.some((edge) => edge.source_node_id === connection.source && edge.target_node_id === connection.target);
    if (duplicate) return;
    // 분기(decision) 노드만 여러 갈래로 나간다 — 그 외 노드의 두 번째 나가는 엣지는 기존 것을 교체한다(확인 게이트)
    const outgoing = base.edges.find((edge) => edge.source_node_id === connection.source);
    if (outgoing && sourceNode?.node_type !== "decision") {
      setPendingConnect({ source: connection.source, target: connection.target, replaceEdgeId: outgoing.id });
      return;
    }
    commit(base, connectNodes(base, connection.source, connection.target));
  }

  function confirmReplace() {
    if (!pendingConnect) return;
    const base = readCanvas();
    commit(base, connectNodes(removeEdge(base, pendingConnect.replaceEdgeId), pendingConnect.source, pendingConnect.target));
    setPendingConnect(null);
  }

  function handleEdgesDelete(deleted: Edge[]) {
    const base = readCanvas();
    commit(base, deleted.reduce((acc, edge) => removeEdge(acc, edge.id), base));
  }

  function deleteEdge(edgeId: string) {
    const base = readCanvas();
    commit(base, removeEdge(base, edgeId));
  }

  // 더블클릭·우클릭 메뉴에서 라벨 편집 — 단일 클릭은 선택만(Delete/Backspace가 먹게 입력창이 포커스를 뺏지 않는다).
  // 취소 플래그는 입력이 포커스를 받을 때 내린다(onFocus) — 메뉴 항목이 ref를 만지지 않게.
  function startLabelEdit(edge: Edge, x: number, y: number) {
    setLabelEdit({ edgeId: edge.id, x, y, value: typeof edge.label === "string" ? edge.label : "" });
  }

  function toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  function handleEdgeDoubleClick(event: React.MouseEvent, edge: Edge) {
    const local = toLocal(event.clientX, event.clientY);
    startLabelEdit(edge, local.x, local.y);
  }

  function handleEdgeContextMenu(event: React.MouseEvent, edge: Edge) {
    event.preventDefault();
    const local = toLocal(event.clientX, event.clientY);
    setMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id, localX: local.x, localY: local.y });
  }

  function saveLabel() {
    if (!labelEdit || cancelledRef.current) return;
    const base = readCanvas();
    commit(base, setEdgeLabel(base, labelEdit.edgeId, labelEdit.value.trim()));
    setLabelEdit(null);
  }

  function handleAutoLayout() {
    const base = readCanvas();
    // 좌표만 커밋 — 핸들은 commit의 buildFlow가 새 좌표로 같은 규칙(deriveFlowSideHandles)을 적용해 laid.edges와 같은 변이 된다
    const laid = autoLayoutFlow(nodes, edges, "LR");
    let next = base;
    for (const node of laid.nodes) next = moveNode(next, node.id, node.position.x, node.position.y);
    commit(base, next);
    window.requestAnimationFrame(() => void fitView(FIT_VIEW_OPTIONS));
  }

  function handleUndo() {
    if (!undoSnapshot) return;
    const flow = buildFlow(undoSnapshot, taskNames, taskCards);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setUndoSnapshot(null);
    onChange(undoSnapshot);
  }

  function handleNodeContextMenu(event: React.MouseEvent, node: AppNode) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }

  function buildEdgeMenuItems(edgeId: string): ContextMenuItem[] {
    const edge = edges.find((x) => x.id === edgeId);
    if (!edge) return [];
    const label = typeof edge.label === "string" && edge.label ? edge.label : t("fwConsult.edgeLabel");
    return [
      { title: label },
      { label: t("fwConsult.menuEditLabel"), icon: PenLine, onSelect: () => startLabelEdit(edge, menu?.localX ?? 0, menu?.localY ?? 0) },
      { divider: true },
      { label: t("fwConsult.menuDeleteEdge"), icon: Trash2, danger: true, onSelect: () => deleteEdge(edgeId) },
    ];
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
    <div ref={wrapRef} className={`relative min-h-0 flex-1 overflow-hidden bg-canvas ${WRAP_CLASS}`} data-id="fw-consult-relations-canvas">
      {/* Turbopack이 dev에서 .react-flow__* 규칙을 purge해 raw <style>로 둔다(lessons canvas §5).
          이 캔버스 래퍼로 한정 — 같은 단계의 카드 미리보기 모달이 또 다른 RF 인스턴스를 띄운다.
          핸들·호버 강조는 에디터와 같은 단일 소스(lib/flow-handle-style.ts) — RF 기본 파란 원형 핸들이 서비스 룩과 어긋난다. */}
      <style>{`.${WRAP_CLASS} .react-flow__node{z-index:2 !important}${buildFlowHandleStyle(`.${WRAP_CLASS}`)}${buildEdgeStateStyle(`.${WRAP_CLASS}`)}`}</style>
      <div className={`h-full w-full ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <ReactFlow
          nodes={nodes}
          // 교체 확인 중인 엣지는 className으로 붉게 — 사용자가 무엇이 지워질지 보고 결정한다
          // 같은 핸들 형제 팬 레인(렌더 전용, lib/edge-fanout) — 에디터 엣지 타입이 data.fan으로 펼친다
          edges={injectFanLanes(
            pendingConnect ? edges.map((edge) => (edge.id === pendingConnect.replaceEdgeId ? { ...edge, className: REPLACING_CLASS } : edge)) : edges,
            buildFanGeom(nodes),
          )}
          nodeTypes={nodeTypes}
          // 에디터 엣지(최소 높이 40px·팬아웃·장애물 우회·다중행 HTML 라벨) — 같은 연결이 에디터와 같은 모양으로 그려진다
          edgeTypes={EDITOR_EDGE_TYPES}
          nodesConnectable
          nodesDraggable
          elementsSelectable
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          onConnect={handleConnect}
          onEdgesDelete={handleEdgesDelete}
          onEdgeDoubleClick={handleEdgeDoubleClick}
          onEdgeContextMenu={handleEdgeContextMenu}
          onNodeContextMenu={handleNodeContextMenu}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.2}
          // 우하단 어트리뷰션 마크 숨김(공식 proOptions) — 에디터와 동일
          proOptions={{ hideAttribution: true }}
          /* 에디터와 동일한 휠/팬 맵핑 — 휠=팬, Ctrl/⌘+휠=줌 */
          panOnDrag
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          zoomOnScroll={false}
          zoomActivationKeyCode={["Control", "Meta"]}
          deleteKeyCode={["Delete", "Backspace"]}
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
              onClick={() => void fitView(FIT_VIEW_OPTIONS)}
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
          onFocus={() => { cancelledRef.current = false; }}
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.edgeId !== undefined ? buildEdgeMenuItems(menu.edgeId) : buildMenuItems(menu.nodeId ?? "")}
          onClose={() => setMenu(null)}
        />
      )}
      {pendingConnect && (
        <ConfirmDialog
          dialogId="fw-relations-replace-edge"
          title={t("fwConsult.replaceEdgeTitle")}
          message={t("fwConsult.replaceEdgeMessage")}
          confirmLabel={t("fwConsult.replaceEdgeConfirm")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={confirmReplace}
          onClose={() => setPendingConnect(null)}
        />
      )}
    </div>
  );
}
