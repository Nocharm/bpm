"use client";

import { ArrowLeft, ArrowRight, Boxes, Check, ChevronRight, CornerDownRight, Download, Lock, LogOut, PanelRight, PencilLine, Redo2, Undo2 } from "lucide-react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  type Connection,
  type Edge,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ScopeWindow } from "@/components/scope-window";
import { loadWindowGeoms, saveWindowGeoms, type WindowGeom } from "@/lib/window-store";

import { CommentSection } from "@/components/comment-section";
import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { EditorLeftSidebar } from "@/components/editor-left-sidebar";
import { GroupBox } from "@/components/group-box";
import { GroupTitleBar } from "@/components/group-title-bar";
import { ProcessNode } from "@/components/process-node";
import { ScopePreview } from "@/components/scope-preview";
import { ShortcutLegend } from "@/components/shortcut-legend";
import {
  alignSelected,
  buildOutline,
  distributeSelected,
  layoutWithDagre,
  normalizeNodeType,
  resolveCollision,
  getIncomingEdges,
  getOutgoingEdges,
  insertNodeBefore,
  insertNodeAfter,
  EDGE_DEFAULTS,
  NODE_HEIGHT,
  NODE_TYPE_OPTIONS,
  NODE_WIDTH,
  type AppNode,
  type NodeData,
  type OutlineEdge,
  type OutlineNode,
  type ProcessNodeType,
} from "@/lib/canvas";
import {
  acquireCheckout,
  createComment,
  createVersion,
  deleteComment,
  deleteVersion,
  getFullGraph,
  getGraph,
  getMap,
  listComments,
  releaseCheckout,
  renameVersion,
  saveGraph,
  updateComment,
  type CheckoutState,
  type CommentItem,
  type FlatNode,
  type Graph,
  type GraphEdge,
  type GraphGroup,
  type VersionGraph,
  type VersionSummary,
} from "@/lib/api";
import { exportCanvasPng } from "@/lib/export";
import { matchesQuery } from "@/lib/hangul";
import { useI18n } from "@/lib/i18n";
import { NodeActionsContext } from "@/lib/node-actions";

// 모듈 스코프 — 안정적 식별자 유지 (React Flow 권장)
const nodeTypes: NodeTypes = { process: ProcessNode };

const DWELL_MS = 300; // 노드 위에 머무는 시간이 이만큼 넘으면 드롭 영역(앞/그룹/뒤) 표시
const DROP_GAP = 24; // 삽입 시 A를 B 좌/우로 떨어뜨리는 간격
const GROUP_PAD = 16; // 그룹 박스가 멤버 bounding box를 감싸는 여백
const GROUP_TITLE_GAP = 26; // 박스 상단에 타이틀바를 얹을 추가 여백 — 멤버 노드와 제목 겹침 방지

type DropZone = "front" | "back" | "group" | "child";
type ScreenRect = { left: number; top: number; width: number; height: number };

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
type Snapshot = { nodes: AppNode[]; edges: Edge[] };
type SaveState = "idle" | "saving" | "saved" | "error";
type MenuState = {
  x: number;
  y: number;
  kind: "pane" | "node" | "edge";
  targetId: string | null;
};

function toAppNodes(graph: Graph): AppNode[] {
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
      groupId: node.group_id ?? null,
      hasChildren: node.has_children ?? false,
    },
  }));
}

function toAppEdges(graph: Graph): Edge[] {
  return graph.edges.map((edge) => ({
    ...EDGE_DEFAULTS,
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
  }));
}

function buildGraph(nodes: AppNode[], edges: Edge[], groups: GraphGroup[]): Graph {
  // 자기완결적 payload 보장 — 백엔드 검증(엣지·group 참조) 422 방지
  const nodeIds = new Set(nodes.map((node) => node.id));
  const keptGroups = groups.filter((group) =>
    nodes.some((node) => node.data.groupId === group.id),
  );
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
      // 고아 group_id(그룹이 payload에 없음)는 null 처리
      group_id: node.data.groupId && groupIds.has(node.data.groupId) ? node.data.groupId : null,
    })),
    // 양 끝이 모두 payload 노드인 엣지만 — 누락 노드 참조 제거
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map<GraphEdge>((edge) => ({
        id: edge.id,
        source_node_id: edge.source,
        target_node_id: edge.target,
        label: typeof edge.label === "string" ? edge.label : "",
      })),
    groups: keptGroups.map((group) => ({ id: group.id, label: group.label, color: group.color })),
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
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [groups, setGroups] = useState<GraphGroup[]>([]);
  // 아웃라인 전체 그래프(하위 프로세스 펼치기용) + 펼친 노드 집합
  const [fullGraph, setFullGraph] = useState<VersionGraph | null>(null);
  const [expandedOutline, setExpandedOutline] = useState<Set<string>>(new Set());
  // 좌측 사이드바 접힘 / 우측 인스펙터 열림·폭(로컬 영속, 220~480 clamp)
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // 서버·클라이언트 첫 렌더 모두 320으로 결정적 — localStorage 복원은 마운트 후 effect에서 (hydration mismatch 방지)
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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

  // 드래그-오버 드롭 영역 (Phase 1: 앞/뒤 흐름 삽입). rect는 활성 시점에 계산해 저장(렌더 중 ref 접근 회피).
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    zone: DropZone;
    rect: ScreenRect;
  } | null>(null);
  // 드래그 노드가 기존 그룹 박스 빈 영역 위에 머무는 중 — 합류 대상 그룹 id(펄스 강조)
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const groupDropTargetRef = useRef<string | null>(null);
  const dwellRef = useRef<{ id: string; since: number } | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragMouseRef = useRef({ x: 0, y: 0 }); // 드래그 중 마우스 flow 좌표 — 4방향 zone 판정 기준
  // 기존 엣지 충돌 시 유지/삽입 되묻기 팝오버
  const [pending, setPending] = useState<{
    mode: DropZone;
    aId: string;
    bId: string;
    rect: ScreenRect;
  } | null>(null);

  // 다른 사용자가 유효한 체크아웃을 쥐고 있으면 읽기 전용 (코멘트 작성은 허용)
  const readOnly = checkout !== null && !checkout.mine;

  const reactFlow = useReactFlow();
  const currentParentId =
    scopes[Math.min(activeIndex, scopes.length - 1)]?.parentId ?? null;

  const scopeKey = (scope: Scope) => scope.parentId ?? "root";

  // 이벤트 핸들러/타이머에서 최신 상태를 읽기 위한 미러 — setState 클로저 stale 방지
  const nodesRef = useRef<AppNode[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const groupsRef = useRef<GraphGroup[]>([]);
  const windowGeomRef = useRef<Record<string, WindowGeom>>({});
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
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
    void getFullGraph(versionId)
      .then(setFullGraph)
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

  const scheduleAutoSave = useCallback(() => {
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
    history.past.push({ nodes: nodesRef.current, edges: edgesRef.current });
    if (history.past.length > HISTORY_LIMIT) {
      history.past.shift();
    }
    history.future = [];
    setHistorySize({ past: history.past.length, future: 0 });
  }, []);

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
    history.future.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setHistorySize({ past: history.past.length, future: history.future.length });
    scheduleAutoSave();
  }, [setNodes, setEdges, scheduleAutoSave]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) {
      return;
    }
    history.past.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistorySize({ past: history.past.length, future: history.future.length });
    scheduleAutoSave();
  }, [setNodes, setEdges, scheduleAutoSave]);

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
        setNodes(toAppNodes(graph));
        setEdges(toAppEdges(graph));
        setGroups(graph.groups);
        refreshFullGraph();
        setSelectedId(null);
        setSelectedEdgeId(null);
        setMenu(null);
        historyRef.current = { past: [], future: [] };
        setHistorySize({ past: 0, future: 0 });
        lastTextEditAtRef.current = 0;
        dirtyRef.current = false;
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        setSaveState("idle");
        // 검색 점프 — 노드가 렌더된 다음 틱에 화면 중앙으로
        if (focusNodeIdRef.current) {
          const focusId = focusNodeIdRef.current;
          focusNodeIdRef.current = null;
          setSelectedId(focusId);
          setTimeout(() => {
            void reactFlow.fitView({
              nodes: [{ id: focusId }],
              padding: 0.4,
              duration: 700,
              maxZoom: 1.3,
            });
          }, 80);
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
  }, [versionId, currentParentId, setNodes, setEdges, reactFlow, refreshFullGraph, t]);

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
  }, [versionId, t]);

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

  const handleDrillIn = useCallback(
    (node: AppNode, clientX: number, clientY: number) => {
      const childKey = node.id;
      if (!windowGeomRef.current[childKey]) {
        const w2 = Math.min(Math.min(760, Math.round(bounds.w * 0.82)), bounds.w);
        const h2 = Math.min(Math.min(500, Math.round(bounds.h * 0.82)), bounds.h);
        let cx = bounds.w / 2;
        let cy = bounds.h / 2;
        const el = canvasContainerRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          cx = clientX - rect.left;
          cy = clientY - rect.top;
        }
        const x = Math.min(Math.max(cx - w2 / 2, 0), Math.max(0, bounds.w - w2));
        const y = Math.min(Math.max(cy - h2 / 2, 0), Math.max(0, bounds.h - h2));
        setWindowGeom((m) => ({
          ...m,
          [childKey]: { x, y, w: w2, h: h2, minimized: false, maximized: false },
        }));
      }
      void navigateTo([
        ...scopes.slice(0, activeIndex + 1),
        { parentId: node.id, title: node.data.label },
      ]);
    },
    [bounds, navigateTo, scopes, activeIndex],
  );

  const handleDrillById = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (node) {
        handleDrillIn(node, clientX, clientY);
      }
    },
    [handleDrillIn],
  );

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
    },
    [activeIndex, saveCurrentScope, t],
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

  // ── 편집 조작 (모두 히스토리 + 자동 저장 대상) ─────────

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        addEdge({ ...EDGE_DEFAULTS, ...connection, id: crypto.randomUUID() }, current),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setEdges, scheduleAutoSave],
  );

  // screen 좌표가 주어지면(컨텍스트 메뉴) 커서가 노드 중심이 되도록 생성
  const handleAddNode = useCallback(
    (screen: { x: number; y: number } | null, nodeType: ProcessNodeType = "process") => {
      if (readOnly) {
        return;
      }
      pushHistory();
      const id = crypto.randomUUID();
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
            label: t("editor.newStep"),
            description: "",
            nodeType,
            color: "",
            assignee: "",
            department: "",
            system: "",
            duration: "",
            groupId: null,
            hasChildren: false,
          },
        },
      ]);
      setSelectedId(id);
      setSelectedEdgeId(null);
      scheduleAutoSave();
    },
    [readOnly, pushHistory, reactFlow, setNodes, scheduleAutoSave, t],
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
      return {
        left: topLeft.x - rect.left,
        top: topLeft.y - rect.top,
        width: (node.measured?.width ?? NODE_WIDTH) * zoom,
        height: (node.measured?.height ?? NODE_HEIGHT) * zoom,
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
      setEdges((current) =>
        zone === "front"
          ? insertNodeBefore(current, aId, bId, rewire)
          : insertNodeAfter(current, aId, bId, rewire),
      );
      scheduleAutoSave();
    },
    [setEdges, scheduleAutoSave],
  );

  // A를 B의 그룹에 합류 — B가 무소속이면 새 그룹 생성(라벨 기본=B의 부서/담당자)
  const addToGroup = useCallback(
    (aId: string, bId: string) => {
      const b = nodesRef.current.find((node) => node.id === bId);
      if (!b) {
        return;
      }
      const bGroupWasEmpty = !b.data.groupId;
      let groupId = b.data.groupId;
      if (!groupId) {
        const newId = crypto.randomUUID();
        groupId = newId;
        setGroups((cur) => [
          ...cur,
          {
            id: newId,
            label: b.data.department || b.data.assignee || "",
            color: b.data.color || "#4a5a8c",
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
            return { ...node, position: { x, y }, data: { ...node.data, groupId } };
          }
          if (bGroupWasEmpty && node.id === bId) {
            return { ...node, data: { ...node.data, groupId } };
          }
          return node;
        });
        return resolveCollision(moved, aId);
      });
      scheduleAutoSave();
    },
    [setNodes, setGroups, scheduleAutoSave],
  );

  // A를 특정 기존 그룹에 합류 — 그룹 박스 빈 영역에 드롭한 경우. 드롭 위치는 유지하되 멤버 겹침만 회피.
  const addToGroupId = useCallback(
    (aId: string, groupId: string) => {
      setNodes((current) => {
        const moved = current.map((node) =>
          node.id === aId ? { ...node, data: { ...node.data, groupId } } : node,
        );
        return resolveCollision(moved, aId);
      });
      scheduleAutoSave();
    },
    [setNodes, scheduleAutoSave],
  );

  // A를 B의 하위 프로세스(자식 스코프)로 이동. 자식 스코프에 먼저 영속(재부모화)한 뒤
  // 현재 스코프에서 제거 — 순서 보장으로 현재 스코프 자동저장이 A를 삭제하지 않도록 함.
  const moveToChild = useCallback(
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
        await saveGraph(
          versionId,
          {
            nodes: [...child.nodes, { ...aGraph, group_id: null }],
            edges: child.edges,
            groups: child.groups,
          },
          bId,
        );
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

  const renameGroup = useCallback(
    (groupId: string, label: string) => {
      setGroups((current) => current.map((g) => (g.id === groupId ? { ...g, label } : g)));
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

  // 선택된 멤버 노드를 그룹에서 제거 (group_id=null). 멤버 0이면 저장 시 그룹 자동 정리.
  const leaveGroup = useCallback(
    (groupId: string) => {
      setNodes((current) =>
        current.map((node) =>
          node.selected && node.data.groupId === groupId
            ? { ...node, data: { ...node.data, groupId: null } }
            : node,
        ),
      );
      scheduleAutoSave();
    },
    [setNodes, scheduleAutoSave],
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
          .filter((node) => node.data.groupId === groupId)
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

  // 드롭 영역에 놓음 — 앞/뒤(흐름)·그룹·하위로 넣기. 앞·뒤는 기존 엣지가 있으면 유지/삽입 되묻기
  const handleZoneDrop = useCallback(
    (aId: string, bId: string, zone: DropZone) => {
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
    [addToGroup, moveToChild, placeBeside, applyFlowEdges, scheduleAutoSave, screenRectOf],
  );

  // 마우스(flow 좌표) 아래에 있는, 드래그 노드가 아직 속하지 않은 기존 그룹 박스 id — 박스 영역 드롭 합류용
  const findGroupAt = useCallback((mouse: { x: number; y: number }, draggingId: string): string | null => {
    const draggingGroupId = nodesRef.current.find((n) => n.id === draggingId)?.data.groupId ?? null;
    for (const group of groupsRef.current) {
      if (group.id === draggingGroupId) {
        continue; // 이미 이 그룹 멤버
      }
      const members = nodesRef.current.filter(
        (n) => n.data.groupId === group.id && n.id !== draggingId,
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

  // 대상 B 위에 앞/뒤 영역 활성화 — A 중심 기준 좌=앞/우=뒤
  const activateZone = useCallback(
    (targetId: string) => {
      const target = nodesRef.current.find((item) => item.id === targetId);
      if (!target) {
        return;
      }
      // A 중심과 B 중심의 우세 방향으로 판정 — 좌=앞/우=뒤/위=그룹/아래=하위
      const bw = target.measured?.width ?? NODE_WIDTH;
      const bh = target.measured?.height ?? NODE_HEIGHT;
      const dx = dragMouseRef.current.x - (target.position.x + bw / 2);
      const dy = dragMouseRef.current.y - (target.position.y + bh / 2);
      const zone: DropZone =
        Math.abs(dx) >= Math.abs(dy)
          ? dx < 0
            ? "front"
            : "back"
          : dy < 0
            ? "group"
            : "child";
      const rect = screenRectOf(targetId);
      if (!rect) {
        return;
      }
      setGroupDropTarget((cur) => (cur ? null : cur)); // 노드 대상이 그룹 박스 hover보다 우선
      setDropTarget((cur) =>
        cur && cur.id === targetId && cur.zone === zone ? cur : { id: targetId, zone, rect },
      );
    },
    [screenRectOf],
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
      dragMouseRef.current = mouse;

      // 이미 떠 있는 링 — 커서가 링(원) 안에 있으면 유지하며 zone만 갱신, 밖으로 나가면 해제 후 재탐지
      const active = dropTargetRef.current;
      const container = canvasContainerRef.current;
      if (active && active.id !== node.id && container) {
        const r = active.rect;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const radius = Math.max(r.width, r.height) + 20;
        const crect = container.getBoundingClientRect();
        const dist = Math.hypot(clientX - crect.left - cx, clientY - crect.top - cy);
        if (dist <= radius) {
          activateZone(active.id);
          return;
        }
        setDropTarget((cur) => (cur ? null : cur));
        clearDwell();
      }

      // 커서 아래 노드 — DWELL_MS 머문 뒤 4방향 링 표시(그룹 hover는 끔)
      const target = reactFlow
        .getIntersectingNodes({ x: mouse.x, y: mouse.y, width: 1, height: 1 })
        .find((other) => other.id !== node.id);
      if (target) {
        setGroupDropTarget((cur) => (cur ? null : cur));
        if (!dwellRef.current || dwellRef.current.id !== target.id) {
          clearDwell();
          dwellRef.current = { id: target.id, since: Date.now() };
          dwellTimerRef.current = setTimeout(() => activateZone(target.id), DWELL_MS);
        } else if (Date.now() - dwellRef.current.since >= DWELL_MS) {
          activateZone(target.id);
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
    if (menu.kind === "pane") {
      if (readOnly) {
        return [{ label: t("ctx.exportPng"), onSelect: () => void handleExportPng() }];
      }
      return [
        ...NODE_TYPE_OPTIONS.map((option) => ({
          label: t(option.labelKey),
          onSelect: () => handleAddNode({ x: menu.x, y: menu.y }, option.value),
        })),
        { divider: true },
        {
          label: t("ctx.autoLayout"),
          onSelect: () =>
            applyNodesTransform((current) => layoutWithDagre(current, edgesRef.current)),
        },
        {
          label: t("editor.alignLeft"),
          onSelect: () => applyNodesTransform((current) => alignSelected(current, "left")),
        },
        {
          label: t("editor.alignTop"),
          onSelect: () => applyNodesTransform((current) => alignSelected(current, "top")),
        },
        {
          label: t("editor.distributeX"),
          onSelect: () => applyNodesTransform((current) => distributeSelected(current, "x")),
        },
        {
          label: t("editor.distributeY"),
          onSelect: () => applyNodesTransform((current) => distributeSelected(current, "y")),
        },
        { divider: true },
        { label: t("ctx.exportPng"), onSelect: () => void handleExportPng() },
      ];
    }
    if (menu.kind === "node") {
      const deleteItems: ContextMenuItem[] = readOnly
        ? []
        : [
            { divider: true },
            {
              label: t("ctx.delete"),
              shortcut: "⌫",
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
            },
            { divider: true },
          ];
      return [
        ...colorItems,
        {
          label: t("ctx.openChild"),
          shortcut: t("ctx.doubleClick"),
          onSelect: () => {
            // ref 조회는 이벤트 시점에 — 렌더 중 ref 접근 금지 (react-hooks/refs)
            const node = nodesRef.current.find((item) => item.id === menu.targetId);
            if (node) {
              handleDrillIn(node, menu.x, menu.y);
            }
          },
        },
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
        shortcut: "⌫",
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
    handleAddNode,
    handleRecolor,
    applyNodesTransform,
    handleDrillIn,
    handleExportPng,
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

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const count = unresolvedCounts.get(node.id) ?? 0;
        return count === (node.data.commentCount ?? 0)
          ? node
          : { ...node, data: { ...node.data, commentCount: count } };
      }),
    [nodes, unresolvedCounts],
  );

  // 그룹 박스 — 멤버 bounding box로 자동 산정해 ViewportPortal에 flow 좌표로 렌더(시각 전용)
  const groupBoxes = useMemo(() => {
    return groups.flatMap((group) => {
      const members = nodes.filter((node) => node.data.groupId === group.id);
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
      return [
        {
          id: group.id,
          label: group.label,
          color: group.color,
          // 상단은 타이틀바 높이만큼 더 띄워 멤버 노드와 제목이 겹치지 않게 함
          x: minX - GROUP_PAD,
          y: minY - GROUP_PAD - GROUP_TITLE_GAP,
          width: maxX - minX + GROUP_PAD * 2,
          height: maxY - minY + GROUP_PAD * 2 + GROUP_TITLE_GAP,
        },
      ];
    });
  }, [nodes, groups]);

  // 선택된 멤버가 속한 그룹 id — 타이틀바에 "그룹 나가기" 노출 판정
  const selectedGroupIds = useMemo(
    () =>
      new Set(
        nodes
          .filter((node) => node.selected && node.data.groupId)
          .map((node) => node.data.groupId),
      ),
    [nodes],
  );

  const selectedComments = useMemo(
    () => comments.filter((comment) => comment.node_id === selectedId),
    [comments, selectedId],
  );

  const nodeActions = useMemo(
    () => ({ onDrill: handleDrillById }),
    [handleDrillById],
  );

  // 인스펙터 폭 로컬 영속
  useEffect(() => {
    window.localStorage.setItem("bpm.inspectorWidth", String(inspectorWidth));
  }, [inspectorWidth]);

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

  // 아웃라인 클릭 — 노드가 속한 스코프로 이동 후, cubic ease(느림→빠름→느림)로 포커싱
  const handleOutlineSelect = useCallback(
    (id: string) => {
      const flatById = new Map((fullGraph?.nodes ?? []).map((node) => [node.id, node]));
      const flat = flatById.get(id);
      const scopeParentId = flat ? flat.parent_node_id : currentParentId;
      if (scopeParentId === currentParentId) {
        setSelectedId(id);
        setSelectedEdgeId(null);
        // duration이 길수록 React Flow 기본 cubic-in-out 가감속이 또렷하게 보임
        void reactFlow.fitView({ nodes: [{ id }], padding: 0.4, maxZoom: 1.3, duration: 700 });
        return;
      }
      // 다른 스코프 — 루트부터 해당 노드 부모까지 스코프 체인 구성 후 이동, 로드 후 포커싱
      const chainIds: string[] = [];
      let cursor = scopeParentId;
      while (cursor !== null) {
        chainIds.unshift(cursor);
        cursor = flatById.get(cursor)?.parent_node_id ?? null;
      }
      const chain: Scope[] = [{ parentId: null, title: mapName }];
      for (const ancestorId of chainIds) {
        chain.push({ parentId: ancestorId, title: flatById.get(ancestorId)?.title ?? "" });
      }
      focusNodeIdRef.current = id;
      void navigateTo(chain);
    },
    [fullGraph, currentParentId, mapName, reactFlow, navigateTo],
  );

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

  const toolButton =
    "inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <NodeActionsContext.Provider value={nodeActions}>
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
          <button
            className="rounded-sm bg-accent px-3 py-1 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleSave()}
            disabled={readOnly}
          >
            {t("editor.save")}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <EditorLeftSidebar
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((value) => !value)}
          selectedId={selectedId}
          outline={outline}
          onSelectNode={handleOutlineSelect}
          onToggleExpand={handleToggleExpand}
        />
        <div
          ref={canvasContainerRef}
          className="relative flex-1 overflow-hidden bg-canvas"
        >
          {scopes.map((scope, index) => {
            const key = scopeKey(scope);
            const geom = windowGeom[key] ?? defaultGeom(index, bounds);
            const active = index === activeIndex;
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
                  <div className="h-full w-full bg-canvas">
                    <ReactFlow
                      nodes={displayNodes}
                      edges={edges}
                      nodeTypes={nodeTypes}
                      snapToGrid
                      snapGrid={[8, 8]}
                      nodesDraggable={!readOnly}
                      nodesConnectable={!readOnly}
                      onNodesChange={onNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onNodeClick={(_, node) => {
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
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
                      }}
                      onPaneContextMenu={(event) => openMenu(event, "pane", null)}
                      onNodeContextMenu={(event, node) => {
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                        openMenu(event, "node", node.id);
                      }}
                      onEdgeContextMenu={(event, edge) => openMenu(event, "edge", edge.id)}
                      onNodeDragStart={() => pushHistory()}
                      onNodeDrag={handleNodeDrag}
                      onNodeDragStop={(_, node) => {
                        if (!readOnly && dropTargetRef.current && dropTargetRef.current.id !== node.id) {
                          handleZoneDrop(node.id, dropTargetRef.current.id, dropTargetRef.current.zone);
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
                      onBeforeDelete={async () => {
                        if (readOnly) {
                          return false;
                        }
                        pushHistory();
                        return true;
                      }}
                      onNodesDelete={() => scheduleAutoSave()}
                      onEdgesDelete={() => scheduleAutoSave()}
                      onMoveStart={() => setMenu(null)}
                      selectionOnDrag
                      panOnDrag={[1]}
                      panActivationKeyCode="Space"
                      fitView
                    >
                      <ViewportPortal>
                        {groupBoxes.map((box) => (
                          <Fragment key={box.id}>
                            {/* 파스텔 박스 — 노드 뒤로 */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                transform: `translate(${box.x}px, ${box.y}px)`,
                                zIndex: -1,
                              }}
                            >
                              <GroupBox
                                color={box.color}
                                width={box.width}
                                height={box.height}
                                targeted={groupDropTarget === box.id}
                              />
                            </div>
                            {/* 타이틀바 — 노드 위, 박스 상단 좌측 */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                transform: `translate(${box.x + 4}px, ${box.y + 3}px)`,
                                zIndex: 1,
                              }}
                            >
                              <GroupTitleBar
                                id={box.id}
                                label={box.label}
                                color={box.color}
                                width={box.width - 56}
                                readOnly={readOnly}
                                colorPresets={GROUP_COLOR_PRESETS}
                                onRename={renameGroup}
                                onRecolor={recolorGroup}
                                onMoveStart={startGroupMove}
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
                        size={1.2}
                        color="var(--color-canvas-dot)"
                      />
                      <Controls />
                    </ReactFlow>
                  </div>
                ) : (
                  <ScopePreview fullGraph={fullGraph} scopeParentId={scope.parentId} />
                )}
              </ScopeWindow>
            );
          })}
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
              const tileW = 84;
              const tileH = 58;
              const cx = r.left + r.width / 2;
              const cy = r.top + r.height / 2;
              // 링 반경 — 넓힌 타일이 노드를 가리지 않도록 약간 키움
              const radius = Math.max(r.width, r.height) + 32;
              // 타일은 원주 위 4 cardinal 지점
              const tiles = [
                { zone: "front", Icon: ArrowLeft, x: cx - radius, y: cy, label: t("dropzone.front") },
                { zone: "back", Icon: ArrowRight, x: cx + radius, y: cy, label: t("dropzone.back") },
                { zone: "group", Icon: Boxes, x: cx, y: cy - radius, label: t("dropzone.group") },
                { zone: "child", Icon: CornerDownRight, x: cx, y: cy + radius, label: t("dropzone.child") },
              ] as const;
              return (
                <div className="pointer-events-none absolute inset-0 z-[1100]">
                  {/* 기준 셀(B) 원형 링 */}
                  <div
                    className="zone-ring absolute rounded-full border-2 border-accent/40"
                    style={{ left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2 }}
                  />
                  {tiles.map(({ zone, Icon, x, y, label }) => (
                    <div
                      key={zone}
                      className={`zone-pop absolute flex flex-col items-center justify-center gap-1 rounded-md border px-2 text-center shadow-md ${
                        dropTarget.zone === zone
                          ? "border-accent bg-accent-tint text-accent"
                          : "border-hairline bg-surface/95 text-ink-tertiary"
                      }`}
                      style={{ left: x - tileW / 2, top: y - tileH / 2, width: tileW, height: tileH }}
                    >
                      <Icon size={20} strokeWidth={1.5} />
                      <span className="text-fine font-medium leading-tight">{label}</span>
                    </div>
                  ))}
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
          <ShortcutLegend />
        </div>

        {inspectorOpen && (
          <div className="flex min-h-0 shrink-0" style={{ width: inspectorWidth }}>
            <div
              onPointerDown={startInspectorResize}
              className="w-1 shrink-0 cursor-col-resize hover:bg-accent-tint"
              title={t("editor.inspectorToggle")}
            />
            <div className="flex-1 overflow-y-auto border-l border-hairline bg-surface p-4">
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
            <label className="mb-1 mt-3 block text-fine text-ink-tertiary">{t("field.type")}</label>
            <select
              className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
              value={selectedNode.data.nodeType}
              disabled={readOnly}
              onChange={(event) =>
                updateSelectedData({ nodeType: normalizeNodeType(event.target.value) })
              }
            >
              {NODE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
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
            <label className="mb-1 block text-fine text-ink-tertiary">{t("editor.edgeLabel")}</label>
            <input
              className="mb-3 w-full rounded-sm border border-hairline px-2 py-1 text-caption"
              value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
              disabled={readOnly}
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
          </div>
        )}
      </div>
      </div>
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
