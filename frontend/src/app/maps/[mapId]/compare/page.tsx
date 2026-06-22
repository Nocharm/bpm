"use client";

// 버전 비교 화면 — 두 버전을 하나의 병합 캔버스로 렌더. 저장 좌표 무시·dagre 연결 기반 배치,
// 추가/삭제 엣지와 추가/삭제/변경 노드를 색으로 표현하고 변경 목록 클릭으로 포커스. (재작성: spec 2026-06-23)

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProcessNode } from "@/components/process-node";
import {
  getFullGraph,
  getMap,
  type VersionGraph,
  type VersionSummary,
} from "@/lib/api";
import { layoutWithDagre, normalizeNodeType, type AppNode } from "@/lib/canvas";
import type { ChangedField } from "@/lib/diff";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  buildMergedGraph,
  type MergedEdge,
  type MergedNode,
  type MergedNodeStatus,
} from "@/lib/merge-diff";

const nodeTypes: NodeTypes = { process: ProcessNode };

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

// 병합 노드 status → ProcessNode diffStatus (unchanged는 중립=undefined)
function toDiffStatus(status: MergedNodeStatus): "added" | "removed" | "changed" | undefined {
  return status === "unchanged" ? undefined : status;
}

// union 노드를 좌표 없는 AppNode로 — 이후 layoutWithDagre가 위치 산정
function buildAppNodes(
  merged: MergedNode[],
  noteOf: (node: MergedNode) => string | undefined,
): AppNode[] {
  return merged.map((m) => ({
    id: m.id,
    type: "process",
    position: { x: 0, y: 0 },
    data: {
      label: m.node.title,
      description: m.node.description,
      nodeType: normalizeNodeType(m.node.node_type),
      color: m.node.color,
      assignee: m.node.assignee,
      department: m.node.department,
      system: m.node.system,
      duration: m.node.duration,
      groupIds: m.node.group_ids ?? [],
      hasChildren: false,
      diffStatus: toDiffStatus(m.status),
      diffNote: noteOf(m),
    },
  }));
}

function buildAppEdges(merged: MergedEdge[]): Edge[] {
  return merged.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    type: "smoothstep" as const,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-border-strong)" },
    style:
      e.status === "added"
        ? { stroke: "var(--color-added)", strokeWidth: 2 }
        : e.status === "removed"
          ? { stroke: "var(--color-removed)", strokeWidth: 2, strokeDasharray: "6 3" }
          : undefined,
  }));
}

function VersionSelect({
  label,
  versions,
  value,
  onChange,
}: {
  label: string;
  versions: VersionSummary[];
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-caption text-ink-secondary">
      {label}
      <select
        className="rounded-sm border border-hairline px-2 py-1 text-caption"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffLegend() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 text-ink-secondary text-caption" data-id="compare-legend">
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-added" /> {t("compare.legendAdded")}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-removed" /> {t("compare.legendRemoved")}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-changed" /> {t("compare.legendChanged")}
      </span>
    </div>
  );
}

interface ChangeItem {
  key: string;
  focusId: string;
  status: MergedNodeStatus;
  title: string;
  detail?: string;
}

function ComparePane({
  mapId,
  mapName,
  versions,
  baseId,
  targetId,
  baseGraph,
  targetGraph,
  onChangeBase,
  onChangeTarget,
}: {
  mapId: number;
  mapName: string;
  versions: VersionSummary[];
  baseId: number;
  targetId: number;
  baseGraph: VersionGraph;
  targetGraph: VersionGraph;
  onChangeBase: (id: number) => void;
  onChangeTarget: (id: number) => void;
}) {
  const { t } = useI18n();
  const flow = useReactFlow();
  const [focusId, setFocusId] = useState<string | null>(null);

  const merged = useMemo(
    () => buildMergedGraph(baseGraph, targetGraph),
    [baseGraph, targetGraph],
  );

  const noteOf = useCallback(
    (m: MergedNode): string | undefined => {
      if (m.status === "changed") {
        return t("compare.changedFields", {
          fields: m.changedFields.map((f) => t(FIELD_MSG[f])).join(", "),
        });
      }
      if (m.status === "added") return t("compare.statusAdded");
      if (m.status === "removed") return t("compare.statusRemoved");
      return undefined;
    },
    [t],
  );

  // 좌표 없는 union 노드 → dagre 배치 (연결 기반, 저장 pos 무시). focus와 무관하게 1회만 계산.
  const positioned = useMemo(
    () => layoutWithDagre(buildAppNodes(merged.nodes, noteOf), buildAppEdges(merged.edges)),
    [merged, noteOf],
  );

  // 포커스된 노드만 selected 표시 (재레이아웃 없이 얕은 갱신)
  const laidNodes = useMemo(
    () => positioned.map((node) => ({ ...node, selected: focusId === node.id })),
    [positioned, focusId],
  );

  // 포커스된 엣지는 굵게 강조
  const appEdges = useMemo(
    () =>
      buildAppEdges(merged.edges).map((edge) =>
        focusId === edge.id
          ? { ...edge, selected: true, style: { ...(edge.style ?? {}), strokeWidth: 3 } }
          : edge,
      ),
    [merged, focusId],
  );

  const titleByKey = useMemo(
    () => new Map(merged.nodes.map((m) => [m.id, m.node.title])),
    [merged],
  );

  const nodeChanges: ChangeItem[] = useMemo(
    () =>
      merged.nodes
        .filter((m) => m.status !== "unchanged")
        .map((m) => ({
          key: `n-${m.id}`,
          focusId: m.id,
          status: m.status,
          title: m.node.title,
          detail:
            m.status === "changed"
              ? m.changedFields.map((f) => t(FIELD_MSG[f])).join(", ")
              : undefined,
        })),
    [merged, t],
  );

  const edgeChanges: ChangeItem[] = useMemo(
    () =>
      merged.edges
        .filter((e) => e.status !== "unchanged")
        .map((e) => ({
          key: `e-${e.id}`,
          focusId: e.id,
          status: e.status,
          title: `${titleByKey.get(e.source) ?? "?"} → ${titleByKey.get(e.target) ?? "?"}`,
          detail: e.status === "added" ? t("compare.edgeAdded") : t("compare.edgeRemoved"),
        })),
    [merged, titleByKey, t],
  );

  const focusNode = useCallback(
    (id: string) => {
      setFocusId(id);
      void flow.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.3, padding: 0.4 });
    },
    [flow],
  );

  const focusEdge = useCallback(
    (edge: MergedEdge) => {
      setFocusId(edge.id);
      void flow.fitView({
        nodes: [{ id: edge.source }, { id: edge.target }],
        duration: 400,
        maxZoom: 1.3,
        padding: 0.4,
      });
    },
    [flow],
  );

  const badgeClass: Record<MergedNodeStatus, string> = {
    added: "bg-added/10 text-added",
    removed: "bg-removed/10 text-removed",
    changed: "bg-changed/10 text-changed",
    unchanged: "",
  };
  const badgeLabel: Record<MergedNodeStatus, string> = {
    added: t("compare.legendAdded"),
    removed: t("compare.legendRemoved"),
    changed: t("compare.legendChanged"),
    unchanged: "",
  };

  const hasChanges = nodeChanges.length + edgeChanges.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-hairline px-4 py-2">
        <Link href={`/maps/${mapId}`} className="text-caption text-accent hover:underline">
          ← {t("compare.editorLink")}
        </Link>
        <h1 className="text-tagline text-ink font-medium">
          {mapName} — {t("compare.title")}
        </h1>
        <div className="flex items-center gap-3">
          <VersionSelect
            label={t("compare.base")}
            versions={versions}
            value={baseId}
            onChange={onChangeBase}
          />
          <span className="text-ink-tertiary">→</span>
          <VersionSelect
            label={t("compare.target")}
            versions={versions}
            value={targetId}
            onChange={onChangeTarget}
          />
        </div>
        <div className="ml-auto">
          <DiffLegend />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 bg-canvas" data-id="compare-canvas">
          <ReactFlow
            nodes={laidNodes}
            edges={appEdges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.2}
              color="var(--color-canvas-dot)"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside
          className="w-72 shrink-0 overflow-auto border-l border-hairline px-3 py-2"
          data-id="compare-changes"
        >
          <div className="mb-2 text-caption-strong text-ink">{t("compare.changes")}</div>
          {!hasChanges && (
            <div className="text-caption text-ink-tertiary">{t("compare.identical")}</div>
          )}
          <ul className="space-y-1 text-body">
            {nodeChanges.map((c) => (
              <li key={c.key}>
                <button
                  className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                  onClick={() => focusNode(c.focusId)}
                >
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-caption ${badgeClass[c.status]}`}>
                    {badgeLabel[c.status]}
                  </span>
                  <span className="text-ink">{c.title}</span>
                  {c.detail && <span className="ml-1 text-caption text-ink-secondary">({c.detail})</span>}
                </button>
              </li>
            ))}
            {edgeChanges.map((c) => {
              const edge = merged.edges.find((e) => e.id === c.focusId);
              return (
                <li key={c.key}>
                  <button
                    className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                    onClick={() => edge && focusEdge(edge)}
                  >
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-caption ${badgeClass[c.status]}`}>
                      {c.detail}
                    </span>
                    <span className="text-ink-secondary">{c.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [baseId, setBaseId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [baseGraph, setBaseGraph] = useState<VersionGraph | null>(null);
  const [targetGraph, setTargetGraph] = useState<VersionGraph | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const detail = await getMap(mapId);
      if (!active) return;
      setMapName(detail.name);
      setVersions(detail.versions);
      // 기본: base=가장 오래된(published 후보), target=최신
      setBaseId(detail.versions[0].id);
      setTargetId(detail.versions[detail.versions.length - 1].id);
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  useEffect(() => {
    if (baseId === null) return;
    let active = true;
    void (async () => {
      const graph = await getFullGraph(baseId);
      if (active) setBaseGraph(graph);
    })();
    return () => {
      active = false;
    };
  }, [baseId]);

  useEffect(() => {
    if (targetId === null) return;
    let active = true;
    void (async () => {
      const graph = await getFullGraph(targetId);
      if (active) setTargetGraph(graph);
    })();
    return () => {
      active = false;
    };
  }, [targetId]);

  const ready =
    baseId !== null &&
    targetId !== null &&
    versions.length > 0 &&
    baseGraph !== null &&
    targetGraph !== null;

  return (
    <div className="flex h-full flex-col">
      {ready ? (
        <ReactFlowProvider>
          <ComparePane
            mapId={mapId}
            mapName={mapName}
            versions={versions}
            baseId={baseId}
            targetId={targetId}
            baseGraph={baseGraph}
            targetGraph={targetGraph}
            onChangeBase={setBaseId}
            onChangeTarget={setTargetId}
          />
        </ReactFlowProvider>
      ) : (
        <div className="p-8 text-caption text-ink-tertiary">…</div>
      )}
    </div>
  );
}
