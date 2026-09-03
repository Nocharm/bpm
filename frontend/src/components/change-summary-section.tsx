"use client";

// 기준 버전 대비 변경 요약 — 접힘 1줄(아이콘+카운트) → 펼침 상세 (2026-08-30 #3).
// 연계 캔버스 확정 섹션에서 추출해 일반 맵 승인 탭(승인자 아래)과 공유한다.
// 노드는 computeVersionDiff(좌표 제외 계약), 엣지는 라벨·핸들 시그니처 비교 — 서버
// _canvas_content_signature와 판정 기준을 맞춘다 (2026-08-28).
import { ChevronRight, GitCompare, Info, Spline } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getFullGraph, type FlatNode, type VersionGraph } from "@/lib/api";
import { sourceHandleId, targetHandleId, type AppNode, type HandleSide } from "@/lib/canvas";
import { computeVersionDiff, FIELD_MSG, type NodeDiffEntry } from "@/lib/diff";
import { useI18n } from "@/lib/i18n";

// 요약에 넘길 라이브 엣지 최소 형태 — 에디터 RF 엣지에서 구조만 취한다(결합 최소화)
export interface LiveEdgeShape {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: unknown;
}

export interface ChangeSummary {
  entries: NodeDiffEntry[];
  edgesAdded: number;
  edgesRemoved: number;
  edgesChanged: number;
  total: number;
}

// 라이브 RF 상태 → diff 입력(VersionGraph) — 저장 직렬화(page.tsx)와 동일 필드 매핑.
// 엣지 비교는 별도 시그니처(buildEdgeSignatures)라 노드만 담는다. 좌표는 diff 제외 계약.
// lineageById: 라이브 노드 id → 계보 루트(rootGraph의 source_node_id). 미전달이면 자기 id —
// 게시본을 열어둔 일반 맵에서 스냅샷(클론) 계보와 짝이 안 맞아 전량 삭제+추가로 오탐된다 (2026-08-30 픽스).
function buildLiveGraph(nodes: AppNode[], lineageById?: ReadonlyMap<string, string>): VersionGraph {
  const flat: FlatNode[] = nodes.map((node, index) => ({
    id: node.id,
    title: node.data.label,
    description: node.data.description,
    node_type: node.data.nodeType,
    color: node.data.color,
    assignee: node.data.assignee,
    department: node.data.department,
    system: node.data.system,
    duration: node.data.duration,
    cost_krw: node.data.cost_krw ?? "",
    cost_usd: node.data.cost_usd ?? "",
    headcount: node.data.headcount ?? "",
    annual_count: node.data.annual_count ?? "",
    fte: node.data.fte ?? "",
    touch_time: node.data.touch_time ?? "",
    input: node.data.input ?? "",
    output: node.data.output ?? "",
    input_forms: node.data.input_forms ?? "",
    output_forms: node.data.output_forms ?? "",
    start_condition: node.data.start_condition ?? "",
    end_condition: node.data.end_condition ?? "",
    gmp: node.data.gmp ?? "",
    url: node.data.url ?? "",
    url_label: node.data.urlLabel ?? "",
    pos_x: node.position.x,
    pos_y: node.position.y,
    sort_order: index,
    group_ids: node.data.groupIds,
    linked_map_id: node.data.linkedMapId ?? null,
    follow_latest: node.data.followLatest ?? true,
    linked_version_id: node.data.linkedVersionId ?? null,
    is_primary_end: node.data.isPrimaryEnd ?? false,
    parent_node_id: null,
    source_node_id: lineageById?.get(node.id) ?? null, // 미상이면 자기 id가 계보 루트
  }));
  return { nodes: flat, edges: [], subprocess_refs: {} };
}

// 엣지 콘텐츠 시그니처 — (출발 계보→도착 계보) 키에 라벨·핸들. 좌표성 필드(side/line_style)는 제외.
function buildEdgeSignatures(
  edges: { src: string; tgt: string; label: string; sh: string; th: string }[],
  lineageOf: (nodeId: string) => string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const edge of edges) {
    out.set(
      `${lineageOf(edge.src)}→${lineageOf(edge.tgt)}`,
      `${edge.label}|${edge.sh}|${edge.th}`,
    );
  }
  return out;
}

// 기준 버전 그래프를 조회해 라이브 대비 요약 산출 — base가 null이면 null(기준 없음)
export function useChangeSummary(
  baseVersionId: number | null,
  liveNodes: AppNode[],
  liveEdges: LiveEdgeShape[],
  lineageById?: ReadonlyMap<string, string>,
): ChangeSummary | null {
  // (기준 id, 그래프) 페어 — id 불일치면 미로딩 취급(동기 setState 없이 스테일 차단)
  const [snapshot, setSnapshot] = useState<{ id: number; graph: VersionGraph } | null>(null);
  useEffect(() => {
    if (baseVersionId === null) return;
    let active = true;
    void getFullGraph(baseVersionId)
      .then((graph) => {
        if (active) setSnapshot({ id: baseVersionId, graph });
      })
      .catch(() => {
        if (active) setSnapshot(null); // 조회 실패 — 호출자가 낙관 처리(서버 게이트 위임)
      });
    return () => {
      active = false;
    };
  }, [baseVersionId]);
  const snapshotGraph =
    baseVersionId !== null && snapshot !== null && snapshot.id === baseVersionId
      ? snapshot.graph
      : null;

  return useMemo(() => {
    if (snapshotGraph === null) return null;
    const liveGraph = buildLiveGraph(liveNodes, lineageById);
    const diff = computeVersionDiff(snapshotGraph, liveGraph);
    const snapById = new Map(snapshotGraph.nodes.map((n) => [n.id, n]));
    const snapSig = buildEdgeSignatures(
      snapshotGraph.edges.map((e) => ({
        src: e.source_node_id,
        tgt: e.target_node_id,
        label: e.label,
        // 레거시 null 핸들은 저장 시 변 파생 id로 채워지므로 동일 규칙으로 정규화
        sh: e.source_handle ?? sourceHandleId((e.source_side as HandleSide) || "right"),
        th: e.target_handle ?? targetHandleId((e.target_side as HandleSide) || "left"),
      })),
      (id) => {
        const node = snapById.get(id);
        return node ? (node.source_node_id ?? node.id) : id;
      },
    );
    const liveSig = buildEdgeSignatures(
      liveEdges.map((e) => ({
        src: e.source,
        tgt: e.target,
        label: typeof e.label === "string" ? e.label : "",
        sh: e.sourceHandle ?? sourceHandleId("right"),
        th: e.targetHandle ?? targetHandleId("left"),
      })),
      (id) => lineageById?.get(id) ?? id, // 라이브 계보 루트 — 스냅샷 쪽 번역과 대칭
    );
    let edgesAdded = 0;
    let edgesRemoved = 0;
    let edgesChanged = 0;
    for (const [key, sig] of liveSig) {
      const prev = snapSig.get(key);
      if (prev === undefined) edgesAdded += 1;
      else if (prev !== sig) edgesChanged += 1;
    }
    for (const key of snapSig.keys()) {
      if (!liveSig.has(key)) edgesRemoved += 1;
    }
    return {
      entries: diff.entries,
      edgesAdded,
      edgesRemoved,
      edgesChanged,
      total: diff.entries.length + edgesAdded + edgesRemoved + edgesChanged,
    };
  }, [snapshotGraph, liveNodes, liveEdges, lineageById]);
}

// 상태별 노드 수 — 접힘 헤더의 컴팩트 카운트 필
function countByStatus(entries: NodeDiffEntry[]): { added: number; removed: number; changed: number } {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const entry of entries) {
    if (entry.status === "added") added += 1;
    else if (entry.status === "removed") removed += 1;
    else changed += 1;
  }
  return { added, removed, changed };
}

// 접힘 1줄(아이콘+기준 필+카운트) → 펼침 상세 목록 (사용자 요구 2026-08-30 #3)
export function ChangeSummaryDisclosure({
  baseLabel,
  summary,
  dataIdPrefix,
}: {
  baseLabel: string;
  summary: ChangeSummary;
  dataIdPrefix: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const counts = countByStatus(summary.entries);
  const edgeTotal = summary.edgesAdded + summary.edgesRemoved + summary.edgesChanged;
  const shownEntries = summary.entries.slice(0, 8);
  const hiddenEntryCount = summary.entries.length - shownEntries.length;
  return (
    <div data-id={`${dataIdPrefix}-change-summary`} className="flex flex-col">
      <button
        type="button"
        data-id={`${dataIdPrefix}-change-summary-toggle`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-1.5 text-left text-fine font-semibold text-ink-secondary"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <GitCompare size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <span>{t("framework.changesTitle")}</span>
        <span className="rounded-full border border-hairline bg-surface-alt px-1.5 font-semibold text-ink-secondary">
          {baseLabel}
        </span>
        {/* 컴팩트 카운트 — 접힌 채로도 규모가 보인다 */}
        {counts.added > 0 && (
          <span className="rounded-full bg-added/10 px-1.5 font-semibold text-added">+{counts.added}</span>
        )}
        {counts.removed > 0 && (
          <span className="rounded-full bg-removed/10 px-1.5 font-semibold text-removed">-{counts.removed}</span>
        )}
        {counts.changed > 0 && (
          <span className="rounded-full bg-changed/10 px-1.5 font-semibold text-changed">~{counts.changed}</span>
        )}
        {edgeTotal > 0 && (
          <span className="flex items-center gap-0.5 rounded-full bg-surface-alt px-1.5 font-semibold text-ink-tertiary">
            <Spline size={11} strokeWidth={1.5} />
            {edgeTotal}
          </span>
        )}
      </button>
      <div
        className={`grid transition-all duration-350 ease-smooth ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-w-0 overflow-hidden">
          <ul className="flex flex-col gap-0.5 pt-1">
            {shownEntries.map((entry) => (
              <li
                key={`${entry.status}:${entry.rightNodeId ?? entry.leftNodeId}`}
                data-id={`${dataIdPrefix}-change-row`}
                className="flex min-w-0 items-baseline gap-1.5 text-fine"
              >
                <span
                  className={`shrink-0 rounded-full px-1.5 font-semibold ${
                    entry.status === "added"
                      ? "bg-added/10 text-added"
                      : entry.status === "removed"
                        ? "bg-removed/10 text-removed"
                        : "bg-changed/10 text-changed"
                  }`}
                >
                  {t(`compare.status${entry.status === "added" ? "Added" : entry.status === "removed" ? "Removed" : "Changed"}` as
                    | "compare.statusAdded"
                    | "compare.statusRemoved"
                    | "compare.statusChanged")}
                </span>
                <span className="min-w-0 truncate text-ink">{entry.title}</span>
                {entry.changedFields.length > 0 && (
                  <span className="min-w-0 truncate text-ink-tertiary">
                    {entry.changedFields.map((field) => t(FIELD_MSG[field])).join(", ")}
                  </span>
                )}
              </li>
            ))}
            {hiddenEntryCount > 0 && (
              <li className="text-fine text-ink-tertiary">
                {t("framework.moreChanges", { n: hiddenEntryCount })}
              </li>
            )}
            {edgeTotal > 0 && (
              <li data-id={`${dataIdPrefix}-change-edges`} className="flex flex-wrap items-center gap-1.5 text-fine text-ink-tertiary">
                <Spline size={14} strokeWidth={1.5} className="shrink-0" />
                <span>{t("framework.edgesLabel")}</span>
                {summary.edgesAdded > 0 && (
                  <span className="rounded-full bg-added/10 px-1.5 font-semibold text-added">
                    +{summary.edgesAdded}
                  </span>
                )}
                {summary.edgesRemoved > 0 && (
                  <span className="rounded-full bg-removed/10 px-1.5 font-semibold text-removed">
                    -{summary.edgesRemoved}
                  </span>
                )}
                {summary.edgesChanged > 0 && (
                  <span className="rounded-full bg-changed/10 px-1.5 font-semibold text-changed">
                    ~{summary.edgesChanged}
                  </span>
                )}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

// 일반 맵 승인 탭용 래퍼 — 기준=최신 게시본, 변경 없으면 1줄 안내 (2026-08-30 #3)
export function ChangeSummarySection({
  baseVersionId,
  baseLabel,
  liveNodes,
  liveEdges,
  lineageById,
}: {
  baseVersionId: number;
  baseLabel: string;
  liveNodes: AppNode[];
  liveEdges: LiveEdgeShape[];
  lineageById?: ReadonlyMap<string, string>;
}) {
  const { t } = useI18n();
  const summary = useChangeSummary(baseVersionId, liveNodes, liveEdges, lineageById);
  if (summary === null) {
    return null; // 로딩/조회 실패 — 표시 생략(요약은 보조 정보)
  }
  return (
    <div data-id="approval-change-summary-box" className="rounded-md border border-hairline px-3 py-2">
      {summary.total > 0 ? (
        <ChangeSummaryDisclosure baseLabel={baseLabel} summary={summary} dataIdPrefix="approval" />
      ) : (
        <p className="flex flex-wrap items-center gap-1.5 text-fine text-ink-tertiary">
          <Info size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="rounded-full border border-hairline bg-surface-alt px-1.5 font-semibold text-ink-secondary">
            {baseLabel}
          </span>
          <span>{t("framework.noChangesAfter")}</span>
        </p>
      )}
    </div>
  );
}
