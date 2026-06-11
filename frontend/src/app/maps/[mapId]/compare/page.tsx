"use client";

import {
  Background,
  Controls,
  type Edge,
  type NodeTypes,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ProcessNode } from "@/components/process-node";
import { getGraph, getMap, type Graph, type VersionSummary } from "@/lib/api";
import type { AppNode } from "@/lib/canvas";

const nodeTypes: NodeTypes = { process: ProcessNode };

function toNodes(graph: Graph): AppNode[] {
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

function toEdges(graph: Graph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
  }));
}

// 한쪽 버전의 최상위 캔버스를 읽기 전용으로 렌더 (spec §3.4 — 비교 1차: 나란히 보기)
function VersionPane({
  versions,
  initialVersionId,
}: {
  versions: VersionSummary[];
  initialVersionId: number;
}) {
  const [versionId, setVersionId] = useState(initialVersionId);
  const [nodes, setNodes] = useState<AppNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const graph = await getGraph(versionId, null);
      if (active) {
        setNodes(toNodes(graph));
        setEdges(toEdges(graph));
      }
    })();
    return () => {
      active = false;
    };
  }, [versionId]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-zinc-200 px-3 py-2">
        <select
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
          value={versionId}
          onChange={(event) => setVersionId(Number(event.target.value))}
          aria-label="비교 버전 선택"
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const detail = await getMap(mapId);
      if (active) {
        setMapName(detail.name);
        setVersions(detail.versions);
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-zinc-200 px-4 py-2">
        <Link href={`/maps/${mapId}`} className="text-sm text-blue-700 hover:underline">
          ← 편집기
        </Link>
        <h1 className="font-medium">{mapName} — 버전 비교</h1>
      </header>
      {versions.length > 0 && (
        <div className="flex flex-1 divide-x divide-zinc-200">
          <VersionPane versions={versions} initialVersionId={versions[0].id} />
          <VersionPane
            versions={versions}
            initialVersionId={versions[1]?.id ?? versions[0].id}
          />
        </div>
      )}
    </div>
  );
}
