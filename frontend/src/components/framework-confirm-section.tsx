"use client";

// 연계 캔버스 확정 섹션 — 일반 맵의 ApprovalPanel 자리를 대체 (2026-08-28 개선판).
// 마이너 확정은 최신 스냅샷 대비 레이아웃 외 변경이 있을 때만(버튼 비활성 + 서버 409 미러),
// 버튼 아래에 변경 요약(비교 diff 재활용: computeVersionDiff + 엣지 시그니처)을 노출한다.
// 메이저 승급은 가시성 있는 토글 행 + 확인 모달(직전 라인 중간 마이너 영구삭제 안내) 경유.
import { BadgeCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  confirmFrameworkVersion,
  getFullGraph,
  type FlatNode,
  type FrameworkConfirmResult,
  type VersionGraph,
  type VersionSummary,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { computeVersionDiff, FIELD_MSG } from "@/lib/diff";
import { sourceHandleId, targetHandleId, type AppNode, type HandleSide } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";

// 확정 요약에 넘길 라이브 엣지 최소 형태 — 에디터 RF 엣지에서 구조만 취한다(결합 최소화)
export interface LiveEdgeShape {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: unknown;
}

export interface FrameworkConfirmSectionProps {
  mapId: number;
  canConfirm: boolean; // myRole editor+ (권한자/sysadmin 파생)
  versions: VersionSummary[]; // 스냅샷 라벨(vX.Y) 파싱 소스 — VersionDetail도 호환
  liveNodes: AppNode[];
  liveEdges: LiveEdgeShape[];
  onConfirmed: (result: FrameworkConfirmResult) => void; // 부모가 versions 갱신·토스트
  onError: (message: string) => void;
}

interface FwSnapshot {
  id: number;
  label: string;
  major: number;
  minor: number;
}

// versions에서 확정 스냅샷(vX.Y published)만 파싱 — 서버 fw_major/minor를 라벨로 복원
function parseSnapshots(versions: VersionSummary[]): FwSnapshot[] {
  const out: FwSnapshot[] = [];
  for (const v of versions) {
    if (v.status !== "published") continue;
    const m = /^v(\d+)\.(\d+)$/.exec(v.label);
    if (!m) continue;
    out.push({ id: v.id, label: v.label, major: Number(m[1]), minor: Number(m[2]) });
  }
  return out.sort((a, b) => a.major - b.major || a.minor - b.minor);
}

// 라이브 RF 상태 → diff 입력(VersionGraph) — 저장 직렬화(page.tsx)와 동일 필드 매핑.
// 엣지 비교는 별도 시그니처(buildEdgeSignatures)라 노드만 담는다. 좌표는 diff 제외 계약.
function buildLiveGraph(nodes: AppNode[]): VersionGraph {
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
    data_form: node.data.data_form ?? "",
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
    source_node_id: null, // 캔버스 draft 노드의 계보 키 = 자기 id (스냅샷 clone이 이 id를 물려받음)
  }));
  return { nodes: flat, edges: [], subprocess_refs: {} };
}

// 엣지 콘텐츠 시그니처 — (출발 계보→도착 계보) 키에 라벨·핸들. 좌표성 필드(side/line_style)는 제외.
// 서버 _canvas_content_signature와 판정 기준을 맞춘다 (2026-08-28).
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

export function FrameworkConfirmSection({
  mapId, canConfirm, versions, liveNodes, liveEdges, onConfirmed, onError,
}: FrameworkConfirmSectionProps) {
  const { t } = useI18n();
  const [major, setMajor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [majorModalOpen, setMajorModalOpen] = useState(false);
  // (스냅샷 id, 그래프) 페어 — id 불일치면 미로딩 취급(동기 setState 없이 스테일 차단)
  const [snapshot, setSnapshot] = useState<{ id: number; graph: VersionGraph } | null>(null);

  const snapshots = useMemo(() => parseSnapshots(versions), [versions]);
  const latest = snapshots.at(-1) ?? null;
  // 메이저 승급 시 영구삭제될 직전 라인 중간 마이너 — 안내 모달·프룬 미리보기
  const pruneTargets = useMemo(() => {
    if (latest === null) return [];
    return snapshots
      .filter((s) => s.major === latest.major && s.minor > 0 && s.minor < latest.minor)
      .map((s) => s.label);
  }, [snapshots, latest]);

  // 최신 스냅샷 그래프 — 변경 요약의 왼쪽(비교 기준). 스냅샷이 바뀔 때만 재조회.
  useEffect(() => {
    if (latest === null) return;
    let active = true;
    void getFullGraph(latest.id)
      .then((graph) => {
        if (active) setSnapshot({ id: latest.id, graph });
      })
      .catch(() => {
        if (active) setSnapshot(null); // 조회 실패 시 게이트는 서버 409에 위임
      });
    return () => {
      active = false;
    };
  }, [latest]);
  const snapshotGraph =
    latest !== null && snapshot !== null && snapshot.id === latest.id ? snapshot.graph : null;

  // 변경 요약 — 노드는 computeVersionDiff(위치 제외 계약), 엣지는 라벨·핸들 시그니처 비교
  const summary = useMemo(() => {
    if (latest === null) return null; // 최초 확정 — 비교 기준 없음(항상 확정 가능)
    if (snapshotGraph === null) return null; // 로딩/실패 — 게이트는 서버에 위임
    const liveGraph = buildLiveGraph(liveNodes);
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
      (id) => id, // 라이브 노드 계보 = 자기 id
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
    return { entries: diff.entries, edgesAdded, edgesRemoved, edgesChanged };
  }, [latest, snapshotGraph, liveNodes, liveEdges]);

  const hasChanges =
    latest === null ||
    summary === null || // 기준 로딩 실패 시 낙관 활성 — 최종 판정은 서버 409
    summary.entries.length > 0 ||
    summary.edgesAdded + summary.edgesRemoved + summary.edgesChanged > 0;

  function runConfirm(promoteMajor: boolean) {
    setBusy(true);
    confirmFrameworkVersion(mapId, promoteMajor)
      .then((result) => {
        setMajor(false);
        onConfirmed(result);
      })
      .catch((err) => onError(humanizeApiError(err, t)))
      .finally(() => setBusy(false));
  }

  const nextMajorLabel = `v${(latest?.major ?? 0) + 1}.0`;
  const shownEntries = summary?.entries.slice(0, 8) ?? [];
  const hiddenEntryCount = (summary?.entries.length ?? 0) - shownEntries.length;

  return (
    <div data-id="framework-confirm-section" className="flex flex-col gap-2 p-3">
      <p className="text-caption text-ink-secondary">
        {latest !== null
          ? t("framework.latestConfirmed", { label: latest.label })
          : t("framework.notConfirmed")}
      </p>
      {canConfirm && (
        <>
          {/* 메이저 승급 토글 — 체크박스보다 가시성 있는 설명 행 (2026-08-28 개선) */}
          <label
            data-id="framework-confirm-major"
            className={`flex cursor-pointer items-start gap-2 rounded-sm border px-2 py-1.5 transition-colors duration-150 ${
              major ? "border-accent-tint-border bg-accent-tint" : "border-hairline hover:bg-surface-alt"
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={major}
              onChange={() => setMajor((value) => !value)}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={`text-caption-strong ${major ? "text-accent" : "text-ink"}`}>
                {t("framework.majorVersion")} · {nextMajorLabel}
              </span>
              <span className="text-fine text-ink-tertiary">{t("framework.majorDesc")}</span>
            </span>
          </label>
          <button
            type="button"
            data-id="framework-confirm-button"
            disabled={busy || (!major && !hasChanges)}
            className="flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => {
              if (major) setMajorModalOpen(true);
              else runConfirm(false);
            }}
          >
            <BadgeCheck size={16} strokeWidth={1.5} />
            {t("framework.confirmChanges")}
          </button>
          {!major && !hasChanges && (
            <p data-id="framework-no-changes" className="text-fine text-ink-tertiary">
              {t("framework.noChanges", { label: latest?.label ?? "" })}
            </p>
          )}
        </>
      )}

      {/* 변경 요약 — 최신 확정본 대비, 좌표 이동은 제외 (비교 diff 재활용) */}
      {latest !== null && summary !== null && hasChanges && (
        <div data-id="framework-change-summary" className="flex flex-col gap-1 border-t border-divider pt-2">
          <p className="text-fine font-semibold text-ink-secondary">
            {t("framework.changesSince", { label: latest.label })}
          </p>
          <ul className="flex flex-col gap-0.5">
            {shownEntries.map((entry) => (
              <li
                key={`${entry.status}:${entry.rightNodeId ?? entry.leftNodeId}`}
                data-id="framework-change-row"
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
            {summary.edgesAdded + summary.edgesRemoved + summary.edgesChanged > 0 && (
              <li data-id="framework-change-edges" className="text-fine text-ink-tertiary">
                {t("framework.changesEdges", {
                  added: summary.edgesAdded,
                  removed: summary.edgesRemoved,
                  changed: summary.edgesChanged,
                })}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 메이저 승급 안내 모달 — 직전 라인 중간 마이너 영구삭제 경고 (2026-08-28 개선) */}
      {majorModalOpen && (
        <ConfirmDialog
          title={t("framework.majorModalTitle", { label: nextMajorLabel })}
          message={
            pruneTargets.length > 0
              ? t("framework.majorModalPrune", {
                  keepFirst: `v${latest?.major ?? 1}.0`,
                  keepLast: latest?.label ?? "",
                  pruned: pruneTargets.join(", "),
                })
              : t("framework.majorModalNoPrune")
          }
          confirmLabel={t("framework.confirmChanges")}
          cancelLabel={t("common.cancel")}
          danger={pruneTargets.length > 0}
          icon={<TriangleAlert size={18} strokeWidth={1.5} />}
          onConfirm={() => {
            setMajorModalOpen(false);
            runConfirm(true);
          }}
          onClose={() => setMajorModalOpen(false)}
        />
      )}
    </div>
  );
}
