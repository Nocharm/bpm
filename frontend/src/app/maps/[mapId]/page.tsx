"use client";

import { AlignCenterHorizontal, AlignCenterVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowLeft, ArrowLeftRight, ArrowRight, Boxes, Check, ChevronRight, CornerDownRight, Download, FoldHorizontal, LayoutGrid, Lock, LogOut, Maximize, Network, PanelRight, PencilLine, Redo2, Undo2, UnfoldHorizontal } from "lucide-react";
import {
  addEdge,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  type Connection,
  type Edge,
  MarkerType,
  type NodeChange,
  type NodeTypes,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ScopeWindow } from "@/components/scope-window";
import { loadWindowGeoms, saveWindowGeoms, type WindowGeom } from "@/lib/window-store";

import { AiChatPanel } from "@/components/ai-chat-panel";
import { ApproverManager } from "@/components/approver-manager";
import { CanvasZoomScale } from "@/components/canvas-zoom-scale";
import { CommentSection } from "@/components/comment-section";
import { WorkflowDashboard } from "@/components/workflow-dashboard";
import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { EdgeBranchModal } from "@/components/edge-branch-modal";
import { EditorLeftSidebar } from "@/components/editor-left-sidebar";
import { ExpandInvariantModal } from "@/components/expand-invariant-modal";
import { GroupBox } from "@/components/group-box";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { GroupBulkModal, type BulkAttrField } from "@/components/group-bulk-modal";
import { GroupTitleBar } from "@/components/group-title-bar";
import { NodeSummaryModal } from "@/components/node-summary-modal";
import { ProcessNode } from "@/components/process-node";
import { ScopePreview } from "@/components/scope-preview";
import { ShortcutLegend } from "@/components/shortcut-legend";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { WindowDock } from "@/components/window-dock";
import {
  alignSelected,
  buildOutline,
  distributeSelected,
  layoutWithDagre,
  layoutSubsetWithDagre,
  makeUniqueLabel,
  nodeSizeOf,
  normalizeNodeType,
  resolveCollision,
  getIncomingEdges,
  getOutgoingEdges,
  insertNodeBefore,
  insertNodeAfter,
  pickDropZone,
  rectWithExclusions,
  branchKindOf,
  sideFromHandleId,
  sourceHandleId,
  targetHandleId,
  BRANCH_YES_LABEL,
  BRANCH_NO_LABEL,
  EDGE_DEFAULTS,
  NODE_HEIGHT,
  NODE_TYPE_OPTIONS,
  NODE_WIDTH,
  type AppNode,
  type BranchKind,
  type DropZone,
  type HandleSide,
  type NodeData,
  type OutlineEdge,
  type OutlineNode,
  type ProcessNodeType,
} from "@/lib/canvas";
import {
  acquireCheckout,
  approveVersion,
  createComment,
  createVersion,
  deleteComment,
  deleteVersion,
  getFullGraph,
  getGraph,
  getMap,
  getMe,
  getWorkflowState,
  listComments,
  publishVersion,
  rejectVersion,
  releaseCheckout,
  renameVersion,
  saveGraph,
  submitVersion,
  updateComment,
  withdrawVersion,
  type AiProposal,
  type CheckoutState,
  type CommentItem,
  type FlatNode,
  type Graph,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type VersionGraph,
  type VersionSummary,
  type WorkflowState,
} from "@/lib/api";
import { exportCanvasPng } from "@/lib/export";
import { matchesQuery } from "@/lib/hangul";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { EXPANSION_LIMITS } from "@/lib/expansion-config";
import { buildGatewayEdges, checkExpansionLimits, checkScopeInvariant } from "@/lib/inline-expand";
import {
  NODE_DISPLAY_FIELDS,
  NodeActionsContext,
  type NodeDisplayField,
} from "@/lib/node-actions";

// 모듈 스코프 — 안정적 식별자 유지 (React Flow 권장)
const nodeTypes: NodeTypes = { process: ProcessNode };

const DWELL_MS = 300; // 노드 위에 머무는 시간이 이만큼 넘으면 드롭 영역(앞/그룹/뒤) 표시
const DROP_GAP = 24; // 삽입 시 A를 B 좌/우로 떨어뜨리는 간격
const GROUP_PAD = 16; // 그룹 박스가 멤버 bounding box를 감싸는 여백
const GROUP_TITLE_GAP = 26; // 박스 상단에 타이틀바를 얹을 추가 여백 — 멤버 노드와 제목 겹침 방지
const EXTENT_MARGIN = 600; // 우/하단 패닝·노드 여백 — 콘텐츠 성장 여유
const EXTENT_TOPLEFT_MARGIN = 120; // 좌/상단 여백 — 작게(좌상단 고정: 위/왼쪽으로 콘텐츠가 가운데로 밀리지 않게)
const MIN_ZOOM = 0.2; // 최소 줌 — translateExtent 우하단 확장(pane/MIN_ZOOM)이 이 값과 일치해야 줌아웃 centering 방지
// 엣지 라벨(분기 Yes/No/기타 등) — 디자인 토큰으로 알약 스타일(서피스 배경 + hairline 테두리 + ink 텍스트)
const EDGE_LABEL_STYLE = { fill: "var(--color-ink)", fontWeight: 600, fontSize: 11 };
const EDGE_LABEL_BG_STYLE = { fill: "var(--color-surface)", stroke: "var(--color-hairline)" };
const EDGE_LABEL_BG_PADDING: [number, number] = [6, 3];
const INLINE_GATEWAY_OPACITY = 0.55; // 인라인 펼침 게이트웨이(A→Start, End→후속) — 연결을 또렷이
const CHILD_SAVE_DEBOUNCE_MS = 700; // 자식 속성 편집 후 자식 스코프 PUT까지 대기(키 입력마다 저장 방지)
const REGION_PAD = 28; // 하위 영역 안쪽 좌우 여백
const REGION_GAP = 48; // A↔영역, 영역↔우측 노드 간격
const REGION_MARGIN = 48; // 영역 세로 레인이 콘텐츠 위아래로 더 뻗는 여백
const REGION_CROSSING_OPACITY = 0.35; // 영역을 가로지르는 엣지 반투명
const INACTIVE_SCOPE_OPACITY = 0.4; // 포커스 모드 — 비활성(인라인 자식) 스코프 노드/엣지 dim. 활성 스코프만 또렷·편집
const ZONE_RADIUS_PAD = 32; // 링 반경 = max(노드 변) + 이 값 — 타일 배치 반경(오버레이 렌더와 hit-test 공용)
const ZONE_TILE_W = 84;
const ZONE_TILE_H = 58;
const AI_WINDOW_KEY = "ai"; // windowGeom 맵에서 AI 플로팅 창 기하 키 (스코프 키와 충돌 없음)

type ScreenRect = { left: number; top: number; width: number; height: number; radius: number };

// 색 프리셋 — 첫 항목(빈 값)은 타입 기본색. 세련된 무채도(muted) 8톤 stroke(데이터/출력 예외).
const COLOR_PRESETS = [
  "",
  "#6e84a3", // slate blue
  "#5e988f", // teal
  "#84a07c", // sage
  "#c7a062", // amber
  "#c58a6b", // clay
  "#c2849a", // rose
  "#9183c0", // violet
  "#909098", // stone
];

// 그룹 전용 팔레트 — 노드보다 깊은 "존/라벨" 톤(노드 색과 분리해 묶음 영역을 구분)
const GROUP_COLOR_PRESETS = [
  "#4a5a8c", // indigo
  "#3f7d72", // pine
  "#5c7a4e", // moss
  "#a87b3e", // bronze
  "#a65d3e", // sienna
  "#8c5a72", // plum
  "#6e5aa0", // iris
  "#5f6068", // graphite
];

const HISTORY_LIMIT = 50; // 스코프당 undo 스냅샷 상한 — 메모리/실용 균형
const TEXT_HISTORY_GAP_MS = 2000; // 타이핑은 이 간격 안에서 한 번의 undo 단위로 묶음
const AUTO_SAVE_DELAY_MS = 2000; // 마지막 변경 후 자동 저장까지의 디바운스
const CHECKOUT_HEARTBEAT_MS = 10_000; // 체크아웃 연장 주기 — TTL(기본 30분) 대비 충분히 짧게
const COMMENT_POLL_MS = 5_000; // 코멘트 "실시간" 폴링 주기 (spec §7 Phase C)

const SEARCH_RESULT_LIMIT = 20; // 검색 드롭다운 최대 표시 수

type Scope = { parentId: string | null; title: string };
type SearchResult = { node: FlatNode; path: string; scopes: Scope[] };
type Snapshot = { nodes: AppNode[]; edges: Edge[]; groups: GraphGroup[] };
type SaveState = "idle" | "saving" | "saved" | "error";
// 인라인 펼침 하위 영역 박스 — 깊이 틴트 배경 렌더용(flow 좌표 절대배치)
type RegionBox = {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

// 인라인 펼침 영역 — 세로선 2개 + 반투명 틴트가 보이는 캔버스를 위아래로 가득 채우는 "세로 레인".
// 별도 컴포넌트(useViewport 구독)라 줌/팬 시 이 부분만 리렌더되고 에디터 본체는 영향 없음.
function InlineRegionBands({
  regions,
  baseDepth,
  onCollapse,
}: {
  regions: RegionBox[];
  baseDepth: number; // 현재 스코프의 절대깊이 — 셰브론을 절대깊이(루트 기준)로 표시해 포커스 레인과 통일
  onCollapse: (id: string) => void;
}) {
  const { t } = useI18n();
  const { y, zoom } = useViewport();
  const paneHeight = useStore((state) => state.height);
  // ViewportPortal은 flow 좌표계 — 화면(0..paneHeight px)을 덮도록 flow 좌표로 변환
  const topFlow = -y / zoom;
  const bandHeight = paneHeight / zoom;
  return (
    <>
      {regions.map((box) => (
        <Fragment key={`region:${box.id}`}>
          {/* 세로선 2개 + 반투명 틴트 — 화면 전체 높이. 깊을수록 틴트가 겹쳐 진해짐. 노드 뒤(z<0), 비상호작용 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${box.x}px, ${topFlow}px)`,
              width: box.width,
              height: bandHeight,
              zIndex: -1,
              pointerEvents: "none",
              background: "color-mix(in srgb, var(--color-accent) 5%, transparent)",
              borderLeft: "1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
              borderRight: "1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
            }}
          />
          {/* 깊이 표시(›×depth) + 이름 — 콘텐츠 상단 근처, 클릭 시 접기 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${box.x + 6}px, ${box.y + 4}px)`,
              zIndex: 1,
            }}
          >
            <button
              type="button"
              className="pointer-events-auto inline-flex items-center gap-1 rounded-xs px-1 py-0.5 text-fine hover:bg-accent-tint"
              title={t("node.collapseChildTitle")}
              onClick={() => onCollapse(box.id)}
            >
              <span className="font-semibold tracking-tight text-accent">
                {"›".repeat(baseDepth + box.depth)}
              </span>
              <span className="text-ink-secondary">{box.label || t("node.childBadge")}</span>
            </button>
          </div>
        </Fragment>
      ))}
    </>
  );
}

// 포커스 스코프의 "레인" — 활성 스코프 좌우 세로 경계선 + 그 사이만 깊이 틴트(바깥은 부모/깊이0 바탕).
// 별도 컴포넌트(useViewport 구독)라 줌/팬 시 이 부분만 리렌더. 화면 전체 높이로 뻗는다.
function FocusScopeBands({
  left,
  right,
  top,
  depth,
  label,
}: {
  left: number;
  right: number;
  top: number;
  depth: number;
  label: string;
}) {
  const { t } = useI18n();
  const { y, zoom } = useViewport();
  const paneHeight = useStore((state) => state.height);
  const topFlow = -y / zoom;
  const bandHeight = paneHeight / zoom;
  return (
    <>
      {/* 레인 틴트(세로선 사이만) + 좌우 세로선 — 인라인 펼침(InlineRegionBands)과 동일: flat 5%, 중첩되면 겹쳐 진해짐. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${left}px, ${topFlow}px)`,
          width: right - left,
          height: bandHeight,
          background: "color-mix(in srgb, var(--color-accent) 5%, transparent)",
          borderLeft: "1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          borderRight: "1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          zIndex: -1,
          pointerEvents: "none",
        }}
      />
      {/* 깊이 표시(›×절대깊이) + 이름 — 인라인 펼침과 동일 언어. 첫 노드 위(top-26)에 띄워 노드와 겹치지 않게. 비상호작용 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${left + 6}px, ${top - 26}px)`,
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <span className="inline-flex items-center gap-1 rounded-xs px-1 py-0.5 text-fine">
          <span className="font-semibold tracking-tight text-accent">{"›".repeat(depth)}</span>
          <span className="text-ink-secondary">{label || t("node.childBadge")}</span>
        </span>
      </div>
    </>
  );
}
type MenuState = {
  x: number;
  y: number;
  kind: "pane" | "node" | "edge" | "group" | "selection";
  targetId: string | null;
};

function toAppNodes(graph: Graph, scopeId: string | null = null): AppNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: node.pos_x, y: node.pos_y },
    data: {
      label: node.title,
      description: node.description,
      nodeType: normalizeNodeType(node.node_type),
      color: node.color,
      assignee: node.assignee,
      department: node.department,
      system: node.system,
      duration: node.duration,
      groupIds: node.group_ids ?? [],
      hasChildren: node.has_children ?? false,
      scopeId,
      linkedMapId: node.linked_map_id,
      followLatest: node.follow_latest,
      linkedVersionId: node.linked_version_id,
      isPrimaryEnd: node.is_primary_end,
    },
  }));
}

// 그룹 태그 추가(중복 제거) — 다중 태그 멤버십
function addTags(existing: string[], add: string[]): string[] {
  const set = new Set(existing);
  for (const id of add) {
    set.add(id);
  }
  return Array.from(set);
}

function toAppEdges(graph: Graph): Edge[] {
  return graph.edges.map((edge) => ({
    ...EDGE_DEFAULTS,
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
    // 백엔드가 raw handle id를 보내면 우선 사용(subprocess end 핸들); 없으면 side에서 파생
    sourceHandle: edge.source_handle ?? sourceHandleId((edge.source_side as HandleSide) || "right"),
    targetHandle: edge.target_handle ?? targetHandleId((edge.target_side as HandleSide) || "left"),
  }));
}

// 자식 스코프 저장용 — NodeData 패치(편집 오버레이)를 GraphNode 필드로 반영(label→title 등).
function patchGraphNode(node: GraphNode, patch: Partial<NodeData>): GraphNode {
  return {
    ...node,
    ...(patch.label !== undefined ? { title: patch.label } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
    ...(patch.department !== undefined ? { department: patch.department } : {}),
    ...(patch.system !== undefined ? { system: patch.system } : {}),
    ...(patch.duration !== undefined ? { duration: patch.duration } : {}),
  };
}

function buildGraph(nodes: AppNode[], edges: Edge[], groups: GraphGroup[]): Graph {
  // 자기완결적 payload 보장 — 백엔드 검증(엣지·group 참조) 422 방지
  const nodeIds = new Set(nodes.map((node) => node.id));
  // 어느 노드든 태그로 가진 그룹만 보존(빈 그룹 제거)
  const referencedGroupIds = new Set<string>();
  for (const node of nodes) {
    for (const gid of node.data.groupIds) {
      referencedGroupIds.add(gid);
    }
  }
  const keptGroups = groups.filter((group) => referencedGroupIds.has(group.id));
  const groupIds = new Set(keptGroups.map((group) => group.id));
  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      title: node.data.label,
      description: node.data.description,
      node_type: node.data.nodeType,
      color: node.data.color,
      assignee: node.data.assignee,
      department: node.data.department,
      system: node.data.system,
      duration: node.data.duration,
      pos_x: node.position.x,
      pos_y: node.position.y,
      sort_order: index,
      // 보존된 그룹만 남김(고아 태그 제거)
      group_ids: node.data.groupIds.filter((gid) => groupIds.has(gid)),
      linked_map_id: node.data.linkedMapId ?? null,
      follow_latest: node.data.followLatest ?? false,
      linked_version_id: node.data.linkedVersionId ?? null,
      is_primary_end: node.data.isPrimaryEnd ?? false,
    })),
    // 양 끝이 모두 payload 노드인 엣지만 — 누락 노드 참조 제거
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map<GraphEdge>((edge) => ({
        id: edge.id,
        source_node_id: edge.source,
        target_node_id: edge.target,
        label: typeof edge.label === "string" ? edge.label : "",
        source_side: sideFromHandleId(edge.sourceHandle, "right"),
        target_side: sideFromHandleId(edge.targetHandle, "left"),
        source_handle: edge.sourceHandle ?? null,
        target_handle: edge.targetHandle ?? null,
      })),
    groups: keptGroups.map((group) => ({
      id: group.id,
      // 평면 다중 태그 모델 — 중첩(parent_group_id) 미사용
      parent_group_id: null,
      label: group.label,
      color: group.color,
    })),
  };
}

function MapEditor({ mapId }: { mapId: number }) {
  const { t } = useI18n();
  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([{ parentId: null, title: "홈" }]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [windowGeom, setWindowGeom] = useState<Record<string, WindowGeom>>({});
  const [zOrder, setZOrder] = useState<string[]>([]);
  const [bounds, setBounds] = useState({ w: 960, h: 640 });
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  // 펼친 자식 노드 — 메인 nodes(현재 스코프)와 분리해 둔다. React Flow가 측정·이벤트를 라우팅하도록 displayNodes에 포함하되,
  // nodes를 오염시키지 않아 아웃라인·저장·라우팅 등 기존 가정이 깨지지 않는다(회귀 0). scopeId = 펼친 부모 id.
  const [childNodes, setChildNodes] = useState<AppNode[]>([]);
  // 드래그 중인 자식 id — 드래그 중엔 displayNodes가 childNodes(절대)위치를, 아니면 buildScope 파생위치를 쓴다.
  const [draggingChildIds, setDraggingChildIds] = useState<Set<string>>(new Set());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [groups, setGroups] = useState<GraphGroup[]>([]);
  // 방금 생성된 그룹 id — 해당 GroupTitleBar가 마운트 시 이름 편집모드로 진입하도록 신호
  const [newGroupId, setNewGroupId] = useState<string | null>(null);
  // 아웃라인 전체 그래프(하위 프로세스 펼치기용) + 펼친 노드 집합
  const [fullGraph, setFullGraph] = useState<VersionGraph | null>(null);
  const [expandedOutline, setExpandedOutline] = useState<Set<string>>(new Set());
  // 캔버스 인라인 펼친 노드 id 집합 — 아웃라인용 expandedOutline과 분리. 스코프/버전 전환 시 초기화.
  const [expandedInline, setExpandedInline] = useState<Set<string>>(new Set());
  // 펼침 한도 초과 시 확인 모달 — next=적용 대기 집합
  const [capPrompt, setCapPrompt] = useState<{
    next: Set<string>;
    nodeCount: number;
    depth: number;
  } | null>(null);
  // 하위 생성 시 후속(나가는 엣지) 없는 노드 — 진행 방법 확인 모달. proceed=후속 확보 후 실행할 동작(생성/드롭 공용)
  const [subprocessPrompt, setSubprocessPrompt] = useState<{
    nodeId: string;
    proceed: () => void;
  } | null>(null);
  // 후속 노드 직접 선택 모드 — 클릭한 노드를 후속으로 연결 후 proceed 실행
  const [pendingSubprocessPick, setPendingSubprocessPick] = useState<{
    sourceId: string;
    proceed: () => void;
  } | null>(null);
  // 삭제로 하위 프로세스 불변식이 깨질 때 — 통째 삭제 확인 모달(값=깨지는 자식 스코프 id = currentParentId)
  const [deleteInvariantPrompt, setDeleteInvariantPrompt] = useState<string | null>(null);
  // 인라인 펼친 자식 노드의 낙관적 편집 오버레이(자식 id→바뀐 필드) — PUT 후 fullGraph가 반영, 스코프 전환 시 초기화.
  const [childEdits, setChildEdits] = useState<Map<string, Partial<NodeData>>>(new Map());
  // 펼침/접힘 직후 잠깐 true — 노드 transform 전환(슬라이드 애니메이션) CSS 클래스 토글용
  const [expandAnimating, setExpandAnimating] = useState(false);
  // 사용자 펼침/접힘 — 전환(transition)은 "전환이 정의된 상태"가 먼저 칠해진 뒤 값이 바뀌어야 발동한다.
  // 따라서 애니메이션 클래스를 먼저 켜고(렌더1) 다음 프레임에 위치(expandedInline)를 바꿔(렌더2) 슬라이드시킨다.
  const commitExpanded = useCallback(
    (next: Set<string> | ((current: Set<string>) => Set<string>)) => {
      setExpandAnimating(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setExpandedInline(next));
      });
    },
    [],
  );
  // 좌측 사이드바 접힘 / 우측 인스펙터 열림·폭(로컬 영속, 220~480 clamp)
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // 서버·클라이언트 첫 렌더 모두 320으로 결정적 — localStorage 복원은 마운트 후 effect에서 (hydration mismatch 방지)
  const [inspectorWidth, setInspectorWidth] = useState(320);
  // 대시보드 패널 높이(px) — 사용자 조절, localStorage 영속
  const [dashboardHeight, setDashboardHeight] = useState(260);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // 판단 노드에서 분기(Yes/No/기타) 라벨을 기다리는 대상.
  // connection: 핸들 드래그(엣지 미생성, 선택 시 생성) / edge: 노드 드롭으로 이미 생성된 엣지에 라벨 부여
  const [branchPrompt, setBranchPrompt] = useState<
    { kind: "connection"; connection: Connection } | { kind: "edge"; edgeId: string } | null
  >(null);
  const [summaryNodeId, setSummaryNodeId] = useState<string | null>(null);
  // 인라인 이름 편집 중인 노드 — 더블클릭으로 진입, NodeActionsContext로 ProcessNode에 전달
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [bulkEditGroupId, setBulkEditGroupId] = useState<string | null>(null);
  // 토스트 스택 — 새 항목은 위에 쌓이고(prepend) 각자 슬라이드 아웃 후 자동 제거
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const removeToast = useCallback((id: string) => {
    setToasts((cur) => cur.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback((message: string) => {
    setToasts((cur) => [{ id: genId(), message }, ...cur]);
  }, []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 검색 결과로 스코프 이동 후 포커스할 노드 — 스코프 로드 완료 시 소비
  const focusNodeIdRef = useRef<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  // 언마운트/버전 전환 시 해제 여부 판단용 — 상태와 달리 cleanup에서 즉시 읽힘
  const checkoutMineRef = useRef(false);
  // 신원·워크플로우 상태 (spec §workflow 2026-06-14)
  const [username, setUsername] = useState<string | null>(null);
  const [mapOwner, setMapOwner] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [managingApprovers, setManagingApprovers] = useState(false);

  // AI 채팅 패널 상태
  const [aiOpen, setAiOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPreviewActive, setAiPreviewActive] = useState(false);
  const aiPreviewRef = useRef(false);

  // 엣지 스타일 — 맵 전역(모든 엣지 일괄). React Flow 빌트인 타입: default=곡선, smoothstep=꺾은선, straight=직선. localStorage 영속.
  const [edgeStyle, setEdgeStyle] = useState<"default" | "smoothstep" | "straight">("smoothstep");

  // 드래그-오버 드롭 영역 (Phase 1: 앞/뒤 흐름 삽입). rect는 활성 시점에 계산해 저장(렌더 중 ref 접근 회피).
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    zone: DropZone | null;
    rect: ScreenRect;
  } | null>(null);
  // 드래그 노드가 기존 그룹 박스 빈 영역 위에 머무는 중 — 합류 대상 그룹 id(펄스 강조)
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const groupDropTargetRef = useRef<string | null>(null);
  const dwellRef = useRef<{ id: string; since: number } | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 드래그 시작 시점의 노드 위치 — 위치 교환(swap) 시 드래그 노드의 원래 자리 복원용
  const dragStartPosRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragCursorRef = useRef({ x: 0, y: 0 }); // 컨테이너 상대 커서 — 타일 적중 판정용
  // 기존 엣지 충돌 시 유지/삽입 되묻기 팝오버
  const [pending, setPending] = useState<{
    mode: DropZone;
    aId: string;
    bId: string;
    rect: ScreenRect;
  } | null>(null);

  // 현재 버전 객체 — StatusBadge·워크플로우 역할 판정 공용
  const currentVersion = versions.find((v) => v.id === versionId) ?? null;

  // 비편집 상태(pending/approved/published)는 캔버스 읽기 전용 — 잠금과 별개로 status 기준
  const statusLocksEditing =
    currentVersion !== null &&
    currentVersion.status !== "draft" &&
    currentVersion.status !== "rejected";
  // 다른 사용자가 유효한 체크아웃을 쥐고 있으면 읽기 전용 (코멘트 작성은 허용)
  const readOnly = (checkout !== null && !checkout.mine) || statusLocksEditing;
  // 역할 판정 — render 중 파생(useEffect 금지)
  // 소유자 미상(created_by=null, seed/legacy 맵)은 백엔드가 누구에게나 승인자 관리를 허용 — 그 규칙과 정합
  const isMapOwner = username !== null && (mapOwner === null || username === mapOwner);
  const isApprover = username !== null && (workflow?.approvers ?? []).includes(username);
  const isSubmitter = username !== null && currentVersion?.submitted_by === username;
  const hasApproved = username !== null && (workflow?.approvals ?? []).includes(username);

  const reactFlow = useReactFlow();
  // 캔버스 컨테이너 픽셀 크기(리사이즈 시에만 변경 — 줌/팬엔 불변) — translateExtent 우하단 확장 계산용
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const currentParentId =
    scopes[Math.min(activeIndex, scopes.length - 1)]?.parentId ?? null;

  // 포커스 모드(A) — 제자리에서 "편집 활성"인 스코프(자식이면 그 인라인 레인이 활성). 기본=현재 스코프.
  // 클릭으로 토글하되 navigateTo/카메라 없음 — 위치 고정, 활성↔비활성 구역만 바뀐다.
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);

  const scopeKey = (scope: Scope) => scope.parentId ?? "root";

  // 이벤트 핸들러/타이머에서 최신 상태를 읽기 위한 미러 — setState 클로저 stale 방지
  const nodesRef = useRef<AppNode[]>([]);
  const childNodesRef = useRef<AppNode[]>([]);
  // 펼침 합성(영역/스코프 오프셋)을 핸들러(handleAddNode 등 정의가 앞선)에서 읽기 위한 ref — TDZ 회피.
  const inlineCompositionRef = useRef<{
    regions: { id: string; x: number; width: number; depth: number }[];
    scopeOffsets: Map<string, { x: number; y: number }>;
  } | null>(null);
  const edgesRef = useRef<Edge[]>([]);
  const groupsRef = useRef<GraphGroup[]>([]);
  const windowGeomRef = useRef<Record<string, WindowGeom>>({});
  // fullGraph가 어떤 버전의 트리인지 기록 — 스코프 전환 시 재요청 게이트용(버전 바뀌면 다시 받음)
  const fullGraphRef = useRef<VersionGraph | null>(null);
  const fullGraphVersionRef = useRef<number | null>(null);
  // toggleInlineExpand는 아래쪽에 정의돼 컨텍스트 메뉴 useMemo(위)에서 직접 못 씀(TDZ) — ref로 호출.
  const toggleInlineExpandRef = useRef<((nodeId: string) => void) | null>(null);
  // 자식 편집 오버레이/디바운스 저장용 — 타이머·dirty 스코프·최신 오버레이 미러(저장 flush에서 읽음)
  const childEditsRef = useRef<Map<string, Partial<NodeData>>>(new Map());
  const dirtyChildScopesRef = useRef<Set<string>>(new Set());
  const childSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    fullGraphRef.current = fullGraph;
  }, [fullGraph]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    childNodesRef.current = childNodes;
  }, [childNodes]);
  const activeScopeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeScopeIdRef.current = activeScopeId;
  }, [activeScopeId]);
  // 포커스(A) — 활성 자식 스코프가 접히면(더 이상 펼쳐져 있지 않으면) 현재 스코프로 복귀.
  useEffect(() => {
    if (activeScopeId !== null && activeScopeId !== currentParentId && !expandedInline.has(activeScopeId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 접힌 활성 스코프 정리(파생 상태 동기화)
      setActiveScopeId(currentParentId);
    }
  }, [activeScopeId, currentParentId, expandedInline]);
  useEffect(() => {
    childEditsRef.current = childEdits;
  }, [childEdits]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  // 펼친 노드의 자식을 childNodes로 materialize한다(React Flow 측정·이벤트용). 부모가 접히면 제거.
  // 스코프/버전 전환 시 expandedInline이 비워지면 자동으로 모두 제거됨. 표시는 displayNodes가 buildScope 파생 위치로 합성.
  useEffect(() => {
    // deps에 childNodes가 없어 cascade 루프 없음(expandedInline/fullGraph 변화 시에만 동기화) — 안전한 의도된 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChildNodes((current) => {
      const present = new Set(current.map((node) => node.id));
      const toAdd: AppNode[] = [];
      if (fullGraph) {
        for (const expandedId of expandedInline) {
          for (const flat of fullGraph.nodes) {
            if (flat.parent_node_id === expandedId && !present.has(flat.id)) {
              const [app] = toAppNodes({ nodes: [flat], edges: [], groups: [] }, expandedId);
              toAdd.push({ ...app, selectable: true, draggable: false, deletable: true });
            }
          }
        }
      }
      // 부모(scopeId)가 더 이상 펼쳐지지 않은 자식 제거
      const kept = current.filter((node) => expandedInline.has(node.data.scopeId as string));
      if (toAdd.length === 0 && kept.length === current.length) {
        return current;
      }
      return [...kept, ...toAdd];
    });
  }, [expandedInline, fullGraph]);

  // React Flow 변경분을 현재 스코프(nodes)와 자식(childNodes)으로 분배 — 자식 측정/선택/이동이 올바른 state로 가게.
  const handleNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      if (childNodes.length === 0) {
        onNodesChange(changes);
        return;
      }
      const childIds = new Set(childNodes.map((node) => node.id));
      const childChanges = changes.filter((change) => "id" in change && childIds.has(change.id));
      const mainChanges = changes.filter(
        (change) => !("id" in change) || !childIds.has(change.id),
      );
      if (mainChanges.length > 0) {
        onNodesChange(mainChanges);
      }
      if (childChanges.length > 0) {
        setChildNodes((current) => applyNodeChanges(childChanges, current));
      }
    },
    [childNodes, onNodesChange],
  );
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);
  useEffect(() => {
    groupDropTargetRef.current = groupDropTarget;
  }, [groupDropTarget]);

  // 아웃라인 하위 펼치기용 전체 그래프 — 비핵심이라 실패해도 조용히 무시(아웃라인만 영향)
  const refreshFullGraph = useCallback(() => {
    if (versionId === null) {
      return;
    }
    const fetchedVersion = versionId;
    void getFullGraph(fetchedVersion)
      .then((graph) => {
        setFullGraph(graph);
        fullGraphVersionRef.current = fetchedVersion; // 캐시된 트리가 속한 버전을 기록 — 게이트의 버전 불일치 판정용
      })
      .catch(() => undefined);
  }, [versionId]);
  useEffect(() => {
    windowGeomRef.current = windowGeom;
  }, [windowGeom]);

  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({
    past: [],
    future: [],
  });
  const lastTextEditAtRef = useRef(0);
  const dirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 저장 ──────────────────────────────────────────────

  const saveCurrentScope = useCallback(async () => {
    // AI 미리보기 중에는 저장 생략 — Apply 전 자동 영속화 방지
    if (aiPreviewRef.current) return;
    // 읽기 전용(타인 체크아웃)이면 저장 자체를 생략 — 스코프 이동은 계속 가능
    if (versionId === null || readOnly) {
      return;
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setSaveState("saving");
    try {
      await saveGraph(
        versionId,
        buildGraph(nodesRef.current, edgesRef.current, groupsRef.current),
        currentParentId,
      );
      dirtyRef.current = false;
      setSaveState("saved");
      refreshFullGraph();
    } catch (err) {
      setSaveState("error");
      throw err;
    }
  }, [versionId, currentParentId, readOnly, refreshFullGraph]);

  // 하위 프로세스 실제 생성 — Start/작업/End를 자식 스코프에 자동 생성(불변식 충족)하고 인라인 펼침.
  // 후속(나가는 엣지) 보장은 호출 전 createSubprocess 래퍼가 처리한다(펼침 시 End→후속 게이트웨이가 연결되도록).
  const runCreateSubprocess = useCallback(
    async (nodeId: string) => {
      if (versionId === null) {
        return;
      }
      const startId = genId();
      const taskId = genId();
      const endId = genId();
      const mkNode = (
        id: string,
        title: string,
        nodeType: string,
        x: number,
        order: number,
      ): GraphNode => ({
        id,
        title,
        description: "",
        node_type: nodeType,
        color: "",
        assignee: "",
        department: "",
        system: "",
        duration: "",
        pos_x: x,
        pos_y: 0,
        sort_order: order,
        group_ids: [],
        linked_map_id: null,
        follow_latest: false,
        linked_version_id: null,
        is_primary_end: false,
      });
      const childGraph: Graph = {
        nodes: [
          mkNode(startId, t("subprocess.startTitle"), "start", 0, 0),
          mkNode(taskId, t("subprocess.taskTitle"), "process", 240, 1),
          mkNode(endId, t("subprocess.endTitle"), "end", 480, 2),
        ],
        edges: [
          {
            id: genId(),
            source_node_id: startId,
            target_node_id: taskId,
            label: "",
            source_side: "right",
            target_side: "left",
            source_handle: null,
            target_handle: null,
          },
          {
            id: genId(),
            source_node_id: taskId,
            target_node_id: endId,
            label: "",
            source_side: "right",
            target_side: "left",
            source_handle: null,
            target_handle: null,
          },
        ],
        groups: [],
      };
      try {
        await saveGraph(versionId, childGraph, nodeId);
        // 부모 노드는 이제 하위 보유 — state 반영(표시용, buildGraph 직렬화엔 무영향)
        setNodes((current) =>
          current.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, hasChildren: true } }
              : node,
          ),
        );
        refreshFullGraph();
        commitExpanded((current) => {
          const next = new Set(current);
          next.add(nodeId);
          return next;
        });
        showToast(t("subprocess.created"));
      } catch {
        showToast(t("subprocess.createError"));
      }
    },
    [versionId, t, refreshFullGraph, showToast, setNodes, commitExpanded],
  );

  // 하위 생성 진입점 — 후속(나가는 엣지) 있으면 즉시 생성, 없으면 진행 방법 모달.
  const createSubprocess = useCallback(
    (nodeId: string) => {
      if (versionId === null) {
        return;
      }
      if (edgesRef.current.some((edge) => edge.source === nodeId)) {
        void runCreateSubprocess(nodeId);
        return;
      }
      setSubprocessPrompt({ nodeId, proceed: () => void runCreateSubprocess(nodeId) });
    },
    [versionId, runCreateSubprocess],
  );

  const scheduleAutoSave = useCallback(() => {
    // AI 미리보기 중에는 자동 저장 생략 — Apply 전 자동 영속화 방지
    if (aiPreviewRef.current) return;
    if (readOnly) {
      return;
    }
    dirtyRef.current = true;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      // 실패는 saveState=error 표시로 사용자에게 노출 — 수동 저장으로 재시도
      void saveCurrentScope().catch(() => undefined);
    }, AUTO_SAVE_DELAY_MS);
  }, [saveCurrentScope, readOnly]);

  // "저장됨" 표시는 잠깐 보여주고 지움
  useEffect(() => {
    if (saveState !== "saved") {
      return;
    }
    const timer = setTimeout(() => setSaveState("idle"), 1500);
    return () => clearTimeout(timer);
  }, [saveState]);

  // 미저장 변경이 있으면 페이지 이탈 경고
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    },
    [],
  );

  // 저장된 창 기하 복원 (클라이언트 전용)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration, 외부 저장소에서 읽는 합법적 패턴
    setWindowGeom(loadWindowGeoms(mapId));
  }, [mapId]);

  // 저장된 인스펙터 너비 복원 (클라이언트 전용, hydration 후 1회)
  useEffect(() => {
    const saved = Number(window.localStorage.getItem("bpm.inspectorWidth"));
    if (Number.isFinite(saved) && saved > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration, 외부 저장소에서 읽는 합법적 패턴
      setInspectorWidth(Math.min(480, Math.max(220, saved)));
    }
  }, []);

  // 저장된 대시보드 높이 복원 (클라이언트 전용, hydration 후 1회)
  useEffect(() => {
    const saved = Number(window.localStorage.getItem("bpm.dashboardHeight"));
    if (Number.isFinite(saved) && saved > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration, 외부 저장소에서 읽는 합법적 패턴
      setDashboardHeight(Math.min(560, Math.max(120, saved)));
    }
  }, []);

  // 창 기하 변경 시 디바운스 저장
  useEffect(() => {
    const timer = setTimeout(() => saveWindowGeoms(mapId, windowGeom), 300);
    return () => clearTimeout(timer);
  }, [mapId, windowGeom]);

  // 캔버스 컨테이너 크기 추적 — 창 클램프/기본배치용
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) {
      return;
    }
    const update = () => setBounds({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // bounds 변경 시 화면 밖으로 나간 창을 안으로 끌어들임 — 다른 해상도에서 저장된 위치 복구
  useEffect(() => {
    if (bounds.w === 0 || bounds.h === 0) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bounds 변동에 따른 기하 보정(같은 참조면 bail-out)
    setWindowGeom((map) => {
      let changed = false;
      const next: Record<string, WindowGeom> = {};
      for (const [key, g] of Object.entries(map)) {
        const w = Math.min(g.w, bounds.w);
        const h = Math.min(g.h, bounds.h);
        const x = Math.min(Math.max(g.x, 0), Math.max(0, bounds.w - w));
        const y = Math.min(Math.max(g.y, 0), Math.max(0, bounds.h - h));
        if (w !== g.w || h !== g.h || x !== g.x || y !== g.y) {
          next[key] = { ...g, x, y, w, h };
          changed = true;
        } else {
          next[key] = g;
        }
      }
      return changed ? next : map;
    });
  }, [bounds]);

  // ── Undo / Redo ───────────────────────────────────────

  const pushHistory = useCallback(() => {
    const history = historyRef.current;
    history.past.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    if (history.past.length > HISTORY_LIMIT) {
      history.past.shift();
    }
    history.future = [];
    setHistorySize({ past: history.past.length, future: 0 });
  }, []);

  // 후속없음 모달 "종료 노드 추가" — 현재 스코프에 End 노드 + nodeId→End 엣지를 만들고 proceed 실행(생성/드롭 공용).
  const handleCreateEndForSubprocess = useCallback(() => {
    const prompt = subprocessPrompt;
    setSubprocessPrompt(null);
    if (!prompt) {
      return;
    }
    const nodeId = prompt.nodeId;
    const source = nodesRef.current.find((node) => node.id === nodeId);
    if (!source) {
      return;
    }
    pushHistory();
    const endId = genId();
      const endNode: AppNode = {
        id: endId,
        type: "process",
        // 앵커 오른쪽에 배치(겹침 방지) — 출발 노드는 process라 폭 170 + 여백 50
        position: { x: source.position.x + NODE_WIDTH + 50, y: source.position.y },
        data: {
          label: makeUniqueLabel(
            t("subprocess.endTitle"),
            nodesRef.current.map((node) => node.data.label),
          ),
          description: "",
          nodeType: "end",
          color: "",
          assignee: "",
          department: "",
          system: "",
          duration: "",
          groupIds: [],
          hasChildren: false,
        },
      };
      setNodes((current) => [...current, endNode]);
      setEdges((current) => [
        ...current,
        {
          ...EDGE_DEFAULTS,
          id: genId(),
          source: nodeId,
          target: endId,
          sourceHandle: sourceHandleId("right"),
          targetHandle: targetHandleId("left"),
        },
      ]);
      scheduleAutoSave();
      prompt.proceed();
    },
    [subprocessPrompt, pushHistory, setNodes, setEdges, scheduleAutoSave, t],
  );

  // 후속 선택 모드에서 노드 클릭 — 클릭 노드를 후속으로 연결 후 하위 생성. 현재 스코프·자기 자신 아님만.
  const handleSubprocessPick = useCallback(
    (pickedId: string) => {
      const pending = pendingSubprocessPick;
      if (pending === null) {
        return;
      }
      if (pickedId === pending.sourceId || !nodesRef.current.some((node) => node.id === pickedId)) {
        return; // 인라인 자식·자기 자신은 후속 대상 불가
      }
      pushHistory();
      setEdges((current) => [
        ...current,
        {
          ...EDGE_DEFAULTS,
          id: genId(),
          source: pending.sourceId,
          target: pickedId,
          sourceHandle: sourceHandleId("right"),
          targetHandle: targetHandleId("left"),
        },
      ]);
      setPendingSubprocessPick(null);
      scheduleAutoSave();
      pending.proceed();
    },
    [pendingSubprocessPick, pushHistory, setEdges, scheduleAutoSave],
  );

  // 후속 선택 모드 — Esc로 취소
  useEffect(() => {
    if (pendingSubprocessPick === null) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingSubprocessPick(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pendingSubprocessPick]);

  // 삭제 불변식 확정 — 깨지는 자식 스코프를 통째로 비워(백엔드 cascade) 부모를 일반 노드로 되돌리고 상위로 복귀.
  // navigateTo는 이동 전 현재 스코프를 자동 저장해 방금 비운 스코프를 되살리므로 직접 스코프를 pop한다.
  const confirmDeleteSubprocess = useCallback(async () => {
    const scopeId = deleteInvariantPrompt;
    setDeleteInvariantPrompt(null);
    if (scopeId === null || versionId === null) {
      return;
    }
    try {
      await saveGraph(versionId, { nodes: [], edges: [], groups: [] }, scopeId);
    } catch {
      showToast(t("subprocess.deleteError"));
      return;
    }
    setExpandedInline((current) => {
      const next = new Set(current);
      next.delete(scopeId);
      return next;
    });
    // 비운 스코프와 그 하위를 브레드크럼에서 제거하고 부모 스코프로 포커스 — 스코프 로드 effect가 부모를 새로 받음
    const idx = scopes.findIndex((scope) => scope.parentId === scopeId);
    const nextScopes = idx > 0 ? scopes.slice(0, idx) : scopes;
    setScopes(nextScopes);
    setActiveIndex(nextScopes.length - 1);
    refreshFullGraph();
    showToast(t("subprocess.reverted"));
  }, [deleteInvariantPrompt, versionId, scopes, refreshFullGraph, showToast, t]);

  // 타이핑은 간격 안에서 한 스냅샷으로 묶고, 그 외 변경은 즉시 기록
  const recordChange = useCallback(
    (fromTyping: boolean) => {
      if (fromTyping) {
        const now = Date.now();
        const withinGap = now - lastTextEditAtRef.current <= TEXT_HISTORY_GAP_MS;
        lastTextEditAtRef.current = now;
        if (withinGap) {
          return;
        }
      }
      pushHistory();
    },
    [pushHistory],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) {
      return;
    }
    history.future.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setGroups(previous.groups);
    setHistorySize({ past: history.past.length, future: history.future.length });
    scheduleAutoSave();
  }, [setNodes, setEdges, setGroups, scheduleAutoSave]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) {
      return;
    }
    history.past.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    setNodes(next.nodes);
    setEdges(next.edges);
    setGroups(next.groups);
    setHistorySize({ past: history.past.length, future: history.future.length });
    scheduleAutoSave();
  }, [setNodes, setEdges, setGroups, scheduleAutoSave]);

  // ── AI 제안 미리보기 / 적용 / 취소 ─────────────────────
  const applyAiProposal = useCallback(
    (proposal: AiProposal) => {
      const keyToId = new Map<string, string>();
      const gnodes = proposal.nodes.map((node) => {
        const id = genId();
        keyToId.set(node.key, id);
        return {
          id,
          title: node.title,
          description: node.description,
          node_type: node.node_type,
          color: "",
          assignee: "",
          department: "",
          system: "",
          duration: "",
          pos_x: 0,
          pos_y: 0,
          sort_order: 0,
          group_ids: [],
          linked_map_id: null,
          follow_latest: false,
          linked_version_id: null,
          is_primary_end: false,
        };
      });
      const gedges = proposal.edges
        .map((edge) => {
          const source = keyToId.get(edge.source);
          const target = keyToId.get(edge.target);
          if (!source || !target) return null;
          return {
            id: genId(),
            source_node_id: source,
            target_node_id: target,
            label: edge.label,
            source_side: "right",
            target_side: "left",
            source_handle: null,
            target_handle: null,
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

      const graph = { nodes: gnodes, edges: gedges, groups: [] };
      const laidOut = layoutWithDagre(toAppNodes(graph), toAppEdges(graph));

      pushHistory(); // Discard = undo restores the pre-preview state
      aiPreviewRef.current = true;
      setNodes(laidOut);
      setEdges(toAppEdges(graph));
      setAiPreviewActive(true);
    },
    [pushHistory, setNodes, setEdges],
  );

  const commitAiPreview = useCallback(() => {
    aiPreviewRef.current = false;
    setAiPreviewActive(false);
    void saveCurrentScope();
  }, [saveCurrentScope]);

  const discardAiPreview = useCallback(() => {
    aiPreviewRef.current = false;
    setAiPreviewActive(false);
    undo(); // restore the snapshot pushed in applyAiProposal
  }, [undo]);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — 입력 필드 포커스 중에는 브라우저 기본 동작 유지. Ctrl+K는 검색 포커스.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      ) {
        return;
      }
      if (event.key === "Escape") {
        setPending(null);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // ── 로드 ──────────────────────────────────────────────

  // 맵 메타 로드 — 버전 확보 + 브레드크럼 루트 이름
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const detail = await getMap(mapId);
        if (!active) {
          return;
        }
        setMapName(detail.name);
        setMapOwner(detail.created_by);
        setVersions(detail.versions);
        setVersionId(detail.versions[0].id);
        setScopes([{ parentId: null, title: detail.name }]);
        setActiveIndex(0);
      } catch (err) {
        if (active) {
          setStatus(err instanceof Error ? err.message : t("err.loadMap"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId, t]);

  // 현재 사용자 신원 — 마운트 1회, auth 비활성 시 null 유지
  useEffect(() => {
    let alive = true;
    void getMe()
      .then((me) => {
        if (alive) {
          setUsername(me.username);
          setAiEnabled(me.ai_enabled);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 워크플로우 상태 — 버전 전환 시 재요청
  const refreshWorkflow = useCallback(async () => {
    if (versionId === null) return;
    try {
      setWorkflow(await getWorkflowState(versionId));
    } catch {
      setWorkflow(null);
    }
  }, [versionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshWorkflow(); // intentional: fetch workflow state when version changes
  }, [refreshWorkflow]);

  // 주어진 노드들을 화면 좌상단에 정렬(현재 줌 유지) — 스코프 전환 시 줌 안 바꾸고 부드럽게 이동(왼쪽위 고정 일관).
  // 콘텐츠 좌상단을 extent 좌상단 경계(minX-여백)에 맞춰 setViewport → 비대칭 extent 안이라 스냅 없음. (스코프 로드 효과보다 먼저 정의 — TDZ 회피)
  const frameScopeTopLeftKeepZoom = useCallback(
    (ids: string[], duration: number) => {
      const idSet = new Set(ids);
      const ns = reactFlow.getNodes().filter((node) => idSet.has(node.id));
      if (ns.length === 0) {
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      for (const node of ns) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
      }
      const z = reactFlow.getZoom();
      void reactFlow.setViewport(
        { x: (EXTENT_TOPLEFT_MARGIN - minX) * z, y: (EXTENT_TOPLEFT_MARGIN - minY) * z, zoom: z },
        { duration },
      );
    },
    [reactFlow],
  );

  // 직전에 로드한 스코프(currentParentId) — 스코프 전환 시에만 부드러운 카메라 이동을 트리거(첫 로드/버전변경 제외)
  const prevScopeRef = useRef<string | null | undefined>(undefined);

  // 현재 스코프(version, parent) 캔버스 로드 — 히스토리/저장 상태도 새 스코프 기준으로 리셋
  useEffect(() => {
    if (versionId === null) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const graph = await getGraph(versionId, currentParentId);
        if (!active) {
          return;
        }
        // 현재 스코프 노드는 모두 currentParentId 스코프 소속 — scope-split 저장 식별용 태그
        setNodes(toAppNodes(graph, currentParentId));
        setEdges(toAppEdges(graph));
        setGroups(graph.groups);
        // 전체 트리는 버전당 1회만 — 스코프 전환 시 기존 데이터 재사용(깜빡임 방지).
        // 버전이 바뀌면 stale 트리이므로 다시 받는다.
        if (fullGraphRef.current === null || fullGraphVersionRef.current !== versionId) {
          refreshFullGraph();
        }
        setSelectedId(null);
        setSelectedEdgeId(null);
        setMenu(null);
        // 스코프 네비게이션(들고나기)이면 펼침을 유지 — "접히지 않고 활성 영역만 이동". 첫 로드/버전 변경만 모두 접힘.
        const prevScope = prevScopeRef.current; // 직전 스코프(아직 갱신 전)
        const isScopeNav =
          prevScope !== undefined &&
          prevScope !== currentParentId &&
          fullGraphVersionRef.current === versionId;
        if (isScopeNav && fullGraphRef.current) {
          const byId = new Map(fullGraphRef.current.nodes.map((flat) => [flat.id, flat]));
          // x가 새 스코프(currentParentId)의 (엄격) 하위인가 — 루트면 전부 하위
          const isUnder = (nodeId: string): boolean => {
            if (currentParentId === null) {
              return true;
            }
            let cur = byId.get(nodeId)?.parent_node_id ?? null;
            for (let guard = 0; cur !== null && guard < 20; guard++) {
              if (cur === currentParentId) {
                return true;
              }
              cur = byId.get(cur)?.parent_node_id ?? null;
            }
            return false;
          };
          setExpandedInline((prev) => {
            const next = new Set([...prev].filter(isUnder)); // 1) 새 스코프 하위 펼침 유지(들어갈 때 붕괴 방지)
            // 2) 나가기(직전 스코프가 새 스코프 하위)면 드릴 경로(직전 스코프→새 스코프 사이)를 펼쳐 유지
            //    → 떠난 스코프가 접히지 않고 인라인으로 보임(활성 영역만 이동).
            if (prevScope !== null && prevScope !== undefined && isUnder(prevScope)) {
              let cur: string | null = prevScope;
              for (let guard = 0; cur !== null && cur !== currentParentId && guard < 20; guard++) {
                next.add(cur);
                cur = byId.get(cur)?.parent_node_id ?? null;
              }
            }
            return next;
          });
        } else {
          setExpandedInline(new Set()); // 재로딩/버전 변경 시 모두 접힘으로 시작(spec 5.2)
        }
        setActiveScopeId(currentParentId); // 포커스(A) 활성 스코프를 새 현재 스코프로 리셋
        setChildEdits(new Map()); // 자식 편집 오버레이 초기화 — 새 스코프는 fullGraph가 권위
        dirtyChildScopesRef.current.clear(); // 대기 중 자식 저장 취소(스코프 전환 시 stale 저장 방지)
        if (childSaveTimerRef.current) {
          clearTimeout(childSaveTimerRef.current);
          childSaveTimerRef.current = null;
        }
        historyRef.current = { past: [], future: [] };
        setHistorySize({ past: 0, future: 0 });
        lastTextEditAtRef.current = 0;
        dirtyRef.current = false;
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        setSaveState("idle");
        // 스코프 전환이면(첫 로드/버전 변경 제외) 새 스코프로 카메라를 부드럽게 이동 — 콘텐츠가 제자리에서
        // 갑자기 바뀌어 시야가 길을 잃는 것 방지(포커스 모드 전환 연속화 A안).
        const isScopeTransition =
          prevScopeRef.current !== undefined && prevScopeRef.current !== currentParentId;
        prevScopeRef.current = currentParentId;
        // 검색 점프 — 노드가 렌더된 다음 틱에 화면 중앙으로
        if (focusNodeIdRef.current) {
          const focusId = focusNodeIdRef.current;
          focusNodeIdRef.current = null;
          setSelectedId(focusId);
          // 새 스코프 로드 직후 — 보더 강조를 위해 React Flow 선택 상태도 단일 선택으로 동기화
          setNodes((current) =>
            current.map((node) =>
              node.selected === (node.id === focusId)
                ? node
                : { ...node, selected: node.id === focusId },
            ),
          );
          setTimeout(() => {
            void reactFlow.fitView({
              nodes: [{ id: focusId }],
              padding: 0.4,
              duration: 700,
              maxZoom: 1.3,
            });
          }, 80);
        } else if (isScopeTransition) {
          const cam = focusCamRef.current;
          focusCamRef.current = null;
          if (cam) {
            // 포커스(Path 2) — 카메라를 offset×zoom만큼 옮겨 navigateTo한 자식이 레인 자리에 그대로(시각적 무이동).
            void reactFlow.setViewport({
              x: cam.vp.x + cam.shift.x * cam.vp.zoom,
              y: cam.vp.y + cam.shift.y * cam.vp.zoom,
              zoom: cam.vp.zoom,
            });
          } else {
            // 검색/브레드크럼 — 줌 유지한 채 새 스코프로 부드럽게 이동.
            const scopeNodeIds = graph.nodes.map((node) => node.id);
            if (scopeNodeIds.length > 0) {
              setTimeout(() => frameScopeTopLeftKeepZoom(scopeNodeIds, 600), 100);
            }
          }
        }
      } catch (err) {
        if (active) {
          setStatus(err instanceof Error ? err.message : t("err.loadCanvas"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [versionId, currentParentId, setNodes, setEdges, reactFlow, refreshFullGraph, t, frameScopeTopLeftKeepZoom]);

  // 노드 검색 — 버전 전체 노드에서 제목 부분 일치 + 초성 일치 (spec §7 Phase B).
  // 빈 쿼리의 결과 초기화는 입력 핸들러에서 처리 (effect 내 동기 setState 금지)
  useEffect(() => {
    if (versionId === null || !searchQuery.trim()) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const full = await getFullGraph(versionId);
        if (!active) {
          return;
        }
        const byId = new Map(full.nodes.map((node) => [node.id, node]));
        const matches = full.nodes
          .filter((node) => matchesQuery(node.title, searchQuery))
          .slice(0, SEARCH_RESULT_LIMIT);
        setSearchResults(
          matches.map((node) => {
            const ancestors: FlatNode[] = [];
            let current = node.parent_node_id ? byId.get(node.parent_node_id) : undefined;
            while (current) {
              ancestors.unshift(current);
              current = current.parent_node_id
                ? byId.get(current.parent_node_id)
                : undefined;
            }
            return {
              node,
              path: [mapName, ...ancestors.map((item) => item.title)].join(" › "),
              scopes: [
                { parentId: null, title: mapName },
                ...ancestors.map((item) => ({ parentId: item.id, title: item.title })),
              ],
            };
          }),
        );
        setSearchIndex(0);
      } catch (err) {
        if (active) {
          setStatus(err instanceof Error ? err.message : t("err.search"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [searchQuery, versionId, mapName, t]);

  // 체크아웃 — 버전 진입 시 획득 시도, heartbeat로 연장. 타인이 선점 중이면
  // mine=false가 와서 읽기 전용이 되고, 선점이 풀리면 다음 heartbeat에 자동 승격된다.
  useEffect(() => {
    if (versionId === null) {
      return;
    }
    // 비편집 상태에선 체크아웃 시도 안 함 — 백엔드가 409 반환하므로 스팸 방지
    const selected = versions.find((v) => v.id === versionId);
    if (selected && selected.status !== "draft" && selected.status !== "rejected") {
      return;
    }
    let active = true;
    const tryAcquire = async () => {
      try {
        const state = await acquireCheckout(versionId);
        if (!active) {
          return;
        }
        checkoutMineRef.current = state.mine;
        setCheckout(state);
      } catch (err) {
        if (active) {
          setStatus(err instanceof Error ? err.message : t("err.checkout"));
        }
      }
    };
    void tryAcquire();
    const heartbeat = setInterval(() => void tryAcquire(), CHECKOUT_HEARTBEAT_MS);
    return () => {
      active = false;
      clearInterval(heartbeat);
      if (checkoutMineRef.current) {
        checkoutMineRef.current = false;
        // 해제 실패는 무시 — TTL이 자동 회수
        void releaseCheckout(versionId).catch(() => undefined);
      }
    };
  }, [versionId, versions, t]);

  const handleForceCheckout = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    try {
      const state = await acquireCheckout(versionId, true);
      checkoutMineRef.current = state.mine;
      setCheckout(state);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.forceCheckout"));
    }
  }, [versionId, t]);

  // 코멘트 폴링 — 5초 주기. 일시 오류는 다음 주기에 재시도되므로 상태 표시를 덮지 않는다.
  useEffect(() => {
    if (versionId === null) {
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const rows = await listComments(versionId);
        if (active) {
          setComments(rows);
        }
      } catch {
        // 다음 주기에 재시도
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), COMMENT_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [versionId]);

  const refreshComments = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    setComments(await listComments(versionId));
  }, [versionId]);

  const handleAddComment = useCallback(
    async (body: string) => {
      if (versionId === null || selectedId === null) {
        return;
      }
      try {
        await createComment(versionId, selectedId, body);
        await refreshComments();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.addComment"));
      }
    },
    [versionId, selectedId, refreshComments, t],
  );

  const handleToggleComment = useCallback(
    async (comment: CommentItem) => {
      try {
        await updateComment(comment.id, !comment.resolved);
        await refreshComments();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.toggleComment"));
      }
    },
    [refreshComments, t],
  );

  const handleDeleteComment = useCallback(
    async (comment: CommentItem) => {
      try {
        await deleteComment(comment.id);
        await refreshComments();
      } catch (err) {
        setStatus(
          err instanceof Error ? err.message : t("err.deleteComment"),
        );
      }
    },
    [refreshComments, t],
  );

  const handleSave = useCallback(async () => {
    try {
      await saveCurrentScope();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.save"));
    }
  }, [saveCurrentScope, t]);

  const defaultGeom = (index: number, b: { w: number; h: number }): WindowGeom => {
    const step = 36;
    const w = Math.min(760, Math.round(b.w * 0.82));
    const h = Math.min(500, Math.round(b.h * 0.82));
    return { x: index * step, y: index * step, w, h, minimized: false, maximized: false };
  };

  // AI 창 기본 기하 — 우측에 도킹된 좁은 패널(처음 열 때). 이후 이동/리사이즈는 windowGeom["ai"]에 영속.
  const aiDefaultGeom = (b: { w: number; h: number }): WindowGeom => {
    const w = 340;
    const h = Math.min(440, Math.max(280, Math.round(b.h * 0.7)));
    return { x: Math.max(0, b.w - w - 16), y: 16, w, h, minimized: false, maximized: false };
  };

  const bringToFront = useCallback((key: string) => {
    setZOrder((order) => [...order.filter((k) => k !== key), key]);
  }, []);

  // 계층 진입/이탈 시 현재 스코프를 저장하고 이동 (편집 손실 방지)
  const navigateTo = useCallback(
    async (nextScopes: Scope[]) => {
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.save"));
        return;
      }
      setScopes(nextScopes);
      setActiveIndex(nextScopes.length - 1);
    },
    [saveCurrentScope, t],
  );

  // 특정 노드의 스코프를 활성화하는 스코프 체인(루트→…→그 노드). null이면 루트.
  const buildScopesTo = useCallback(
    (scopeNodeId: string | null): Scope[] => {
      const fg = fullGraphRef.current;
      if (!fg || scopeNodeId === null) {
        return [{ parentId: null, title: mapName }];
      }
      const byId = new Map(fg.nodes.map((node) => [node.id, node]));
      const chain: FlatNode[] = [];
      let cur = byId.get(scopeNodeId);
      while (cur) {
        chain.unshift(cur);
        cur = cur.parent_node_id ? byId.get(cur.parent_node_id) : undefined;
      }
      return [
        { parentId: null, title: mapName },
        ...chain.map((node) => ({ parentId: node.id, title: node.title })),
      ];
    },
    [mapName],
  );

  // 포커스(Path 2) — 자식을 navigateTo로 진짜 nodes化하되, 카메라를 offset×zoom만큼 옮겨 자식이 레인 자리에
  // 그대로 보이게(시각적 무이동). 편집·저장은 네이티브(스코프상대 좌표 그대로). 스코프 로드 효과가 이 ref를 읽어 적용.
  const focusCamRef = useRef<{ shift: { x: number; y: number }; vp: { x: number; y: number; zoom: number } } | null>(null);

  // 창 포커스 — 현재 활성 스코프를 저장하고 해당 창을 라이브로 전환(스코프 체인은 유지)
  const focusScope = useCallback(
    async (index: number) => {
      if (index === activeIndex) {
        return;
      }
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.save"));
        return;
      }
      setActiveIndex(index);
      // 최외곽(루트) 캔버스를 포커스하면 떠 있던 드릴인 창들을 최소화(좌하단 dock)
      if (index === 0) {
        setWindowGeom((map) => {
          const next = { ...map };
          scopes.forEach((scope, i) => {
            if (i === 0) {
              return;
            }
            const key = scopeKey(scope);
            const base = next[key] ?? defaultGeom(i, bounds);
            next[key] = { ...base, minimized: true };
          });
          return next;
        });
      }
    },
    [activeIndex, saveCurrentScope, scopes, bounds, t],
  );

  // 창 닫기 — 그 창과 하위(더 깊은 창) 모두 닫고 상위로 복귀
  const closeScope = useCallback(
    (index: number) => {
      if (index <= 0) {
        return;
      }
      void navigateTo(scopes.slice(0, index));
    },
    [navigateTo, scopes],
  );

  const handleBreadcrumb = useCallback(
    (index: number) => {
      void focusScope(index);
    },
    [focusScope],
  );

  // 버전 전환 — 현재 스코프 저장 후 루트로 리셋해 새 버전 캔버스를 로드
  const switchVersion = useCallback(
    async (nextVersionId: number) => {
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.save"));
        return;
      }
      setVersionId(nextVersionId);
      setScopes([{ parentId: null, title: mapName }]);
      setActiveIndex(0);
    },
    [saveCurrentScope, mapName, t],
  );

  const handleCreateVersion = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    const label = window.prompt(t("prompt.newVersionName"), "To-Be");
    if (!label?.trim()) {
      return;
    }
    try {
      await saveCurrentScope();
      const created = await createVersion(mapId, label.trim(), versionId);
      const detail = await getMap(mapId);
      setVersions(detail.versions);
      setVersionId(created.id);
      setScopes([{ parentId: null, title: mapName }]);
      setActiveIndex(0);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.createVersion"));
    }
  }, [versionId, mapId, mapName, saveCurrentScope, t]);

  const handleRenameVersion = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    const current = versions.find((version) => version.id === versionId);
    const label = window.prompt(t("prompt.renameVersion"), current?.label ?? "");
    if (!label?.trim()) {
      return;
    }
    try {
      await renameVersion(versionId, label.trim());
      const detail = await getMap(mapId);
      setVersions(detail.versions);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.renameVersion"));
    }
  }, [versionId, versions, mapId, t]);

  const handleDeleteVersion = useCallback(async () => {
    if (versionId === null || versions.length <= 1) {
      return;
    }
    if (!window.confirm(t("prompt.deleteVersionConfirm"))) {
      return;
    }
    try {
      await deleteVersion(versionId);
      const detail = await getMap(mapId);
      setVersions(detail.versions);
      setVersionId(detail.versions[0].id);
      setScopes([{ parentId: null, title: mapName }]);
      setActiveIndex(0);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.deleteVersion"));
    }
  }, [versionId, versions, mapId, mapName, t]);

  // 워크플로우 전이 — updated VersionSummary를 versions에 머지하고 workflow 갱신
  const runTransition = useCallback(
    async (action: (id: number) => Promise<VersionSummary>) => {
      if (versionId === null) return;
      try {
        const updated = await action(versionId);
        setVersions((prev) =>
          prev.map((v) => (v.id === updated.id ? { ...v, ...updated } : v)),
        );
        await refreshWorkflow();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.workflow"));
      }
    },
    [versionId, refreshWorkflow, t],
  );

  // ── 편집 조작 (모두 히스토리 + 자동 저장 대상) ─────────

  // 라벨 지정해 엣지 생성 (기본은 빈 라벨)
  const createEdge = useCallback(
    (connection: Connection, label: string) => {
      pushHistory();
      setEdges((current) =>
        addEdge(
          { ...EDGE_DEFAULTS, ...connection, id: genId(), label: label || undefined },
          current,
        ),
      );
      scheduleAutoSave();
    },
    [pushHistory, setEdges, scheduleAutoSave],
  );

  // 자식 간 연결 → 그 자식 스코프에 엣지 저장(fullGraph 낙관적 추가로 즉시 렌더 + 권위 그래프 PUT).
  const createChildEdge = useCallback(
    async (scopeId: string, connection: Connection, label: string) => {
      if (versionId === null) {
        return;
      }
      const edge: GraphEdge = {
        id: genId(),
        source_node_id: connection.source as string,
        target_node_id: connection.target as string,
        label,
        source_side: sideFromHandleId(connection.sourceHandle, "right"),
        target_side: sideFromHandleId(connection.targetHandle, "left"),
        source_handle: connection.sourceHandle ?? null,
        target_handle: connection.targetHandle ?? null,
      };
      setFullGraph((prev) => (prev === null ? prev : { ...prev, edges: [...prev.edges, edge] }));
      try {
        const graph = await getGraph(versionId, scopeId);
        await saveGraph(versionId, { ...graph, edges: [...graph.edges, edge] }, scopeId);
        refreshFullGraph();
      } catch {
        showToast(t("err.save"));
      }
    },
    [versionId, refreshFullGraph, showToast, t, setFullGraph],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) {
        return;
      }
      // 자식 간 연결(같은 자식 스코프) → 그 스코프에 엣지 저장
      const srcChild = childNodesRef.current.find((node) => node.id === connection.source);
      const tgtChild = childNodesRef.current.find((node) => node.id === connection.target);
      if (
        srcChild &&
        tgtChild &&
        srcChild.data.scopeId != null &&
        srcChild.data.scopeId === tgtChild.data.scopeId
      ) {
        void createChildEdge(srcChild.data.scopeId, connection, "");
        return;
      }
      // 판단(decision) 노드에서 나가는 연결 → Yes/No/기타 선택 모달, 그 외는 즉시 생성
      const source = nodesRef.current.find((node) => node.id === connection.source);
      if (source?.data.nodeType === "decision") {
        setBranchPrompt({ kind: "connection", connection });
        return;
      }
      createEdge(connection, "");
    },
    [readOnly, createEdge, createChildEdge],
  );

  // 분기 모달 선택 → 라벨(Yes/No/빈값=기타) 적용. 드래그 연결은 엣지를 생성, 노드 드롭은 기존 엣지에 라벨만 부여.
  const handlePickBranch = useCallback(
    (kind: BranchKind) => {
      const label = kind === "yes" ? BRANCH_YES_LABEL : kind === "no" ? BRANCH_NO_LABEL : "";
      if (branchPrompt?.kind === "connection") {
        createEdge(branchPrompt.connection, label);
      } else if (branchPrompt?.kind === "edge") {
        const edgeId = branchPrompt.edgeId;
        setEdges((current) =>
          current.map((edge) =>
            edge.id === edgeId ? { ...edge, label: label || undefined } : edge,
          ),
        );
        scheduleAutoSave();
      }
      setBranchPrompt(null);
    },
    [branchPrompt, createEdge, setEdges, scheduleAutoSave],
  );

  // 자식 스코프에 새 노드 생성(스코프상대 위치) — fullGraph 낙관적 추가(materialize로 즉시 렌더) + 권위 그래프 PUT.
  const addChildNode = useCallback(
    async (scopeId: string, position: { x: number; y: number }) => {
      if (versionId === null) {
        return;
      }
      const id = genId();
      const tree = fullGraphRef.current;
      const siblingTitles = tree
        ? tree.nodes.filter((node) => node.parent_node_id === scopeId).map((node) => node.title)
        : [];
      const base: GraphNode = {
        id,
        title: makeUniqueLabel(t("editor.newStep"), siblingTitles),
        description: "",
        node_type: "process",
        color: "",
        assignee: "",
        department: "",
        system: "",
        duration: "",
        pos_x: position.x,
        pos_y: position.y,
        sort_order: 0,
        group_ids: [],
        linked_map_id: null,
        follow_latest: false,
        linked_version_id: null,
        is_primary_end: false,
      };
      setFullGraph((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              nodes: [
                ...prev.nodes,
                { ...base, has_children: false, parent_node_id: scopeId, source_node_id: null },
              ],
            },
      );
      try {
        const graph = await getGraph(versionId, scopeId);
        await saveGraph(versionId, { ...graph, nodes: [...graph.nodes, base] }, scopeId);
        refreshFullGraph();
      } catch {
        showToast(t("err.save"));
      }
    },
    [versionId, refreshFullGraph, showToast, t, setFullGraph],
  );

  // screen 좌표가 주어지면(컨텍스트 메뉴) 커서가 노드 중심이 되도록 생성
  const handleAddNode = useCallback(
    (screen: { x: number; y: number } | null, nodeType: ProcessNodeType = "process") => {
      if (readOnly) {
        return;
      }
      // 펼침 중 클릭이 자식 영역 안이면 그 자식 스코프에 추가(스코프상대 위치로 변환)
      const composition = inlineCompositionRef.current;
      if (screen && composition) {
        const point = reactFlow.screenToFlowPosition(screen);
        const region = composition.regions
          .filter((box) => point.x >= box.x && point.x <= box.x + box.width)
          .sort((a, b) => b.depth - a.depth)[0];
        const offset = region ? composition.scopeOffsets.get(region.id) : undefined;
        if (region && offset) {
          void addChildNode(region.id, {
            x: point.x - offset.x - NODE_WIDTH / 2,
            y: point.y - offset.y - NODE_HEIGHT / 2,
          });
          return;
        }
      }
      pushHistory();
      const id = genId();
      const count = nodesRef.current.length;
      let position = { x: 80 + count * 30, y: 80 + count * 30 };
      if (screen) {
        const point = reactFlow.screenToFlowPosition(screen);
        position = { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 };
      } else {
        // 좌측 팔레트 등 좌표 없는 추가 — 현재 뷰포트 중앙에 배치
        const container = canvasContainerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const point = reactFlow.screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
          position = { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 };
        }
      }
      setNodes((current) => [
        ...current,
        {
          id,
          type: "process",
          position,
          data: {
            label: makeUniqueLabel(
              t("editor.newStep"),
              current.map((node) => node.data.label),
            ),
            description: "",
            nodeType,
            color: "",
            assignee: "",
            department: "",
            system: "",
            duration: "",
            groupIds: [],
            hasChildren: false,
          },
        },
      ]);
      setSelectedId(id);
      setSelectedEdgeId(null);
      scheduleAutoSave();
    },
    [readOnly, pushHistory, reactFlow, setNodes, scheduleAutoSave, t, addChildNode],
  );

  // 정렬/레이아웃 버튼 공통 래퍼 — 변경 전 스냅샷 기록 + 자동 저장
  const applyNodesTransform = useCallback(
    (transform: (current: AppNode[]) => AppNode[]) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setNodes(transform);
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, scheduleAutoSave],
  );

  // ── 드래그-오버 드롭 영역 (앞/뒤 흐름 삽입, Phase 1) ─────────

  // 노드 id의 캔버스 컨테이너 상대 화면 사각형 — 드롭 영역/팝오버 위치 계산용 (이벤트에서만 호출)
  const screenRectOf = useCallback(
    (nodeId: string): ScreenRect | null => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      const container = canvasContainerRef.current;
      if (!node || !container) {
        return null;
      }
      const zoom = reactFlow.getViewport().zoom;
      const topLeft = reactFlow.flowToScreenPosition({ x: node.position.x, y: node.position.y });
      const rect = container.getBoundingClientRect();
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      return {
        left: topLeft.x - rect.left,
        top: topLeft.y - rect.top,
        width: w * zoom,
        height: h * zoom,
        // 링 반경은 줌·노드 타입과 무관하게 프로세스 노드 크기 기준 상수 — 모든 노드에서 동일 크기. 0.7배로 축소
        radius: (Math.max(NODE_WIDTH, NODE_HEIGHT) + ZONE_RADIUS_PAD) * 0.7,
      };
    },
    [reactFlow],
  );

  // A를 B의 좌(앞)/우(뒤)로 인접 배치 후 겹침 회피. 8px 그리드 스냅.
  const placeBeside = useCallback(
    (aId: string, bId: string, zone: DropZone) => {
      setNodes((current) => {
        const b = current.find((node) => node.id === bId);
        if (!b) {
          return current;
        }
        const bw = b.measured?.width ?? NODE_WIDTH;
        const rawX =
          zone === "front" ? b.position.x - NODE_WIDTH - DROP_GAP : b.position.x + bw + DROP_GAP;
        const moved = current.map((node) =>
          node.id === aId
            ? {
                ...node,
                position: { x: Math.round(rawX / 8) * 8, y: Math.round(b.position.y / 8) * 8 },
              }
            : node,
        );
        return resolveCollision(moved, aId);
      });
    },
    [setNodes],
  );

  // 흐름 엣지 적용 — rewire면 B의 기존 연결을 끊고 A를 중간에 삽입
  const applyFlowEdges = useCallback(
    (aId: string, bId: string, zone: DropZone, rewire: boolean) => {
      const current = edgesRef.current;
      const isDecision = (nodeId: string): boolean =>
        nodesRef.current.find((node) => node.id === nodeId)?.data.nodeType === "decision";
      const next =
        zone === "front"
          ? insertNodeBefore(current, aId, bId, rewire)
          : insertNodeAfter(current, aId, bId, rewire, isDecision(bId));
      setEdges(next);
      // 마름모에서 새로 출발하는(라벨 없는) 엣지가 생겼으면 분기 라벨 모달을 띄운다.
      const beforeIds = new Set(current.map((edge) => edge.id));
      const fresh = next.find(
        (edge) => !beforeIds.has(edge.id) && !edge.label && isDecision(edge.source),
      );
      if (fresh) {
        setBranchPrompt({ kind: "edge", edgeId: fresh.id });
      }
      scheduleAutoSave();
    },
    [setEdges, scheduleAutoSave],
  );

  // A를 B의 그룹(태그)에 합류 — B가 태그를 가지면 그 태그들을 A에 추가, 무소속이면 새 그룹 생성 후 둘 다 태그.
  const addToGroup = useCallback(
    (aId: string, bId: string) => {
      const b = nodesRef.current.find((node) => node.id === bId);
      if (!b) {
        return;
      }
      const createNew = b.data.groupIds.length === 0;
      const newId = createNew ? genId() : "";
      const tagsForA = createNew ? [newId] : b.data.groupIds;
      if (createNew) {
        setGroups((cur) => [
          ...cur,
          {
            id: newId,
            parent_group_id: null,
            label: makeUniqueLabel(
              b.data.department || b.data.assignee || "",
              cur.map((g) => g.label),
            ),
            color: GROUP_COLOR_PRESETS[cur.length % GROUP_COLOR_PRESETS.length],
          },
        ]);
      }
      setNodes((current) => {
        const target = current.find((node) => node.id === bId);
        if (!target) {
          return current;
        }
        const bw = target.measured?.width ?? NODE_WIDTH;
        const x = Math.round((target.position.x + bw + DROP_GAP) / 8) * 8;
        const y = Math.round(target.position.y / 8) * 8;
        const moved = current.map((node) => {
          if (node.id === aId) {
            return {
              ...node,
              position: { x, y },
              data: { ...node.data, groupIds: addTags(node.data.groupIds, tagsForA) },
            };
          }
          if (createNew && node.id === bId) {
            return { ...node, data: { ...node.data, groupIds: addTags(node.data.groupIds, [newId]) } };
          }
          return node;
        });
        return resolveCollision(moved, aId);
      });
      scheduleAutoSave();
    },
    [setNodes, setGroups, scheduleAutoSave],
  );

  // A에 특정 그룹 태그 추가 — 그룹 박스 영역에 드롭한 경우. 드롭 위치는 유지하되 멤버 겹침만 회피.
  const addToGroupId = useCallback(
    (aId: string, groupId: string) => {
      setNodes((current) => {
        const moved = current.map((node) =>
          node.id === aId
            ? { ...node, data: { ...node.data, groupIds: addTags(node.data.groupIds, [groupId]) } }
            : node,
        );
        return resolveCollision(moved, aId);
      });
      scheduleAutoSave();
    },
    [setNodes, scheduleAutoSave],
  );

  // A를 B의 하위 프로세스(자식 스코프)로 이동. 자식 스코프에 먼저 영속(재부모화)한 뒤
  // 현재 스코프에서 제거 — 순서 보장으로 현재 스코프 자동저장이 A를 삭제하지 않도록 함.
  const runMoveToChild = useCallback(
    async (aId: string, bId: string) => {
      if (versionId === null) {
        return;
      }
      const aNode = nodesRef.current.find((node) => node.id === aId);
      if (!aNode) {
        return;
      }
      // 사이클 방지 — B가 A의 하위(=A가 B의 조상)면 거부. 전체 그래프로 B의 조상 체인 확인.
      if (aId === bId) {
        return;
      }
      // 하위 프로세스는 process 노드만 가질 수 있음 — decision/start/end는 거부
      const bNode = nodesRef.current.find((node) => node.id === bId);
      if (bNode && bNode.data.nodeType !== "process") {
        setStatus(t("err.childOnlyProcess"));
        return;
      }
      const parentById = new Map(
        (fullGraph?.nodes ?? []).map((node) => [node.id, node.parent_node_id]),
      );
      for (let anc = parentById.get(bId) ?? null; anc !== null; anc = parentById.get(anc) ?? null) {
        if (anc === aId) {
          setStatus(t("err.moveChildCycle"));
          return;
        }
      }
      const aGraph = buildGraph([aNode], [], []).nodes[0];
      try {
        const child = await getGraph(versionId, bId);
        let childGraph: Graph;
        if (child.nodes.length === 0) {
          // B가 비어 있으면 Start → A → End 로 감싸 제대로 된 하위 프로세스 생성(불변식 충족)
          const startId = genId();
          const endId = genId();
          const terminal = (
            id: string,
            titleKey: "subprocess.startTitle" | "subprocess.endTitle",
            type: string,
            x: number,
            order: number,
          ): GraphNode => ({
            id,
            title: t(titleKey),
            description: "",
            node_type: type,
            color: "",
            assignee: "",
            department: "",
            system: "",
            duration: "",
            pos_x: x,
            pos_y: 0,
            sort_order: order,
            group_ids: [],
            linked_map_id: null,
            follow_latest: false,
            linked_version_id: null,
            is_primary_end: false,
          });
          childGraph = {
            nodes: [
              terminal(startId, "subprocess.startTitle", "start", 0, 0),
              { ...aGraph, group_ids: [], pos_x: 240, pos_y: 0, sort_order: 1 },
              terminal(endId, "subprocess.endTitle", "end", 480, 2),
            ],
            edges: [
              {
                id: genId(),
                source_node_id: startId,
                target_node_id: aId,
                label: "",
                source_side: "right",
                target_side: "left",
                source_handle: null,
                target_handle: null,
              },
              {
                id: genId(),
                source_node_id: aId,
                target_node_id: endId,
                label: "",
                source_side: "right",
                target_side: "left",
                source_handle: null,
                target_handle: null,
              },
            ],
            groups: [],
          };
        } else {
          // 이미 하위가 있으면 A를 그대로 추가(기존 동작)
          childGraph = {
            nodes: [...child.nodes, { ...aGraph, group_ids: [] }],
            edges: child.edges,
            groups: child.groups,
          };
        }
        await saveGraph(versionId, childGraph, bId);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.moveChild"));
        return;
      }
      setNodes((current) =>
        current
          .filter((node) => node.id !== aId)
          .map((node) =>
            node.id === bId ? { ...node, data: { ...node.data, hasChildren: true } } : node,
          ),
      );
      // A에 연결된 현재 스코프 엣지 제거 — 안 하면 저장 시 payload 미존재 노드 참조로 422
      setEdges((current) => current.filter((edge) => edge.source !== aId && edge.target !== aId));
      setSelectedId((sel) => (sel === aId ? null : sel));
      scheduleAutoSave();
      refreshFullGraph();
    },
    [versionId, fullGraph, setNodes, setEdges, scheduleAutoSave, refreshFullGraph, t],
  );

  // 드롭으로 하위 만들기 진입점 — B에 후속(나가는 엣지) 있으면 즉시, 없으면 후속없음 모달(우클릭 생성과 동일 UX).
  const moveToChild = useCallback(
    (aId: string, bId: string) => {
      if (versionId === null) {
        return;
      }
      if (edgesRef.current.some((edge) => edge.source === bId)) {
        void runMoveToChild(aId, bId);
        return;
      }
      setSubprocessPrompt({ nodeId: bId, proceed: () => void runMoveToChild(aId, bId) });
    },
    [versionId, runMoveToChild],
  );

  const renameGroup = useCallback(
    (groupId: string, label: string) => {
      setGroups((current) => {
        const taken = current.filter((g) => g.id !== groupId).map((g) => g.label);
        const unique = makeUniqueLabel(label, taken);
        return current.map((g) => (g.id === groupId ? { ...g, label: unique } : g));
      });
      setNewGroupId((cur) => (cur === groupId ? null : cur));
      scheduleAutoSave();
    },
    [setGroups, scheduleAutoSave],
  );

  const recolorGroup = useCallback(
    (groupId: string, color: string) => {
      setGroups((current) => current.map((g) => (g.id === groupId ? { ...g, color } : g)));
      scheduleAutoSave();
    },
    [setGroups, scheduleAutoSave],
  );

  // 멤버 2명 미만 그룹은 유지 의미 없음 — 주어진 노드로 멤버 수를 세어 자동 제거(라이브 정리, 저장 0명 정리와 별개).
  const pruneSmallGroups = useCallback(
    (nextNodes: AppNode[]) => {
      const counts = new Map<string, number>();
      for (const node of nextNodes) {
        for (const gid of node.data.groupIds) {
          counts.set(gid, (counts.get(gid) ?? 0) + 1);
        }
      }
      // 라이브 groups 기준으로 제거 대상 선판정 — setGroups 업데이터 안 부작용(StrictMode 이중호출) 회피
      const removed = groupsRef.current.filter((group) => (counts.get(group.id) ?? 0) < 2);
      if (removed.length === 0) {
        return;
      }
      const removedIds = new Set(removed.map((group) => group.id));
      setGroups((cur) => cur.filter((group) => !removedIds.has(group.id)));
      showToast(removed.length === 1 ? t("group.removed") : t("group.removedN", { n: removed.length }));
    },
    [setGroups, showToast, t],
  );

  // 노드 삭제 시 멤버가 2명 미만이 된 그룹 정리 — 삭제된 노드를 제외한 잔여 노드로 멤버 재계산.
  // 자식 삭제 후 그 자식 스코프를 저장 — 권위 그래프(getGraph: 그룹 보존)에서 삭제 노드/엣지 제거 후 PUT.
  const saveChildScopeAfterDelete = useCallback(
    async (scopeId: string, removedIds: Set<string>) => {
      if (versionId === null) {
        return;
      }
      try {
        const graph = await getGraph(versionId, scopeId);
        const keptNodes = graph.nodes.filter((node) => !removedIds.has(node.id));
        const keptIds = new Set(keptNodes.map((node) => node.id));
        const keptEdges = graph.edges.filter(
          (edge) => keptIds.has(edge.source_node_id) && keptIds.has(edge.target_node_id),
        );
        await saveGraph(
          versionId,
          { nodes: keptNodes, edges: keptEdges, groups: graph.groups },
          scopeId,
        );
        refreshFullGraph();
      } catch {
        showToast(t("err.save"));
      }
    },
    [versionId, refreshFullGraph, showToast, t],
  );

  // 자식 드래그 후 그 자식의 스코프상대 좌표를 저장 — fullGraph 낙관적 갱신(즉시 파생 위치 반영) + 권위 그래프에 위치 PUT.
  // 자식 스코프 드래그 저장 — 여러 노드를 한 번의 getGraph→PUT로(같은 스코프 다중 드래그 레이스 방지).
  const saveChildScopeDragBatch = useCallback(
    async (scopeId: string, moves: { id: string; pos: { x: number; y: number } }[]) => {
      if (versionId === null || moves.length === 0) {
        return;
      }
      const byId = new Map(moves.map((move) => [move.id, move.pos]));
      setFullGraph((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              nodes: prev.nodes.map((node) => {
                const pos = byId.get(node.id);
                return pos ? { ...node, pos_x: pos.x, pos_y: pos.y } : node;
              }),
            },
      );
      try {
        const graph = await getGraph(versionId, scopeId);
        const nodes = graph.nodes.map((node) => {
          const pos = byId.get(node.id);
          return pos ? { ...node, pos_x: pos.x, pos_y: pos.y } : node;
        });
        await saveGraph(versionId, { ...graph, nodes }, scopeId);
        refreshFullGraph();
      } catch {
        showToast(t("err.save"));
      }
    },
    [versionId, refreshFullGraph, showToast, t, setFullGraph],
  );

  const handleNodesDelete = useCallback(
    (deleted: AppNode[]) => {
      const removed = new Set(deleted.map((node) => node.id));
      pruneSmallGroups(nodesRef.current.filter((node) => !removed.has(node.id)));
      // 펼친 자식 삭제 → 각 자식 스코프에서 제거 후 PUT(현재 스코프 저장과 별개)
      const childScopes = new Set(
        deleted
          .filter((node) => node.data.scopeId != null && node.data.scopeId !== currentParentId)
          .map((node) => node.data.scopeId as string),
      );
      if (childScopes.size > 0) {
        // fullGraph에서도 낙관적으로 제거 — 안 그러면 materialize effect가 삭제한 자식을 즉시 되살린다(저장 전).
        setFullGraph((prev) => {
          if (prev === null) {
            return prev;
          }
          const keptNodes = prev.nodes.filter((node) => !removed.has(node.id));
          const keptIds = new Set(keptNodes.map((node) => node.id));
          return {
            ...prev,
            nodes: keptNodes,
            edges: prev.edges.filter(
              (edge) => keptIds.has(edge.source_node_id) && keptIds.has(edge.target_node_id),
            ),
          };
        });
      }
      for (const scopeId of childScopes) {
        void saveChildScopeAfterDelete(scopeId, removed);
      }
      scheduleAutoSave();
    },
    [pruneSmallGroups, scheduleAutoSave, currentParentId, saveChildScopeAfterDelete, setFullGraph],
  );

  // 선택된 멤버 노드에서 이 그룹 태그만 제거. 멤버 2명 미만이 되면 그룹 자동 제거.
  const leaveGroup = useCallback(
    (groupId: string) => {
      const next = nodesRef.current.map((node) =>
        node.selected && node.data.groupIds.includes(groupId)
          ? {
              ...node,
              data: { ...node.data, groupIds: node.data.groupIds.filter((id) => id !== groupId) },
            }
          : node,
      );
      setNodes(next);
      pruneSmallGroups(next);
      scheduleAutoSave();
    },
    [setNodes, pruneSmallGroups, scheduleAutoSave],
  );

  // 선택된 노드들(2개 이상)에 새 그룹 태그 추가 — 라벨 기본=첫 노드의 부서/담당자. 기존 태그는 유지(다중 소속).
  const createGroupFromSelection = useCallback(() => {
    if (readOnly) {
      return;
    }
    const selected = nodesRef.current.filter((node) => node.selected);
    if (selected.length < 2) {
      showToast(t("group.needTwo"));
      return;
    }
    // 선택 노드가 모두 한 그룹에 함께 속하면 중복 그룹 — 차단(무명 그룹 양산 방지)
    const shared = selected.reduce<Set<string> | null>((common, node) => {
      const ids = new Set(node.data.groupIds);
      return common === null ? ids : new Set([...common].filter((id) => ids.has(id)));
    }, null);
    if (shared && shared.size > 0) {
      showToast(t("group.allInOne"));
      return;
    }
    pushHistory();
    const newId = genId();
    const first = selected[0];
    setGroups((cur) => [
      ...cur,
      {
        id: newId,
        parent_group_id: null,
        label: makeUniqueLabel(
          first.data.department || first.data.assignee || "",
          cur.map((g) => g.label),
        ),
        color: GROUP_COLOR_PRESETS[cur.length % GROUP_COLOR_PRESETS.length],
      },
    ]);
    const ids = new Set(selected.map((node) => node.id));
    setNodes((current) =>
      current.map((node) =>
        ids.has(node.id)
          ? { ...node, data: { ...node.data, groupIds: addTags(node.data.groupIds, [newId]) } }
          : node,
      ),
    );
    setNewGroupId(newId);
    scheduleAutoSave();
  }, [readOnly, pushHistory, setGroups, setNodes, scheduleAutoSave, showToast, t]);

  // 그룹 해제(disband) — 모든 노드에서 이 그룹 태그 제거 + 그룹 자체 삭제. leaveGroup(선택 멤버만 이탈)과 구분.
  const disbandGroup = useCallback(
    (groupId: string) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setNodes((current) =>
        current.map((node) =>
          node.data.groupIds.includes(groupId)
            ? {
                ...node,
                data: { ...node.data, groupIds: node.data.groupIds.filter((id) => id !== groupId) },
              }
            : node,
        ),
      );
      setGroups((current) => current.filter((group) => group.id !== groupId));
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, setGroups, scheduleAutoSave],
  );

  // 그룹 멤버(이 태그를 가진 노드) 색 일괄 변경
  const applyGroupColor = useCallback(
    (groupId: string, color: string) => {
      pushHistory();
      setNodes((current) =>
        current.map((node) =>
          node.data.groupIds.includes(groupId)
            ? { ...node, data: { ...node.data, color } }
            : node,
        ),
      );
      scheduleAutoSave();
    },
    [pushHistory, setNodes, scheduleAutoSave],
  );

  // 그룹 멤버 속성 일괄 적용 — 모달이 정책(교체/추가/건너뛰기/개별)을 멤버별 값으로 해석해 넘김
  const applyGroupAttribute = useCallback(
    (field: BulkAttrField, updates: { id: string; value: string }[]) => {
      if (updates.length === 0) {
        return;
      }
      pushHistory();
      const valueById = new Map(updates.map((u) => [u.id, u.value]));
      setNodes((current) =>
        current.map((node) =>
          valueById.has(node.id)
            ? { ...node, data: { ...node.data, [field]: valueById.get(node.id) ?? "" } }
            : node,
        ),
      );
      scheduleAutoSave();
      showToast(t("bulk.applied"));
    },
    [pushHistory, setNodes, scheduleAutoSave, showToast, t],
  );

  // 그룹 타이틀바 드래그 → 멤버 전체를 함께 이동
  const startGroupMove = useCallback(
    (
      groupId: string,
      event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
    ) => {
      if (readOnly) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pushHistory();
      const zoom = reactFlow.getViewport().zoom || 1;
      const startX = event.clientX;
      const startY = event.clientY;
      const startPositions = new Map(
        nodesRef.current
          .filter((node) => node.data.groupIds.includes(groupId))
          .map((node) => [node.id, { ...node.position }]),
      );
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        setNodes((current) =>
          current.map((node) => {
            const start = startPositions.get(node.id);
            return start ? { ...node, position: { x: start.x + dx, y: start.y + dy } } : node;
          }),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        scheduleAutoSave();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [readOnly, reactFlow, setNodes, pushHistory, scheduleAutoSave],
  );

  // A를 B의 자리로, B를 A의 드래그 시작 자리로 교환 (드롭존 중앙=swap)
  const swapNodes = useCallback(
    (aId: string, bId: string) => {
      const start = dragStartPosRef.current;
      setNodes((current) => {
        const b = current.find((node) => node.id === bId);
        if (!b) {
          return current;
        }
        const bPos = { ...b.position };
        const aOrig = start && start.id === aId ? { x: start.x, y: start.y } : null;
        return current.map((node) => {
          if (node.id === aId) {
            return { ...node, position: bPos };
          }
          if (node.id === bId && aOrig) {
            return { ...node, position: aOrig };
          }
          return node;
        });
      });
      // 엣지 연결 상태도 교환 — A의 연결은 B로, B의 연결은 A로
      setEdges((current) =>
        current.map((edge) => {
          const source = edge.source === aId ? bId : edge.source === bId ? aId : edge.source;
          const target = edge.target === aId ? bId : edge.target === bId ? aId : edge.target;
          return source === edge.source && target === edge.target
            ? edge
            : { ...edge, source, target };
        }),
      );
      scheduleAutoSave();
    },
    [setNodes, setEdges, scheduleAutoSave],
  );

  // 드롭 영역에 놓음 — 앞/뒤(흐름)·그룹·하위·교환. 앞·뒤는 기존 엣지가 있으면 유지/삽입 되묻기
  const handleZoneDrop = useCallback(
    (aId: string, bId: string, zone: DropZone) => {
      if (zone === "swap") {
        swapNodes(aId, bId);
        return;
      }
      if (zone === "group") {
        addToGroup(aId, bId);
        return;
      }
      if (zone === "child") {
        void moveToChild(aId, bId);
        return;
      }
      placeBeside(aId, bId, zone);
      scheduleAutoSave();
      const conflict =
        zone === "front"
          ? getIncomingEdges(edgesRef.current, bId).some((edge) => edge.source !== aId)
          : getOutgoingEdges(edgesRef.current, bId).some((edge) => edge.target !== aId);
      const rect = conflict ? screenRectOf(bId) : null;
      if (conflict && rect) {
        setPending({ mode: zone, aId, bId, rect });
        return;
      }
      // 충돌 없음(또는 위치 계산 실패) → 기본 삽입
      applyFlowEdges(aId, bId, zone, true);
    },
    [swapNodes, addToGroup, moveToChild, placeBeside, applyFlowEdges, scheduleAutoSave, screenRectOf],
  );

  // 마우스(flow 좌표) 아래에 있는, 드래그 노드가 아직 속하지 않은 기존 그룹 박스 id — 박스 영역 드롭 합류용
  const findGroupAt = useCallback((mouse: { x: number; y: number }, draggingId: string): string | null => {
    const draggingTags = nodesRef.current.find((n) => n.id === draggingId)?.data.groupIds ?? [];
    for (const group of groupsRef.current) {
      if (draggingTags.includes(group.id)) {
        continue; // 이미 이 그룹 태그 보유
      }
      const members = nodesRef.current.filter(
        (n) => n.data.groupIds.includes(group.id) && n.id !== draggingId,
      );
      if (members.length === 0) {
        continue;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const m of members) {
        const w = m.measured?.width ?? NODE_WIDTH;
        const h = m.measured?.height ?? NODE_HEIGHT;
        minX = Math.min(minX, m.position.x);
        minY = Math.min(minY, m.position.y);
        maxX = Math.max(maxX, m.position.x + w);
        maxY = Math.max(maxY, m.position.y + h);
      }
      const inX = mouse.x >= minX - GROUP_PAD && mouse.x <= maxX + GROUP_PAD;
      const inY = mouse.y >= minY - GROUP_PAD - GROUP_TITLE_GAP && mouse.y <= maxY + GROUP_PAD;
      if (inX && inY) {
        return group.id;
      }
    }
    return null;
  }, []);

  // dwell 타이머/상태 정리
  const clearDwell = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    dwellRef.current = null;
  }, []);

  // 드롭 링(+타일)이 컨테이너 가장자리를 넘으면 뷰포트를 패닝해 시야 안으로 끌어온다.
  // 링 반경은 화면 고정 크기라 줌이 아닌 패닝이 링을 드러내는 수단. 패닝한 만큼 rect도 옮겨 반환(타일 정합).
  const ensureRingVisible = useCallback(
    (rect: ScreenRect): ScreenRect => {
      const container = canvasContainerRef.current;
      if (!container) {
        return rect;
      }
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const margin = rect.radius + ZONE_TILE_H + 8; // 타일 한 칸까지 여유
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = 0;
      let dy = 0;
      if (cx - margin < 0) {
        dx = margin - cx;
      } else if (cx + margin > cw) {
        dx = cw - margin - cx;
      }
      if (cy - margin < 0) {
        dy = margin - cy;
      } else if (cy + margin > ch) {
        dy = ch - margin - cy;
      }
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return rect;
      }
      const vp = reactFlow.getViewport();
      reactFlow.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 200 });
      return { ...rect, left: rect.left + dx, top: rect.top + dy };
    },
    [reactFlow],
  );

  // 커서(컨테이너 상대 좌표)로 타일 적중 zone을 갱신. 타일 밖이면 zone=null(중립). 링(rect)은 유지.
  const activateZone = useCallback(
    (targetId: string, cursorX: number, cursorY: number) => {
      const found = screenRectOf(targetId);
      if (!found) {
        return;
      }
      // 가장자리면 시야 보정(패닝) 후 보정된 rect로 타일 판정
      const rect = ensureRingVisible(found);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const zone = pickDropZone(cursorX, cursorY, cx, cy, rect.radius, ZONE_TILE_W, ZONE_TILE_H);
      setGroupDropTarget((cur) => (cur ? null : cur)); // 노드 대상이 그룹 박스 hover보다 우선
      setDropTarget((cur) =>
        cur && cur.id === targetId && cur.zone === zone ? cur : { id: targetId, zone, rect },
      );
    },
    [screenRectOf, ensureRingVisible],
  );

  // 드래그 중 — 커서 위치(현재 마우스) 기준으로 판정.
  // 링이 한번 뜨면 커서가 링 밖으로 나가기 전까지 유지(겹침 해제와 무관). 노드가 없으면 그룹 박스 hover.
  const handleNodeDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: AppNode) => {
      if (readOnly) {
        return;
      }
      const clientX = "touches" in event ? (event.touches[0]?.clientX ?? 0) : event.clientX;
      const clientY = "touches" in event ? (event.touches[0]?.clientY ?? 0) : event.clientY;
      const mouse = reactFlow.screenToFlowPosition({ x: clientX, y: clientY });

      // 컨테이너 상대 커서 — 타일 적중 판정·링 유지 경계가 모두 이 좌표계(=screenRectOf/오버레이 렌더)
      const container = canvasContainerRef.current;
      const crect = container?.getBoundingClientRect();
      const curX = crect ? clientX - crect.left : clientX;
      const curY = crect ? clientY - crect.top : clientY;
      dragCursorRef.current = { x: curX, y: curY };

      // 이미 떠 있는 링 — 커서가 유지 경계 안이면 zone만 갱신, 밖으로 나가면 해제 후 재탐지
      const active = dropTargetRef.current;
      if (active && active.id !== node.id) {
        const r = active.rect;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const keep = r.radius + ZONE_TILE_H; // 타일까지 커서를 옮겨도 링 유지
        const dist = Math.hypot(curX - cx, curY - cy);
        if (dist <= keep) {
          activateZone(active.id, curX, curY);
          return;
        }
        setDropTarget((cur) => (cur ? null : cur));
        clearDwell();
      }

      // 드래그 노드와 겹치는 노드 — DWELL_MS 머문 뒤 4방향 링 표시(커서 아님, 노드끼리 겹침 기준)
      const target = reactFlow
        .getIntersectingNodes(node)
        .find((other) => other.id !== node.id);
      if (target) {
        setGroupDropTarget((cur) => (cur ? null : cur));
        if (!dwellRef.current || dwellRef.current.id !== target.id) {
          clearDwell();
          dwellRef.current = { id: target.id, since: Date.now() };
          dwellTimerRef.current = setTimeout(
            () => activateZone(target.id, dragCursorRef.current.x, dragCursorRef.current.y),
            DWELL_MS,
          );
        } else if (Date.now() - dwellRef.current.since >= DWELL_MS) {
          activateZone(target.id, dragCursorRef.current.x, dragCursorRef.current.y);
        }
        return;
      }

      // 커서 아래 노드 없음 — 기존 그룹 박스 빈 영역 위면 합류 대상으로 강조
      clearDwell();
      setDropTarget((cur) => (cur ? null : cur));
      const gid = findGroupAt(mouse, node.id);
      setGroupDropTarget((cur) => (cur === gid ? cur : gid));
    },
    [readOnly, reactFlow, clearDwell, activateZone, findGroupAt],
  );

  // 언마운트 시 dwell 타이머 정리
  useEffect(() => clearDwell, [clearDwell]);

  // 언마운트 시 자식 저장 디바운스 타이머 정리(언마운트 후 setState 경고 방지)
  useEffect(
    () => () => {
      if (childSaveTimerRef.current) {
        clearTimeout(childSaveTimerRef.current);
      }
    },
    [],
  );

  const updateSelectedData = useCallback(
    (patch: Partial<NodeData>, fromTyping = false) => {
      if (readOnly) {
        return;
      }
      recordChange(fromTyping);
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedId
            ? { ...node, data: { ...node.data, ...patch } }
            : node,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, recordChange, selectedId, setNodes, scheduleAutoSave],
  );

  // 우클릭 색 스와치 → 선택 노드 색 변경 (우클릭 시 해당 노드가 selectedId가 됨)
  const handleRecolor = useCallback(
    (color: string) => updateSelectedData({ color }),
    [updateSelectedData],
  );

  // 특정 노드 데이터 패치 — 정보 수정 모달(summaryNodeId 대상)에서 사용. id로 직접 지정(선택과 무관).
  const patchNode = useCallback(
    (id: string, patch: Partial<NodeData>, fromTyping = false) => {
      if (readOnly) {
        return;
      }
      recordChange(fromTyping);
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, recordChange, setNodes, scheduleAutoSave],
  );

  // ── 인라인 펼친 자식 노드 편집 → 자기 스코프 저장(scope-split) ──────────
  // fullGraph엔 그룹이 없어 재구성 불가 → getGraph로 권위 그래프(노드+엣지+그룹)를 받아 노드 필드만 덮어 PUT.
  const flushChildScopeSaves = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    const scopeIds = [...dirtyChildScopesRef.current];
    dirtyChildScopesRef.current.clear();
    if (scopeIds.length === 0) {
      return;
    }
    const edits = childEditsRef.current; // 동기 시점 캡처 — 이후 await 중 오버레이가 초기화돼도 안전
    let failed = false;
    for (const scopeId of scopeIds) {
      try {
        const scopeGraph = await getGraph(versionId, scopeId);
        const patched: Graph = {
          ...scopeGraph,
          nodes: scopeGraph.nodes.map((node) => {
            const edit = edits.get(node.id);
            return edit ? patchGraphNode(node, edit) : node;
          }),
        };
        await saveGraph(versionId, patched, scopeId);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      showToast(t("err.save"));
    }
    refreshFullGraph();
  }, [versionId, refreshFullGraph, showToast, t]);

  // 자식 속성 패치(이름 외) — 낙관적 오버레이 + 자식 스코프 디바운스 저장(키 입력마다 PUT 방지).
  const patchChildNode = useCallback(
    (id: string, patch: Partial<NodeData>) => {
      const tree = fullGraphRef.current;
      if (tree === null) {
        return;
      }
      const flat = tree.nodes.find((node) => node.id === id);
      if (!flat || flat.parent_node_id === null) {
        return; // 자식 스코프 노드만
      }
      setChildEdits((current) => {
        const next = new Map(current);
        next.set(id, { ...(next.get(id) ?? {}), ...patch });
        return next;
      });
      dirtyChildScopesRef.current.add(flat.parent_node_id);
      if (childSaveTimerRef.current) {
        clearTimeout(childSaveTimerRef.current);
      }
      childSaveTimerRef.current = setTimeout(() => {
        childSaveTimerRef.current = null;
        void flushChildScopeSaves();
      }, CHILD_SAVE_DEBOUNCE_MS);
    },
    [flushChildScopeSaves],
  );

  // 자식 이름 확정(blur/Enter) — 스코프 내 중복 방지 후 오버레이 + 즉시 저장.
  const renameChildNode = useCallback(
    (id: string, label: string) => {
      const tree = fullGraphRef.current;
      if (tree === null) {
        return;
      }
      const flat = tree.nodes.find((node) => node.id === id);
      if (!flat || flat.parent_node_id === null) {
        return;
      }
      const scopeId = flat.parent_node_id;
      const taken = tree.nodes
        .filter((node) => node.parent_node_id === scopeId && node.id !== id)
        .map((node) => childEditsRef.current.get(node.id)?.label ?? node.title);
      const unique = makeUniqueLabel(label, taken);
      setChildEdits((current) => {
        const next = new Map(current);
        next.set(id, { ...(next.get(id) ?? {}), label: unique });
        return next;
      });
      dirtyChildScopesRef.current.add(scopeId);
      if (childSaveTimerRef.current) {
        clearTimeout(childSaveTimerRef.current);
        childSaveTimerRef.current = null;
      }
      void flushChildScopeSaves(); // 이름 확정은 즉시
    },
    [flushChildScopeSaves],
  );

  // 정보 수정 모달 패치 — summaryNodeId 대상. 현재 스코프 노드는 state, 펼친 자식은 scope-split.
  const handleSummaryPatch = useCallback(
    (patch: Partial<NodeData>) => {
      if (summaryNodeId === null) {
        return;
      }
      if (nodesRef.current.some((node) => node.id === summaryNodeId)) {
        patchNode(summaryNodeId, patch, true);
      } else {
        patchChildNode(summaryNodeId, patch);
      }
    },
    [summaryNodeId, patchNode, patchChildNode],
  );

  // 제목 입력 확정(blur) — 캔버스 내 다른 노드와 이름 중복 시 " (n)" 접미사로 고유화.
  const handleSummaryLabelCommit = useCallback(
    (label: string) => {
      if (summaryNodeId === null) {
        return;
      }
      if (!nodesRef.current.some((node) => node.id === summaryNodeId)) {
        renameChildNode(summaryNodeId, label); // 펼친 자식 — scope-split
        return;
      }
      const taken = nodesRef.current
        .filter((node) => node.id !== summaryNodeId)
        .map((node) => node.data.label);
      const unique = makeUniqueLabel(label, taken);
      if (unique !== label) {
        patchNode(summaryNodeId, { label: unique }, false);
      }
    },
    [summaryNodeId, patchNode, renameChildNode],
  );

  // 인라인 이름 편집 커밋(캔버스 노드·아웃라인 공용) — 현재 스코프 노드는 state, 펼친 자식은 scope-split 저장.
  const renameNode = useCallback(
    (id: string, label: string) => {
      setEditingNodeId(null);
      if (readOnly) {
        return;
      }
      if (!nodesRef.current.some((node) => node.id === id)) {
        void renameChildNode(id, label); // 현재 스코프에 없으면 펼친 자식 — 자기 스코프에 저장
        return;
      }
      pushHistory();
      setNodes((current) => {
        const taken = current.filter((node) => node.id !== id).map((node) => node.data.label);
        const unique = makeUniqueLabel(label, taken);
        return current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, label: unique } } : node,
        );
      });
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, scheduleAutoSave, renameChildNode],
  );

  const updateSelectedEdgeLabel = useCallback(
    (label: string) => {
      if (readOnly) {
        return;
      }
      recordChange(true);
      setEdges((current) =>
        current.map((edge) =>
          edge.id === selectedEdgeId
            ? { ...edge, label: label || undefined }
            : edge,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, recordChange, selectedEdgeId, setEdges, scheduleAutoSave],
  );

  const setEdgeSide = useCallback(
    (edgeId: string, end: "source" | "target", side: HandleSide) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                ...(end === "source"
                  ? { sourceHandle: sourceHandleId(side) }
                  : { targetHandle: targetHandleId(side) }),
              }
            : edge,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setEdges, scheduleAutoSave],
  );

  // 검색 결과 선택 — 같은 스코프면 바로 포커스, 아니면 스코프 이동 후 포커스
  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      setSearchQuery("");
      setSearchResults([]);
      const targetScope = result.scopes[result.scopes.length - 1];
      if (targetScope.parentId === currentParentId) {
        setSelectedId(result.node.id);
        setSelectedEdgeId(null);
        void reactFlow.fitView({
          nodes: [{ id: result.node.id }],
          padding: 0.4,
          duration: 300,
          maxZoom: 1.25,
        });
        return;
      }
      focusNodeIdRef.current = result.node.id;
      void navigateTo(result.scopes);
    },
    [currentParentId, reactFlow, navigateTo],
  );

  const handleExportPng = useCallback(async () => {
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    const sanitize = (text: string) => text.replace(/[^\w가-힣.-]+/g, "-");
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14);
    try {
      await exportCanvasPng(
        nodesRef.current,
        `${sanitize(mapName)}_${sanitize(versionLabel)}_${stamp}.png`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.exportPng"));
    }
  }, [versions, versionId, mapName, t]);

  // ── 컨텍스트 메뉴 ─────────────────────────────────────

  const openMenu = useCallback(
    (event: React.MouseEvent | MouseEvent, kind: MenuState["kind"], targetId: string | null) => {
      event.preventDefault();
      // 읽기 전용에서는 노드 메뉴(드릴다운)만 의미가 있다
      if (readOnly && kind !== "node") {
        return;
      }
      setMenu({ x: event.clientX, y: event.clientY, kind, targetId });
    },
    [readOnly],
  );

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) {
      return [];
    }
    // 정렬은 2개 이상, 분배는 3개 이상 대상이 있어야 의미가 있다 — 부족하면 비활성화
    const selectedCount = nodes.filter((node) => node.selected).length;

    // 정렬·레이아웃 통합 하위 메뉴 — ids=null이면 전체(pane), 지정이면 그 대상. 가로/세로는 아이콘으로 구분.
    const alignSubmenu = (
      ids: ReadonlySet<string> | null,
      count: number,
    ): ContextMenuItem[] => [
      {
        label: t("ctx.autoLayout"),
        icon: Network,
        accel: "a",
        shortcut: "A",
        disabled: ids ? count < 2 : false,
        onSelect: () =>
          applyNodesTransform((current) =>
            ids
              ? layoutSubsetWithDagre(current, edgesRef.current, ids)
              : layoutWithDagre(current, edgesRef.current),
          ),
      },
      { divider: true },
      // 가로 정렬(세로 기준선) — 좌측 / 가로 가운데
      {
        label: t("editor.alignLeft"),
        icon: AlignStartVertical,
        shortcut: "W",
        accel: "w",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "left", ids ?? undefined)),
      },
      {
        label: t("editor.alignCenterX"),
        icon: AlignCenterVertical,
        shortcut: "C",
        accel: "c",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "centerX", ids ?? undefined)),
      },
      { divider: true },
      // 세로 정렬(가로 기준선) — 상단 / 세로 가운데
      {
        label: t("editor.alignTop"),
        icon: AlignStartHorizontal,
        shortcut: "T",
        accel: "t",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "top", ids ?? undefined)),
      },
      {
        label: t("editor.alignCenterY"),
        icon: AlignCenterHorizontal,
        shortcut: "X",
        accel: "x",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "centerY", ids ?? undefined)),
      },
      { divider: true },
      // 등간격 분배 — 가로 / 세로
      {
        label: t("editor.distributeX"),
        icon: AlignHorizontalDistributeCenter,
        shortcut: "R",
        accel: "r",
        disabled: count < 3,
        onSelect: () => applyNodesTransform((current) => distributeSelected(current, "x", ids ?? undefined)),
      },
      {
        label: t("editor.distributeY"),
        icon: AlignVerticalDistributeCenter,
        shortcut: "V",
        accel: "v",
        disabled: count < 3,
        onSelect: () => applyNodesTransform((current) => distributeSelected(current, "y", ids ?? undefined)),
      },
    ];
    const alignItem = (ids: ReadonlySet<string> | null, count: number): ContextMenuItem => ({
      label: t("ctx.align"),
      icon: LayoutGrid,
      accel: "a",
      shortcut: "A",
      submenu: alignSubmenu(ids, count),
    });

    if (menu.kind === "pane") {
      // 맨 아래 "기타" 하위 메뉴 — 추후 기능 확장 지점
      const moreItem: ContextMenuItem = {
        label: t("ctx.more"),
        submenu: [
          { label: t("ctx.exportPng"), shortcut: "Ctrl+⇧E", onSelect: () => void handleExportPng() },
        ],
      };
      if (readOnly) {
        return [moreItem];
      }
      return [
        ...NODE_TYPE_OPTIONS.map((option, index) => ({
          label: t(option.labelKey),
          shortcut: String(index + 1),
          accel: String(index + 1),
          onSelect: () => handleAddNode({ x: menu.x, y: menu.y }, option.value),
        })),
        { divider: true },
        alignItem(null, selectedCount),
        { divider: true },
        moreItem,
      ];
    }
    // 그룹/복수선택 정렬 메뉴 — ids 미지정(selection)은 선택 노드, 지정(group)은 그룹 멤버 대상
    if (menu.kind === "group" || menu.kind === "selection") {
      const ids =
        menu.kind === "group"
          ? new Set(nodes.filter((node) => menu.targetId !== null && node.data.groupIds.includes(menu.targetId)).map((node) => node.id))
          : new Set(nodes.filter((node) => node.selected).map((node) => node.id));
      const targetCount = ids.size;
      const groupId = menu.targetId;
      // 그룹 우클릭 = 일괄 편집·그룹 해제, 복수선택 우클릭 = 그룹 생성 (둘 다 정렬 위에 배치)
      const groupActions: ContextMenuItem[] =
        menu.kind === "group" && groupId && !readOnly
          ? [
              { label: t("group.bulkEdit"), onSelect: () => setBulkEditGroupId(groupId) },
              { label: t("ctx.disband"), onSelect: () => disbandGroup(groupId) },
              { divider: true },
            ]
          : menu.kind === "selection" && !readOnly
            ? [
                {
                  label: t("ctx.createGroup"),
                  shortcut: "G",
                  accel: "g",
                  disabled: targetCount < 2,
                  onSelect: () => createGroupFromSelection(),
                },
                { divider: true },
              ]
            : [];
      return [...groupActions, alignItem(ids, targetCount)];
    }
    if (menu.kind === "edge") {
      const edge = edges.find((e) => e.id === menu.targetId);
      if (!edge || readOnly) {
        return [];
      }
      return [
        {
          pad: true,
          label: t("edge.sourceSide"),
          current: sideFromHandleId(edge.sourceHandle, "right"),
          onPick: (side: HandleSide) => setEdgeSide(edge.id, "source", side),
        },
        { divider: true },
        {
          pad: true,
          label: t("edge.targetSide"),
          current: sideFromHandleId(edge.targetHandle, "left"),
          onPick: (side: HandleSide) => setEdgeSide(edge.id, "target", side),
        },
      ];
    }
    if (menu.kind === "node") {
      const deleteItems: ContextMenuItem[] = readOnly
        ? []
        : [
            { divider: true },
            {
              label: t("ctx.delete"),
              shortcut: "Del",
              danger: true,
              onSelect: () => {
                if (menu.targetId) {
                  void reactFlow.deleteElements({ nodes: [{ id: menu.targetId }] });
                }
              },
            },
          ];
      const colorItems: ContextMenuItem[] = readOnly
        ? []
        : [
            {
              colors: COLOR_PRESETS,
              current: nodes.find((item) => item.id === menu.targetId)?.data.color ?? "",
              onPick: handleRecolor,
              moreLabel: t("editor.moreColors"),
            },
            { divider: true },
          ];
      // 하위 있으면 "열기"(창 — 기존 편집), process+하위없으면 "생성"(Start/작업/End 자동 + 인라인 펼침)
      const targetNode = nodes.find((item) => item.id === menu.targetId);
      const hasKids = targetNode?.data.hasChildren ?? false;
      const isProcessNode = targetNode?.data.nodeType === "process";
      const openChildItems: ContextMenuItem[] = hasKids
        ? [
            {
              label: t("ctx.openChild"),
              onSelect: () => {
                // 드릴인 창 대신 인라인 펼침/접기(toggleInlineExpand) — ref는 정의 순서(TDZ) 회피용
                if (menu.targetId) {
                  toggleInlineExpandRef.current?.(menu.targetId);
                }
              },
            },
          ]
        : isProcessNode
          ? [
              {
                label: t("ctx.createSubprocess"),
                onSelect: () => {
                  const node = nodesRef.current.find((item) => item.id === menu.targetId);
                  if (node) {
                    createSubprocess(node.id);
                  }
                },
              },
            ]
          : [];
      return [
        // 노드 우클릭 기본 = 정보 수정 모달(보기+편집)
        {
          label: t("ctx.editInfo"),
          shortcut: "E",
          accel: "e",
          onSelect: () => {
            if (menu.targetId) {
              setSummaryNodeId(menu.targetId);
            }
          },
        },
        { divider: true },
        ...colorItems,
        ...openChildItems,
        ...deleteItems,
      ];
    }
    return [
      {
        label: t("ctx.editLabel"),
        onSelect: () => {
          setSelectedEdgeId(menu.targetId);
          setSelectedId(null);
        },
      },
      { divider: true },
      {
        label: t("ctx.delete"),
        shortcut: "Del",
        danger: true,
        onSelect: () => {
          if (menu.targetId) {
            void reactFlow.deleteElements({ edges: [{ id: menu.targetId }] });
          }
        },
      },
    ];
  }, [
    menu,
    readOnly,
    nodes,
    edges,
    setEdgeSide,
    handleAddNode,
    handleRecolor,
    applyNodesTransform,
    createSubprocess,
    handleExportPng,
    createGroupFromSelection,
    disbandGroup,
    reactFlow,
    t,
  ]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );
  // 선택 엣지가 판단 노드 분기면 그 종류(Yes/No/기타), 아니면 null — 인스펙터 탭 표시 판정
  const selectedEdgeBranch = useMemo<BranchKind | null>(() => {
    if (!selectedEdge) {
      return null;
    }
    const source = nodes.find((node) => node.id === selectedEdge.source);
    if (source?.data.nodeType !== "decision") {
      return null;
    }
    return branchKindOf(selectedEdge.label);
  }, [selectedEdge, nodes]);

  // 인스펙터 탭으로 분기 종류 전환 — Yes/No는 고정 라벨, 기타는 라벨 비우고 직접 편집
  const setSelectedEdgeBranch = useCallback(
    (kind: BranchKind) => {
      updateSelectedEdgeLabel(
        kind === "yes" ? BRANCH_YES_LABEL : kind === "no" ? BRANCH_NO_LABEL : "",
      );
    },
    [updateSelectedEdgeLabel],
  );
  // 노드별 미해결 코멘트 수 — 렌더 시 nodes에 주입 (effect 내 setState 회피)
  const unresolvedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of comments) {
      if (!comment.resolved) {
        counts.set(comment.node_id, (counts.get(comment.node_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [comments]);

  // 인라인 펼치기/접기 토글 — 순수 뷰(raw state·저장 무영향). 펼칠 때 한도 초과면 확인 모달.
  const toggleInlineExpand = useCallback(
    (nodeId: string) => {
      const next = new Set(expandedInline);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        // 중첩: 이 노드의 후손도 모두 접는다 — 안 그러면 후손의 childNodes가 고아로 남는다.
        if (fullGraph) {
          const parentOf = new Map(fullGraph.nodes.map((n) => [n.id, n.parent_node_id]));
          const isDescendant = (id: string): boolean => {
            let cursor = parentOf.get(id) ?? null;
            while (cursor != null) {
              if (cursor === nodeId) {
                return true;
              }
              cursor = parentOf.get(cursor) ?? null;
            }
            return false;
          };
          for (const id of [...next]) {
            if (isDescendant(id)) {
              next.delete(id);
            }
          }
        }
        commitExpanded(next);
        return;
      }
      next.add(nodeId);
      if (fullGraph) {
        const limits = checkExpansionLimits(fullGraph, next);
        if (limits.exceeds) {
          setCapPrompt({ next, nodeCount: limits.nodeCount, depth: limits.depth });
          return;
        }
      }
      commitExpanded(next);
    },
    [expandedInline, fullGraph, commitExpanded],
  );
  // 컨텍스트 메뉴 등 위쪽 useMemo에서 호출하도록 ref로 노출(TDZ 회피)
  useEffect(() => {
    toggleInlineExpandRef.current = toggleInlineExpand;
  }, [toggleInlineExpand]);

  // 모두 펼치기 — fullGraph에서 하위를 가진 모든 노드. 모두 접기 — 비움.
  const expandAll = useCallback(() => {
    if (!fullGraph) {
      return;
    }
    const next = new Set(
      fullGraph.nodes
        .map((node) => node.parent_node_id)
        .filter((id): id is string => id != null),
    );
    if (next.size === 0) {
      return;
    }
    const limits = checkExpansionLimits(fullGraph, next);
    if (limits.exceeds) {
      setCapPrompt({ next, nodeCount: limits.nodeCount, depth: limits.depth });
      return;
    }
    commitExpanded(next);
  }, [fullGraph, commitExpanded]);

  const collapseAll = useCallback(() => commitExpanded(new Set()), [commitExpanded]);

  const confirmCapPrompt = useCallback(() => {
    if (capPrompt) {
      commitExpanded(capPrompt.next);
    }
    setCapPrompt(null);
  }, [capPrompt, commitExpanded]);

  // 인라인 펼침 합성(영역 컨테이너 모델, 중첩 재귀) — 펼친 노드 오른쪽에 하위 "캔버스 레인"을 삽입하고
  // 공간상 그보다 오른쪽 노드를 우측으로 민다. 왼쪽/A의 수동 배치는 보존(전체 재배치 아님). 파생 레이어.
  const inlineComposition = useMemo(() => {
    if (expandedInline.size === 0 || !fullGraph) {
      return null;
    }
    const tree = fullGraph;
    const rootIds = new Set(nodes.map((node) => node.id));

    // 한 스코프를 배치 — 펼친 노드마다 하위 스코프를 재귀 배치해 오른쪽에 영역으로 삽입.
    // 입력 노드는 이미 배치돼 있음(루트=수동, 자식=dagre). depth>1이면 결과를 원점 정규화해 부모가 평행이동.
    const buildScope = (
      scopeNodes: AppNode[],
      depth: number,
    ): { nodes: AppNode[]; regions: RegionBox[]; childEdges: Edge[]; width: number; height: number } => {
      const placed = new Map<string, AppNode>(
        scopeNodes.map((node) => [node.id, { ...node, position: { ...node.position } }]),
      );
      const descendants: AppNode[] = [];
      const regions: RegionBox[] = [];
      const childEdges: Edge[] = [];

      const expandedHere = scopeNodes
        .filter((node) => expandedInline.has(node.id))
        .sort((a, b) => a.position.x - b.position.x);

      for (const target of expandedHere) {
        const anchor = placed.get(target.id);
        if (!anchor) {
          continue;
        }
        const kidsFlat = tree.nodes.filter((node) => node.parent_node_id === target.id);
        if (kidsFlat.length === 0) {
          continue;
        }
        const kidApp = kidsFlat.map((flat) => {
          const [app] = toAppNodes({ nodes: [flat], edges: [], groups: [] }, target.id);
          // 자식은 선택·편집 허용. 위치는 파생이라 드래그/삭제는 불가. 편집 오버레이(라벨·속성)를 입힘.
          const edit = childEdits.get(app.id);
          // 자식은 `nodes` state에 없어 React Flow가 측정 못 함 → 미측정 노드는 visibility:hidden으로 숨겨진다.
          // 타입별 근사 크기를 measured로 직접 넣어 즉시 보이게 한다(레이아웃도 이 크기로 일관).
          const size = nodeSizeOf(app.data.nodeType);
          return {
            ...app,
            draggable: false,
            selectable: true,
            deletable: false,
            width: size.w,
            height: size.h,
            measured: { width: size.w, height: size.h },
            data: edit ? { ...app.data, ...edit } : app.data,
          };
        });
        const kidIds = new Set(kidsFlat.map((kid) => kid.id));
        const kidEdges = toAppEdges({
          nodes: [],
          edges: tree.edges.filter(
            (edge) => kidIds.has(edge.source_node_id) && kidIds.has(edge.target_node_id),
          ),
          groups: [],
        }).map((edge) => ({ ...edge, selectable: false, deletable: false, focusable: false }));
        // 자식 스코프 로컬 LR 배치 후 재귀(자식 안의 펼침 처리)
        // 자식은 dagre 재배치 대신 저장된 위치를 그대로 사용 — 드래그 편집이 영속되고 인라인=드릴인 레이아웃 일관.
        const sub = buildScope(kidApp, depth + 1);
        const anchorSize = nodeSizeOf(anchor.data.nodeType);
        const regionW = sub.width + REGION_PAD * 2;
        const regionX = anchor.position.x + anchorSize.w + REGION_GAP;
        // 영역 상단을 앵커 상단에 정렬(세로 중심정렬 아님) — 단일행 초기표시는 동일하고, 자식 세로 드래그 시 재중심화 튐을 없앤다.
        const childTop = anchor.position.y;
        // A 바로 오른쪽 노드도 영역을 완전히 벗어나도록 앵커 폭 포함(겹침 방지)
        const footprint = anchorSize.w + regionW + REGION_GAP * 2;
        // 공간상 A보다 오른쪽 = 우측 이동(이 스코프 노드 + 먼저 배치된 자식/영역)
        for (const node of placed.values()) {
          if (node.position.x > anchor.position.x) {
            node.position = { ...node.position, x: node.position.x + footprint };
          }
        }
        for (const node of descendants) {
          if (node.position.x > anchor.position.x) {
            node.position = { ...node.position, x: node.position.x + footprint };
          }
        }
        for (const region of regions) {
          if (region.x > anchor.position.x) {
            region.x += footprint;
          }
        }
        // 하위 레이아웃을 영역 안쪽으로 평행이동(좌: 안쪽 여백, 상: A 세로 중앙)
        const offsetX = regionX + REGION_PAD;
        for (const node of sub.nodes) {
          descendants.push({
            ...node,
            position: { x: node.position.x + offsetX, y: node.position.y + childTop },
          });
        }
        for (const region of sub.regions) {
          regions.push({ ...region, x: region.x + offsetX, y: region.y + childTop });
        }
        childEdges.push(...sub.childEdges, ...kidEdges);
        regions.push({
          id: target.id,
          label: target.data.label,
          depth,
          x: regionX,
          y: 0,
          width: regionW,
          height: 0,
        });
      }

      // 콘텐츠 bbox — Y는 노드만, X는 노드+영역(영역이 더 넓을 수 있음)
      const all = [...placed.values(), ...descendants];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of all) {
        const size = nodeSizeOf(node.data.nodeType);
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + size.w);
        maxY = Math.max(maxY, node.position.y + size.h);
      }
      for (const region of regions) {
        minX = Math.min(minX, region.x);
        maxX = Math.max(maxX, region.x + region.width);
      }
      const width = all.length > 0 ? maxX - minX : 0;
      const height = all.length > 0 ? maxY - minY : 0;
      // 중첩(depth>1)은 원점 정규화 — 부모가 (offsetX, childTop)으로 평행이동하도록
      if (depth > 1 && all.length > 0) {
        for (const node of all) {
          node.position = { x: node.position.x - minX, y: node.position.y - minY };
        }
        for (const region of regions) {
          region.x -= minX;
          region.y -= minY;
        }
      }
      return { nodes: all, regions, childEdges, width, height };
    };

    const root = buildScope(nodes, 1);
    if (root.regions.length === 0) {
      return null;
    }
    const allNodes = root.nodes;
    const childNodes = allNodes.filter((node) => !rootIds.has(node.id));
    const { regions, childEdges } = root;

    // 영역 배경은 캔버스를 상하로 가득 채우는 세로 레인 — 전체 콘텐츠 Y 범위 + 여백
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of allNodes) {
      const size = nodeSizeOf(node.data.nodeType);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y + size.h);
    }
    for (const region of regions) {
      region.y = minY - REGION_MARGIN;
      region.height = maxY - minY + REGION_MARGIN * 2;
    }

    // 게이트웨이(A→진입, 진출→후속, 깊이 무관) + A→B 숨김(깊이 무관)
    const combinedEdges = [...edges, ...childEdges];
    const gateways = buildGatewayEdges(expandedInline, childNodes, combinedEdges).map((edge) => ({
      ...EDGE_DEFAULTS,
      ...edge,
      animated: false,
      selectable: false,
      deletable: false,
      focusable: false,
      style: { opacity: INLINE_GATEWAY_OPACITY, strokeDasharray: "5 4" },
    }));
    const hiddenIds = new Set(
      combinedEdges.filter((edge) => expandedInline.has(edge.source)).map((edge) => edge.id),
    );
    // 영역을 가로지르는 루트 엣지 → 반투명(양 끝이 영역 좌우로 갈리는 경우)
    const xOf = new Map<string, number>();
    for (const node of allNodes) {
      xOf.set(node.id, node.position.x);
    }
    const crossingIds = new Set<string>();
    for (const edge of edges) {
      if (hiddenIds.has(edge.id)) {
        continue;
      }
      const sx = xOf.get(edge.source);
      const tx = xOf.get(edge.target);
      if (sx == null || tx == null) {
        continue;
      }
      const lo = Math.min(sx, tx);
      const hi = Math.max(sx, tx);
      if (regions.some((region) => lo < region.x && hi > region.x + region.width)) {
        crossingIds.add(edge.id);
      }
    }

    // 자식별 영역 오프셋(파생 절대위치 − fullGraph 스코프상대) — 드래그/추가 시 절대↔스코프상대 변환용.
    // scopeOffsets: 같은 스코프 자식은 동일 오프셋 → 새 노드 추가 위치 변환에 사용.
    const childOffsets = new Map<string, { x: number; y: number }>();
    const scopeOffsets = new Map<string, { x: number; y: number }>();
    for (const node of allNodes) {
      const sid = node.data.scopeId;
      if (sid != null && sid !== currentParentId) {
        const flat = fullGraph.nodes.find((entry) => entry.id === node.id);
        if (flat) {
          const offset = {
            x: node.position.x - flat.pos_x,
            y: node.position.y - flat.pos_y,
          };
          childOffsets.set(node.id, offset);
          scopeOffsets.set(sid, offset);
        }
      }
    }
    return {
      nodes: allNodes,
      childEdges,
      gateways,
      regions,
      hiddenIds,
      crossingIds,
      childOffsets,
      scopeOffsets,
    };
  }, [expandedInline, fullGraph, nodes, edges, childEdits, currentParentId]);

  useEffect(() => {
    inlineCompositionRef.current = inlineComposition;
  }, [inlineComposition]);

  // 펼침/접힘은 줌·팬을 바꾸지 않는다(사용자 요청 — 자동 fitView 제거). 슬라이드 전환만 잠깐 켰다 끈다.
  useEffect(() => {
    if (!expandAnimating) {
      return;
    }
    const timer = window.setTimeout(() => setExpandAnimating(false), 450);
    return () => window.clearTimeout(timer);
  }, [expandAnimating]);

  // 포커스 모드 Step 2 — 활성 스코프가 자식일 때(currentParentId≠null) 조상 스코프 노드를 읽기전용 dim 컨텍스트로 렌더.
  // 활성 스코프(`nodes`)는 스코프상대 좌표라, 각 조상 스코프를 그 우변이 활성 스코프 좌측에 오도록 평행이동(상단 정렬). 깊이만큼 좌로 누적.
  // fullGraph는 자식 state(`nodes`)에 없어 React Flow 미측정 → measured 직접 주입(레슨: 미측정=visibility:hidden).
  const ancestorContextNodes = useMemo<AppNode[]>(() => {
    // 인라인 펼침 중에도 조상 컨텍스트를 그린다(펼치면 깊이0이 사라지던 버그) — 앵커는 "표시" 위치(합성된 nodes) 기준.
    const anchorNodes = inlineComposition ? inlineComposition.nodes : nodes;
    if (currentParentId === null || !fullGraph || anchorNodes.length === 0) {
      return [];
    }
    // 활성 스코프(현재 표시)의 가로 범위 — 조상들이 이 영역을 감싸도록 배치
    let aMinX = Infinity;
    let aMaxX = -Infinity;
    let aMinY = Infinity;
    for (const node of anchorNodes) {
      const w = nodeSizeOf(node.data.nodeType).w;
      aMinX = Math.min(aMinX, node.position.x);
      aMaxX = Math.max(aMaxX, node.position.x + w);
      aMinY = Math.min(aMinY, node.position.y);
    }
    const byId = new Map(fullGraph.nodes.map((flat) => [flat.id, flat]));
    const GAP = 60; // 인접 노드 가로 간격(인라인 펼침과 동일 언어)
    const out: AppNode[] = [];
    let focusId: string | null = currentParentId; // 이 노드를 담는 부모 스코프를 활성 영역 둘레에 그린다
    let region = { minX: aMinX, maxX: aMaxX };
    for (let guard = 0; guard < 20 && focusId !== null; guard++) {
      const parentScopeId: string | null = byId.get(focusId)?.parent_node_id ?? null; // focusId를 담는 스코프
      const siblings = fullGraph.nodes
        .filter((flat) => (flat.parent_node_id ?? null) === parentScopeId)
        .sort((a, b) => a.pos_x - b.pos_x);
      const focusIdx = siblings.findIndex((flat) => flat.id === focusId);
      if (focusIdx < 0) {
        break;
      }
      const built = siblings.map((flat) => {
        const [app] = toAppNodes({ nodes: [flat], edges: [], groups: [] }, parentScopeId);
        return { app, size: nodeSizeOf(app.data.nodeType) };
      });
      const xs: number[] = new Array(built.length);
      // 포커스 노드(현재 스코프) — 활성 영역 바로 왼쪽. 앞·뒤 형제는 stored X 상대 간격을 보존(비균일 배치도 펼친 뷰와 일치).
      const focusStoredX = built[focusIdx].app.position.x;
      xs[focusIdx] = region.minX - GAP - built[focusIdx].size.w;
      for (let i = focusIdx - 1; i >= 0; i--) {
        xs[i] = xs[focusIdx] + (built[i].app.position.x - focusStoredX); // 앞 형제: 포커스 노드 기준 상대
      }
      for (let i = focusIdx + 1; i < built.length; i++) {
        // 뒤 형제: 활성 영역 오른쪽 + 포커스 노드 기준 stored X 상대(펼친 뷰와 일치 — 영역이 포커스 노드를 대체).
        xs[i] = region.maxX + (built[i].app.position.x - focusStoredX);
      }
      // 세로: 스코프 내부 상대 y를 보존(포커스 노드를 활성 행에 정렬). 직선 흐름이면 모두 aMinY, 분기는 유지.
      const focusStoredY = built[focusIdx].app.position.y;
      let lvMinX = Infinity;
      let lvMaxX = -Infinity;
      for (let i = 0; i < built.length; i++) {
        const { app, size } = built[i];
        out.push({
          ...app,
          position: { x: xs[i], y: aMinY + (app.position.y - focusStoredY) },
          selectable: false,
          draggable: false,
          deletable: false,
          connectable: false,
          // measured만 주입(미측정=visibility:hidden 회피). width/height 프롭은 강제하지 않아 DOM은 내용 기반
          // 오토사이징 → 활성 노드와 동일 폭(강제 시 nodeSizeOf 근사 170으로 미세하게 넓어짐).
          measured: { width: size.w, height: size.h },
          style: { opacity: INACTIVE_SCOPE_OPACITY },
        });
        lvMinX = Math.min(lvMinX, xs[i]);
        lvMaxX = Math.max(lvMaxX, xs[i] + size.w);
      }
      region = { minX: lvMinX, maxX: lvMaxX }; // 이 레벨의 범위가 다음(상위) 조상의 활성 영역
      if (parentScopeId === null) {
        break; // 루트 스코프까지 그림
      }
      focusId = parentScopeId;
    }
    return out;
  }, [currentParentId, inlineComposition, fullGraph, nodes]);

  const displayNodes = useMemo(() => {
    // 인라인 펼침 중이면 합성·재배치된 노드(현재+자식)를, 아니면 현재 노드를 기준으로 코멘트 수 주입
    const base = inlineComposition ? inlineComposition.nodes : nodes;
    // 파생 자식(prop-only) 대신 childNodes의 state 객체를 buildScope 파생 위치로 표시해야 RF가 측정·이벤트를 라우팅한다.
    const childById = inlineComposition
      ? new Map(childNodes.map((node) => [node.id, node] as const))
      : null;
    const mapped = base.map((node) => {
      const stateChild = childById?.get(node.id);
      let display;
      if (stateChild) {
        // 자식(인라인) 노드 — 그 스코프가 활성이면 편집(불투명), 아니면 읽기전용 dim. 포커스(A) 토글.
        const isActive = (node.data.scopeId ?? null) === activeScopeId;
        display = {
          ...stateChild,
          // 드래그 중인 자식은 childNodes(절대)위치, 아니면 buildScope 파생위치
          position: draggingChildIds.has(node.id) ? stateChild.position : node.position,
          data: node.data,
          selectable: isActive,
          draggable: isActive,
          deletable: isActive,
          connectable: isActive,
          style: { ...stateChild.style, opacity: isActive ? 1 : INACTIVE_SCOPE_OPACITY },
        };
      } else if (inlineComposition) {
        // 프레임(현재 스코프) 노드 — 활성이면 편집, 비활성(자식 포커스 중)이면 읽기전용 dim.
        const isActive = currentParentId === activeScopeId;
        display = isActive
          ? { ...node, connectable: true }
          : {
              ...node,
              selectable: false,
              draggable: false,
              deletable: false,
              connectable: false,
              style: { ...node.style, opacity: INACTIVE_SCOPE_OPACITY },
            };
      } else {
        display = node;
      }
      const count = unresolvedCounts.get(display.id) ?? 0;
      return count === (display.data.commentCount ?? 0)
        ? display
        : { ...display, data: { ...display.data, commentCount: count } };
    });
    // 조상 컨텍스트(자식 스코프 활성 시)를 dim 읽기전용으로 덧붙임 — 루트(currentParentId=null)에선 빈 배열이라 무영향.
    return [...mapped, ...ancestorContextNodes];
  }, [nodes, childNodes, inlineComposition, unresolvedCounts, draggingChildIds, ancestorContextNodes, activeScopeId, currentParentId]);

  // 엣지 렌더 변환 — ① 맵 전역 스타일(type) 적용, ② 선택 노드 기준 앞/뒤 단계 강조(target teal, source orange)
  const styledEdges = useMemo(() => {
    const hiddenIds = inlineComposition?.hiddenIds;
    const crossingIds = inlineComposition?.crossingIds;
    const currentStyled = edges.map((edge) => {
      // 인라인 펼침 시 A→B는 렌더에서만 숨김(데이터 보존)
      if (hiddenIds?.has(edge.id)) {
        return { ...edge, hidden: true } as Edge;
      }
      let next: Edge = edge.type === edgeStyle ? edge : { ...edge, type: edgeStyle };
      // 영역을 가로지르는 엣지 — 반투명으로 영역 위를 지나가게
      if (crossingIds?.has(edge.id)) {
        next = { ...next, style: { ...next.style, opacity: REGION_CROSSING_OPACITY } };
      }
      // 라벨이 있는 엣지(분기 Yes/No/기타 등) — 디자인 알약 스타일
      if (edge.label) {
        // Yes/No 분기는 은은한 파스텔 블루/레드로 선·라벨 색 구분(라벨에서 파생, 영속 불필요). 기타는 기본 톤.
        const branch = branchKindOf(edge.label);
        const branchColor =
          branch === "yes"
            ? "var(--color-branch-yes)"
            : branch === "no"
              ? "var(--color-branch-no)"
              : null;
        next = {
          ...next,
          ...(branchColor
            ? {
                style: { ...next.style, stroke: branchColor },
                markerEnd: { type: MarkerType.ArrowClosed, color: branchColor },
              }
            : {}),
          labelStyle: EDGE_LABEL_STYLE,
          labelBgStyle: branchColor
            ? { fill: `color-mix(in srgb, ${branchColor} 14%, white)`, stroke: branchColor }
            : EDGE_LABEL_BG_STYLE,
          labelBgPadding: EDGE_LABEL_BG_PADDING,
          labelBgBorderRadius: 6,
        };
      }
      if (!selectedId) {
        return next;
      }
      const stroke =
        edge.target === selectedId
          ? "var(--color-edge-in)"
          : edge.source === selectedId
            ? "var(--color-edge-out)"
            : null;
      if (!stroke) {
        return next;
      }
      return {
        ...next,
        style: { ...next.style, stroke, strokeWidth: 2.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      };
    });
    if (!inlineComposition) {
      return currentStyled;
    }
    // 자식 엣지: 펼친 노드 출발(A→B)이면 숨김, 아니면 맵 전역 type만 맞춤. 게이트웨이는 합성 시 스타일 완료.
    // 포커스 모드 Step 1: 비활성 스코프라 dim + 비선택(읽기전용).
    const childStyled = inlineComposition.childEdges.map((edge) => {
      if (hiddenIds?.has(edge.id)) {
        return { ...edge, hidden: true } as Edge;
      }
      const typed = edge.type === edgeStyle ? edge : { ...edge, type: edgeStyle };
      return {
        ...typed,
        selectable: false,
        style: { ...typed.style, opacity: INACTIVE_SCOPE_OPACITY },
      };
    });
    const gatewayStyled = inlineComposition.gateways.map((edge) =>
      edge.type === edgeStyle ? edge : { ...edge, type: edgeStyle },
    );
    return [...currentStyled, ...childStyled, ...gatewayStyled];
  }, [edges, selectedId, edgeStyle, inlineComposition]);

  // 그룹 박스 — 태그(다중 소속) 멤버 bbox로 산정. 멤버 많은 그룹일수록 패딩↑(작은 그룹을 감쌈),
  // z는 멤버 적은 그룹이 위(노드보다는 뒤). 반투명 fill이라 겹쳐도 모두 보임.
  const groupBoxes = useMemo(() => {
    // 인라인 펼침 중엔 그룹 박스 숨김 — 노드가 dagre로 재배치돼 raw 위치 기준 박스가 어긋나는 것 방지(Phase 2 단순화)
    if (expandedInline.size > 0) {
      return [];
    }
    return groups.flatMap((group) => {
      const members = nodes.filter((node) => node.data.groupIds.includes(group.id));
      if (members.length === 0) {
        return [];
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const member of members) {
        const w = member.measured?.width ?? NODE_WIDTH;
        const h = member.measured?.height ?? NODE_HEIGHT;
        minX = Math.min(minX, member.position.x);
        minY = Math.min(minY, member.position.y);
        maxX = Math.max(maxX, member.position.x + w);
        maxY = Math.max(maxY, member.position.y + h);
      }
      // 멤버 많을수록 패딩↑ → 큰 그룹이 작은 그룹을 시각적으로 감쌈
      const pad = GROUP_PAD + Math.min(members.length, 8) * 4;
      const originX = minX - pad;
      const originY = minY - pad - GROUP_TITLE_GAP;
      const width = maxX - minX + pad * 2;
      const height = maxY - minY + pad * 2 + GROUP_TITLE_GAP;
      // 기본 사각형(멤버 padded bbox)에서, 범위 안에 들어온 비멤버 노드를 가장 가까운 변쪽으로 잘라냄.
      // 좌표는 박스 좌상단(origin) 기준 상대. y는 타이틀바 헤드룸(GROUP_TITLE_GAP)만큼 내림.
      const intruderMargin = 8;
      const intruders = nodes
        .filter((node) => !node.data.groupIds.includes(group.id))
        .flatMap((node) => {
          const w = node.measured?.width ?? NODE_WIDTH;
          const h = node.measured?.height ?? NODE_HEIGHT;
          // 멤버 padded bbox와 겹치는 비멤버만
          if (
            node.position.x >= maxX + pad ||
            node.position.x + w <= minX - pad ||
            node.position.y >= maxY + pad ||
            node.position.y + h <= minY - pad
          ) {
            return [];
          }
          return [
            {
              x: node.position.x - intruderMargin - originX,
              y: node.position.y - intruderMargin - originY,
              w: w + intruderMargin * 2,
              h: h + intruderMargin * 2,
            },
          ];
        });
      // 멤버 노드(작은 여백)는 notch보다 우선 — notch가 멤버를 반만 자르지 않게 비껴감
      const memberKeep = 6;
      const memberRects = members.map((member) => {
        const w = member.measured?.width ?? NODE_WIDTH;
        const h = member.measured?.height ?? NODE_HEIGHT;
        return {
          x: member.position.x - memberKeep - originX,
          y: member.position.y - memberKeep - originY,
          w: w + memberKeep * 2,
          h: h + memberKeep * 2,
        };
      });
      const region = rectWithExclusions(
        { x: 0, y: GROUP_TITLE_GAP, w: width, h: height - GROUP_TITLE_GAP },
        intruders,
        memberRects,
      );
      return [
        {
          id: group.id,
          label: group.label,
          color: group.color,
          x: originX,
          y: originY,
          width,
          height,
          fill: region.fill,
          outline: region.outline,
          // 멤버 적은 그룹이 위(z 큼). 전부 노드(z:0)보다 뒤
          z: -members.length,
        },
      ];
    });
  }, [nodes, groups, expandedInline]);

  // 노드 위치(nodeExtent)·패닝(translateExtent) 허용 범위 = 콘텐츠 bbox + 사방 대칭 여백(무한 캔버스 느낌, 자유 패닝).
  const contentExtent = useMemo<
    | { node: [[number, number], [number, number]]; pan: [[number, number], [number, number]] }
    | undefined
  >(() => {
    // 인라인 펼침 중엔 합성·재배치된 노드(현재+자식) 기준 — 자식이 패닝 범위 밖으로 잘리지 않게
    const extentNodes = inlineComposition ? inlineComposition.nodes : nodes;
    if (extentNodes.length === 0) {
      return undefined; // 빈 캔버스는 React Flow 기본(무제한)
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of extentNodes) {
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }
    // 조상 컨텍스트(좌측 dim)도 패닝 범위에 포함 — 안 그러면 translateExtent가 조상을 잘라 못 본다.
    for (const node of ancestorContextNodes) {
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }
    // 대칭 여백 — 좌상단 고정 없이 콘텐츠 사방에 동일 여백(줌아웃 시 기본 centering 허용). 패닝·노드 동일 extent.
    const extent: [[number, number], [number, number]] = [
      [minX - EXTENT_MARGIN, minY - EXTENT_MARGIN],
      [maxX + EXTENT_MARGIN, maxY + EXTENT_MARGIN],
    ];
    return { node: extent, pan: extent };
  }, [nodes, inlineComposition, ancestorContextNodes]);

  // 현재 스코프의 절대깊이(루트=0) — 인라인 펼침 셰브론을 절대깊이 기준으로 맞춰 포커스 레인과 통일.
  const currentScopeDepth = useMemo(() => {
    if (currentParentId === null) {
      return 0;
    }
    const byId = new Map((fullGraph?.nodes ?? []).map((node) => [node.id, node]));
    let d = 0;
    let cur: string | null = currentParentId;
    while (cur !== null && d < 20) {
      d += 1;
      cur = byId.get(cur)?.parent_node_id ?? null;
    }
    return d;
  }, [currentParentId, fullGraph]);

  // 포커스(Path 2) — 자식 스코프에 들어가 있으면, 현재 스코프 + 보이는 조상 스코프(깊이≥1)를 각각 레인으로 감싼다.
  // 깊이별로 다른 틴트 → 중첩 레인(깊이2에서 깊이1 레인이 사라지지 않게). 루트(깊이0)는 틴트 없음.
  const focusScopeLanes = useMemo<
    { left: number; right: number; top: number; depth: number; label: string }[]
  >(() => {
    if (currentParentId === null) {
      return [];
    }
    const byId = new Map((fullGraph?.nodes ?? []).map((node) => [node.id, node]));
    // 절대깊이(루트=0) — 인라인 펼침(InlineRegionBands)과 같은 기준이라 같은 스코프는 같은 셰브론.
    const depthOf = (scopeId: string | null): number => {
      let d = 0;
      let cur = scopeId;
      while (cur !== null && d < 20) {
        d += 1;
        cur = byId.get(cur)?.parent_node_id ?? null;
      }
      return d;
    };
    const boundsOf = (ns: AppNode[]) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      for (const node of ns) {
        const w = nodeSizeOf(node.data.nodeType).w;
        minX = Math.min(minX, node.position.x);
        maxX = Math.max(maxX, node.position.x + w);
        minY = Math.min(minY, node.position.y);
      }
      return { left: minX - REGION_PAD, right: maxX + REGION_PAD, top: minY };
    };
    const lanes: { left: number; right: number; top: number; depth: number; label: string }[] = [];
    // 현재(활성) 스코프 — 펼침 중이면 합성·재배치된 "표시" 위치 기준이라야 레인이 펼친 끝(밀려난 노드·자식)까지 따라간다.
    const currentScopeNodes = inlineComposition ? inlineComposition.nodes : nodes;
    if (currentScopeNodes.length > 0) {
      lanes.push({
        ...boundsOf(currentScopeNodes),
        depth: depthOf(currentParentId),
        label: byId.get(currentParentId)?.title ?? "",
      });
    }
    // 보이는 조상 스코프들 — 스코프별로 묶어 각자 레인(깊이0=루트는 제외)
    const byScope = new Map<string, AppNode[]>();
    for (const node of ancestorContextNodes) {
      const sid = node.data.scopeId ?? null;
      if (sid === null) {
        continue;
      }
      const arr = byScope.get(sid) ?? [];
      arr.push(node);
      byScope.set(sid, arr);
    }
    for (const [sid, ns] of byScope) {
      lanes.push({ ...boundsOf(ns), depth: depthOf(sid), label: byId.get(sid)?.title ?? "" });
    }
    return lanes;
  }, [currentParentId, nodes, inlineComposition, ancestorContextNodes, fullGraph]);

  // 선택된 멤버가 가진 그룹 태그(합집합) — 타이틀바에 "그룹 나가기" 노출 판정
  const selectedGroupIds = useMemo(
    () =>
      new Set(
        nodes.filter((node) => node.selected).flatMap((node) => node.data.groupIds),
      ),
    [nodes],
  );

  const selectedComments = useMemo(
    () => comments.filter((comment) => comment.node_id === selectedId),
    [comments, selectedId],
  );

  // 노드에 표시할 정보 필드 — 사이드바 체크박스로 토글, localStorage 영속
  const [displayFields, setDisplayFields] = useState<NodeDisplayField[]>(["assignee"]);

  useEffect(() => {
    const saved = window.localStorage.getItem("bpm.nodeDisplayFields");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as NodeDisplayField[];
        const valid = parsed.filter((field) => NODE_DISPLAY_FIELDS.includes(field));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration
        setDisplayFields(valid);
      } catch {
        // 무시 — 기본값 유지
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("bpm.nodeDisplayFields", JSON.stringify(displayFields));
  }, [displayFields]);

  // 엣지 스타일 1회 hydration + 변경 영속
  useEffect(() => {
    const saved = window.localStorage.getItem("bpm.edgeStyle");
    if (saved === "default" || saved === "smoothstep" || saved === "straight") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration
      setEdgeStyle(saved);
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem("bpm.edgeStyle", edgeStyle);
  }, [edgeStyle]);

  const toggleDisplayField = useCallback((field: NodeDisplayField) => {
    setDisplayFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  }, []);

  const cancelRename = useCallback(() => setEditingNodeId(null), []);
  // 타이틀 더블클릭 → 이름 편집 진입 (이름 외 영역 더블클릭은 요약창)
  const startRename = useCallback(
    (id: string) => {
      if (!readOnly) {
        setSelectedId(id);
        setEditingNodeId(id);
      }
    },
    [readOnly],
  );
  const nodeActions = useMemo(
    () => ({
      onToggleExpand: toggleInlineExpand,
      expandedInlineIds: expandedInline,
      displayFields,
      editingNodeId,
      onStartRename: startRename,
      onRename: renameNode,
      onCancelRename: cancelRename,
    }),
    [
      toggleInlineExpand,
      expandedInline,
      displayFields,
      editingNodeId,
      startRename,
      renameNode,
      cancelRename,
    ],
  );

  // 포커스(A) — 자식(prop-only) 노드는 RF 노드 이벤트가 안 발화 → 캔버스 컨테이너 raw dblclick(capture)으로 가로챔.
  // 비활성 자식 더블클릭=그 스코프 제자리 활성화, 활성 자식 더블클릭=요약/편집 모달. (프레임 노드는 RF onNodeDoubleClick 처리.)
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) {
      return;
    }
    const handleDblClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      const id = nodeEl?.getAttribute("data-id");
      if (!id || nodesRef.current.some((node) => node.id === id)) {
        return; // 현재 스코프(프레임) 노드/노드 밖 — React Flow 기본 처리
      }
      event.preventDefault();
      event.stopPropagation(); // React Flow 더블클릭 줌 방지
      // 포커스(Path 2) — 비활성 자식 더블클릭 = 단일클릭과 동일하게 그 스코프로 navigateTo + 카메라 보정(제자리).
      const scopeId = childNodesRef.current.find((node) => node.id === id)?.data.scopeId ?? null;
      const rendered = reactFlow.getNode(id)?.position;
      const stored = fullGraphRef.current?.nodes.find((n) => n.id === id);
      if (rendered && stored) {
        focusCamRef.current = {
          shift: { x: rendered.x - stored.pos_x, y: rendered.y - stored.pos_y },
          vp: reactFlow.getViewport(),
        };
      }
      void navigateTo(buildScopesTo(scopeId));
    };
    container.addEventListener("dblclick", handleDblClick, true); // capture — RF zoom보다 먼저
    return () => container.removeEventListener("dblclick", handleDblClick, true);
  }, [navigateTo, buildScopesTo, reactFlow]);

  // 인스펙터 폭 로컬 영속
  useEffect(() => {
    window.localStorage.setItem("bpm.inspectorWidth", String(inspectorWidth));
  }, [inspectorWidth]);

  // 대시보드 높이 로컬 영속
  useEffect(() => {
    window.localStorage.setItem("bpm.dashboardHeight", String(dashboardHeight));
  }, [dashboardHeight]);

  // 좌측 아웃라인 — 현재 스코프는 라이브 상태, 하위 스코프는 전체 그래프에서 병합
  const outline = useMemo(() => {
    // 현재 스코프는 라이브 상태가 권위 — id로 dedup해 fullGraph가 stale일 때 중복 행 방지
    const liveIds = new Set(nodes.map((node) => node.id));
    const outlineNodes: OutlineNode[] = nodes.map((node) => ({
      id: node.id,
      parentId: currentParentId,
      label: node.data.label,
      nodeType: node.data.nodeType,
    }));
    const outlineEdges: OutlineEdge[] = edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }));
    if (fullGraph) {
      const seenNodes = new Set(liveIds);
      for (const flat of fullGraph.nodes) {
        if (seenNodes.has(flat.id)) {
          continue;
        }
        // 현재 스코프 노드는 라이브가 권위 — 라이브 로드 후 fullGraph에만 있으면 삭제된 것이므로 제외(아웃라인 즉시 반영).
        // nodes 비어있는 로드/전환 구간엔 fullGraph로 폴백(깜빡임 방지).
        if (nodes.length > 0 && flat.parent_node_id === currentParentId) {
          continue;
        }
        seenNodes.add(flat.id);
        outlineNodes.push({
          id: flat.id,
          parentId: flat.parent_node_id,
          label: flat.title,
          nodeType: normalizeNodeType(flat.node_type),
        });
      }
      const seenEdges = new Set(outlineEdges.map((edge) => `${edge.source} ${edge.target}`));
      for (const graphEdge of fullGraph.edges) {
        const key = `${graphEdge.source_node_id} ${graphEdge.target_node_id}`;
        if (liveIds.has(graphEdge.source_node_id) || seenEdges.has(key)) {
          continue;
        }
        seenEdges.add(key);
        outlineEdges.push({
          source: graphEdge.source_node_id,
          target: graphEdge.target_node_id,
        });
      }
    }
    // 항상 프로젝트 루트(전체 트리) 기준 — 창을 옮겨도 전체 프로젝트를 일관되게 표시.
    // 활성 스코프 경로(드릴인한 노드들)는 항상 펼쳐 현재 위치가 보이도록 합성.
    const effectiveExpanded = new Set(expandedOutline);
    for (const scope of scopes) {
      if (scope.parentId !== null) {
        effectiveExpanded.add(scope.parentId);
      }
    }
    return buildOutline(outlineNodes, outlineEdges, null, effectiveExpanded);
  }, [nodes, edges, fullGraph, currentParentId, expandedOutline, scopes]);

  // 스코프 전환 중 라이브 nodes 공백 구간엔 직전 비어있지 않은 outline을 고스트로 유지(깜빡임 방지).
  // 비어있지 않을 때만 갱신 → 공백 구간엔 마지막 good 값을 그대로 렌더해 "사라졌다 뜨는" 현상 제거.
  const [displayOutline, setDisplayOutline] = useState(outline);
  useEffect(() => {
    if (outline.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 비어있지 않은 outline만 표시 캐시에 반영(고스트 유지)
      setDisplayOutline(outline);
    }
  }, [outline]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedOutline((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 노드가 화면 밖일 때만 현재 줌 유지한 채 부드럽게 가운데로 — 이미 보이면 이동 없음(매 클릭 점프/줌변경 방지).
  const revealNodeIfOffscreen = useCallback(
    (id: string) => {
      const node = reactFlow.getNode(id);
      if (!node) {
        return;
      }
      const zoom = reactFlow.getZoom();
      const vpt = reactFlow.getViewport();
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      const sx = node.position.x * zoom + vpt.x;
      const sy = node.position.y * zoom + vpt.y;
      const margin = 48; // 화면 가장자리 여유 — 이 안이면 "보임"으로 간주
      const visible =
        sx >= margin &&
        sy >= margin &&
        sx + w * zoom <= paneWidth - margin &&
        sy + h * zoom <= paneHeight - margin;
      if (!visible) {
        void reactFlow.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom,
          duration: 500,
        });
      }
    },
    [reactFlow, paneWidth, paneHeight],
  );

  // fit 버튼 — 현재 스코프를 화면에 맞추되 가운데가 아니라 좌상단 정렬(왼쪽위 고정). 줌은 맞추되 콘텐츠는 좌상단에.
  const fitScopeTopLeft = useCallback(() => {
    const idSet = new Set(nodesRef.current.map((node) => node.id));
    const ns = reactFlow.getNodes().filter((node) => idSet.has(node.id));
    if (ns.length === 0) {
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of ns) {
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }
    const pad = 80;
    const zx = (paneWidth - pad * 2) / Math.max(1, maxX - minX);
    const zy = (paneHeight - pad * 2) / Math.max(1, maxY - minY);
    const z = Math.max(MIN_ZOOM, Math.min(zx, zy, 1.2));
    void reactFlow.setViewport(
      { x: (EXTENT_TOPLEFT_MARGIN - minX) * z, y: (EXTENT_TOPLEFT_MARGIN - minY) * z, zoom: z },
      { duration: 400 },
    );
  }, [reactFlow, paneWidth, paneHeight]);

  // 아웃라인 클릭 — 노드가 속한 스코프로 이동 후, 화면 밖일 때만 현재 줌으로 부드럽게 포커싱
  const handleOutlineSelect = useCallback(
    (id: string) => {
      const flatById = new Map((fullGraph?.nodes ?? []).map((node) => [node.id, node]));
      const flat = flatById.get(id);
      const scopeParentId = flat ? flat.parent_node_id : currentParentId;
      if (scopeParentId === currentParentId) {
        setSelectedId(id);
        setSelectedEdgeId(null);
        // 캔버스 클릭과 달리 프로그램적 선택은 React Flow 선택 상태를 안 건드려 보더가 안 켜짐 — 직접 단일 선택 동기화
        setNodes((current) =>
          current.map((node) =>
            node.selected === (node.id === id) ? node : { ...node, selected: node.id === id },
          ),
        );
        // 화면에 이미 보이면 이동 없음, 밖일 때만 현재 줌으로 부드럽게 가운데(줌 강제 변경 제거 — 매 클릭 점프 방지)
        revealNodeIfOffscreen(id);
        return;
      }
      // 다른 스코프(하위) — 드릴인 창 대신 조상 체인을 인라인 펼쳐 해당 노드를 레인에 노출하고 포커싱.
      const chainIds: string[] = [];
      let cursor = scopeParentId;
      while (cursor !== null) {
        chainIds.unshift(cursor);
        cursor = flatById.get(cursor)?.parent_node_id ?? null;
      }
      commitExpanded((prev) => {
        const next = new Set(prev);
        for (const ancestorId of chainIds) {
          next.add(ancestorId); // 루트~부모까지 모두 펼쳐 중첩 레인으로 대상 노드 표시
        }
        return next;
      });
      setSelectedId(id);
      // 합성·재배치가 반영된 다음 틱에 대상 노드로 팬 — 줌은 현재 값 유지(자동 줌 변경 방지)
      window.setTimeout(() => {
        const zoom = reactFlow.getZoom();
        void reactFlow.fitView({
          nodes: [{ id }],
          padding: 0.4,
          minZoom: zoom,
          maxZoom: zoom,
          duration: 500,
        });
      }, 160);
    },
    [fullGraph, currentParentId, reactFlow, setNodes, commitExpanded, revealNodeIfOffscreen],
  );

  // 아웃라인 Tab/↓ — 다음(아래) 가시 행으로 이동. 펼치기는 자동으로 하지 않는다(→/F가 담당).
  const handleOutlineNext = useCallback(
    (id: string) => {
      const idx = outline.findIndex((row) => row.id === id);
      if (idx === -1) {
        return;
      }
      const next = outline[idx + 1];
      if (next) {
        handleOutlineSelect(next.id);
      }
    },
    [outline, handleOutlineSelect],
  );

  // Shift+Tab/↑ — 아웃라인의 이전(위) 가시 행으로 이동. 첫 자식에선 idx-1이 곧 부모라 자연히 위로 올라간다.
  const handleOutlinePrev = useCallback(
    (id: string) => {
      const idx = outline.findIndex((row) => row.id === id);
      if (idx <= 0) {
        return;
      }
      handleOutlineSelect(outline[idx - 1].id);
    },
    [outline, handleOutlineSelect],
  );

  // → 펼치기 — 자식 있고 접혀있을 때만(이동 없음).
  const handleOutlineExpand = useCallback(
    (id: string) => {
      const row = outline.find((r) => r.id === id);
      if (!row?.hasChildren || row.expanded) {
        return;
      }
      setExpandedOutline((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    },
    [outline],
  );

  // 현재 노드의 부모를 접으며 그 부모로 이동 — F(말단)·←(닫을 게 없을 때) 공통.
  const foldToParent = useCallback(
    (id: string) => {
      const parentId =
        (fullGraph?.nodes ?? []).find((node) => node.id === id)?.parent_node_id ?? null;
      if (parentId === null) {
        return;
      }
      setExpandedOutline((prev) => {
        if (!prev.has(parentId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      handleOutlineSelect(parentId);
    },
    [fullGraph, handleOutlineSelect],
  );

  // ← — 펼쳐진 하위프로세스는 닫고, 닫을 게 없으면(말단·이미 접힘) 부모를 접으며 부모로 이동.
  const handleOutlineCollapse = useCallback(
    (id: string) => {
      const row = outline.find((r) => r.id === id);
      if (row?.hasChildren && row.expanded) {
        setExpandedOutline((prev) => {
          if (!prev.has(id)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      foldToParent(id);
    },
    [outline, foldToParent],
  );

  // F 토글 — 자식 있으면 펼치기↔접기 토글, 말단이면 부모를 접으며 부모로 이동.
  const handleOutlineFold = useCallback(
    (id: string) => {
      const row = outline.find((r) => r.id === id);
      if (row?.hasChildren) {
        setExpandedOutline((prev) => {
          const next = new Set(prev);
          if (row.expanded) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        return;
      }
      foldToParent(id);
    },
    [outline, foldToParent],
  );

  // 전역 단축키(조합키) — 메뉴 없이도 동작. 단일 키(1-4·E·정렬 L/C/T/M/H/V)는 우클릭 메뉴 가속기(ContextMenu) 담당.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // 입력/편집 중이면 무시 (검색·라벨·AI·아웃라인 rename 등)
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      ) {
        return;
      }
      // 모달 열림 중엔 무시
      if (summaryNodeId || bulkEditGroupId || branchPrompt || managingApprovers || pending) {
        return;
      }
      const count = nodesRef.current.filter((node) => node.selected).length;
      const fire = (action: () => void) => {
        event.preventDefault();
        setMenu(null); // 메뉴가 떠 있으면 닫고 실행
        action();
      };

      // 모든 판정은 물리 키(event.code) — 한글 IME·키 레이아웃·OS(Mac Option) 무관
      // Shift+L — 전역 자동 정렬(오토레이아웃, L=Layout). 메뉴 가속기는 A→A.
      if (
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === "KeyL"
      ) {
        fire(() => applyNodesTransform((current) => layoutWithDagre(current, edgesRef.current)));
        return;
      }
      // Ctrl 조합 — 그룹 생성 / PNG 내보내기 (undo/redo·검색은 별도 핸들러)
      if (event.ctrlKey || event.metaKey) {
        if (event.code === "KeyG" && !event.shiftKey) {
          fire(() => createGroupFromSelection());
        } else if (event.code === "KeyE" && event.shiftKey) {
          fire(() => void handleExportPng());
        }
        return;
      }

      // Alt 조합 — 전역 정렬/분배 (왼손 전용 키: 좌=W, 가로가운데=C, 상단=T, 세로가운데=X, 가로분배=R, 세로분배=V)
      if (event.altKey) {
        const alignByCode: Record<string, "left" | "centerX" | "top" | "centerY"> = {
          KeyW: "left",
          KeyC: "centerX",
          KeyT: "top",
          KeyX: "centerY",
        };
        const axis = alignByCode[event.code];
        if (axis) {
          if (count >= 2) {
            fire(() => applyNodesTransform((current) => alignSelected(current, axis)));
          }
          return;
        }
        if (event.code === "KeyR" || event.code === "KeyV") {
          if (count >= 3) {
            fire(() =>
              applyNodesTransform((current) => distributeSelected(current, event.code === "KeyR" ? "x" : "y")),
            );
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    summaryNodeId,
    bulkEditGroupId,
    branchPrompt,
    managingApprovers,
    pending,
    applyNodesTransform,
    createGroupFromSelection,
    handleExportPng,
  ]);

  // 인스펙터 좌측 가장자리 드래그로 폭 조절 (왼쪽으로 끌면 넓어짐)
  const startInspectorResize = useCallback(
    (event: { clientX: number; preventDefault: () => void }) => {
      event.preventDefault();
      const startX = event.clientX;
      const startW = inspectorWidth;
      const onMove = (ev: PointerEvent) => {
        setInspectorWidth(Math.min(480, Math.max(220, startW + (startX - ev.clientX))));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [inspectorWidth],
  );

  const startDashboardResize = useCallback(
    (event: { clientY: number; preventDefault: () => void }) => {
      event.preventDefault();
      const startY = event.clientY;
      const startH = dashboardHeight;
      const onMove = (ev: PointerEvent) => {
        // 핸들을 위로 끌면 대시보드가 커진다
        setDashboardHeight(Math.min(560, Math.max(120, startH + (startY - ev.clientY))));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [dashboardHeight],
  );

  const toolButton =
    "inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <NodeActionsContext.Provider value={nodeActions}>
      {/* 인라인 펼침/접힘 슬라이드 — 런타임 클래스(.react-flow__node) 대상 규칙은 Turbopack(dev)이 purge하므로
          globals.css 대신 raw <style>로 주입해 dev·prod 모두 적용되게 한다(ease-in-out = 느림→빠름→느림). */}
      <style>{`.bpm-expand-anim .react-flow__node{transition:transform 350ms cubic-bezier(0.65,0,0.35,1)}@media(prefers-reduced-motion:reduce){.bpm-expand-anim .react-flow__node{transition:none}}`}</style>
      <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-4 py-2">
        <Link href="/" className="inline-flex items-center gap-1 text-caption text-accent hover:underline">
          <ArrowLeft size={16} strokeWidth={1.5} />{t("editor.backToList")}
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {scopes.map((scope, index) => (
            <span key={scope.parentId ?? "root"} className="flex items-center gap-1">
              {index > 0 && <ChevronRight size={14} strokeWidth={1.5} className="text-ink-tertiary" />}
              <button
                className={
                  index === scopes.length - 1
                    ? "font-medium text-ink"
                    : "text-accent hover:underline"
                }
                onClick={() => handleBreadcrumb(index)}
              >
                {scope.title}
              </button>
            </span>
          ))}
        </nav>

        <div className="relative">
          <input
            ref={searchInputRef}
            className="w-56 rounded-sm border border-hairline px-2 py-1 text-caption"
            placeholder={t("editor.searchPlaceholder")}
            value={searchQuery}
            onChange={(event) => {
              const value = event.target.value;
              setSearchQuery(value);
              if (!value.trim()) {
                setSearchResults([]);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSearchIndex((index) => Math.min(index + 1, searchResults.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSearchIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && searchResults[searchIndex]) {
                handleSearchSelect(searchResults[searchIndex]);
              } else if (event.key === "Escape") {
                setSearchQuery("");
                setSearchResults([]);
                event.currentTarget.blur();
              }
            }}
          />
          {searchResults.length > 0 && (
            <ul className="absolute left-0 top-full z-50 mt-1 max-h-72 w-80 overflow-auto rounded-sm border border-hairline bg-surface py-1">
              {searchResults.map((result, index) => (
                <li key={result.node.id}>
                  <button
                    className={`block w-full px-3 py-1.5 text-left text-caption ${
                      index === searchIndex ? "bg-surface-alt" : ""
                    }`}
                    onMouseDown={(event) => {
                      // blur로 드롭다운이 닫히기 전에 선택 처리
                      event.preventDefault();
                      handleSearchSelect(result);
                    }}
                    onMouseEnter={() => setSearchIndex(index)}
                  >
                    <span className="font-medium text-ink">{result.node.title}</span>
                    <span className="ml-2 text-fine text-ink-tertiary">{result.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {readOnly && checkout?.checked_out_by && (
            <span className="flex items-center gap-2 rounded-sm bg-changed/10 px-2 py-1 text-caption text-changed">
              <PencilLine size={14} strokeWidth={1.5} />{t("editor.editingByOther", { name: checkout.checked_out_by })}
              <button
                className="rounded-sm bg-error px-1.5 py-0.5 text-fine text-on-accent hover:bg-error/90"
                onClick={() => void handleForceCheckout()}
              >
                {t("editor.forceEdit")}
              </button>
            </span>
          )}
          {currentVersion?.status === "rejected" && currentVersion.reject_reason && (
            <span className="text-caption text-error">
              {t("wf.rejectedBanner", { reason: currentVersion.reject_reason })}
            </span>
          )}
          {checkout?.mine && (
            <span className="inline-flex items-center gap-1 text-fine text-ink-tertiary" title={t("editor.editingMineTitle")}>
              <Lock size={14} strokeWidth={1.5} />{t("editor.editingMine")}
            </span>
          )}
          {status && <span className="text-caption text-error">{status}</span>}
          {saveState === "saving" && (
            <span className="text-caption text-ink-tertiary">{t("editor.saving")}</span>
          )}
          {saveState === "saved" && (
            <span className="inline-flex items-center gap-1 text-caption text-added"><Check size={14} strokeWidth={1.5} />{t("editor.saved")}</span>
          )}
          {saveState === "error" && (
            <span className="text-caption text-error">{t("editor.saveError")}</span>
          )}
          <select
            className="rounded-sm border border-hairline px-2 py-1 text-caption"
            value={versionId ?? ""}
            onChange={(event) => void switchVersion(Number(event.target.value))}
            aria-label={t("editor.versionSelectAria")}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
              </option>
            ))}
          </select>
          {managingApprovers && (
            <ApproverManager
              mapId={mapId}
              onClose={() => setManagingApprovers(false)}
              onSaved={() => void refreshWorkflow()}
            />
          )}
          <button className={toolButton} onClick={() => void handleCreateVersion()}>
            {t("editor.newVersion")}
          </button>
          <button className={toolButton} onClick={() => void handleRenameVersion()}>
            {t("editor.rename")}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-error hover:bg-surface-alt disabled:opacity-40 disabled:text-ink-tertiary"
            onClick={() => void handleDeleteVersion()}
            disabled={versions.length <= 1 || readOnly}
          >
            {t("editor.deleteVersion")}
          </button>
          <Link
            href={`/maps/${mapId}/compare`}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            {t("editor.compare")}
          </Link>

          <span className="mx-1 h-5 w-px bg-hairline" />

          <button
            className={toolButton}
            onClick={undo}
            disabled={readOnly || historySize.past === 0}
            title={t("editor.undoTitle")}
          >
            <Undo2 size={16} strokeWidth={1.5} />
          </button>
          <button
            className={toolButton}
            onClick={redo}
            disabled={readOnly || historySize.future === 0}
            title={t("editor.redoTitle")}
          >
            <Redo2 size={16} strokeWidth={1.5} />
          </button>

          <button
            className={toolButton}
            onClick={expandAll}
            title={t("editor.expandAll")}
            aria-label={t("editor.expandAll")}
          >
            <UnfoldHorizontal size={16} strokeWidth={1.5} />
          </button>
          <button
            className={toolButton}
            onClick={collapseAll}
            disabled={expandedInline.size === 0}
            title={t("editor.collapseAll")}
            aria-label={t("editor.collapseAll")}
          >
            <FoldHorizontal size={16} strokeWidth={1.5} />
          </button>

          <button className={toolButton} onClick={() => void handleExportPng()}>
            <Download size={16} strokeWidth={1.5} />PNG
          </button>
          <button
            className={toolButton}
            onClick={() => setInspectorOpen((open) => !open)}
            title={t("editor.inspectorToggle")}
            aria-label={t("editor.inspectorToggle")}
          >
            <PanelRight size={16} strokeWidth={1.5} />
          </button>
          {/* 엣지 스타일 — 맵 전역(모든 엣지 일괄 적용) */}
          <select
            className="rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt"
            value={edgeStyle}
            onChange={(event) =>
              setEdgeStyle(event.target.value as "default" | "smoothstep" | "straight")
            }
            title={t("editor.edgeStyle")}
            aria-label={t("editor.edgeStyle")}
          >
            <option value="default">{t("edgeStyle.curve")}</option>
            <option value="smoothstep">{t("edgeStyle.step")}</option>
            <option value="straight">{t("edgeStyle.straight")}</option>
          </select>
          {/* AI 토글은 항상 노출 — 패널 내부에서 비활성/사유 안내 (서버 ai_enabled 기준) */}
          <button
            type="button"
            className="rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt"
            onClick={() => {
              // 열 때 dock에 최소화돼 있던 상태면 창으로 복원
              if (!aiOpen) {
                setWindowGeom((map) => {
                  const g = map[AI_WINDOW_KEY];
                  return g?.minimized ? { ...map, [AI_WINDOW_KEY]: { ...g, minimized: false } } : map;
                });
              }
              setAiOpen((open) => !open);
            }}
            title={t("ai.toggle")}
          >
            {t("ai.toggle")}
          </button>
          <button
            className="rounded-sm bg-accent px-3 py-1 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleSave()}
            disabled={readOnly}
          >
            {t("editor.save")}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <EditorLeftSidebar
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((value) => !value)}
          selectedId={selectedId}
          outline={displayOutline}
          onSelectNode={handleOutlineSelect}
          onToggleExpand={handleToggleExpand}
          displayFields={displayFields}
          onToggleDisplayField={toggleDisplayField}
          readOnly={readOnly}
          onRowContextMenu={(event, id) => {
            setSelectedId(id);
            setSelectedEdgeId(null);
            openMenu(event, "node", id);
          }}
          onRenameNode={renameNode}
          onSelectNext={handleOutlineNext}
          onSelectPrev={handleOutlinePrev}
          onExpand={handleOutlineExpand}
          onCollapse={handleOutlineCollapse}
          onFold={handleOutlineFold}
        />
        <div
          ref={canvasContainerRef}
          // select-none — 박스선택 드래그가 노드 라벨·아웃라인 텍스트를 파랗게 선택하는 UI 오류 방지(입력창은 globals에서 예외)
          className="relative flex-1 select-none overflow-hidden bg-canvas"
        >
          {scopes.map((scope, index) => {
            const key = scopeKey(scope);
            const geom = windowGeom[key] ?? defaultGeom(index, bounds);
            // 포커스 모드 — 루트(index 0)가 유일한 캔버스 호스트라 항상 active(드릴 깊이와 무관).
            const active = index === 0 || index === activeIndex;
            // 포커스 모드 — 드릴인 플로팅 창 억제. 캔버스는 항상 루트에 두고 활성 스코프는 currentParentId로 전환.
            if (index !== 0) {
              return null;
            }
            return (
              <ScopeWindow
                key={key}
                title={scope.title}
                geom={geom}
                active={active}
                zIndex={active ? 1000 : zOrder.indexOf(key) + 1}
                canClose={index > 0}
                chromeless={index === 0}
                bounds={bounds}
                onFocus={() => {
                  bringToFront(key);
                  if (!active) {
                    void focusScope(index);
                  }
                }}
                onGeomChange={(next) =>
                  setWindowGeom((map) => ({ ...map, [key]: next }))
                }
                onClose={() => closeScope(index)}
              >
                {active ? (
                  // 그룹 오버레이·복수 선택 영역 우클릭 시 브라우저 기본 메뉴 차단 (ReactFlow 핸들러가 안 타는 영역)
                  <div
                    className={`h-full w-full bg-canvas${expandAnimating ? " bpm-expand-anim" : ""}`}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <ReactFlow
                      nodes={displayNodes}
                      edges={styledEdges}
                      nodeTypes={nodeTypes}
                      snapToGrid
                      snapGrid={[8, 8]}
                      nodesDraggable={!readOnly && expandedInline.size === 0}
                      nodesConnectable={!readOnly}
                      onNodesChange={handleNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onNodeClick={(_, node) => {
                        // 후속 선택 모드면 이 클릭은 후속 지정 — 선택 대신 후속 연결 후 하위 생성
                        if (pendingSubprocessPick) {
                          handleSubprocessPick(node.id);
                          return;
                        }
                        // 포커스(Path 2) — 다른 스코프 노드 클릭 시 그 스코프를 navigateTo로 진짜 nodes化(네이티브 풀편집).
                        // 카메라 보정: 클릭 노드의 "현재 표시 위치 − 저장(스코프상대) 위치"만큼 카메라를 옮겨
                        // 그 노드(=스코프)가 제자리에 남게 한다. 자식 진입·루트 복귀(exit) 양쪽 모두 제자리.
                        const nodeScope = node.data?.scopeId ?? null;
                        if (nodeScope !== currentParentId) {
                          const stored = fullGraph?.nodes.find((n) => n.id === node.id);
                          if (stored) {
                            focusCamRef.current = {
                              shift: {
                                x: node.position.x - stored.pos_x,
                                y: node.position.y - stored.pos_y,
                              },
                              vp: reactFlow.getViewport(),
                            };
                          }
                          void navigateTo(buildScopesTo(nodeScope));
                          return;
                        }
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                      }}
                      onNodeDoubleClick={(_, node) => {
                        // 이름 외 영역 더블클릭 = 요약/편집 모달(현재 스코프·펼친 자식 공용).
                        // 타이틀 더블클릭은 process-node가 stopPropagation해 이름 편집으로.
                        setSelectedId(node.id);
                        setSummaryNodeId(node.id);
                      }}
                      onEdgeClick={(_, edge) => {
                        setSelectedEdgeId(edge.id);
                        setSelectedId(null);
                      }}
                      onPaneClick={() => {
                        setSelectedId(null);
                        setSelectedEdgeId(null);
                        setMenu(null);
                        setPending(null);
                        setSummaryNodeId(null);
                        setPendingSubprocessPick(null); // 빈 영역 클릭 = 후속 선택 취소
                      }}
                      onPaneContextMenu={(event) => openMenu(event, "pane", null)}
                      onNodeContextMenu={(event, node) => {
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                        openMenu(event, "node", node.id);
                      }}
                      onEdgeContextMenu={(event, edge) => openMenu(event, "edge", edge.id)}
                      onSelectionContextMenu={(event) => openMenu(event, "selection", null)}
                      onNodeDragStart={(_, node) => {
                        const sid = node.data.scopeId;
                        if (sid != null && sid !== currentParentId) {
                          // 자식 드래그 — 잡은 것 + 같은 스코프의 선택된 자식 모두를 파생위치로 맞추고 드래그 플래그
                          // (다중 선택 드래그 시 일부만 움직이던 버그 수정 — 선택 전체를 함께 이동/저장)
                          const dragIds = new Set<string>();
                          setChildNodes((current) =>
                            current.map((child) => {
                              const inScope = (child.data.scopeId ?? null) === sid;
                              if (inScope && (child.id === node.id || child.selected)) {
                                dragIds.add(child.id);
                                const derived = inlineComposition?.nodes.find(
                                  (n) => n.id === child.id,
                                )?.position;
                                return derived ? { ...child, position: derived } : child;
                              }
                              return child;
                            }),
                          );
                          setDraggingChildIds((prev) => {
                            const next = new Set(prev);
                            dragIds.forEach((id) => next.add(id));
                            return next;
                          });
                          return;
                        }
                        pushHistory();
                        dragStartPosRef.current = { id: node.id, x: node.position.x, y: node.position.y };
                      }}
                      onNodeDrag={handleNodeDrag}
                      onNodeDragStop={(_, node) => {
                        const sid = node.data.scopeId;
                        if (sid != null && sid !== currentParentId) {
                          // 자식 드래그 종료 — 드래그된(선택된) 같은 스코프 자식 모두를 절대→스코프상대 변환 후 한 번에 저장.
                          if (!readOnly) {
                            const draggedIds = new Set(
                              childNodesRef.current
                                .filter(
                                  (child) =>
                                    child.selected && (child.data.scopeId ?? null) === sid,
                                )
                                .map((child) => child.id),
                            );
                            draggedIds.add(node.id); // 잡은 것 포함(단일 드래그도)
                            const moves = childNodesRef.current
                              .filter((child) => draggedIds.has(child.id))
                              .map((child) => {
                                const offset =
                                  inlineComposition?.childOffsets.get(child.id) ?? {
                                    x: 0,
                                    y: 0,
                                  };
                                return {
                                  id: child.id,
                                  pos: { x: child.position.x - offset.x, y: child.position.y - offset.y },
                                };
                              });
                            void saveChildScopeDragBatch(sid, moves);
                          }
                          setDraggingChildIds(new Set()); // 드래그 종료 — 전부 해제
                          clearDwell();
                          setDropTarget(null);
                          setGroupDropTarget(null);
                          return;
                        }
                        const drop = dropTargetRef.current;
                        if (
                          !readOnly &&
                          drop &&
                          drop.id !== node.id &&
                          drop.zone !== null
                        ) {
                          handleZoneDrop(node.id, drop.id, drop.zone);
                        } else if (!readOnly && groupDropTargetRef.current) {
                          addToGroupId(node.id, groupDropTargetRef.current);
                        } else if (!readOnly) {
                          setNodes((current) => resolveCollision(current, node.id));
                          scheduleAutoSave();
                        }
                        clearDwell();
                        setDropTarget(null);
                        setGroupDropTarget(null);
                      }}
                      onSelectionDragStart={() => pushHistory()}
                      onSelectionDragStop={() => scheduleAutoSave()}
                      onBeforeDelete={async ({ nodes: toDelete }) => {
                        if (readOnly) {
                          return false;
                        }
                        // 자식 스코프(하위 프로세스)에서 마지막 Start/End/작업 삭제 → 불변식 깨짐.
                        // 유효→무효 전이일 때만 가로채(레거시 미충족 스코프는 막지 않음) 통째 삭제 확인 모달로.
                        if (currentParentId !== null && toDelete.length > 0) {
                          const removing = new Set(toDelete.map((node) => node.id));
                          const remaining = nodesRef.current.filter((node) => !removing.has(node.id));
                          if (
                            checkScopeInvariant(nodesRef.current) &&
                            !checkScopeInvariant(remaining)
                          ) {
                            setDeleteInvariantPrompt(currentParentId);
                            return false; // 네이티브 삭제 취소 — 확정 시 하위 통째 삭제로 처리
                          }
                        }
                        pushHistory();
                        return true;
                      }}
                      onNodesDelete={handleNodesDelete}
                      onEdgesDelete={() => scheduleAutoSave()}
                      onMoveStart={() => setMenu(null)}
                      selectionOnDrag
                      panOnDrag={[1]}
                      panActivationKeyCode="Space"
                      deleteKeyCode={["Delete"]}
                      // 휠 기본 = 캔버스 상하 이동(팬), Ctrl(또는 Cmd)+휠 = 줌 (사용자 요청)
                      panOnScroll
                      panOnScrollMode={PanOnScrollMode.Vertical}
                      zoomOnScroll={false}
                      zoomActivationKeyCode={["Control", "Meta"]}
                      {...(contentExtent
                        ? { nodeExtent: contentExtent.node, translateExtent: contentExtent.pan }
                        : {})}
                      minZoom={MIN_ZOOM}
                      fitView
                    >
                      <ViewportPortal>
                        {inlineComposition && (
                          <InlineRegionBands
                            regions={inlineComposition.regions}
                            baseDepth={currentScopeDepth}
                            onCollapse={toggleInlineExpand}
                          />
                        )}
                        {focusScopeLanes.map((lane, index) => (
                          <FocusScopeBands
                            key={`lane:${lane.depth}:${index}`}
                            left={lane.left}
                            right={lane.right}
                            top={lane.top}
                            depth={lane.depth}
                            label={lane.label}
                          />
                        ))}
                        {groupBoxes.map((box) => (
                          <Fragment key={box.id}>
                            {/* 반투명 박스 — 노드 뒤로, 멤버 적은 그룹이 위(z) */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                transform: `translate(${box.x}px, ${box.y}px)`,
                                zIndex: box.z,
                              }}
                            >
                              <GroupBox
                                color={box.color}
                                width={box.width}
                                height={box.height}
                                fill={box.fill}
                                outline={box.outline}
                                targeted={groupDropTarget === box.id}
                              />
                            </div>
                            {/* 타이틀바 — 노드 위, 박스 상단 좌측. 우클릭 시 그룹 멤버 정렬 메뉴 */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                transform: `translate(${box.x + 4}px, ${box.y + 3}px)`,
                                zIndex: 1,
                              }}
                              onContextMenu={(event) => {
                                event.stopPropagation(); // 팬 컨텍스트 메뉴로 덮어쓰이지 않게
                                openMenu(event, "group", box.id);
                              }}
                            >
                              <GroupTitleBar
                                id={box.id}
                                label={box.label}
                                color={box.color}
                                width={box.width - 56}
                                readOnly={readOnly}
                                autoEdit={box.id === newGroupId}
                                colorPresets={GROUP_COLOR_PRESETS}
                                onRename={renameGroup}
                                onRecolor={recolorGroup}
                                onMoveStart={startGroupMove}
                                onBulkEdit={setBulkEditGroupId}
                              />
                            </div>
                            {/* 그룹 나가기 — 박스 경계 우측 위 모서리. 선택 멤버가 있을 때만 */}
                            {selectedGroupIds.has(box.id) && !readOnly && (
                              <div
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  top: 0,
                                  transform: `translate(${box.x + box.width - 26}px, ${box.y + 3}px)`,
                                  zIndex: 2,
                                }}
                              >
                                <button
                                  type="button"
                                  className="pointer-events-auto rounded-sm border border-hairline bg-surface p-1 text-ink-tertiary shadow-sm hover:bg-error/10 hover:text-error"
                                  title={t("group.leave")}
                                  aria-label={t("group.leave")}
                                  onClick={() => leaveGroup(box.id)}
                                >
                                  <LogOut size={12} strokeWidth={1.5} />
                                </button>
                              </div>
                            )}
                          </Fragment>
                        ))}
                      </ViewportPortal>
                      <Background
                        variant={BackgroundVariant.Dots}
                        gap={20}
                        size={1.8}
                        color="var(--color-canvas-dot)"
                      />
                      <Controls showFitView={false}>
                        {/* 기본 fit(가운데 정렬+스냅) 대신 좌상단 정렬 fit — 왼쪽위 고정 일관 */}
                        <ControlButton onClick={fitScopeTopLeft} title={t("editor.fitView")}>
                          <Maximize size={14} strokeWidth={1.5} />
                        </ControlButton>
                      </Controls>
                      <CanvasZoomScale />
                    </ReactFlow>
                  </div>
                ) : (
                  <ScopePreview fullGraph={fullGraph} scopeParentId={scope.parentId} />
                )}
              </ScopeWindow>
            );
          })}
          <WindowDock
            items={[
              ...scopes
                .map((scope, index) => ({ scope, index, key: scopeKey(scope) }))
                .filter(({ index, key }) => index !== 0 && (windowGeom[key] ?? defaultGeom(index, bounds)).minimized)
                .map(({ scope, key }) => ({ key, title: scope.title })),
              ...(aiOpen && windowGeom[AI_WINDOW_KEY]?.minimized
                ? [{ key: AI_WINDOW_KEY, title: t("ai.title") }]
                : []),
            ]}
            onRestore={(key) => {
              if (key === AI_WINDOW_KEY) {
                setWindowGeom((map) => {
                  const base = map[AI_WINDOW_KEY] ?? aiDefaultGeom(bounds);
                  return { ...map, [AI_WINDOW_KEY]: { ...base, minimized: false } };
                });
                return;
              }
              setWindowGeom((map) => {
                const idx = scopes.findIndex((scope) => scopeKey(scope) === key);
                const base = map[key] ?? defaultGeom(idx, bounds);
                return { ...map, [key]: { ...base, minimized: false } };
              });
              bringToFront(key);
            }}
          />
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menuItems}
              onClose={() => setMenu(null)}
            />
          )}
          {dropTarget &&
            (() => {
              const r = dropTarget.rect;
              const tileW = ZONE_TILE_W;
              const tileH = ZONE_TILE_H;
              const cx = r.left + r.width / 2;
              const cy = r.top + r.height / 2;
              // 링 반경 — screenRectOf에서 줌 무관 고정값으로 계산됨 (hit-test와 공용)
              const radius = r.radius;
              // 타일은 원주 위 4 cardinal 지점
              const tiles = [
                { zone: "front", Icon: ArrowLeft, x: cx - radius, y: cy, label: t("dropzone.front") },
                { zone: "back", Icon: ArrowRight, x: cx + radius, y: cy, label: t("dropzone.back") },
                { zone: "group", Icon: Boxes, x: cx, y: cy - radius, label: t("dropzone.group") },
                { zone: "child", Icon: CornerDownRight, x: cx, y: cy + radius, label: t("dropzone.child") },
                // 좌하단(SW) 대각 — 위치+연결 교환
                { zone: "swap", Icon: ArrowLeftRight, x: cx - radius * Math.SQRT1_2, y: cy + radius * Math.SQRT1_2, label: t("dropzone.swap") },
              ] as const;
              // 하위로 넣기는 process 노드 타깃만 — decision/start/end면 child 타일을 숨기지 않고 비활성 표시
              const childAllowed =
                nodes.find((node) => node.id === dropTarget.id)?.data.nodeType === "process";
              return (
                <div className="pointer-events-none absolute inset-0 z-[1100]">
                  {/* 기준 셀(B) 원형 링 */}
                  <div
                    className="zone-ring absolute rounded-full border-2 border-accent/40"
                    style={{ left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2 }}
                  />
                  {tiles.map(({ zone, Icon, x, y, label }) => {
                    const disabled = zone === "child" && !childAllowed;
                    const active = dropTarget.zone === zone && !disabled;
                    return (
                    <div
                      key={zone}
                      className={`zone-pop absolute flex flex-col items-center justify-center gap-1 rounded-md border px-2 text-center shadow-md ${
                        disabled
                          ? "border-dashed border-hairline bg-surface/70 text-ink-tertiary opacity-40"
                          : active
                            ? "border-accent bg-accent-tint text-accent"
                            : "border-hairline bg-surface/95 text-ink-tertiary"
                      }`}
                      style={{ left: x - tileW / 2, top: y - tileH / 2, width: tileW, height: tileH }}
                    >
                      <Icon size={20} strokeWidth={1.5} />
                      <span className="text-fine font-medium leading-tight">{label}</span>
                    </div>
                    );
                  })}
                </div>
              );
            })()}
          {pending && (
            <div
              className="absolute z-[1110] flex flex-col gap-1 rounded-md border border-hairline bg-surface p-2 shadow-lg"
              style={{ left: pending.rect.left, top: pending.rect.top + pending.rect.height + 8 }}
            >
              <span className="text-fine text-ink-secondary">{t("dropzone.conflictPrompt")}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => {
                    applyFlowEdges(pending.aId, pending.bId, pending.mode, false);
                    setPending(null);
                  }}
                >
                  {t("dropzone.keep")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-2 py-0.5 text-caption font-medium text-on-accent hover:bg-accent-focus"
                  onClick={() => {
                    applyFlowEdges(pending.aId, pending.bId, pending.mode, true);
                    setPending(null);
                  }}
                >
                  {t("dropzone.insert")}
                </button>
              </div>
            </div>
          )}
          {aiPreviewActive && (
            <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-md bg-surface px-3 py-2 shadow-lg">
              <span className="text-caption text-ink">{t("ai.title")}</span>
              <button type="button" className="rounded-sm border border-hairline px-2 py-1 text-caption text-accent" onClick={commitAiPreview}>
                {t("approvers.save")}
              </button>
              <button type="button" className="rounded-sm border border-hairline px-2 py-1 text-caption text-error" onClick={discardAiPreview}>
                {t("approvers.cancel")}
              </button>
            </div>
          )}
          <ShortcutLegend />
          {summaryNodeId && versionId !== null && (() => {
            // 현재 스코프 노드 우선, 없으면 인라인 펼친 자식 노드(편집 오버레이 반영된 합성 노드)
            const node =
              nodes.find((n) => n.id === summaryNodeId) ??
              inlineComposition?.nodes.find((n) => n.id === summaryNodeId);
            if (!node) {
              return null;
            }
            const isCurrentScopeNode = nodes.some((n) => n.id === summaryNodeId);
            // 자식 노드는 현재 스코프 edges/nodes에 없으므로 fullGraph(전체 트리)에서 선후행 계산
            const labelById = (id: string): string =>
              isCurrentScopeNode
                ? nodes.find((n) => n.id === id)?.data.label ?? ""
                : fullGraph?.nodes.find((n) => n.id === id)?.title ?? "";
            const predecessors = isCurrentScopeNode
              ? edges
                  .filter((edge) => edge.target === summaryNodeId)
                  .map((edge) => labelById(edge.source))
                  .filter(Boolean)
              : (fullGraph?.edges ?? [])
                  .filter((edge) => edge.target_node_id === summaryNodeId)
                  .map((edge) => labelById(edge.source_node_id))
                  .filter(Boolean);
            const successors = isCurrentScopeNode
              ? edges
                  .filter((edge) => edge.source === summaryNodeId)
                  .map((edge) => labelById(edge.target))
                  .filter(Boolean)
              : (fullGraph?.edges ?? [])
                  .filter((edge) => edge.source_node_id === summaryNodeId)
                  .map((edge) => labelById(edge.target_node_id))
                  .filter(Boolean);
            const hasChildren = (fullGraph?.nodes ?? []).some((n) => n.parent_node_id === summaryNodeId);
            // 다중 태그 — 그룹 라벨들을 콤마로 합쳐 표시
            const groupLabels = node.data.groupIds
              .map((gid) => groups.find((g) => g.id === gid)?.label)
              .filter((label): label is string => Boolean(label));
            const groupLabel = groupLabels.length > 0 ? groupLabels.join(", ") : null;
            const typeKey = NODE_TYPE_OPTIONS.find((option) => option.value === node.data.nodeType)?.labelKey;
            return (
              <NodeSummaryModal
                versionId={versionId}
                nodeId={summaryNodeId}
                title={node.data.label}
                typeLabel={typeKey ? t(typeKey) : node.data.nodeType}
                groupLabel={groupLabel}
                predecessors={predecessors}
                successors={successors}
                hasChildren={hasChildren}
                fullGraph={fullGraph}
                readOnly={readOnly}
                color={node.data.color}
                assignee={node.data.assignee}
                department={node.data.department}
                system={node.data.system}
                duration={node.data.duration}
                colorPresets={COLOR_PRESETS}
                onPatch={handleSummaryPatch}
                onCommitLabel={handleSummaryLabelCommit}
                onClose={() => setSummaryNodeId(null)}
                onOpenChild={() => {
                  // 드릴인 창 대신 같은 캔버스에 인라인 펼침(드릴인 창 열기는 제거)
                  const id = summaryNodeId;
                  setSummaryNodeId(null);
                  if (id !== null) {
                    toggleInlineExpand(id);
                  }
                }}
              />
            );
          })()}
          {bulkEditGroupId && (
            <GroupBulkModal
              groupLabel={groups.find((g) => g.id === bulkEditGroupId)?.label ?? ""}
              members={nodes
                .filter((n) => bulkEditGroupId !== null && n.data.groupIds.includes(bulkEditGroupId))
                .map((n) => ({
                  id: n.id,
                  label: n.data.label,
                  assignee: n.data.assignee,
                  department: n.data.department,
                  system: n.data.system,
                  duration: n.data.duration,
                }))}
              colorPresets={COLOR_PRESETS}
              onRenameGroup={(label) => renameGroup(bulkEditGroupId, label)}
              onApplyColor={(color) => applyGroupColor(bulkEditGroupId, color)}
              onApplyAttribute={(field, updates) =>
                applyGroupAttribute(field, updates)
              }
              onClose={() => setBulkEditGroupId(null)}
            />
          )}
          {/* 플로팅 AI 채팅 — ScopeWindow 재사용(드래그/리사이즈/최소화→dock/위치 영속). active=항상 상호작용. */}
          {versionId !== null && aiOpen && !(windowGeom[AI_WINDOW_KEY]?.minimized) && (
            <ScopeWindow
              title={t("ai.title")}
              geom={windowGeom[AI_WINDOW_KEY] ?? aiDefaultGeom(bounds)}
              active
              zIndex={1090}
              canClose
              bounds={bounds}
              onFocus={() => {}}
              onGeomChange={(next) =>
                setWindowGeom((map) => ({ ...map, [AI_WINDOW_KEY]: next }))
              }
              onClose={() => setAiOpen(false)}
            >
              <AiChatPanel
                versionId={versionId}
                parent={currentParentId}
                aiEnabled={aiEnabled}
                canEdit={!readOnly && (checkout?.mine ?? false)}
                onGraphProposal={applyAiProposal}
              />
            </ScopeWindow>
          )}
        </div>

        {inspectorOpen && (
          <div className="flex min-h-0 shrink-0" style={{ width: inspectorWidth }}>
            <div
              onPointerDown={startInspectorResize}
              className="w-1 shrink-0 cursor-col-resize hover:bg-accent-tint"
              title={t("editor.inspectorToggle")}
            />
            <div className="flex min-w-0 flex-1 flex-col border-l border-hairline bg-surface">
            <div className="flex-1 overflow-y-auto p-4">
            {selectedNode ? (
              <>
            <h2 className="mb-3 text-caption-strong text-ink-secondary">{t("editor.nodeEdit")}</h2>
            <label className="mb-1 block text-fine text-ink-tertiary">{t("field.title")}</label>
            <input
              className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
              value={selectedNode.data.label}
              disabled={readOnly}
              onChange={(event) =>
                updateSelectedData({ label: event.target.value }, true)
              }
            />
            <label className="mb-1 block text-fine text-ink-tertiary">{t("field.description")}</label>
            <textarea
              className="h-28 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
              value={selectedNode.data.description}
              disabled={readOnly}
              onChange={(event) =>
                updateSelectedData({ description: event.target.value }, true)
              }
            />
            {/* 유형 — 생성 시 고정, 변경 불가(읽기 전용 표시) */}
            <label className="mb-1 mt-3 block text-fine text-ink-tertiary">{t("field.type")}</label>
            <div className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary">
              {t(
                NODE_TYPE_OPTIONS.find((option) => option.value === selectedNode.data.nodeType)
                  ?.labelKey ?? "nodeType.process",
              )}
            </div>
            <label className="mb-1 block text-fine text-ink-tertiary">{t("field.color")}</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset || "default"}
                  title={preset || t("editor.defaultColor")}
                  aria-label={t("editor.colorAria", { name: preset || t("editor.colorDefaultName") })}
                  className={`h-5 w-5 rounded-xs border ${
                    selectedNode.data.color === preset
                      ? "ring-2 ring-accent"
                      : "border-hairline"
                  }`}
                  style={{ backgroundColor: preset || "#ffffff" }}
                  disabled={readOnly}
                  onClick={() => updateSelectedData({ color: preset })}
                />
              ))}
            </div>
            <input
              key={`${selectedNode.id}-${selectedNode.data.color}`}
              className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
              defaultValue={selectedNode.data.color}
              disabled={readOnly}
              placeholder={t("editor.hexPlaceholder")}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value === "" || /^#[0-9a-fA-F]{6}$/.test(value)) {
                  updateSelectedData({ color: value });
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
            <details className="mb-3 rounded-sm border border-hairline px-2 py-1.5">
              <summary className="cursor-pointer text-fine font-medium text-ink-secondary">
                {t("editor.bpmAttrs")}
              </summary>
              <label className="mb-1 mt-2 block text-fine text-ink-tertiary">{t("field.assignee")}</label>
              <input
                className="mb-2 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
                value={selectedNode.data.assignee}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ assignee: event.target.value }, true)
                }
              />
              <label className="mb-1 block text-fine text-ink-tertiary">{t("field.department")}</label>
              <input
                className="mb-2 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
                value={selectedNode.data.department}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ department: event.target.value }, true)
                }
              />
              <label className="mb-1 block text-fine text-ink-tertiary">{t("field.system")}</label>
              <input
                className="mb-2 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
                value={selectedNode.data.system}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ system: event.target.value }, true)
                }
              />
              <label className="mb-1 block text-fine text-ink-tertiary">{t("field.duration")}</label>
              <input
                className="mb-2 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
                value={selectedNode.data.duration}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ duration: event.target.value }, true)
                }
                placeholder={t("editor.durationPlaceholder")}
              />
            </details>
            {selectedNode.data.nodeType === "end" && (
              <label className="mb-3 flex items-center gap-2 text-caption text-ink-secondary">
                <input
                  type="checkbox"
                  checked={selectedNode.data.isPrimaryEnd ?? false}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateSelectedData({ isPrimaryEnd: event.target.checked }, true)
                  }
                />
                {t("node.primaryEnd")}
              </label>
            )}
            <details open className="mb-3 rounded-sm border border-hairline px-2 py-1.5">
              <summary className="cursor-pointer text-fine font-medium text-ink-secondary">
                {t("editor.comments")}
                {selectedComments.some((comment) => !comment.resolved) &&
                  ` (${t("editor.unresolvedCount", { n: selectedComments.filter((comment) => !comment.resolved).length })})`}
              </summary>
              <div className="mt-2">
                {/* 코멘트는 읽기 전용 모드에서도 작성 가능 — 피드백 통로 */}
                <CommentSection
                  comments={selectedComments}
                  onAdd={(body) => void handleAddComment(body)}
                  onToggleResolved={(comment) => void handleToggleComment(comment)}
                  onDelete={(comment) => void handleDeleteComment(comment)}
                />
              </div>
            </details>
            <p className="mt-3 text-fine text-ink-tertiary">
              {t("editor.hintNode")}
            </p>
              </>
            ) : selectedEdge ? (
              <>
            <h2 className="mb-3 text-caption-strong text-ink-secondary">{t("editor.edgeEdit")}</h2>
            {/* 판단 노드 분기 엣지 — Yes/No/기타 탭 전환. 기타일 때만 라벨 직접 편집 */}
            {selectedEdgeBranch !== null && (
              <div className="mb-3 flex overflow-hidden rounded-sm border border-hairline text-caption">
                {(["yes", "no", "other"] as BranchKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setSelectedEdgeBranch(kind)}
                    className={`flex-1 px-2 py-1 ${
                      selectedEdgeBranch === kind
                        ? "bg-accent-tint text-accent"
                        : "text-ink-secondary hover:bg-surface-alt"
                    }`}
                  >
                    {t(`branch.${kind}`)}
                  </button>
                ))}
              </div>
            )}
            <label className="mb-1 block text-fine text-ink-tertiary">{t("editor.edgeLabel")}</label>
            <input
              className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption disabled:bg-surface-alt disabled:text-ink-tertiary"
              value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
              disabled={readOnly || (selectedEdgeBranch !== null && selectedEdgeBranch !== "other")}
              onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
            />
            <p className="mt-3 text-fine text-ink-tertiary">{t("editor.hintEdge")}</p>
              </>
            ) : (
              <div className="text-caption text-ink-secondary">
                <p className="mb-2 text-fine text-ink-tertiary">{t("inspector.noSelection")}</p>
                <h2 className="text-caption-strong text-ink">{mapName}</h2>
                <p className="text-ink-tertiary">{t("inspector.nodesCount", { n: nodes.length })}</p>
                {groups.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
                      {t("inspector.groupsTitle")}
                    </div>
                    <ul className="flex flex-col gap-1">
                      {groups.map((group) => (
                        <li key={group.id} className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-hairline"
                            style={{ background: group.color || "var(--color-surface-alt)" }}
                          />
                          <span className="truncate">{group.label || t("sidebar.untitled")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            </div>
            {currentVersion && (
              <>
                <div
                  onPointerDown={startDashboardResize}
                  className="h-1 shrink-0 cursor-row-resize border-t border-hairline hover:bg-accent-tint"
                  title={t("dash.resize")}
                />
                <div
                  className="shrink-0 overflow-hidden"
                  style={{ height: dashboardHeight }}
                >
                  <WorkflowDashboard
                    versionLabel={currentVersion.label}
                    status={currentVersion.status}
                    submittedBy={currentVersion.submitted_by}
                    rejectReason={currentVersion.reject_reason}
                    workflow={workflow}
                    isCheckoutHolder={checkout?.mine ?? false}
                    isApprover={isApprover}
                    isSubmitter={isSubmitter}
                    hasApproved={hasApproved}
                    isMapOwner={isMapOwner}
                    onSubmit={() => void runTransition(submitVersion)}
                    onApprove={() => void runTransition(approveVersion)}
                    onReject={(reason) => void runTransition((id) => rejectVersion(id, reason))}
                    onPublish={() => void runTransition(publishVersion)}
                    onWithdraw={() => void runTransition(withdrawVersion)}
                    onManageApprovers={() => setManagingApprovers(true)}
                  />
                </div>
              </>
            )}
            </div>
          </div>
        )}
      </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={removeToast} />
      {branchPrompt && (
        <EdgeBranchModal onPick={handlePickBranch} onClose={() => setBranchPrompt(null)} />
      )}
      {capPrompt && (
        <ModalBackdrop
          onClose={() => setCapPrompt(null)}
          className="fixed inset-0 z-[1100] flex items-center justify-center px-4"
          style={{ background: "color-mix(in srgb, var(--color-ink) 12%, transparent)" }}
        >
          <div
            className="w-full max-w-sm rounded-md border border-hairline bg-surface p-4"
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            <h2 className="text-body-strong text-ink">{t("inline.capTitle")}</h2>
            <p className="mt-2 text-caption text-ink-secondary">
              {t("inline.capBody", {
                nodes: capPrompt.nodeCount,
                depth: capPrompt.depth,
                maxNodes: EXPANSION_LIMITS.maxNodes,
                maxDepth: EXPANSION_LIMITS.maxDepth,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption hover:bg-surface-alt"
                onClick={() => setCapPrompt(null)}
              >
                {t("inline.capCancel")}
              </button>
              <button
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-white hover:opacity-90"
                onClick={confirmCapPrompt}
              >
                {t("inline.capProceed")}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
      {subprocessPrompt && (
        <ExpandInvariantModal
          title={t("subprocess.noSuccessorTitle")}
          body={t("subprocess.noSuccessorBody")}
          onClose={() => setSubprocessPrompt(null)}
          actions={[
            { label: t("subprocess.cancel"), onClick: () => setSubprocessPrompt(null) },
            {
              label: t("subprocess.pickNode"),
              onClick: () => {
                const prompt = subprocessPrompt;
                setSubprocessPrompt(null);
                setPendingSubprocessPick({ sourceId: prompt.nodeId, proceed: prompt.proceed });
              },
            },
            {
              label: t("subprocess.createEnd"),
              variant: "accent",
              onClick: () => handleCreateEndForSubprocess(),
            },
          ]}
        />
      )}
      {pendingSubprocessPick && (
        <div
          className="pointer-events-none fixed left-1/2 top-20 z-[1100] -translate-x-1/2 rounded-full border border-accent bg-surface px-4 py-1.5 text-caption text-accent"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          {t("subprocess.pickHint")}
        </div>
      )}
      {deleteInvariantPrompt !== null && (
        <ExpandInvariantModal
          title={t("subprocess.deleteInvariantTitle")}
          body={t("subprocess.deleteInvariantBody")}
          onClose={() => setDeleteInvariantPrompt(null)}
          actions={[
            { label: t("subprocess.cancel"), onClick: () => setDeleteInvariantPrompt(null) },
            {
              label: t("subprocess.deleteInvariantConfirm"),
              variant: "danger",
              onClick: () => {
                void confirmDeleteSubprocess();
              },
            },
          ]}
        />
      )}
    </NodeActionsContext.Provider>
  );
}

export default function MapEditorPage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  return (
    <ReactFlowProvider>
      <MapEditor mapId={mapId} />
    </ReactFlowProvider>
  );
}
