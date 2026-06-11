"use client";

import {
  addEdge,
  Background,
  Controls,
  type Connection,
  type Edge,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommentSection } from "@/components/comment-section";
import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";
import { ProcessNode } from "@/components/process-node";
import {
  alignSelected,
  distributeSelected,
  layoutWithDagre,
  normalizeNodeType,
  NODE_HEIGHT,
  NODE_TYPE_OPTIONS,
  NODE_WIDTH,
  type AppNode,
  type NodeData,
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
  type VersionSummary,
} from "@/lib/api";
import { exportCanvasPng } from "@/lib/export";
import { matchesQuery } from "@/lib/hangul";

// 모듈 스코프 — 안정적 식별자 유지 (React Flow 권장)
const nodeTypes: NodeTypes = { process: ProcessNode };

// 색 프리셋 — 첫 항목(빈 값)은 타입 기본색
const COLOR_PRESETS = [
  "",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#18181b",
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
      hasChildren: node.has_children ?? false,
    },
  }));
}

function toAppEdges(graph: Graph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
  }));
}

function buildGraph(nodes: AppNode[], edges: Edge[]): Graph {
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
    })),
    edges: edges.map<GraphEdge>((edge) => ({
      id: edge.id,
      source_node_id: edge.source,
      target_node_id: edge.target,
      label: typeof edge.label === "string" ? edge.label : "",
    })),
  };
}

function MapEditor({ mapId }: { mapId: number }) {
  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([{ parentId: null, title: "홈" }]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
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

  // 다른 사용자가 유효한 체크아웃을 쥐고 있으면 읽기 전용 (코멘트 작성은 허용)
  const readOnly = checkout !== null && !checkout.mine;

  const reactFlow = useReactFlow();
  const currentParentId = scopes[scopes.length - 1].parentId;

  // 이벤트 핸들러/타이머에서 최신 상태를 읽기 위한 미러 — setState 클로저 stale 방지
  const nodesRef = useRef<AppNode[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

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
        buildGraph(nodesRef.current, edgesRef.current),
        currentParentId,
      );
      dirtyRef.current = false;
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      throw err;
    }
  }, [versionId, currentParentId, readOnly]);

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
      } catch (err) {
        if (active) {
          setStatus(err instanceof Error ? err.message : "맵을 불러오지 못했습니다");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

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
              duration: 300,
              maxZoom: 1.25,
            });
          }, 80);
        }
      } catch (err) {
        if (active) {
          setStatus(err instanceof Error ? err.message : "캔버스를 불러오지 못했습니다");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [versionId, currentParentId, setNodes, setEdges, reactFlow]);

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
          setStatus(err instanceof Error ? err.message : "검색에 실패했습니다");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [searchQuery, versionId, mapName]);

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
          setStatus(err instanceof Error ? err.message : "체크아웃에 실패했습니다");
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
  }, [versionId]);

  const handleForceCheckout = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    try {
      const state = await acquireCheckout(versionId, true);
      checkoutMineRef.current = state.mine;
      setCheckout(state);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "강제 체크아웃에 실패했습니다");
    }
  }, [versionId]);

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
        setStatus(err instanceof Error ? err.message : "코멘트 등록에 실패했습니다");
      }
    },
    [versionId, selectedId, refreshComments],
  );

  const handleToggleComment = useCallback(
    async (comment: CommentItem) => {
      try {
        await updateComment(comment.id, !comment.resolved);
        await refreshComments();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "코멘트 변경에 실패했습니다");
      }
    },
    [refreshComments],
  );

  const handleDeleteComment = useCallback(
    async (comment: CommentItem) => {
      try {
        await deleteComment(comment.id);
        await refreshComments();
      } catch (err) {
        setStatus(
          err instanceof Error ? err.message : "코멘트 삭제에 실패했습니다 (작성자만 가능)",
        );
      }
    },
    [refreshComments],
  );

  const handleSave = useCallback(async () => {
    try {
      await saveCurrentScope();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "저장에 실패했습니다");
    }
  }, [saveCurrentScope]);

  // 계층 진입/이탈 시 현재 스코프를 저장하고 이동 (편집 손실 방지)
  const navigateTo = useCallback(
    async (nextScopes: Scope[]) => {
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "저장에 실패했습니다");
        return;
      }
      setScopes(nextScopes);
    },
    [saveCurrentScope],
  );

  const handleDrillIn = useCallback(
    (node: AppNode) => {
      void navigateTo([...scopes, { parentId: node.id, title: node.data.label }]);
    },
    [navigateTo, scopes],
  );

  const handleBreadcrumb = useCallback(
    (index: number) => {
      if (index === scopes.length - 1) {
        return;
      }
      void navigateTo(scopes.slice(0, index + 1));
    },
    [navigateTo, scopes],
  );

  // 버전 전환 — 현재 스코프 저장 후 루트로 리셋해 새 버전 캔버스를 로드
  const switchVersion = useCallback(
    async (nextVersionId: number) => {
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "저장에 실패했습니다");
        return;
      }
      setVersionId(nextVersionId);
      setScopes([{ parentId: null, title: mapName }]);
    },
    [saveCurrentScope, mapName],
  );

  const handleCreateVersion = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    const label = window.prompt("새 버전 이름 (현재 버전을 복제합니다)", "To-Be");
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
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "버전 생성에 실패했습니다");
    }
  }, [versionId, mapId, mapName, saveCurrentScope]);

  const handleRenameVersion = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    const current = versions.find((version) => version.id === versionId);
    const label = window.prompt("버전 이름 변경", current?.label ?? "");
    if (!label?.trim()) {
      return;
    }
    try {
      await renameVersion(versionId, label.trim());
      const detail = await getMap(mapId);
      setVersions(detail.versions);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "이름 변경에 실패했습니다");
    }
  }, [versionId, versions, mapId]);

  const handleDeleteVersion = useCallback(async () => {
    if (versionId === null || versions.length <= 1) {
      return;
    }
    if (!window.confirm("이 버전을 삭제할까요? 되돌릴 수 없습니다.")) {
      return;
    }
    try {
      await deleteVersion(versionId);
      const detail = await getMap(mapId);
      setVersions(detail.versions);
      setVersionId(detail.versions[0].id);
      setScopes([{ parentId: null, title: mapName }]);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "버전 삭제에 실패했습니다");
    }
  }, [versionId, versions, mapId, mapName]);

  // ── 편집 조작 (모두 히스토리 + 자동 저장 대상) ─────────

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        addEdge({ ...connection, id: crypto.randomUUID() }, current),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setEdges, scheduleAutoSave],
  );

  // screen 좌표가 주어지면(컨텍스트 메뉴) 커서가 노드 중심이 되도록 생성
  const handleAddNode = useCallback(
    (screen: { x: number; y: number } | null) => {
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
      }
      setNodes((current) => [
        ...current,
        {
          id,
          type: "process",
          position,
          data: {
            label: "새 단계",
            description: "",
            nodeType: "process",
            color: "",
            assignee: "",
            department: "",
            system: "",
            duration: "",
            hasChildren: false,
          },
        },
      ]);
      setSelectedId(id);
      setSelectedEdgeId(null);
      scheduleAutoSave();
    },
    [readOnly, pushHistory, reactFlow, setNodes, scheduleAutoSave],
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
      setStatus(err instanceof Error ? err.message : "PNG 내보내기에 실패했습니다");
    }
  }, [versions, versionId, mapName]);

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
      return [
        {
          label: "+ 노드 추가",
          onSelect: () => handleAddNode({ x: menu.x, y: menu.y }),
        },
        {
          label: "자동 정렬",
          onSelect: () =>
            applyNodesTransform((current) => layoutWithDagre(current, edgesRef.current)),
        },
      ];
    }
    if (menu.kind === "node") {
      const deleteItems: ContextMenuItem[] = readOnly
        ? []
        : [
            {
              label: "삭제",
              shortcut: "⌫",
              danger: true,
              onSelect: () => {
                if (menu.targetId) {
                  void reactFlow.deleteElements({ nodes: [{ id: menu.targetId }] });
                }
              },
            },
          ];
      return [
        {
          label: "하위 프로세스 열기",
          shortcut: "더블클릭",
          onSelect: () => {
            // ref 조회는 이벤트 시점에 — 렌더 중 ref 접근 금지 (react-hooks/refs)
            const node = nodesRef.current.find((item) => item.id === menu.targetId);
            if (node) {
              handleDrillIn(node);
            }
          },
        },
        ...deleteItems,
      ];
    }
    return [
      {
        label: "라벨 편집",
        onSelect: () => {
          setSelectedEdgeId(menu.targetId);
          setSelectedId(null);
        },
      },
      {
        label: "삭제",
        shortcut: "⌫",
        danger: true,
        onSelect: () => {
          if (menu.targetId) {
            void reactFlow.deleteElements({ edges: [{ id: menu.targetId }] });
          }
        },
      },
    ];
  }, [menu, readOnly, handleAddNode, applyNodesTransform, handleDrillIn, reactFlow]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );
  const depth = scopes.length - 1;

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

  const selectedComments = useMemo(
    () => comments.filter((comment) => comment.node_id === selectedId),
    [comments, selectedId],
  );

  const toolButton =
    "rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 px-4 py-2">
        <Link href="/" className="text-sm text-blue-700 hover:underline">
          ← 목록
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {scopes.map((scope, index) => (
            <span key={scope.parentId ?? "root"} className="flex items-center gap-1">
              {index > 0 && <span className="text-zinc-400">›</span>}
              <button
                className={
                  index === scopes.length - 1
                    ? "font-medium text-zinc-800"
                    : "text-blue-700 hover:underline"
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
            className="w-56 rounded border border-zinc-300 px-2 py-1 text-sm"
            placeholder="노드 검색 — 초성 가능 (Ctrl+K)"
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
            <ul className="absolute left-0 top-full z-50 mt-1 max-h-72 w-80 overflow-auto rounded border border-zinc-200 bg-white py-1 shadow-lg">
              {searchResults.map((result, index) => (
                <li key={result.node.id}>
                  <button
                    className={`block w-full px-3 py-1.5 text-left text-sm ${
                      index === searchIndex ? "bg-zinc-100" : ""
                    }`}
                    onMouseDown={(event) => {
                      // blur로 드롭다운이 닫히기 전에 선택 처리
                      event.preventDefault();
                      handleSearchSelect(result);
                    }}
                    onMouseEnter={() => setSearchIndex(index)}
                  >
                    <span className="font-medium text-zinc-800">{result.node.title}</span>
                    <span className="ml-2 text-xs text-zinc-400">{result.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {readOnly && checkout?.checked_out_by && (
            <span className="flex items-center gap-2 rounded bg-amber-100 px-2 py-1 text-sm text-amber-900">
              📝 {checkout.checked_out_by}님이 편집 중 — 읽기 전용
              <button
                className="rounded bg-red-500 px-1.5 py-0.5 text-xs text-white hover:bg-red-600"
                onClick={() => void handleForceCheckout()}
              >
                강제 편집
              </button>
            </span>
          )}
          {checkout?.mine && (
            <span className="text-xs text-zinc-400" title="이 버전을 편집 중입니다">
              🔒 편집 중
            </span>
          )}
          {status && <span className="text-sm text-red-600">{status}</span>}
          {saveState === "saving" && (
            <span className="text-sm text-zinc-400">저장 중…</span>
          )}
          {saveState === "saved" && (
            <span className="text-sm text-green-600">저장됨 ✓</span>
          )}
          {saveState === "error" && (
            <span className="text-sm text-red-600">저장 실패 — 저장 버튼으로 재시도</span>
          )}

          <select
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
            value={versionId ?? ""}
            onChange={(event) => void switchVersion(Number(event.target.value))}
            aria-label="버전 선택"
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
              </option>
            ))}
          </select>
          <button className={toolButton} onClick={() => void handleCreateVersion()}>
            새 버전
          </button>
          <button className={toolButton} onClick={() => void handleRenameVersion()}>
            이름변경
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:text-zinc-300"
            onClick={() => void handleDeleteVersion()}
            disabled={versions.length <= 1 || readOnly}
          >
            버전삭제
          </button>
          <Link
            href={`/maps/${mapId}/compare`}
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
          >
            비교
          </Link>

          <span className="mx-1 h-5 w-px bg-zinc-200" />

          <button
            className={toolButton}
            onClick={undo}
            disabled={readOnly || historySize.past === 0}
            title="실행취소 (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            className={toolButton}
            onClick={redo}
            disabled={readOnly || historySize.future === 0}
            title="다시실행 (Ctrl+Shift+Z)"
          >
            ↷
          </button>

          <button
            className={toolButton}
            disabled={readOnly}
            onClick={() =>
              applyNodesTransform((current) => layoutWithDagre(current, edgesRef.current))
            }
          >
            자동 정렬
          </button>
          <button
            className={toolButton}
            disabled={readOnly}
            onClick={() => applyNodesTransform((current) => alignSelected(current, "left"))}
          >
            좌측 맞춤
          </button>
          <button
            className={toolButton}
            disabled={readOnly}
            onClick={() => applyNodesTransform((current) => alignSelected(current, "top"))}
          >
            상단 맞춤
          </button>
          <button
            className={toolButton}
            disabled={readOnly}
            onClick={() => applyNodesTransform((current) => distributeSelected(current, "x"))}
          >
            가로 등간격
          </button>
          <button
            className={toolButton}
            disabled={readOnly}
            onClick={() => applyNodesTransform((current) => distributeSelected(current, "y"))}
          >
            세로 등간격
          </button>
          <button
            className={toolButton}
            disabled={readOnly}
            onClick={() => handleAddNode(null)}
          >
            + 노드
          </button>
          <button className={toolButton} onClick={() => void handleExportPng()}>
            PNG
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleSave()}
            disabled={readOnly}
          >
            저장
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* 계층 깊이 시각화 — 뒤에 살짝 보이는 카드 스택 */}
        <div className="relative flex-1">
          {depth > 0 && (
            <>
              <div className="pointer-events-none absolute inset-2 -z-10 rounded border border-zinc-200 bg-zinc-50" />
              <div className="pointer-events-none absolute inset-1 -z-10 rounded border border-zinc-200 bg-white" />
            </>
          )}
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
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
            onNodeDoubleClick={(_, node) => handleDrillIn(node as AppNode)}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectedEdgeId(null);
              setMenu(null);
            }}
            onPaneContextMenu={(event) => openMenu(event, "pane", null)}
            onNodeContextMenu={(event, node) => {
              setSelectedId(node.id);
              setSelectedEdgeId(null);
              openMenu(event, "node", node.id);
            }}
            onEdgeContextMenu={(event, edge) => openMenu(event, "edge", edge.id)}
            onNodeDragStart={() => pushHistory()}
            onNodeDragStop={() => scheduleAutoSave()}
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
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menuItems}
              onClose={() => setMenu(null)}
            />
          )}
        </div>

        {selectedNode && (
          <aside className="w-80 overflow-y-auto border-l border-zinc-200 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-600">노드 편집</h2>
            <label className="mb-1 block text-xs text-zinc-500">제목</label>
            <input
              className="mb-3 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              value={selectedNode.data.label}
              disabled={readOnly}
              onChange={(event) =>
                updateSelectedData({ label: event.target.value }, true)
              }
            />
            <label className="mb-1 block text-xs text-zinc-500">설명</label>
            <textarea
              className="h-28 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              value={selectedNode.data.description}
              disabled={readOnly}
              onChange={(event) =>
                updateSelectedData({ description: event.target.value }, true)
              }
            />
            <label className="mb-1 mt-3 block text-xs text-zinc-500">타입</label>
            <select
              className="mb-3 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              value={selectedNode.data.nodeType}
              disabled={readOnly}
              onChange={(event) =>
                updateSelectedData({ nodeType: normalizeNodeType(event.target.value) })
              }
            >
              {NODE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-xs text-zinc-500">색상</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset || "default"}
                  title={preset || "기본색"}
                  aria-label={`색상 ${preset || "기본"}`}
                  className={`h-5 w-5 rounded border ${
                    selectedNode.data.color === preset
                      ? "ring-2 ring-blue-400"
                      : "border-zinc-300"
                  }`}
                  style={{ backgroundColor: preset || "#ffffff" }}
                  disabled={readOnly}
                  onClick={() => updateSelectedData({ color: preset })}
                />
              ))}
            </div>
            <input
              key={`${selectedNode.id}-${selectedNode.data.color}`}
              className="mb-3 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              defaultValue={selectedNode.data.color}
              disabled={readOnly}
              placeholder="#RRGGBB 직접 입력 후 Enter"
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
            <details className="mb-3 rounded border border-zinc-200 px-2 py-1.5">
              <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                BPM 속성
              </summary>
              <label className="mb-1 mt-2 block text-xs text-zinc-500">담당자</label>
              <input
                className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
                value={selectedNode.data.assignee}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ assignee: event.target.value }, true)
                }
              />
              <label className="mb-1 block text-xs text-zinc-500">부서</label>
              <input
                className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
                value={selectedNode.data.department}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ department: event.target.value }, true)
                }
              />
              <label className="mb-1 block text-xs text-zinc-500">시스템</label>
              <input
                className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
                value={selectedNode.data.system}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ system: event.target.value }, true)
                }
              />
              <label className="mb-1 block text-xs text-zinc-500">소요시간</label>
              <input
                className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
                value={selectedNode.data.duration}
                disabled={readOnly}
                onChange={(event) =>
                  updateSelectedData({ duration: event.target.value }, true)
                }
                placeholder="예: 2일"
              />
            </details>
            <details open className="mb-3 rounded border border-zinc-200 px-2 py-1.5">
              <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                코멘트
                {selectedComments.some((comment) => !comment.resolved) &&
                  ` (미해결 ${selectedComments.filter((comment) => !comment.resolved).length})`}
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
            <p className="mt-3 text-xs text-zinc-400">
              더블클릭: 하위 프로세스로 진입 · 우클릭: 메뉴 · Ctrl+Z: 실행취소
            </p>
          </aside>
        )}

        {!selectedNode && selectedEdge && (
          <aside className="w-72 border-l border-zinc-200 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-600">엣지 편집</h2>
            <label className="mb-1 block text-xs text-zinc-500">라벨 (분기 조건 등)</label>
            <input
              className="mb-3 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
              disabled={readOnly}
              onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
            />
            <p className="mt-3 text-xs text-zinc-400">우클릭: 메뉴 · Ctrl+Z: 실행취소</p>
          </aside>
        )}
      </div>
    </div>
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
