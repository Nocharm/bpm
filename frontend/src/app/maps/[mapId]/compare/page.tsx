"use client";

// 버전 비교 화면 — 두 버전을 나란히 렌더하고 추가/삭제/변경을 하이라이트 (spec §3.4, §7 Phase B).

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
import { useEffect, useMemo, useState } from "react";

import { ProcessNode } from "@/components/process-node";
import {
  getFullGraph,
  getMap,
  type VersionGraph,
  type VersionSummary,
} from "@/lib/api";
import { normalizeNodeType, type AppNode } from "@/lib/canvas";
import {
  computeVersionDiff,
  type ChangedField,
  type NodeDiffEntry,
  type DiffStatus,
  type VersionDiff,
} from "@/lib/diff";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const nodeTypes: NodeTypes = { process: ProcessNode };

// 필드 키 → 번역 키 매핑 — t() 의존성 없음
const FIELD_MSG: Record<ChangedField, MessageKey> = {
  title: "field.title",
  description: "field.description",
  type: "field.type",
  color: "field.color",
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
  location: "field.location",
};

// 최상위 캔버스 노드만 렌더 — 하위 변경은 ⚡ 뱃지로 표시
function buildPaneNodes(
  graph: VersionGraph,
  nodeStatus: Map<string, NodeDiffEntry>,
  descendantChanged: Set<string>,
  buildDiffNote: (entry: NodeDiffEntry) => string,
): AppNode[] {
  const parentIds = new Set(
    graph.nodes.map((node) => node.parent_node_id).filter(Boolean),
  );
  return graph.nodes
    .filter((node) => node.parent_node_id === null)
    .map((node) => {
      const entry = nodeStatus.get(node.id);
      return {
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
          hasChildren: parentIds.has(node.id),
          diffStatus: entry?.status,
          diffNote: entry ? buildDiffNote(entry) : undefined,
          hasDescendantChange: descendantChanged.has(node.id),
        },
      };
    });
}

function buildPaneEdges(
  graph: VersionGraph,
  edgeStatus: Map<string, DiffStatus>,
): Edge[] {
  const topIds = new Set(
    graph.nodes.filter((node) => node.parent_node_id === null).map((node) => node.id),
  );
  return graph.edges
    .filter(
      (edge) => topIds.has(edge.source_node_id) && topIds.has(edge.target_node_id),
    )
    .map((edge) => {
      const status = edgeStatus.get(edge.id);
      return {
        id: edge.id,
        source: edge.source_node_id,
        target: edge.target_node_id,
        label: edge.label || undefined,
        style:
          status === "added"
            ? { stroke: "#22c55e", strokeWidth: 2 }
            : status === "removed"
              ? { stroke: "#ef4444", strokeWidth: 2, strokeDasharray: "6 3" }
              : undefined,
      };
    });
}

function VersionPane({
  versions,
  versionId,
  onChangeVersion,
  nodes,
  edges,
}: {
  versions: VersionSummary[];
  versionId: number;
  onChangeVersion: (id: number) => void;
  nodes: AppNode[];
  edges: Edge[];
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-zinc-200 px-3 py-2">
        <select
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
          value={versionId}
          onChange={(event) => onChangeVersion(Number(event.target.value))}
          aria-label={t("compare.selectVersionAria")}
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

function DiffLegend() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 text-xs text-zinc-600">
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-green-500" /> {t("compare.legendAdded")}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-red-500" /> {t("compare.legendRemoved")}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-amber-500" /> {t("compare.legendChanged")}
      </span>
      <span className="flex items-center gap-1">⚡ {t("compare.childChanged")}</span>
    </div>
  );
}

function DiffEntryList({ diff }: { diff: VersionDiff }) {
  const { t } = useI18n();

  const entryBadges: Record<DiffStatus, { label: string; className: string }> = {
    added: { label: t("compare.legendAdded"), className: "bg-green-100 text-green-700" },
    removed: { label: t("compare.legendRemoved"), className: "bg-red-100 text-red-700" },
    changed: { label: t("compare.legendChanged"), className: "bg-amber-100 text-amber-700" },
  };

  if (diff.entries.length === 0) {
    return (
      <div className="border-t border-zinc-200 px-4 py-2 text-sm text-zinc-500">
        {t("compare.identical")}
      </div>
    );
  }
  const count = (status: DiffStatus) =>
    diff.entries.filter((entry) => entry.status === status).length;
  return (
    <div className="max-h-44 overflow-auto border-t border-zinc-200 px-4 py-2">
      <div className="mb-1 text-xs text-zinc-500">
        {t("compare.summary", {
          a: count("added"),
          r: count("removed"),
          c: count("changed"),
        })}
      </div>
      <ul className="space-y-1 text-sm">
        {diff.entries.map((entry, index) => {
          const badge = entryBadges[entry.status];
          return (
            <li key={`${entry.status}-${entry.leftNodeId ?? ""}-${entry.rightNodeId ?? index}`}>
              <span
                className={`mr-2 rounded px-1.5 py-0.5 text-xs ${badge.className}`}
              >
                {badge.label}
              </span>
              {entry.path && <span className="text-zinc-400">{entry.path} › </span>}
              <span className="font-medium text-zinc-800">{entry.title}</span>
              {entry.changedFields.length > 0 && (
                <span className="ml-2 text-xs text-zinc-500">
                  ({entry.changedFields.map((f) => t(FIELD_MSG[f])).join(", ")})
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ComparePage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);
  const { t } = useI18n();

  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [leftId, setLeftId] = useState<number | null>(null);
  const [rightId, setRightId] = useState<number | null>(null);
  const [leftGraph, setLeftGraph] = useState<VersionGraph | null>(null);
  const [rightGraph, setRightGraph] = useState<VersionGraph | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const detail = await getMap(mapId);
      if (active) {
        setMapName(detail.name);
        setVersions(detail.versions);
        setLeftId(detail.versions[0].id);
        setRightId(detail.versions[1]?.id ?? detail.versions[0].id);
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  useEffect(() => {
    if (leftId === null) {
      return;
    }
    let active = true;
    void (async () => {
      const graph = await getFullGraph(leftId);
      if (active) {
        setLeftGraph(graph);
      }
    })();
    return () => {
      active = false;
    };
  }, [leftId]);

  useEffect(() => {
    if (rightId === null) {
      return;
    }
    let active = true;
    void (async () => {
      const graph = await getFullGraph(rightId);
      if (active) {
        setRightGraph(graph);
      }
    })();
    return () => {
      active = false;
    };
  }, [rightId]);

  const diff = useMemo(
    () =>
      leftGraph && rightGraph ? computeVersionDiff(leftGraph, rightGraph) : null,
    [leftGraph, rightGraph],
  );

  // buildDiffNote 의존성: t (언어 변경 시 재생성)
  const buildDiffNote = useMemo(
    () =>
      (entry: NodeDiffEntry): string => {
        if (entry.status === "changed") {
          return t("compare.changedFields", {
            fields: entry.changedFields.map((f) => t(FIELD_MSG[f])).join(", "),
          });
        }
        const diffNotes: Record<DiffStatus, string> = {
          added: t("compare.statusAdded"),
          removed: t("compare.statusRemoved"),
          changed: t("compare.statusChanged"),
        };
        return diffNotes[entry.status];
      },
    [t],
  );

  const leftNodes = useMemo(
    () =>
      leftGraph && diff
        ? buildPaneNodes(leftGraph, diff.leftNodeStatus, diff.leftDescendantChanged, buildDiffNote)
        : [],
    [leftGraph, diff, buildDiffNote],
  );
  const rightNodes = useMemo(
    () =>
      rightGraph && diff
        ? buildPaneNodes(rightGraph, diff.rightNodeStatus, diff.rightDescendantChanged, buildDiffNote)
        : [],
    [rightGraph, diff, buildDiffNote],
  );
  const leftEdges = useMemo(
    () => (leftGraph && diff ? buildPaneEdges(leftGraph, diff.leftEdgeStatus) : []),
    [leftGraph, diff],
  );
  const rightEdges = useMemo(
    () => (rightGraph && diff ? buildPaneEdges(rightGraph, diff.rightEdgeStatus) : []),
    [rightGraph, diff],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-zinc-200 px-4 py-2">
        <Link href={`/maps/${mapId}`} className="text-sm text-blue-700 hover:underline">
          ← {t("compare.editorLink")}
        </Link>
        <h1 className="font-medium">{mapName} — {t("compare.title")}</h1>
        <span className="text-xs text-zinc-400">{t("compare.subtitle")}</span>
        <div className="ml-auto">
          <DiffLegend />
        </div>
      </header>
      {leftId !== null && rightId !== null && versions.length > 0 && (
        <>
          <div className="flex flex-1 divide-x divide-zinc-200">
            <VersionPane
              versions={versions}
              versionId={leftId}
              onChangeVersion={setLeftId}
              nodes={leftNodes}
              edges={leftEdges}
            />
            <VersionPane
              versions={versions}
              versionId={rightId}
              onChangeVersion={setRightId}
              nodes={rightNodes}
              edges={rightEdges}
            />
          </div>
          {diff && <DiffEntryList diff={diff} />}
        </>
      )}
    </div>
  );
}
