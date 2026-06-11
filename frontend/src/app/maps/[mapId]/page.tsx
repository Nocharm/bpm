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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProcessNode } from "@/components/process-node";
import {
  alignSelected,
  distributeSelected,
  layoutWithDagre,
  type AppNode,
  type NodeData,
} from "@/lib/canvas";
import {
  createVersion,
  deleteVersion,
  getGraph,
  getMap,
  renameVersion,
  saveGraph,
  type Graph,
  type GraphEdge,
  type VersionSummary,
} from "@/lib/api";

// 모듈 스코프 — 안정적 식별자 유지 (React Flow 권장)
const nodeTypes: NodeTypes = { process: ProcessNode };

type Scope = { parentId: string | null; title: string };

function toAppNodes(graph: Graph): AppNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: node.pos_x, y: node.pos_y },
    data: {
      label: node.title,
      description: node.description,
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
      node_type: "default",
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
  const [status, setStatus] = useState<string | null>(null);

  const currentParentId = scopes[scopes.length - 1].parentId;

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

  // 현재 스코프(version, parent) 캔버스 로드
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
      } catch (err) {
        if (active) {
          setStatus(err instanceof Error ? err.message : "캔버스를 불러오지 못했습니다");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [versionId, currentParentId, setNodes, setEdges]);

  const saveCurrentScope = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    await saveGraph(versionId, buildGraph(nodes, edges), currentParentId);
    setStatus("저장됨");
  }, [versionId, nodes, edges, currentParentId]);

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

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge({ ...connection, id: crypto.randomUUID() }, current),
      );
    },
    [setEdges],
  );

  const handleAddNode = useCallback(() => {
    const id = crypto.randomUUID();
    setNodes((current) => [
      ...current,
      {
        id,
        type: "process",
        position: { x: 80 + current.length * 30, y: 80 + current.length * 30 },
        data: { label: "새 단계", description: "", hasChildren: false },
      },
    ]);
    setSelectedId(id);
  }, [setNodes]);

  const updateSelectedData = useCallback(
    (patch: Partial<NodeData>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedId
            ? { ...node, data: { ...node.data, ...patch } }
            : node,
        ),
      );
    },
    [selectedId, setNodes],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  const depth = scopes.length - 1;

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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status && <span className="text-sm text-zinc-500">{status}</span>}

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
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={() => void handleCreateVersion()}
          >
            새 버전
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={() => void handleRenameVersion()}
          >
            이름변경
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:text-zinc-300"
            onClick={() => void handleDeleteVersion()}
            disabled={versions.length <= 1}
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
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={() => setNodes((current) => layoutWithDagre(current, edges))}
          >
            자동 정렬
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={() => setNodes((current) => alignSelected(current, "left"))}
          >
            좌측 맞춤
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={() => setNodes((current) => alignSelected(current, "top"))}
          >
            상단 맞춤
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={() => setNodes((current) => distributeSelected(current, "x"))}
          >
            가로 등간격
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={() => setNodes((current) => distributeSelected(current, "y"))}
          >
            세로 등간격
          </button>
          <button
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
            onClick={handleAddNode}
          >
            + 노드
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => void handleSave()}
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
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onNodeDoubleClick={(_, node) => handleDrillIn(node as AppNode)}
            onPaneClick={() => setSelectedId(null)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {selectedNode && (
          <aside className="w-72 border-l border-zinc-200 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-600">노드 편집</h2>
            <label className="mb-1 block text-xs text-zinc-500">제목</label>
            <input
              className="mb-3 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              value={selectedNode.data.label}
              onChange={(event) => updateSelectedData({ label: event.target.value })}
            />
            <label className="mb-1 block text-xs text-zinc-500">설명</label>
            <textarea
              className="h-28 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
              value={selectedNode.data.description}
              onChange={(event) =>
                updateSelectedData({ description: event.target.value })
              }
            />
            <p className="mt-3 text-xs text-zinc-400">
              더블클릭: 하위 프로세스로 진입 · Delete: 선택 삭제
            </p>
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
