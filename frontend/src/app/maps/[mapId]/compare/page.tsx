"use client";

// 버전 비교 화면 — 두 버전을 하나의 병합 캔버스로 렌더. 저장 좌표 무시·dagre 연결 기반 배치,
// 추가/삭제 엣지와 추가/삭제/변경 노드를 색으로 표현하고 변경 목록 클릭으로 포커스. (재작성: spec 2026-06-23)

import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  EdgeLabelRenderer,
  applyNodeChanges,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  MarkerType,
  type NodeChange,
  type NodeTypes,
  Panel,
  PanOnScrollMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Lock,
  type LucideIcon,
  Maximize,
  Minus,
  MoveHorizontal,
  MoveVertical,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { NodeSelectionRing } from "@/components/node-selection-ring";
import { ProcessNode } from "@/components/process-node";
import {
  ApiError,
  type FlatNode,
  getFullGraph,
  getMap,
  type VersionGraph,
  type VersionStatus,
  type VersionSummary,
} from "@/lib/api";
import {
  getNextNodeAlongFlow,
  getPrevNodeAlongFlow,
  type HandleSide,
  hasBpmAttributes,
  hasCustomTerminalLabel,
  layoutWithDagre,
  nodeSizeOf,
  normalizeNodeType,
  sourceHandleId,
  targetHandleId,
  type AppNode,
} from "@/lib/canvas";
import { humanizeApiError } from "@/lib/api-errors";
import { classifyFieldDiff } from "@/lib/compare-field-diff";
import {
  FIELD_DIFF_LABEL_CLASS,
  FIELD_DIFF_ROW_CLASS,
  FieldDiffHoverable,
  FieldDiffValues,
  type FieldDiffRowData,
} from "@/components/compare-field-diff";
import { type ChangedField, FIELD_MSG, getLineageKey } from "@/lib/diff";
import { formatGmp, getGmpBadgeStyle, GMP_OPTIONS } from "@/lib/gmp";
import { formatDurationHm, formatThousands } from "@/lib/duration";
import {
  getInheritedParams,
  isSpParamField,
  PARAM_FIELDS,
  PARAM_LABEL_KEY,
  type ParamField,
} from "@/lib/params";
import { sumVersionParam } from "@/lib/param-sum";
import { PARAM_ICON } from "@/components/param-icons";
import { findPublishedAt } from "@/components/version/requester-comment-banner";
import { formatKst, formatKstShort } from "@/lib/datetime";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";
import { exportFramedPng } from "@/lib/export";
import { alignBackbone, computeSpine, isBackEdge, pickHandleSide } from "@/lib/flow-layout";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { NodeActionsContext, type IoListDisplayState, type NodeActions } from "@/lib/node-actions";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  buildMergedGraph,
  type MergedEdge,
  type MergedNode,
  type MergedNodeStatus,
} from "@/lib/merge-diff";

const nodeTypes: NodeTypes = { process: ProcessNode };

// passthrough-removed(양끝이 모두 유지 노드) 엣지 — 삽입 노드를 피해 우회하는 아크(red 점선). C2b.
// 삭제된 직접 연결이 새 경로(A→X→B)와 겹치지 않게 부풀린 베지어. 방향은 핸들 변으로 결정:
//   LR(bottom 핸들)=아래로 dip / TB(right 핸들)=오른쪽으로 bulge.
function RemovedArcEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, markerEnd, style,
}: EdgeProps) {
  const side = sourcePosition === Position.Right || sourcePosition === Position.Left;
  const path = side
    ? (() => {
        const bulge = Math.max(sourceX, targetX) + 52;
        return `M${sourceX},${sourceY} C${bulge},${sourceY} ${bulge},${targetY} ${targetX},${targetY}`;
      })()
    : (() => {
        const dip = Math.max(sourceY, targetY) + 52;
        return `M${sourceX},${sourceY} C${sourceX},${dip} ${targetX},${dip} ${targetX},${targetY}`;
      })();
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

// 라벨 있는 일반 엣지 — 저장된 line_style(곡선/꺾은선/직선)대로 경로를 그린다(""=레거시는 꺾은선).
// HTML 라벨(EdgeLabelRenderer)은 반투명+블러 배경으로 선이 라벨에서 "끊긴" 느낌을 줄이며 가독성 확보.
function LabeledSmoothEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  label,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const lineStyle = data && "lineStyle" in data ? data.lineStyle : undefined;
  const pathArgs = {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  };
  const [path, labelX, labelY] =
    lineStyle === "straight"
      ? getStraightPath(pathArgs)
      : lineStyle === "default"
        ? getBezierPath(pathArgs)
        : getSmoothStepPath(pathArgs);
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-xs px-1 text-fine text-ink-secondary"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: "color-mix(in srgb, var(--color-surface) 55%, transparent)",
              backdropFilter: "blur(3px)",
              WebkitBackdropFilter: "blur(3px)",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes: EdgeTypes = { removedArc: RemovedArcEdge, labeled: LabeledSmoothEdge };

// 비교뷰 노드 컨텍스트 — 변경은 diff 필로 보여주므로 박스의 BPM 필드 줄을 숨긴다(속성 4종 제외).
// 노드 높이가 내용과 무관하게 균일해져 백본 정렬(alignBackbone)이 정확해지고 중복 표시도 제거.
// 파라미터 칩("params")은 종전처럼 항상 표시 — 에디터 토글과 무관.
const COMPARE_NODE_ACTIONS: NodeActions = {
  onToggleExpand: null,
  expandedInlineIds: new Set<string>(),
  displayFields: ["params"],
  editingNodeId: null,
  onStartRename: null,
  onRename: null,
  onCancelRename: null,
  ctrlDragIds: new Set<string>(),
  onEditGmp: null,
  ioChecks: new Set<string>(),
  onToggleIoCheck: null,
  ioListStates: new Map<string, IoListDisplayState>(),
  onSetIoListState: null,
  ioCheckPulse: null,
  onHoverIoLink: null,
};

// FIELD_MSG는 lib/diff.ts로 승격 — 확정 요약(연계 캔버스)과 공용 (2026-08-28)

// duration·touch_time은 1h30m, 비용 2필드는 천단위 콤마(라벨에 통화가 있어 기호는 생략) — 나머지는 원문 그대로.
// 포맷 실패(무효 레거시 값)는 원문 노출(빈 표시보다 진단 가능).
const displayFieldValue = (field: ChangedField, value: string): string => {
  if (field === "duration" || field === "touch_time") return formatDurationHm(value) || value;
  if (field === "gmp") return formatGmp(value) || value;
  if (field === "cost_krw" || field === "cost_usd") return formatThousands(value) || value;
  return value;
};

// 병합 노드 status → ProcessNode diffStatus (unchanged는 중립=undefined)
function toDiffStatus(status: MergedNodeStatus): "added" | "removed" | "changed" | undefined {
  return status === "unchanged" ? undefined : status;
}

// H.MM → 분 — 합계 delta 계산용(서머리 탭). 값은 sumVersionParam이 이미 정규화한 것만 들어온다.
function toMinutes(value: string): number {
  const [h, mm = ""] = value.split(".");
  return Number.parseInt(h, 10) * 60 + (mm === "" ? 0 : Number.parseInt(mm, 10));
}

// 버전 합계 delta(target−base) — 부호+표시형. 동일/무의미(0)면 null(칩 미표시).
function formatSumDelta(field: ParamField, base: string, target: string): string | null {
  if (base === "" && target === "") return null;
  if (field === "duration" || field === "touch_time") {
    const diff = (target === "" ? 0 : toMinutes(target)) - (base === "" ? 0 : toMinutes(base));
    if (diff === 0) return null;
    const abs = Math.abs(diff);
    const hm = abs % 60 === 0 ? String(abs / 60) : `${Math.floor(abs / 60)}.${String(abs % 60).padStart(2, "0")}`;
    return `${diff > 0 ? "+" : "−"}${formatDurationHm(hm) || hm}`;
  }
  const diff = (target === "" ? 0 : Number(target)) - (base === "" ? 0 : Number(base));
  if (!Number.isFinite(diff) || diff === 0) return null;
  // 십진 오차 잘라내기 — 파라미터 표시 정밀도(소수 2자리)면 충분
  const abs = Math.round(Math.abs(diff) * 100) / 100;
  const shown =
    field === "cost_krw" || field === "cost_usd" ? formatThousands(String(abs)) || String(abs) : String(abs);
  return `${diff > 0 ? "+" : "−"}${shown}`;
}

// 노드의 파라미터 기여값 — SP 노드는 지정값 상속(5종), annual_count·fte는 자체값. sumVersionParam과 동일 규칙.
function getNodeParamValue(graph: VersionGraph, node: FlatNode, field: ParamField): string {
  if (node.node_type === "subprocess" && node.linked_map_id !== null && isSpParamField(field)) {
    return getInheritedParams(graph.subprocess_refs?.[node.linked_map_id])[field];
  }
  return node[field] ?? "";
}

// 정수 카운트 delta — 동일하면 null(칩 미표시). 요약 확장 섹션(구조·집합·GMP) 공용.
function formatCountDelta(base: number, target: number): string | null {
  return target === base ? null : `${target > base ? "+" : "−"}${Math.abs(target - base)}`;
}

// 노드의 시스템/부서 표시값 — SP 노드는 링크 맵 지정값(라이브 참조).
function getNodeAttr(graph: VersionGraph, node: FlatNode, field: "system" | "department"): string {
  if (node.node_type === "subprocess" && node.linked_map_id !== null) {
    return graph.subprocess_refs?.[node.linked_map_id]?.[field] ?? "";
  }
  return node[field] ?? "";
}

// 두 버전의 문자열 집합 diff — 추가/제거/공통(정렬). 시스템·부서 커버리지 섹션 공용.
function diffValueSets(base: ReadonlySet<string>, target: ReadonlySet<string>) {
  return {
    added: [...target].filter((v) => !base.has(v)).sort(),
    removed: [...base].filter((v) => !target.has(v)).sort(),
    kept: [...target].filter((v) => base.has(v)).sort(),
  };
}

// 담당자 지정률 표시 — "60% (6/10)". 대상(공정 속성 노드) 0개면 "-".
function formatCoverage(assigned: number, eligible: number): string {
  if (eligible === 0) return "-";
  return `${Math.round((assigned / eligible) * 100)}% (${assigned}/${eligible})`;
}

// union 노드를 좌표 없는 AppNode로 — 이후 layoutWithDagre가 위치 산정
type DiffFieldRow = FieldDiffRowData;

function buildAppNodes(
  merged: MergedNode[],
  noteOf: (node: MergedNode) => string | undefined,
  fieldsOf: (node: MergedNode) => DiffFieldRow[] | undefined,
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
      cost_krw: m.node.cost_krw,
      cost_usd: m.node.cost_usd,
      headcount: m.node.headcount,
      annual_count: m.node.annual_count,
      fte: m.node.fte,
      // 링크 상태 전달 — 미전달이면 모든 SP 노드가 "링크 미지정" 배너로 오표시된다 (2026-08-29 픽스)
      linkedMapId: m.node.linked_map_id ?? null,
      groupIds: m.node.group_ids ?? [],
      hasChildren: false,
      diffStatus: toDiffStatus(m.status),
      diffNote: noteOf(m),
      diffFields: fieldsOf(m),
      // 비교 엣지는 전부 4변 핸들로 재매핑 — unchanged subprocess도 NodeHandles를 렌더해야 앵커됨 (F1)
      sideHandles: true,
    },
  }));
}

// spine 판정·백본 직선화는 공용 lib/flow-layout(computeSpine·alignBackbone) 사용 — 에디터 자동정렬과 공유.

// dagre 배치 후처리 — 유지(unchanged/changed) 노드를 공통 backbone 중심Y에 맞춰 열(rank)별로 세로 이동.
// ①백본이 완전 직선(중심Y 일치 → smoothstep 직각 계단 제거) ②병렬 곁가지의 유지/변경 노드(예: 관리자 승인)를
// 라인 위로. 추가 노드는 같은 열 내 상대 오프셋을 유지해 위/아래 곁가지로 남는다. 열=중심X로 그룹.
// 비교뷰 실측 렌더 높이(BPM 속성 줄은 숨겨 균일 — COMPARE_NODE_ACTIONS). dagre는 nodeSizeOf로 배치하지만
// 렌더 중심은 실제 높이 기준이라, 정렬은 이 값으로 계산해야 handle Y가 정확히 일치(직선).
const COMPARE_RENDER_H: Record<string, number> = {
  process: 38,
  decision: 96,
  start: 38,
  end: 38,
  subprocess: 64,
};

// 비교뷰 실측 렌더 폭 — TB에서 cross축(X) 정렬·핸들 중심 계산에 사용. nodeSizeOf는 dagre 박스라 실제와
// 다르다(process는 min-w-[150px]=150인데 nodeSizeOf=170 → TB 세로 엣지가 10px 꺾임). 실제 폭으로 계산해야
// handle X가 일치해 [D-U] 세로 엣지가 직선. process 150·terminal 90·decision 116·subprocess 180.
const COMPARE_RENDER_W: Record<string, number> = {
  process: 150,
  decision: 116,
  start: 90,
  end: 90,
  subprocess: 180,
};

// 비교뷰 실측 크기 함수 — 공용 alignBackbone에 주입(에디터는 measured, 비교는 위 상수표).
// 터미널은 커스텀 라벨의 타입 필 줄(+18px)로 커진 높이를 근사(백본 중심 정렬용 — 노트는 캔버스 미노출).
const compareRenderH = (node: AppNode) => {
  const base = COMPARE_RENDER_H[node.data.nodeType] ?? 38;
  if (node.data.nodeType !== "start" && node.data.nodeType !== "end") return base;
  return hasCustomTerminalLabel(node.data.label) ? base + 18 : base;
};
const compareRenderW = (node: AppNode) =>
  COMPARE_RENDER_W[node.data.nodeType] ?? nodeSizeOf(node.data.nodeType).w;

function buildAppEdges(merged: MergedEdge[], keptKeys: Set<string>): Edge[] {
  return merged.map((e) => {
    // 양끝이 모두 유지 노드인 removed 엣지 = 삽입 등으로 끊긴 직접 연결 → 우회 아크로 렌더.
    const passthrough =
      e.status === "removed" && keptKeys.has(e.source) && keptKeys.has(e.target);
    const markerColor =
      e.status === "added"
        ? "var(--color-added)"
        : e.status === "removed"
          ? "var(--color-removed)"
          : e.status === "changed"
            ? "var(--color-changed)"
            : "var(--color-border-strong)";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      type: passthrough ? "removedArc" : "labeled",
      // 저장된 선 모양 그대로 렌더 — LabeledSmoothEdge가 경로 함수를 고른다
      data: { lineStyle: e.lineStyle },
      markerEnd: { type: MarkerType.ArrowClosed, color: markerColor },
      style:
        e.status === "added"
          ? { stroke: "var(--color-added)", strokeWidth: 2 }
          : e.status === "removed"
            ? { stroke: "var(--color-removed)", strokeWidth: 2, strokeDasharray: "6 3" }
            : e.status === "changed"
              ? { stroke: "var(--color-changed)", strokeWidth: 2 }
              : undefined,
    };
  });
}

// 버전 상태 → 색점(pill 좌측) — version-status.ts 계열 토큰 재사용, 무채 기본.
const STATUS_DOT: Record<VersionStatus, string> = {
  draft: "bg-ink-tertiary",
  pending: "bg-changed",
  approved: "bg-accent",
  published: "bg-added",
  rejected: "bg-error",
  expired: "bg-ink-tertiary",
};

// 역할 캡션(기준/대상) + 상태 색점 트리거 — 행에 상태 필·변경일(updated_at)을 보여주는
// 커스텀 드롭다운. native select은 option에 rich row를 못 그려 교체(피드백 2026-08-28).
// 반대편에 이미 선택된 버전 행은 역할 태그로 표시하고 클릭 시 스왑 — 동일 버전 쌍 선택 차단.
function VersionSelect({
  dataId,
  label,
  versions,
  value,
  otherValue,
  otherTag,
  onChange,
  onSwap,
}: {
  dataId: string;
  label: string;
  versions: VersionSummary[];
  value: number;
  otherValue: number;
  otherTag: string;
  onChange: (id: number) => void;
  onSwap: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = versions.find((version) => version.id === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        data-id={dataId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-sm border border-hairline bg-surface pl-2 pr-1.5 hover:bg-surface-alt"
      >
        <span className="text-fine font-semibold text-ink-tertiary">{label}</span>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            current ? STATUS_DOT[current.status] : "bg-ink-tertiary"
          }`}
        />
        <span className="max-w-[11rem] truncate text-caption text-ink">{current?.label ?? "-"}</span>
        <ChevronDown size={12} strokeWidth={1.5} className="text-ink-tertiary" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div
            data-id={`${dataId}-menu`}
            className="absolute left-0 z-[1001] mt-1 w-72 rounded-md border border-hairline bg-surface py-1 shadow-lg"
          >
            {versions.map((version) => {
              const selected = version.id === value;
              // 반대편(기준↔대상)에 이미 선택된 버전 — 역할 태그 표시, 클릭은 스왑
              const isOther = !selected && version.id === otherValue;
              return (
                <button
                  key={version.id}
                  type="button"
                  title={isOther ? t("compare.swapAria") : undefined}
                  onClick={() => {
                    setOpen(false);
                    if (isOther) onSwap();
                    else if (!selected) onChange(version.id);
                  }}
                  className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-caption hover:bg-surface-alt ${
                    selected ? "bg-accent-tint/50" : ""
                  }`}
                >
                  {isOther ? (
                    <span className="shrink-0 rounded-sm border border-hairline bg-surface-alt px-1 text-[10px] leading-4 text-ink-secondary">
                      {otherTag}
                    </span>
                  ) : (
                    <Check
                      size={13}
                      strokeWidth={2}
                      className={`shrink-0 ${selected ? "text-accent" : "invisible"}`}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{version.label}</span>
                    {/* 변경날(마지막 수정, KST) — 이름 아랫줄 좌정렬·축소 폰트(피드백 2026-08-28) */}
                    <span className="block text-[10px] leading-tight text-ink-tertiary">
                      {formatKstShort(version.updated_at)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-sm border px-1 py-0.5 text-fine ${VERSION_STATUS_STYLE[version.status]}`}
                  >
                    {t(VERSION_STATUS_LABEL[version.status])}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// 좌하 범례 — 노드 diff 테두리 스타일(추가 실선·삭제 점선·변경 실선) + 건수(좌상 카운트 필과 통합).
function DiffLegend({ counts }: { counts: { added: number; removed: number; changed: number } }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5 text-caption text-ink-secondary" data-id="compare-legend">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-added" /> {t("compare.legendAdded")}
        <span className="font-semibold text-ink">{counts.added}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-dashed border-removed" />{" "}
        {t("compare.legendRemoved")}
        <span className="font-semibold text-ink">{counts.removed}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[3px] border-2 border-changed" /> {t("compare.legendChanged")}
        <span className="font-semibold text-ink">{counts.changed}</span>
      </span>
    </div>
  );
}

// 요약 탭 카드 셸 — 접기 헤더(아이콘·라벨·delta 칩 + BASE→TARGET 값 줄)와 펼침 본문 공용.
function SummaryCard({
  dataId,
  icon: Icon,
  label,
  subLabel,
  delta,
  baseText,
  targetText,
  open,
  onToggle,
  children,
}: {
  dataId: string;
  icon: LucideIcon;
  label: string;
  subLabel?: string;
  delta: string | null;
  baseText: string;
  targetText: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline">
      <button type="button" data-id={dataId} onClick={onToggle} className="w-full px-2 py-1.5 text-left">
        <span className="flex items-center gap-1.5">
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`shrink-0 text-ink-tertiary transition-transform duration-150 ${
              open ? "rotate-90" : ""
            }`}
          />
          <Icon size={13} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
          <span className="min-w-0 truncate text-caption text-ink">
            {label}
            {subLabel && <span className="text-ink-tertiary"> · {subLabel}</span>}
          </span>
          {delta && (
            <span className="ml-auto shrink-0 rounded-full bg-changed/10 px-1.5 text-fine font-semibold text-changed">
              {delta}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-end gap-1 text-caption">
          <span className="text-ink-secondary">{baseText}</span>
          <span className="text-ink-tertiary">→</span>
          <span className="font-semibold text-ink">{targetText}</span>
        </span>
      </button>
      {open && children}
    </div>
  );
}

// 우측 인스펙터 속성 행 — 라벨 좌·값 우측정렬. divide-y로 구분.
function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-20 shrink-0 text-fine text-ink-tertiary">{label}</span>
      <span className="min-w-0 flex-1 text-right text-caption text-ink-secondary">{children}</span>
    </div>
  );
}

// 우하 줌 바 — `- % +` + fit(전체화면). 라이브 zoom은 store transform에서.
function ZoomBar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const btn =
    "flex h-6 w-6 items-center justify-center rounded-xs text-ink-secondary hover:bg-surface-alt";
  return (
    <div className="flex items-center gap-0.5 rounded-sm border border-hairline bg-surface/90 p-0.5 shadow-sm backdrop-blur-sm">
      <button type="button" onClick={() => zoomOut()} title="Zoom out" className={btn}>
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <span className="w-9 text-center text-fine tabular-nums text-ink-secondary">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" onClick={() => zoomIn()} title="Zoom in" className={btn}>
        <Plus size={14} strokeWidth={1.5} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-divider" />
      <button type="button" onClick={() => fitView({ duration: 300 })} title="Fit view" className={btn}>
        <Maximize size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

interface ChangeItem {
  key: string;
  focusId: string;
  isEdge: boolean;
  status: MergedNodeStatus;
  title: string;
  detail?: string;
  fields?: DiffFieldRow[];
}

// PNG 정보 카드에 쓰는 맵 메타 — 부서/오너/프레임워크 경로 + 버전별 게시 시각(events에서 추출).
interface CompareMapMeta {
  owningDept: string | null;
  ownerName: string | null;
  categoryPath: string | null;
  publishedById: ReadonlyMap<number, string | null>;
}

function ComparePane({
  mapId,
  mapName,
  versions,
  mapMeta,
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
  mapMeta: CompareMapMeta;
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
  // 변경 패널 필터 — 상태(all/추가/삭제/변경) + 종류(all/노드/엣지). 칩 클릭으로 목록 좁힘.
  const [filter, setFilter] = useState<"all" | "added" | "removed" | "changed">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "node" | "edge">("all");
  // 흐름 방향 — LR(좌→우, 기본) / TB(상→하). 맵이 한 축으로 너무 길 때 전환.
  const [flowDir, setFlowDir] = useState<"LR" | "TB">("LR");
  // 좌(변경 패널)·우(속성 인스펙터) 접힘 + 제목 드롭다운 — 에디터 헤더와 동일 위치의 토글.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  // 인스펙터 탭 — 속성(선택 대상) / 요약(버전 파라미터 합계). 요약 카드별 펼침/숨김 + 항목 드롭다운.
  const [inspectorTab, setInspectorTab] = useState<"props" | "summary">("props");
  const [openParams, setOpenParams] = useState<ReadonlySet<string>>(new Set());
  const [hiddenSums, setHiddenSums] = useState<ReadonlySet<string>>(new Set());
  const [sumMenuOpen, setSumMenuOpen] = useState(false);
  // 세션 한정 드래그 — 저장하지 않는 표시 전용 위치. 키에 레이아웃 기준(방향·버전 쌍)을 심어
  // 방향 토글/버전 전환 시 이전 드래그가 자동 무효화된다(리셋 effect 불필요).
  const [sessionPos, setSessionPos] = useState<ReadonlyMap<string, { x: number; y: number }>>(
    new Map(),
  );
  const toggleSumOpen = (key: string) =>
    setOpenParams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const layoutKey = `${flowDir}|${baseId}>${targetId}`;
  // 드래그 프레임은 rfNodes에만 반영(applyNodeChanges — 움직인 노드만 identity 교체).
  // 매 프레임 sessionPos를 갱신하면 laidNodes·nodeCenters·handleSides·appEdges가 전부
  // 재계산되어 전 노드/엣지가 새 identity로 재렌더 → 캔버스 전체가 새로고침되듯 끊겼다.
  const handleNodesChange = (changes: NodeChange<AppNode>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  };
  // 드롭 시점에만 세션 위치 커밋 — 핸들 변(handleSides)·센터 재계산이 1회로 끝난다.
  const handleNodeDragStop = (_e: unknown, _node: AppNode, nodes: AppNode[]) => {
    setSessionPos((prev) => {
      const next = new Map(prev);
      for (const node of nodes) next.set(`${layoutKey}|${node.id}`, node.position);
      return next;
    });
  };

  const merged = useMemo(
    () => buildMergedGraph(baseGraph, targetGraph),
    [baseGraph, targetGraph],
  );

  // 유지(non-removed) 노드 계보키 — passthrough-removed 엣지(양끝 유지) 판정용.
  const keptKeys = useMemo(
    () => new Set(merged.nodes.filter((n) => n.status !== "removed").map((n) => n.id)),
    [merged],
  );

  // spine(척추) — 유지 노드 + 인라인 삽입. 직선화(alignBackbone)·진입 변(handleSides) 공유. removed는 off-spine.
  const spineIds = useMemo(() => {
    const present = new Set(
      merged.nodes.filter((n) => n.status !== "removed").map((n) => n.id),
    );
    const keptStatus = new Set(
      merged.nodes
        .filter((n) => n.status === "unchanged" || n.status === "changed")
        .map((n) => n.id),
    );
    const edges = merged.edges.filter((e) => e.status !== "removed");
    return computeSpine(present, keptStatus, edges);
  }, [merged]);

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

  // 변경 노드의 before→after 필 표시값 — 필드 라벨 i18n + 빈값은 None.
  // status는 None 폴백 전 원시 표시값으로 분류(생성/삭제/변경 색 구분).
  const fieldsOf = useCallback(
    (m: MergedNode): DiffFieldRow[] | undefined =>
      m.status === "changed"
        ? m.fieldChanges.map((fc) => {
            const rawBefore = displayFieldValue(fc.field, fc.before);
            const rawAfter = displayFieldValue(fc.field, fc.after);
            return {
              label: t(FIELD_MSG[fc.field]),
              before: rawBefore || t("summary.none"),
              after: rawAfter || t("summary.none"),
              status: classifyFieldDiff(rawBefore, rawAfter),
            };
          })
        : undefined,
    [t],
  );

  // 좌표 없는 union 노드 → dagre 배치 (연결 기반, 저장 pos 무시). focus와 무관하게 1회만 계산.
  const positioned = useMemo(() => {
    // 배치는 To-Be(target) 흐름만으로 — 삭제 엣지를 전부 제외해 유지 백본이 깔끔한 직선이 되게 한다.
    // (삭제 엣지를 넣으면 삭제 노드가 본류 라인 위에 끼어 직접 엣지를 막고 노드를 위/아래로 왜곡시킴.)
    const layoutEdges = merged.edges.filter((edge) => edge.status !== "removed");
    // 전개방향(흐름축=ranksep) 간격을 촘촘히(한눈에), 수직축(nodesep)은 방향별로. TB는 좌우(nodesep)를
    // 조금 더 벌려 곁가지 구분. LR: nodesep 120·ranksep 120, TB: nodesep 120·ranksep 150.
    const spacing = flowDir === "TB" ? { nodesep: 120, ranksep: 150 } : { nodesep: 120, ranksep: 120 };
    const laid = layoutWithDagre(
      buildAppNodes(
        merged.nodes.filter((node) => node.status !== "removed"),
        noteOf,
        fieldsOf,
      ),
      buildAppEdges(layoutEdges, keptKeys),
      flowDir,
      spacing,
    );
    // 후처리 — 백본(유지+인라인 삽입=spine)을 공통 수직축으로 정렬(직선화 + 병렬 곁가지 라인 밖으로).
    const keptStatusIds = new Set(
      merged.nodes
        .filter((node) => node.status === "unchanged" || node.status === "changed")
        .map((node) => node.id),
    );
    const aligned = alignBackbone(laid, keptStatusIds, flowDir, spineIds, compareRenderW, compareRenderH);
    // 삭제 노드는 삭제 엣지 이웃(배치된 유지 노드)의 평균 위치에서 곁가지로 밀어낸다(본류 라인 비우기).
    // LR은 아래로(+y), TB는 오른쪽으로(+x) — 흐름축과 겹치지 않는 쪽.
    const posByKey = new Map(aligned.map((node) => [node.id, node.position]));
    // 같은 이웃을 공유하는 삭제 노드는 평균 위치가 동일해 완전히 포개진다 — 점유 슬롯을 추적해
    // 곁가지 방향(LR=아래, TB=오른쪽)으로 순차 오프셋.
    const occupiedSlots = new Set<string>();
    const slotKey = (x: number, y: number) => `${Math.round(x / 40)}:${Math.round(y / 40)}`;
    const removed = buildAppNodes(
      merged.nodes.filter((node) => node.status === "removed"),
      noteOf,
      fieldsOf,
    ).map((node) => {
      const neighbors = merged.edges
        .filter((edge) => edge.status === "removed" && (edge.source === node.id || edge.target === node.id))
        .map((edge) => (edge.source === node.id ? edge.target : edge.source))
        .map((key) => posByKey.get(key))
        .filter((pos): pos is { x: number; y: number } => !!pos);
      if (neighbors.length === 0) return node;
      const ax = neighbors.reduce((sum, pos) => sum + pos.x, 0) / neighbors.length;
      const ay = neighbors.reduce((sum, pos) => sum + pos.y, 0) / neighbors.length;
      let x = flowDir === "LR" ? ax : ax + 220;
      let y = flowDir === "LR" ? ay + 150 : ay;
      while (occupiedSlots.has(slotKey(x, y))) {
        if (flowDir === "LR") y += 120;
        else x += 220;
      }
      occupiedSlots.add(slotKey(x, y));
      return { ...node, position: { x, y } };
    });
    return [...aligned, ...removed];
  }, [merged, noteOf, fieldsOf, keptKeys, flowDir, spineIds]);

  // 레이아웃된 노드 중심 좌표 — 엣지 핸들 변 산정용. 실측 렌더 폭/높이(COMPARE_RENDER_*)로 계산해야
  // 핸들 중심이 실제와 일치(nodeSizeOf는 dagre 박스라 어긋남). 세션 드래그 위치가 있으면 그 좌표를
  // 쓴다 — 옮긴 노드를 따라 핸들 변 배정도 다시 계산된다.
  const nodeCenters = useMemo(() => {
    const centers = new Map<string, { cx: number; cy: number }>();
    for (const node of positioned) {
      const type = node.data.nodeType;
      const pos = sessionPos.get(`${layoutKey}|${node.id}`) ?? node.position;
      centers.set(node.id, {
        cx: pos.x + (COMPARE_RENDER_W[type] ?? nodeSizeOf(type).w) / 2,
        cy: pos.y + (COMPARE_RENDER_H[type] ?? 38) / 2,
      });
    }
    return centers;
  }, [positioned, sessionPos, layoutKey]);


  // 엣지별 붙을 변(핸들) — 의미상 정해진 변을 각 끝에 "직접" 배정(핸들 공유 허용). 이전의 4변 그리디 회피는
  // 결제처리처럼 엣지가 많은 노드(있음·곁가지 2개·다음·재시도=5개)에서 곁가지를 반대편(아래)으로 밀어 꼬았음.
  //  · passthrough(삭제 직접연결)=우회 변(LR bottom / TB right), 역행 루프(back)=우회 변(LR top / TB left)
  //  · 그 외: 곁가지(off-spine) 노드 자신=흐름축 변(이전=뒤·다음=앞), 본류(spine)↔곁가지=본류가 cross측 변,
  //    둘 다 spine=흐름축. → 위 곁가지는 본류에 top으로, 아래 삭제 노드는 bottom으로(재시도와 top 공유 무방).
  const handleSides = useMemo(() => {
    const arcSide: HandleSide = flowDir === "LR" ? "bottom" : "right";
    const result = new Map<string, { source: HandleSide; target: HandleSide }>();
    for (const edge of merged.edges) {
      const s = nodeCenters.get(edge.source);
      const t = nodeCenters.get(edge.target);
      const passthrough =
        edge.status === "removed" && keptKeys.has(edge.source) && keptKeys.has(edge.target);
      // 흐름 역행 루프 판정·변 선택은 공용 lib(isBackEdge·pickHandleSide) — 에디터 자동정렬과 공유.
      const back = !passthrough && !!s && !!t && isBackEdge(flowDir, s, t);
      const sideFor = (
        thisC: { cx: number; cy: number } | undefined,
        otherC: { cx: number; cy: number } | undefined,
        thisId: string,
        otherId: string,
      ): HandleSide => {
        if (passthrough) return arcSide;
        return pickHandleSide(flowDir, thisC, otherC, spineIds.has(thisId), spineIds.has(otherId), back);
      };
      result.set(edge.id, {
        source: sideFor(s, t, edge.source, edge.target),
        target: sideFor(t, s, edge.target, edge.source),
      });
    }
    return result;
  }, [merged, keptKeys, nodeCenters, flowDir, spineIds]);

  // 포커스된 노드만 selected 표시 (재레이아웃 없이 얕은 갱신) + 세션 드래그 위치 오버라이드
  const laidNodes = useMemo(
    () =>
      positioned.map((node) => {
        const override = sessionPos.get(`${layoutKey}|${node.id}`);
        return override
          ? { ...node, position: override, selected: focusId === node.id }
          : { ...node, selected: focusId === node.id };
      }),
    [positioned, focusId, sessionPos, layoutKey],
  );

  // React Flow에 넘기는 실제 노드 배열 — 드래그는 applyNodeChanges로 이 state에만 쌓이고,
  // 레이아웃/포커스 산출물(laidNodes)이 바뀔 때만 통째로 리셋한다(드롭 커밋 포함 — 위치 동일해 점프 없음).
  const [rfNodes, setRfNodes] = useState<AppNode[]>(laidNodes);
  useEffect(() => {
    // laidNodes는 rfNodes와 무관하게 산출 — cascade 루프 없음 (lessons react-ts §3)
    setRfNodes(laidNodes);
  }, [laidNodes]);

  // 포커스된 엣지는 굵게 강조
  const appEdges = useMemo(
    () =>
      buildAppEdges(merged.edges, keptKeys).map((edge) => {
        let styled = edge;
        // handleSides가 정한 변으로 핸들 지정. 비교뷰 하위프로세스 노드는 4변 핸들(NodeHandles)을 렌더하므로
        // 편집기용 전용 핸들 remap(withSubprocessHandles)은 쓰지 않는다(TB에서 상/하 진입이 막히던 원인).
        const sides = handleSides.get(edge.id);
        if (sides) {
          styled = {
            ...styled,
            sourceHandle: sourceHandleId(sides.source),
            targetHandle: targetHandleId(sides.target),
          };
        }
        if (focusId === edge.id) {
          styled = { ...styled, selected: true, style: { ...(styled.style ?? {}), strokeWidth: 3 } };
        }
        return styled;
      }),
    [merged, focusId, keptKeys, handleSides],
  );

  const titleByKey = useMemo(
    () => new Map(merged.nodes.map((m) => [m.id, m.node.title])),
    [merged],
  );

  // 변경 항목(패널) — 목업 순서: 추가 노드→추가 엣지→삭제 노드→삭제 엣지→변경 노드.
  // 변경 노드는 before→after 필 포함, 엣지는 방향 문자열 + "Edge added/removed" 설명.
  const changeItems: ChangeItem[] = useMemo(() => {
    const nodeItems: ChangeItem[] = merged.nodes
      .filter((m) => m.status !== "unchanged")
      .map((m) => ({
        key: `n-${m.id}`,
        focusId: m.id,
        isEdge: false,
        status: m.status,
        title: m.node.title,
        fields:
          m.status === "changed"
            ? m.fieldChanges.map((fc) => {
                const rawBefore = displayFieldValue(fc.field, fc.before);
                const rawAfter = displayFieldValue(fc.field, fc.after);
                return {
                  label: t(FIELD_MSG[fc.field]),
                  before: rawBefore || t("summary.none"),
                  after: rawAfter || t("summary.none"),
                  status: classifyFieldDiff(rawBefore, rawAfter),
                };
              })
            : undefined,
      }));
    // 노드 추가/삭제로 딸려온 엣지는 제외 — 양끝이 모두 "기존"(양 버전 존재=unchanged/changed) 노드인,
    // 즉 실제 배선(선 연결) 변경만 목록에 남긴다. 새/삭제 노드에 붙은 엣지는 노드 항목으로 이미 드러남.
    const bothVersion = new Set(
      merged.nodes
        .filter((n) => n.status === "unchanged" || n.status === "changed")
        .map((n) => n.id),
    );
    const edgeItems: ChangeItem[] = merged.edges
      .filter(
        (e) => e.status !== "unchanged" && bothVersion.has(e.source) && bothVersion.has(e.target),
      )
      .map((e) => ({
        key: `e-${e.id}`,
        focusId: e.id,
        isEdge: true,
        status: e.status,
        title: `${titleByKey.get(e.source) ?? "?"} → ${titleByKey.get(e.target) ?? "?"}`,
        detail:
          e.status === "added"
            ? t("compare.edgeAdded")
            : e.status === "removed"
              ? t("compare.edgeRemoved")
              : t("compare.edgeLabelChanged"),
        // 라벨 변경 엣지 — 노드 필드 변경과 같은 before→after 행으로 표시
        fields: e.labelChange
          ? [
              {
                label: t("compare.edgeLabelField"),
                before: e.labelChange.before || t("summary.none"),
                after: e.labelChange.after || t("summary.none"),
                status: classifyFieldDiff(e.labelChange.before, e.labelChange.after),
              },
            ]
          : undefined,
      }));
    const pick = (items: ChangeItem[], status: MergedNodeStatus) =>
      items.filter((i) => i.status === status);
    return [
      ...pick(nodeItems, "added"),
      ...pick(edgeItems, "added"),
      ...pick(nodeItems, "removed"),
      ...pick(edgeItems, "removed"),
      ...pick(nodeItems, "changed"),
      ...pick(edgeItems, "changed"),
    ];
  }, [merged, titleByKey, t]);

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

  const handleSwap = useCallback(() => {
    onChangeBase(targetId);
    onChangeTarget(baseId);
  }, [onChangeBase, onChangeTarget, baseId, targetId]);

  // 병합 캔버스를 PNG로 저장 — 저장 노드 범위를 1600×1000(대형 맵은 프레임 확장)에 맞춰 렌더.
  // 좌하단 정보 카드: 이름·부서·오너·버전(base → target)·게시일(있으면)·프레임워크(등록 시).
  const handleExport = useCallback(() => {
    const baseLabel = versions.find((v) => v.id === baseId)?.label ?? "-";
    const targetLabel = versions.find((v) => v.id === targetId)?.label ?? "-";
    const basePub = mapMeta.publishedById.get(baseId) ?? null;
    const targetPub = mapMeta.publishedById.get(targetId) ?? null;
    const fmtPub = (iso: string | null) => (iso ? formatKst(iso) : "-");
    void exportFramedPng(
      flow.getNodes(),
      `${mapName}-compare.png`,
      { width: 1600, height: 1000, minZoom: 0.5 },
      {
        title: mapName,
        rows: [
          {
            label: t("export.infoOwningDept"),
            value: mapMeta.owningDept?.split("/").filter(Boolean).pop() ?? "-",
          },
          { label: t("export.infoOwner"), value: mapMeta.ownerName ?? "-" },
          { label: t("export.infoVersion"), value: `${baseLabel} → ${targetLabel}` },
          ...(basePub || targetPub
            ? [{ label: t("export.infoPublished"), value: `${fmtPub(basePub)} → ${fmtPub(targetPub)}` }]
            : []),
          ...(mapMeta.categoryPath
            ? [{ label: t("export.infoFramework"), value: mapMeta.categoryPath }]
            : []),
        ],
      },
    );
  }, [flow, mapName, versions, baseId, targetId, mapMeta, t]);

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
  // 항목 앞 아이콘(색상 사각) — 추가 ＋ / 삭제 − / 변경 ✎.
  const iconBg: Record<MergedNodeStatus, string> = {
    added: "bg-added",
    removed: "bg-removed",
    changed: "bg-changed",
    unchanged: "",
  };
  const statusIcon = (status: MergedNodeStatus) =>
    status === "added" ? (
      <Plus size={12} strokeWidth={2.5} />
    ) : status === "removed" ? (
      <Minus size={12} strokeWidth={2.5} />
    ) : (
      <Pencil size={11} strokeWidth={2} />
    );

  const hasChanges = changeItems.length > 0;

  // 좌상 카운트 필 + 패널 필터칩 — 노드+엣지를 status별 집계(엣지 추가/삭제 포함, 변경은 노드만).
  const counts = useMemo(() => {
    const acc = { added: 0, removed: 0, changed: 0 };
    for (const item of changeItems) {
      if (item.status === "added" || item.status === "removed" || item.status === "changed") {
        acc[item.status] += 1;
      }
    }
    return acc;
  }, [changeItems]);

  const kindCounts = useMemo(
    () => ({
      node: changeItems.filter((i) => !i.isEdge).length,
      edge: changeItems.filter((i) => i.isEdge).length,
    }),
    [changeItems],
  );

  const filteredChanges = useMemo(
    () =>
      changeItems.filter(
        (i) =>
          (filter === "all" || i.status === filter) &&
          (kindFilter === "all" || (kindFilter === "edge") === i.isEdge),
      ),
    [changeItems, filter, kindFilter],
  );
  // 25개씩 증분 렌더 — 대형 맵 비교에서 변경 목록 전량 렌더 부하 방지
  const {
    visible: shownChanges,
    hasMore: hasMoreChanges,
    sentinelRef: changesSentinelRef,
  } = useInfiniteSlice(filteredChanges, `${filter}:${kindFilter}`);

  // 우측 인스펙터 대상 — 포커스된 id가 노드면 노드 패널, 엣지면 엣지 패널(둘 다 아니면 안내).
  const selectedNode = useMemo(
    () => merged.nodes.find((n) => n.id === focusId) ?? null,
    [merged, focusId],
  );
  const selectedEdge = useMemo(
    () => merged.edges.find((e) => e.id === focusId) ?? null,
    [merged, focusId],
  );

  // 서머리 탭 — 버전별 파라미터 합계(BASE→TARGET)와 기여 노드 목록(계보 키, 클릭=캔버스 포커스).
  // 값이 양 버전 모두 없는 파라미터/노드는 숨긴다.
  const paramSummary = useMemo(() => {
    const baseByLineage = new Map(baseGraph.nodes.map((n) => [getLineageKey(n), n]));
    const targetByLineage = new Map(targetGraph.nodes.map((n) => [getLineageKey(n), n]));
    return PARAM_FIELDS.map((field) => {
      const rows = merged.nodes
        .map((m) => {
          const baseNode = baseByLineage.get(m.id);
          const targetNode = targetByLineage.get(m.id);
          return {
            key: m.id,
            title: m.node.title,
            base: baseNode ? getNodeParamValue(baseGraph, baseNode, field) : "",
            target: targetNode ? getNodeParamValue(targetGraph, targetNode, field) : "",
          };
        })
        .filter((row) => row.base !== "" || row.target !== "");
      return {
        field,
        base: sumVersionParam(baseGraph, field),
        target: sumVersionParam(targetGraph, field),
        rows,
      };
    }).filter((entry) => entry.base !== "" || entry.target !== "");
  }, [merged, baseGraph, targetGraph]);

  // 요약 확장 섹션 — 구조 통계 / 시스템·부서 집합 diff / 담당자 지정률 / GMP 분포 (버전 단위 비교)
  const extraSummary = useMemo(() => {
    const collectSet = (graph: VersionGraph, field: "system" | "department") =>
      new Set(
        graph.nodes.map((node) => getNodeAttr(graph, node, field).trim()).filter((v) => v !== ""),
      );
    const structureOf = (graph: VersionGraph) => ({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      decisions: graph.nodes.filter((n) => normalizeNodeType(n.node_type) === "decision").length,
      subprocesses: graph.nodes.filter((n) => n.node_type === "subprocess").length,
    });
    // 담당자 지정률 — BPM 속성 대상(process/decision)의 자체 assignee 기준(SP는 상속이라 제외)
    const coverageOf = (graph: VersionGraph) => {
      const eligible = graph.nodes.filter((n) => hasBpmAttributes(normalizeNodeType(n.node_type)));
      return {
        assigned: eligible.filter((n) => (n.assignee ?? "").trim() !== "").length,
        eligible: eligible.length,
      };
    };
    // GMP 분포 — 분류 값별 노드 수(+미분류). SP는 링크 맵 분류 상속(GmpPill과 동일 게이팅).
    const gmpOf = (graph: VersionGraph) => {
      const counts: Record<string, number> = { direct: 0, indirect: 0, non_gmp: 0, unset: 0 };
      for (const node of graph.nodes) {
        const type = normalizeNodeType(node.node_type);
        const isSubprocess = node.node_type === "subprocess";
        if (!hasBpmAttributes(type) && !isSubprocess) continue;
        const value =
          isSubprocess && node.linked_map_id !== null
            ? (graph.subprocess_refs?.[node.linked_map_id]?.gmp ?? "")
            : (node.gmp ?? "");
        counts[value in counts ? value : "unset"] += 1;
      }
      return counts;
    };
    return {
      structure: { base: structureOf(baseGraph), target: structureOf(targetGraph) },
      systems: diffValueSets(collectSet(baseGraph, "system"), collectSet(targetGraph, "system")),
      systemCounts: { base: collectSet(baseGraph, "system").size, target: collectSet(targetGraph, "system").size },
      departments: diffValueSets(
        collectSet(baseGraph, "department"),
        collectSet(targetGraph, "department"),
      ),
      departmentCounts: {
        base: collectSet(baseGraph, "department").size,
        target: collectSet(targetGraph, "department").size,
      },
      coverage: { base: coverageOf(baseGraph), target: coverageOf(targetGraph) },
      gmp: { base: gmpOf(baseGraph), target: gmpOf(targetGraph) },
    };
  }, [baseGraph, targetGraph]);

  // 드롭다운에 나열할 요약 항목 — 데이터가 있는 것만(자동 숨김과 체크 숨김은 별개).
  const summaryItems = useMemo(() => {
    const items: { key: string; label: string }[] = paramSummary.map((entry) => ({
      key: entry.field,
      label: t(PARAM_LABEL_KEY[entry.field]),
    }));
    items.push({ key: "structure", label: t("compare.sumStructure") });
    const { systems, departments, coverage, gmp } = extraSummary;
    if (systems.added.length + systems.removed.length + systems.kept.length > 0) {
      items.push({ key: "systems", label: t("compare.sumSystems") });
    }
    if (
      departments.added.length + departments.removed.length + departments.kept.length > 0 ||
      coverage.base.eligible > 0 ||
      coverage.target.eligible > 0
    ) {
      items.push({ key: "departments", label: t("compare.sumDepartments") });
    }
    const gmpTotal = (c: Record<string, number>) => c.direct + c.indirect + c.non_gmp;
    if (gmpTotal(gmp.base) > 0 || gmpTotal(gmp.target) > 0) {
      items.push({ key: "gmp", label: t("field.gmp") });
    }
    return items;
  }, [paramSummary, extraSummary, t]);

  const hiddenSumCount = summaryItems.filter((item) => hiddenSums.has(item.key)).length;
  const isSumShown = (key: string) =>
    !hiddenSums.has(key) && summaryItems.some((item) => item.key === key);

  // Tab 이동용 흐름 엣지 — 삭제 제외(현재 To-Be 흐름). getNextNodeAlongFlow는 source/target만 읽음.
  const flowEdges = useMemo(
    () =>
      merged.edges
        .filter((e) => e.status !== "removed")
        .map((e) => ({ id: e.id, source: e.source, target: e.target })) as Edge[],
    [merged],
  );

  // Tab / Shift+Tab — 흐름상 다음/이전 노드로 포커스 이동(+화면 중앙). 입력 중엔 제외. 미선택 시 시작 노드.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Tab은 캔버스 내비로 가로챈다 — 브라우저 기본 포커스 이동(패널 버튼 순회) 방지.
      e.preventDefault();
      // 클릭했던 패널 버튼이 포커스를 쥔 채 Tab→focus-visible 파란 아웃라인이 남는 것 제거.
      (document.activeElement as HTMLElement | null)?.blur?.();
      const current = focusId && positioned.some((n) => n.id === focusId) ? focusId : null;
      let target: string | null;
      if (!current) {
        // 미선택(또는 엣지 포커스) — 흐름 시작(입력 엣지 없는 노드)으로.
        const incoming = new Set(flowEdges.map((edge) => edge.target));
        target = positioned.find((n) => !incoming.has(n.id))?.id ?? positioned[0]?.id ?? null;
      } else {
        target = e.shiftKey
          ? getPrevNodeAlongFlow(flowEdges, current)
          : getNextNodeAlongFlow(flowEdges, current);
      }
      if (!target) return;
      setFocusId(target);
      const node = positioned.find((n) => n.id === target);
      if (node) {
        // 세션 드래그로 옮긴 노드는 옮긴 좌표로 센터링
        const pos = sessionPos.get(`${layoutKey}|${node.id}`) ?? node.position;
        const size = nodeSizeOf(node.data.nodeType);
        void flow.setCenter(pos.x + size.w / 2, pos.y + size.h / 2, {
          duration: 350,
          zoom: flow.getZoom(),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flowEdges, focusId, positioned, flow, sessionPos, layoutKey]);

  // 방향 요약용 현재 선택 버전 이름 (변경 사항 패널 캡션)
  const baseName = versions.find((v) => v.id === baseId)?.label ?? "-";
  const targetName = versions.find((v) => v.id === targetId)?.label ?? "-";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 메인 캔버스 스타일 참고 — 노드 핸들(히트박스) 숨김 + 노드 호버 시 자기색 강조 링(bpm-node-emph).
          Turbopack이 dev에서 .react-flow__node 셀렉터 규칙을 purge해 raw <style>로 둔다(lessons canvas §5). */}
      <style>{`
.react-flow__handle{opacity:0}
.react-flow__node:hover .bpm-node-emph{box-shadow:0 0 0 3px color-mix(in srgb,var(--nc) 42%,transparent)}
.react-flow__node{z-index:2 !important}
      `}</style>
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        {/* 좌: 좌측 패널 접기(에디터 PanelLeft 위치) · 제목 드롭다운(누르면 에디터로) · Version compare */}
        <button
          type="button"
          onClick={() => setLeftCollapsed((v) => !v)}
          title={t(leftCollapsed ? "sidebar.expand" : "sidebar.collapse")}
          aria-label={t(leftCollapsed ? "sidebar.expand" : "sidebar.collapse")}
          className="inline-flex items-center justify-center rounded-sm p-1.5 text-ink-secondary hover:bg-surface-alt"
        >
          <PanelLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setTitleMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption font-medium text-ink hover:bg-surface-alt"
          >
            <span className="max-w-[16rem] truncate">{mapName}</span>
            <ChevronDown size={14} strokeWidth={1.5} className="text-ink-tertiary" />
          </button>
          {titleMenuOpen && (
            <>
              <div className="fixed inset-0 z-[1000]" onClick={() => setTitleMenuOpen(false)} />
              <div className="absolute left-0 z-[1001] mt-1 w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg">
                <Link
                  href={`/maps/${mapId}`}
                  onClick={() => setTitleMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                >
                  <ArrowLeft size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                  {t("compare.editorLink")}
                </Link>
              </div>
            </>
          )}
        </div>
        <span className="text-caption text-ink-tertiary">{t("compare.title")}</span>
        <div className="ml-2 flex items-center gap-2">
          <VersionSelect
            dataId="compare-version-base"
            label={t("compare.base")}
            versions={versions}
            value={baseId}
            otherValue={targetId}
            otherTag={t("compare.tagTarget")}
            onChange={onChangeBase}
            onSwap={handleSwap}
          />
          <ArrowRight size={14} strokeWidth={1.5} className="text-ink-tertiary" />
          <VersionSelect
            dataId="compare-version-target"
            label={t("compare.target")}
            versions={versions}
            value={targetId}
            otherValue={baseId}
            otherTag={t("compare.tagBase")}
            onChange={onChangeTarget}
            onSwap={handleSwap}
          />
          <button
            type="button"
            onClick={handleSwap}
            title={t("compare.swapAria")}
            aria-label={t("compare.swapAria")}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-hairline text-ink-secondary hover:bg-surface-alt"
          >
            <ArrowLeftRight size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFlowDir((dir) => (dir === "LR" ? "TB" : "LR"))}
            title={t(flowDir === "LR" ? "compare.layoutVertical" : "compare.layoutHorizontal")}
            aria-label={t(flowDir === "LR" ? "compare.layoutVertical" : "compare.layoutHorizontal")}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-hairline text-ink-secondary hover:bg-surface-alt"
          >
            {flowDir === "LR" ? (
              <MoveVertical size={14} strokeWidth={1.5} />
            ) : (
              <MoveHorizontal size={14} strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-hairline px-3 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            <Download size={14} strokeWidth={1.5} />
            {t("compare.export")}
          </button>
          <button
            type="button"
            onClick={() => setInspectorOpen((open) => !open)}
            title={t("compare.inspectorToggle")}
            aria-label={t("compare.inspectorToggle")}
            className="inline-flex items-center justify-center rounded-sm p-1.5 text-ink-secondary hover:bg-surface-alt"
          >
            <PanelRight size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {!leftCollapsed && (
        <aside
          className="flex w-72 shrink-0 flex-col border-r border-hairline bg-surface"
          data-id="compare-changes"
        >
          <div className="flex items-center justify-between px-3 pb-1 pt-3">
            <h2 className="text-body-strong text-ink">{t("compare.changes")}</h2>
            <span className="text-caption text-ink-tertiary">{changeItems.length}</span>
          </div>
          {/* 방향 요약 — 이 목록이 '무엇에서 무엇으로'의 변경인지 상시 표기 */}
          <div
            className="flex min-w-0 items-center gap-1 px-3 pb-2 text-fine text-ink-tertiary"
            data-id="compare-direction"
          >
            <span className="min-w-0 truncate" title={baseName}>
              {baseName}
            </span>
            <ArrowRight size={11} strokeWidth={1.5} className="shrink-0" />
            <span className="min-w-0 truncate font-semibold text-ink-secondary" title={targetName}>
              {targetName}
            </span>
          </div>
          {hasChanges && (
            <div className="flex flex-col gap-1.5 border-b border-hairline px-3 pb-2">
              {/* 상태 필터 — 전체/추가/삭제/변경(상태 색점+건수) */}
              <div className="flex gap-1.5">
                {(
                  [
                    { key: "all", label: t("compare.filterAll"), count: changeItems.length, dot: "" },
                    { key: "added", label: "", count: counts.added, dot: "bg-added" },
                    { key: "removed", label: "", count: counts.removed, dot: "bg-removed" },
                    { key: "changed", label: "", count: counts.changed, dot: "bg-changed" },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setFilter(chip.key)}
                    className={`flex h-6 items-center gap-1.5 rounded-full border px-2 text-fine ${
                      filter === chip.key
                        ? "border-accent-tint-border bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                  >
                    {chip.dot && <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />}
                    {chip.label && <span>{chip.label}</span>}
                    <span className="font-semibold">{chip.count}</span>
                  </button>
                ))}
              </div>
              {/* 종류 필터 — 모두/노드만/엣지만 */}
              <div className="flex gap-1.5">
                {(
                  [
                    { key: "all", label: t("compare.kindAll"), count: changeItems.length },
                    { key: "node", label: t("compare.kindNodes"), count: kindCounts.node },
                    { key: "edge", label: t("compare.kindEdges"), count: kindCounts.edge },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setKindFilter(chip.key)}
                    className={`flex h-6 items-center gap-1.5 rounded-full border px-2 text-fine ${
                      kindFilter === chip.key
                        ? "border-accent-tint-border bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                  >
                    <span>{chip.label}</span>
                    <span className="font-semibold">{chip.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {!hasChanges ? (
              <div className="px-1.5 py-1 text-caption text-ink-tertiary">
                {t("compare.identical")}
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {shownChanges.map((item) => {
                  const selected = focusId === item.focusId;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => {
                          if (item.isEdge) {
                            const edge = merged.edges.find((e) => e.id === item.focusId);
                            if (edge) focusEdge(edge);
                          } else {
                            focusNode(item.focusId);
                          }
                        }}
                        className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left ${
                          selected ? "bg-accent-tint" : "hover:bg-surface-alt"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-on-accent ${iconBg[item.status]}`}
                        >
                          {statusIcon(item.status)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-caption-strong text-ink">{item.title}</span>
                            <span
                              className={`rounded-full px-1.5 text-fine font-semibold ${badgeClass[item.status]}`}
                            >
                              {badgeLabel[item.status]}
                            </span>
                          </span>
                          {item.fields && item.fields.length > 0 && (
                            // 필드별 세로 행 — 상태색(생성/삭제/변경)·부분 강조, 잘린 값은 호버 팝오버로 전체 표시.
                            <span className="mt-1 flex flex-col gap-0.5">
                              {item.fields.map((f) => (
                                <FieldDiffHoverable
                                  key={f.label}
                                  row={f}
                                  className={`flex min-w-0 items-center gap-1 rounded-xs border px-1 py-px text-fine ${FIELD_DIFF_ROW_CLASS[f.status]}`}
                                >
                                  <span
                                    className={`shrink-0 font-semibold ${FIELD_DIFF_LABEL_CLASS[f.status]}`}
                                  >
                                    {f.label}
                                  </span>
                                  <FieldDiffValues row={f} truncate />
                                </FieldDiffHoverable>
                              ))}
                            </span>
                          )}
                          {item.detail && (
                            <span className="mt-0.5 block text-fine text-ink-tertiary">
                              {item.detail}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {hasMoreChanges && <li ref={changesSentinelRef} className="h-px shrink-0" />}
              </ul>
            )}
          </div>
        </aside>
        )}
        <div className="relative min-w-0 flex-1 overflow-hidden bg-canvas" data-id="compare-canvas">
          {/* Compare View 워터마크 — 읽기전용 인지(에디터 read-only 워터마크 재활용, dot-grid 대체).
              z-[4]로 노드(z-2) 위에 덮되 opacity .14로 투과 — 에디터 워터마크와 동일. */}
          <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center overflow-hidden">
            <span className="-rotate-[18deg] select-none whitespace-nowrap text-[120px] font-semibold uppercase tracking-widest text-accent opacity-[0.14]">
              {t("compare.watermark")}
            </span>
          </div>
          <NodeActionsContext.Provider value={COMPARE_NODE_ACTIONS}>
          <ReactFlow
            key={flowDir}
            nodes={rfNodes}
            edges={appEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            /* 세션 한정 드래그 — 배치는 자동(dagre)이지만 검토 중 임시로 끌어 볼 수 있다.
               저장하지 않으며 방향 토글·버전 전환 시 원위치(sessionPos 키에 레이아웃 기준 포함). */
            nodesDraggable
            onNodesChange={handleNodesChange}
            onNodeDragStop={handleNodeDragStop}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            fitView
            minZoom={0.2}
            onNodeClick={(_, node) => setFocusId(node.id)}
            onEdgeClick={(_, edge) => setFocusId(edge.id)}
            /* 에디터와 동일한 휠/팬 맵핑 — 휠=상하·좌우 팬, Ctrl/⌘+휠=줌, 좌클릭·Space 드래그=팬(그랩). */
            panOnDrag
            panActivationKeyCode="Space"
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomActivationKeyCode={["Control", "Meta"]}
          >
            {/* 선택 노드 위로 슬라이드하는 포커스 링(에디터와 동일 — ViewportPortal로 flow 좌표 정합) */}
            <ViewportPortal>
              <NodeSelectionRing />
            </ViewportPortal>
            {/* dot-grid 제거 · 좌상 카운트 필 제거(좌하 범례로 통합) */}
            <Panel
              position="bottom-left"
              className="rounded-sm border border-hairline bg-surface/80 px-2.5 py-1.5 shadow-sm backdrop-blur-sm"
            >
              <DiffLegend counts={counts} />
            </Panel>
            <Panel position="bottom-right">
              <ZoomBar />
            </Panel>
          </ReactFlow>
          </NodeActionsContext.Provider>
        </div>
        {inspectorOpen && (
          <aside
            className="flex w-72 shrink-0 flex-col border-l border-hairline bg-surface"
            data-id="compare-inspector"
          >
            {/* 탭 — 속성(선택 대상) / 요약(버전 파라미터 합계) */}
            <div className="flex items-center gap-1 border-b border-hairline px-3 pb-2 pt-3">
              {(
                [
                  { key: "props", label: t("compare.properties") },
                  { key: "summary", label: t("compare.summaryTab") },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  data-id={`compare-inspector-tab-${tab.key}`}
                  onClick={() => setInspectorTab(tab.key)}
                  className={`rounded-sm px-2 py-0.5 text-caption ${
                    inspectorTab === tab.key
                      ? "bg-accent-tint font-semibold text-accent"
                      : "text-ink-secondary hover:bg-surface-alt"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              {inspectorTab === "summary" ? (
                // 요약 항목 표시 선택 — 체크 해제=숨김, 숨긴 개수는 (-N)으로 표기 (읽기전용 필 대체)
                <div className="relative ml-auto">
                  <button
                    type="button"
                    data-id="compare-sum-visibility"
                    title={t("compare.sumVisibility")}
                    aria-label={t("compare.sumVisibility")}
                    onClick={() => setSumMenuOpen((open) => !open)}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
                  >
                    <SlidersHorizontal size={12} strokeWidth={1.5} />
                    {hiddenSumCount > 0 && (
                      <span className="font-semibold text-changed">(-{hiddenSumCount})</span>
                    )}
                    <ChevronDown size={11} strokeWidth={1.5} className="text-ink-tertiary" />
                  </button>
                  {sumMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-[1000]" onClick={() => setSumMenuOpen(false)} />
                      <div className="absolute right-0 z-[1001] mt-1 max-h-80 w-52 overflow-auto rounded-md border border-hairline bg-surface py-1 shadow-lg">
                        {summaryItems.map((item) => (
                          <label
                            key={item.key}
                            className="flex cursor-pointer items-center gap-2 px-3 py-1 text-caption text-ink hover:bg-surface-alt"
                          >
                            <input
                              type="checkbox"
                              data-id={`compare-sum-toggle-${item.key}`}
                              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                              checked={!hiddenSums.has(item.key)}
                              onChange={() =>
                                setHiddenSums((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.key)) next.delete(item.key);
                                  else next.add(item.key);
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0 truncate">{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1 rounded-sm bg-surface-alt px-2 py-0.5 text-fine font-semibold text-ink-secondary">
                  <Lock size={12} strokeWidth={1.7} />
                  {t("compare.viewOnly")}
                </span>
              )}
            </div>
            {inspectorTab === "summary" ? (
              // 요약 탭 — 버전 합계 카드(파라미터·구조·시스템·부서/담당자·GMP). 드롭다운 체크로 숨김.
              <div
                className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-3"
                data-id="compare-summary"
              >
                {paramSummary
                  .filter(({ field }) => !hiddenSums.has(field))
                  .map(({ field, base, target, rows }) => (
                    <SummaryCard
                      key={field}
                      dataId={`compare-sum-${field}`}
                      icon={PARAM_ICON[field]}
                      label={t(PARAM_LABEL_KEY[field])}
                      subLabel={field === "headcount" ? t("compare.avg") : undefined}
                      delta={formatSumDelta(field, base, target)}
                      baseText={displayFieldValue(field, base) || t("summary.none")}
                      targetText={displayFieldValue(field, target) || t("summary.none")}
                      open={openParams.has(field)}
                      onToggle={() => toggleSumOpen(field)}
                    >
                      <ul className="border-t border-hairline px-1 py-1">
                        {rows.map((row) => (
                          <li key={row.key}>
                            <button
                              type="button"
                              data-id={`compare-sum-${field}-node-${row.key}`}
                              onClick={() => focusNode(row.key)}
                              className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                            >
                              <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">
                                {row.title}
                              </span>
                              {row.base === row.target ? (
                                <span className="shrink-0 text-caption text-ink-secondary">
                                  {displayFieldValue(field, row.target)}
                                </span>
                              ) : (
                                <span className="flex shrink-0 items-center gap-1 text-caption">
                                  <span className="text-ink-muted line-through">
                                    {displayFieldValue(field, row.base) || t("summary.none")}
                                  </span>
                                  <span className="text-ink-tertiary">→</span>
                                  <span className="font-semibold text-changed">
                                    {displayFieldValue(field, row.target) || t("summary.none")}
                                  </span>
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </SummaryCard>
                  ))}
                {isSumShown("structure") && (
                  <SummaryCard
                    dataId="compare-sum-structure"
                    icon={Boxes}
                    label={t("compare.sumStructure")}
                    delta={formatCountDelta(
                      extraSummary.structure.base.nodes,
                      extraSummary.structure.target.nodes,
                    )}
                    baseText={String(extraSummary.structure.base.nodes)}
                    targetText={String(extraSummary.structure.target.nodes)}
                    open={openParams.has("structure")}
                    onToggle={() => toggleSumOpen("structure")}
                  >
                    <ul className="flex flex-col gap-1 border-t border-hairline px-2 py-1.5">
                      {(
                        [
                          { key: "nodes", label: t("compare.statNodes") },
                          { key: "edges", label: t("compare.statEdges") },
                          { key: "decisions", label: t("nodeType.decision") },
                          { key: "subprocesses", label: t("nodeType.subprocess") },
                        ] as const
                      ).map(({ key, label }) => {
                        const b = extraSummary.structure.base[key];
                        const tn = extraSummary.structure.target[key];
                        const rowDelta = formatCountDelta(b, tn);
                        return (
                          <li key={key} className="flex items-center gap-1.5 text-caption">
                            <span className="min-w-0 flex-1 truncate text-ink-secondary">{label}</span>
                            <span className={b === tn ? "text-ink-secondary" : "text-ink-muted"}>{b}</span>
                            <span className="text-ink-tertiary">→</span>
                            <span className={`font-semibold ${b === tn ? "text-ink-secondary" : "text-ink"}`}>
                              {tn}
                            </span>
                            {rowDelta && (
                              <span className="rounded-full bg-changed/10 px-1 text-fine font-semibold text-changed">
                                {rowDelta}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </SummaryCard>
                )}
                {isSumShown("systems") && (
                  <SummaryCard
                    dataId="compare-sum-systems"
                    icon={Server}
                    label={t("compare.sumSystems")}
                    delta={formatCountDelta(extraSummary.systemCounts.base, extraSummary.systemCounts.target)}
                    baseText={String(extraSummary.systemCounts.base)}
                    targetText={String(extraSummary.systemCounts.target)}
                    open={openParams.has("systems")}
                    onToggle={() => toggleSumOpen("systems")}
                  >
                    <div className="flex flex-wrap gap-1 border-t border-hairline px-2 py-1.5">
                      {extraSummary.systems.added.map((v) => (
                        <span key={`+${v}`} className="rounded-full bg-added/10 px-1.5 text-fine font-semibold text-added">
                          + {v}
                        </span>
                      ))}
                      {extraSummary.systems.removed.map((v) => (
                        <span key={`-${v}`} className="rounded-full bg-removed/10 px-1.5 text-fine font-semibold text-removed line-through">
                          {v}
                        </span>
                      ))}
                      {extraSummary.systems.kept.map((v) => (
                        <span key={v} className="rounded-full border border-hairline px-1.5 text-fine text-ink-secondary">
                          {v}
                        </span>
                      ))}
                    </div>
                  </SummaryCard>
                )}
                {isSumShown("departments") && (
                  <SummaryCard
                    dataId="compare-sum-departments"
                    icon={Building2}
                    label={t("compare.sumDepartments")}
                    delta={formatCountDelta(
                      extraSummary.departmentCounts.base,
                      extraSummary.departmentCounts.target,
                    )}
                    baseText={String(extraSummary.departmentCounts.base)}
                    targetText={String(extraSummary.departmentCounts.target)}
                    open={openParams.has("departments")}
                    onToggle={() => toggleSumOpen("departments")}
                  >
                    <div className="border-t border-hairline px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {extraSummary.departments.added.map((v) => (
                          <span key={`+${v}`} className="rounded-full bg-added/10 px-1.5 text-fine font-semibold text-added">
                            + {v}
                          </span>
                        ))}
                        {extraSummary.departments.removed.map((v) => (
                          <span key={`-${v}`} className="rounded-full bg-removed/10 px-1.5 text-fine font-semibold text-removed line-through">
                            {v}
                          </span>
                        ))}
                        {extraSummary.departments.kept.map((v) => (
                          <span key={v} className="rounded-full border border-hairline px-1.5 text-fine text-ink-secondary">
                            {v}
                          </span>
                        ))}
                      </div>
                      {/* 담당자 지정률 — process/decision 자체 assignee 기준(SP 상속 제외) */}
                      <div className="mt-1.5 flex items-center gap-1.5 text-caption">
                        <span className="min-w-0 flex-1 truncate text-ink-tertiary">
                          {t("compare.assigneeCoverage")}
                        </span>
                        <span className="text-ink-secondary">
                          {formatCoverage(
                            extraSummary.coverage.base.assigned,
                            extraSummary.coverage.base.eligible,
                          )}
                        </span>
                        <span className="text-ink-tertiary">→</span>
                        <span className="font-semibold text-ink">
                          {formatCoverage(
                            extraSummary.coverage.target.assigned,
                            extraSummary.coverage.target.eligible,
                          )}
                        </span>
                      </div>
                    </div>
                  </SummaryCard>
                )}
                {isSumShown("gmp") && (
                  <SummaryCard
                    dataId="compare-sum-gmp"
                    icon={ShieldCheck}
                    label={t("field.gmp")}
                    delta={formatCountDelta(
                      extraSummary.gmp.base.direct + extraSummary.gmp.base.indirect + extraSummary.gmp.base.non_gmp,
                      extraSummary.gmp.target.direct + extraSummary.gmp.target.indirect + extraSummary.gmp.target.non_gmp,
                    )}
                    baseText={String(
                      extraSummary.gmp.base.direct + extraSummary.gmp.base.indirect + extraSummary.gmp.base.non_gmp,
                    )}
                    targetText={String(
                      extraSummary.gmp.target.direct + extraSummary.gmp.target.indirect + extraSummary.gmp.target.non_gmp,
                    )}
                    open={openParams.has("gmp")}
                    onToggle={() => toggleSumOpen("gmp")}
                  >
                    <ul className="flex flex-col gap-1 border-t border-hairline px-2 py-1.5">
                      {[
                        ...GMP_OPTIONS.map((option) => ({
                          key: option.value as string,
                          label: option.label,
                          style: getGmpBadgeStyle(option.value),
                        })),
                        { key: "unset", label: t("perm.processFields.gmpUnset"), style: undefined },
                      ]
                        .filter(({ key }) => extraSummary.gmp.base[key] > 0 || extraSummary.gmp.target[key] > 0)
                        .map(({ key, label, style }) => {
                          const b = extraSummary.gmp.base[key];
                          const tn = extraSummary.gmp.target[key];
                          const rowDelta = formatCountDelta(b, tn);
                          return (
                            <li key={key} className="flex items-center gap-1.5 text-caption">
                              <span
                                className={`min-w-0 flex-1 truncate ${style ? "" : "text-ink-tertiary"}`}
                              >
                                <span
                                  className={style ? "rounded-full px-1.5 py-0.5 text-fine" : "text-caption"}
                                  style={style}
                                >
                                  {label}
                                </span>
                              </span>
                              <span className={b === tn ? "text-ink-secondary" : "text-ink-muted"}>{b}</span>
                              <span className="text-ink-tertiary">→</span>
                              <span className={`font-semibold ${b === tn ? "text-ink-secondary" : "text-ink"}`}>
                                {tn}
                              </span>
                              {rowDelta && (
                                <span className="rounded-full bg-changed/10 px-1 text-fine font-semibold text-changed">
                                  {rowDelta}
                                </span>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  </SummaryCard>
                )}
              </div>
            ) : !selectedNode && selectedEdge ? (
              // 엣지 포커스 — 빈 안내 대신 배선 정보(출발→도착·상태·라벨·선 모양) (B7)
              <div
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3"
                data-id="compare-inspector-edge"
              >
                <div>
                  <div className="mb-1 text-fine text-ink-tertiary">{t("compare.kindEdges")}</div>
                  <div className="rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink-secondary">
                    {titleByKey.get(selectedEdge.source) ?? "?"}
                    <span className="mx-1 text-ink-tertiary">→</span>
                    {titleByKey.get(selectedEdge.target) ?? "?"}
                  </div>
                </div>
                <div className="divide-y divide-divider">
                  <InspectorRow label={t("field.type")}>
                    {selectedEdge.status === "unchanged" ? (
                      <span className="text-ink-tertiary">-</span>
                    ) : (
                      <span
                        className={`rounded-full px-1.5 text-fine font-semibold ${badgeClass[selectedEdge.status]}`}
                      >
                        {badgeLabel[selectedEdge.status]}
                      </span>
                    )}
                  </InspectorRow>
                  <InspectorRow label={t("compare.edgeLabelField")}>
                    {selectedEdge.labelChange ? (
                      <>
                        <span className="text-ink-muted line-through">
                          {selectedEdge.labelChange.before || t("summary.none")}
                        </span>
                        <span className="mx-1 text-ink-tertiary">→</span>
                        <span className="font-semibold text-changed">
                          {selectedEdge.labelChange.after || t("summary.none")}
                        </span>
                      </>
                    ) : (
                      <span className={selectedEdge.label ? "text-ink-secondary" : "text-ink-tertiary"}>
                        {selectedEdge.label || t("summary.none")}
                      </span>
                    )}
                  </InspectorRow>
                  <InspectorRow label={t("inspector.edgeStyle")}>
                    {t(
                      selectedEdge.lineStyle === "straight"
                        ? "edgeStyle.straight"
                        : selectedEdge.lineStyle === "default"
                          ? "edgeStyle.curve"
                          : "edgeStyle.step",
                    )}
                  </InspectorRow>
                </div>
              </div>
            ) : !selectedNode ? (
              <div className="px-3 py-3 text-caption text-ink-tertiary">
                {t("compare.selectNode")}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
                <div>
                  <div className="mb-1 text-fine text-ink-tertiary">{t(FIELD_MSG.title)}</div>
                  <div className="rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink-secondary">
                    {selectedNode.node.title || t("summary.none")}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-fine text-ink-tertiary">{t(FIELD_MSG.description)}</div>
                  <div className="min-h-[2rem] whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1.5 text-caption leading-relaxed text-ink-tertiary">
                    {selectedNode.node.description || t("summary.none")}
                  </div>
                </div>
                <div className="divide-y divide-divider">
                  <InspectorRow label={t(FIELD_MSG.type)}>
                    {t(`nodeType.${normalizeNodeType(selectedNode.node.node_type)}` as MessageKey)}
                  </InspectorRow>
                  <InspectorRow label={t(FIELD_MSG.color)}>
                    {selectedNode.node.color ? (
                      <span
                        className="inline-block h-5 w-5 rounded-[5px] border align-middle"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${selectedNode.node.color} 18%, white)`,
                          borderColor: selectedNode.node.color,
                        }}
                      />
                    ) : (
                      <span className="text-ink-tertiary">{t("summary.none")}</span>
                    )}
                  </InspectorRow>
                  {(
                    [
                      "assignee",
                      "department",
                      "system",
                      "duration",
                      "touch_time",
                      "cost_krw",
                      "cost_usd",
                      "headcount",
                      "annual_count",
                      "fte",
                      "gmp",
                    ] as const
                  ).map((key) => {
                    const change = selectedNode.fieldChanges.find((fc) => fc.field === key);
                    const current = displayFieldValue(key, selectedNode.node[key] || "");
                    return (
                      <InspectorRow key={key} label={t(FIELD_MSG[key])}>
                        {change ? (
                          <>
                            <span className="text-ink-muted line-through">
                              {displayFieldValue(key, change.before) || t("summary.none")}
                            </span>
                            <span className="mx-1 text-ink-tertiary">→</span>
                            <span className="font-semibold text-changed">
                              {displayFieldValue(key, change.after) || t("summary.none")}
                            </span>
                          </>
                        ) : (
                          <span className={current ? "text-ink-secondary" : "text-ink-tertiary"}>
                            {current || t("summary.none")}
                          </span>
                        )}
                      </InspectorRow>
                    );
                  })}
                </div>
                {/* I/O·조건 — 긴 텍스트 필드는 블록형, 값이나 변경이 있는 것만 (인터뷰 승격 필드 최신화) */}
                {(() => {
                  const longFields = [
                    "input",
                    "output",
                    "input_forms",
                    "output_forms",
                    "data_form",
                    "start_condition",
                    "end_condition",
                  ] as const;
                  const rows = longFields
                    .map((key) => ({
                      key,
                      change: selectedNode.fieldChanges.find((fc) => fc.field === key),
                      current: selectedNode.node[key] ?? "",
                    }))
                    .filter((row) => row.change || row.current);
                  if (rows.length === 0) return null;
                  return (
                    <div className="flex flex-col gap-2" data-id="compare-inspector-io">
                      <div className="text-fine font-semibold text-ink-tertiary">
                        {t("inspector.details")}
                      </div>
                      {rows.map(({ key, change, current }) => (
                        <div key={key}>
                          <div className="mb-1 text-fine text-ink-tertiary">{t(FIELD_MSG[key])}</div>
                          {change ? (
                            <div className="rounded-sm border border-changed/30 bg-changed/10 px-2 py-1.5 text-caption">
                              <div className="whitespace-pre-wrap text-ink-muted line-through">
                                {change.before || t("summary.none")}
                              </div>
                              <div className="whitespace-pre-wrap font-semibold text-ink">
                                {change.after || t("summary.none")}
                              </div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink-secondary">
                              {current}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// 로드 실패 공통 처리 — 403은 접근 안내 모달, 그 외는 인라인 안내(무한 로딩 방지). 3개 로드 effect 공용.
function applyLoadError(
  err: unknown,
  t: (key: MessageKey) => string,
  setAccessDenied: (denied: boolean) => void,
  setLoadError: (message: string | null) => void,
): void {
  if (err instanceof ApiError && err.status === 403) {
    setAccessDenied(true);
  } else {
    setLoadError(humanizeApiError(err, t));
  }
}

export default function ComparePage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);
  const router = useRouter();
  const { t } = useI18n();

  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  // PNG 정보 카드 소스 — getMap 상세에서 1회 조립(게시일은 버전 events에서 추출)
  const [mapMeta, setMapMeta] = useState<CompareMapMeta | null>(null);
  const [baseId, setBaseId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [baseGraph, setBaseGraph] = useState<VersionGraph | null>(null);
  const [targetGraph, setTargetGraph] = useState<VersionGraph | null>(null);
  // 비공개 맵 접근 게이트 — 로드 403이면 에디터와 동일한 안내 모달 후 홈으로 (에디터 page.tsx accessDenied와 동일 패턴)
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const detail = await getMap(mapId);
        if (!active) return;
        setMapName(detail.name);
        setVersions(detail.versions);
        setMapMeta({
          owningDept: detail.owning_department ?? null,
          ownerName: detail.owner_name ?? detail.created_by ?? null,
          categoryPath: detail.category_path ?? null,
          publishedById: new Map(detail.versions.map((v) => [v.id, findPublishedAt(v.events)])),
        });
        // base=게시(published) 버전 우선(없으면 최초), target=최신 — 게시본을 기준선으로 비교.
        const published = detail.versions.find((version) => version.status === "published");
        setBaseId((published ?? detail.versions[0]).id);
        setTargetId(detail.versions[detail.versions.length - 1].id);
      } catch (err) {
        if (active) applyLoadError(err, t, setAccessDenied, setLoadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId, t]);

  useEffect(() => {
    if (baseId === null) return;
    let active = true;
    void (async () => {
      try {
        const graph = await getFullGraph(baseId);
        if (active) setBaseGraph(graph);
      } catch (err) {
        if (active) applyLoadError(err, t, setAccessDenied, setLoadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [baseId, t]);

  useEffect(() => {
    if (targetId === null) return;
    let active = true;
    void (async () => {
      try {
        const graph = await getFullGraph(targetId);
        if (active) setTargetGraph(graph);
      } catch (err) {
        if (active) applyLoadError(err, t, setAccessDenied, setLoadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [targetId, t]);

  const ready =
    baseId !== null &&
    targetId !== null &&
    versions.length > 0 &&
    mapMeta !== null &&
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
            mapMeta={mapMeta}
            baseId={baseId}
            targetId={targetId}
            baseGraph={baseGraph}
            targetGraph={targetGraph}
            onChangeBase={setBaseId}
            onChangeTarget={setTargetId}
          />
        </ReactFlowProvider>
      ) : loadError ? (
        <div data-id="compare-load-error" className="p-8 text-caption text-error">
          {loadError}
        </div>
      ) : (
        <div className="p-8 text-caption text-ink-tertiary">…</div>
      )}
      {/* 비공개 맵 접근 게이트 — 403 로드 실패 안내, 확인/닫기 모두 홈으로 (에디터 page.tsx와 동일 패턴) */}
      {accessDenied && (
        <ConfirmDialog
          icon={<Lock size={28} strokeWidth={1.5} />}
          title={t("mapAccess.deniedTitle")}
          message={t("mapAccess.deniedBody")}
          confirmLabel={t("mapAccess.deniedConfirm")}
          onConfirm={() => router.replace("/")}
          onClose={() => router.replace("/")}
        />
      )}
    </div>
  );
}
