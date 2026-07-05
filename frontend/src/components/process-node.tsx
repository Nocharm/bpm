"use client";

import { Fragment, useRef, type CSSProperties } from "react";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  CornerDownRight,
  Lock,
  type LucideIcon,
  MessageSquare,
  Server,
  Tag,
  User,
  Workflow,
  Zap,
} from "lucide-react";

import {
  hasBpmAttributes,
  type AppNode,
  type HandleSide,
  type ProcessNodeType,
  terminalDisplayLabel,
  toPosition,
} from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { type NodeDisplayField, useNodeActions } from "@/lib/node-actions";
import {
  PRIMARY_END_HANDLE,
  SUBPROCESS_IN_HANDLE,
  type SubEnd,
} from "@/lib/subprocess-embed";

const FIELD_ICON: Record<NodeDisplayField, LucideIcon> = {
  assignee: User,
  department: Building2,
  system: Server,
  duration: Clock,
  nodeType: Tag,
};

const NODE_TYPE_LABEL_KEY: Record<ProcessNodeType, MessageKey> = {
  process: "nodeType.process",
  decision: "nodeType.decision",
  start: "nodeType.start",
  end: "nodeType.end",
  subprocess: "nodeType.subprocess",
};

// 노드에 표시할 정보 줄들 — displayFields(컨텍스트)에서 켜진 필드 중 값이 있는 것만 여러 줄로
// start/end는 BPM 속성(담당자/부서/시스템/소요) 줄을 표시하지 않음.
// subprocess는 노드 자체 필드 대신 지정 어트리뷰트(sp*, 라이브 참조)를 표시 (spec 2026-07-06).
function NodeFields({ data }: { data: AppNode["data"] }) {
  const { t } = useI18n();
  const { displayFields } = useNodeActions();
  const isSubprocess = data.nodeType === "subprocess";
  const spValues: Record<Exclude<NodeDisplayField, "nodeType">, string | null | undefined> = {
    assignee: data.spAssignee,
    department: data.spDepartment,
    system: data.spSystem,
    duration: data.spDuration,
  };
  return (
    <>
      {displayFields.map((field) => {
        // nodeType 외의 BPM 속성 필드는 process·decision(+지정 subprocess)만 표시
        if (field !== "nodeType" && !hasBpmAttributes(data.nodeType) && !isSubprocess) {
          return null;
        }
        const value =
          field === "nodeType"
            ? t(NODE_TYPE_LABEL_KEY[data.nodeType])
            : isSubprocess
              ? spValues[field]
              : data[field];
        if (!value) {
          return null;
        }
        const Icon = FIELD_ICON[field];
        return (
          <div key={field} className="mt-0.5 text-xs text-ink-tertiary">
            <span className="inline-flex items-center gap-1">
              <Icon size={12} strokeWidth={1.5} />
              {value}
            </span>
          </div>
        );
      })}
    </>
  );
}

// 노드 타이틀 — 더블클릭 인라인 편집(editingNodeId 일치 시 입력 모드). 평상시 호버에 I-beam 커서.
// 타이틀 더블클릭만 이름 편집으로 진입(stopPropagation) — 이름 외 영역은 노드 요약창으로.
// displayLabel: 표시 전용(시작/끝의 "Start (라벨)"). 편집 입력은 항상 원본 label을 다룬다.
function NodeTitle({
  id,
  label,
  displayLabel,
}: {
  id: string;
  label: string;
  displayLabel?: string;
}) {
  const { editingNodeId, onStartRename, onRename, onCancelRename } = useNodeActions();
  // Esc 취소 시 onBlur가 값을 다시 커밋하지 않도록 가드
  const cancelledRef = useRef(false);

  if (editingNodeId === id && onRename) {
    return (
      <input
        autoFocus
        defaultValue={label}
        // nodrag — 입력 중 React Flow가 노드를 끌지 않게
        className="nodrag w-full rounded-xs border border-accent bg-surface px-1 text-center text-sm text-ink"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onBlur={(event) => {
          if (cancelledRef.current) {
            cancelledRef.current = false;
            return;
          }
          onRename(id, event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelledRef.current = true;
            onCancelRename?.();
          }
        }}
      />
    );
  }
  return (
    <span
      className={onStartRename ? "cursor-text" : undefined}
      onDoubleClick={
        onStartRename
          ? (event) => {
              // 타이틀 더블클릭 = 이름 편집 (노드 더블클릭=요약창으로 버블되지 않게 차단)
              event.stopPropagation();
              onStartRename(id);
            }
          : undefined
      }
    >
      {displayLabel ?? label}
    </span>
  );
}

// 타입별 기본 stroke — data.color 미지정(빈 값) 시 사용. 세련된 무채도 톤(데이터/출력 예외 → raw hex 허용)
const DEFAULT_COLORS: Record<ProcessNodeType, string> = {
  process: "#6e84a3", // slate (E3)
  decision: "#c7a062", // amber
  start: "#84a07c", // sage
  end: "#c2849a", // rose
  subprocess: "#7c6adc", // violet
};

// data.color 우선, 없으면 타입별 기본 stroke — 미니맵 등에서 실제 노드 색 재사용.
export function resolveNodeStroke(color: string, nodeType: ProcessNodeType): string {
  return color || DEFAULT_COLORS[nodeType];
}

// 파스텔 fill — 저장된 stroke color에서 파생(데이터 모델 무변경)
function deriveFill(color: string): string {
  return `color-mix(in srgb, ${color} 18%, white)`;
}

// 비교 화면 diff — 노드 자기색 대신 diff색으로 테두리/틴트/뱃지 (에디터에선 diffStatus 미설정).
type DiffStatus = "added" | "removed" | "changed";
const DIFF_COLOR: Record<DiffStatus, string> = {
  added: "var(--color-added)",
  removed: "var(--color-removed)",
  changed: "var(--color-changed)",
};
const DIFF_BADGE_KEY: Record<DiffStatus, MessageKey> = {
  added: "compare.legendAdded",
  removed: "compare.legendRemoved",
  changed: "compare.legendChanged",
};
const DIFF_BADGE_BG: Record<DiffStatus, string> = {
  added: "bg-added",
  removed: "bg-removed",
  changed: "bg-changed",
};

// diff 노드 스타일 — diff색 테두리(삭제=점선)+연한 틴트 fill. --nc는 호버 강조 링용.
function diffNodeStyle(status: DiffStatus): CSSProperties {
  const c = DIFF_COLOR[status];
  return {
    borderColor: c,
    borderWidth: "1.5px",
    borderStyle: status === "removed" ? "dashed" : "solid",
    background: `color-mix(in srgb, ${c} 12%, white)`,
    "--nc": c,
  } as unknown as CSSProperties;
}

// 상태 뱃지(상단) — opacity .7로 내용 안 가림. 위치는 className으로(마름모는 상단중앙).
function DiffBadge({ status, className = "-top-2.5 left-2.5" }: { status: DiffStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute z-10 rounded-full px-1.5 text-[11px] font-semibold leading-5 text-white opacity-70 ${DIFF_BADGE_BG[status]} ${className}`}
    >
      {t(DIFF_BADGE_KEY[status])}
    </span>
  );
}

// 필 배경은 노드 fill과 동일한 불투명 틴트 — 뒤로 지나는 엣지(우회 아크)가 비쳐 변경 내용을 가리지 않게.
const CHANGED_PILL_BG = "color-mix(in srgb, var(--color-changed) 12%, white)";

// 변경 필드 before→after 필 — 노드 아래에 절대배치(레이아웃 영향 없음). changed 노드만.
// 최대 3줄 + "+N more"로 캡(다필드 변경 시 아래 노드 침범 방지). 값은 폭 제한 truncate.
function DiffFieldPills({ fields }: { fields: NonNullable<AppNode["data"]["diffFields"]> }) {
  const { t } = useI18n();
  const shown = fields.slice(0, 3);
  const extra = fields.length - shown.length;
  return (
    <div className="absolute left-0 top-full z-10 mt-1.5 flex flex-col items-start gap-1">
      {shown.map((field) => (
        <span
          key={field.label}
          className="flex max-w-[220px] items-center gap-1 whitespace-nowrap rounded-xs border border-changed/30 px-1.5 py-0.5 text-[11px]"
          style={{ backgroundColor: CHANGED_PILL_BG }}
        >
          <span className="shrink-0 font-semibold text-changed">{field.label}</span>
          <span className="min-w-0 truncate text-ink-muted">{field.before}</span>
          <span className="shrink-0 text-ink-tertiary">→</span>
          <span className="min-w-0 truncate font-semibold text-ink">{field.after}</span>
        </span>
      ))}
      {extra > 0 && (
        <span
          className="rounded-xs border border-changed/30 px-1.5 py-0.5 text-[11px] font-medium text-changed"
          style={{ backgroundColor: CHANGED_PILL_BG }}
        >
          {t("compare.moreFields", { n: extra })}
        </span>
      )}
    </div>
  );
}

// 미해결 코멘트 수 뱃지 (에디터 전용)
function UnresolvedCommentBadge({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <span
      className="absolute -left-2 -top-2 rounded-full bg-removed px-1 text-[10px] leading-4 text-white"
      title={t("node.unresolvedAria", { n: count })}
    >
      <span className="inline-flex items-center gap-0.5">
        <MessageSquare size={10} strokeWidth={1.5} />
        {count}
      </span>
    </span>
  );
}

// 하위 계층에 변경이 있음을 알리는 뱃지 (비교 화면 전용)
function DescendantChangeBadge() {
  const { t } = useI18n();
  return (
    <span
      className="absolute -right-2 -top-2 rounded-full bg-changed px-1 text-[10px] leading-4 text-white"
      title={t("node.childChangedTitle")}
    >
      <Zap size={10} strokeWidth={1.5} />
    </span>
  );
}

// 담당자 부서 드리프트 경고 뱃지 — 담당자의 현재 부서가 노드 부서와 다를 때 (에디터 전용)
function AssigneeWarningBadge() {
  const { t } = useI18n();
  return (
    <span
      className="absolute -bottom-2 -right-2 rounded-full border border-hairline bg-surface p-0.5 shadow-sm"
      title={t("assignee.driftWarn")}
    >
      <AlertTriangle size={12} strokeWidth={1.5} className="text-error" />
    </span>
  );
}

// 미지정 서브프로세스 뱃지 — 링크맵이 지정 해제/미지정이면 경고 삼각형 + 잠금(권한 무관). (spec 2026-07-06)
function UndesignatedBadge() {
  const { t } = useI18n();
  return (
    <span
      data-id="subprocess-undesignated-badge"
      className="absolute -right-2 -top-2 rounded-xs border border-error/40 bg-error/10 p-0.5 shadow-sm"
      title={t("subprocess.undesignated")}
    >
      <AlertTriangle size={14} strokeWidth={1.5} className="text-error" />
    </span>
  );
}

// 잠긴 하위프로세스 뱃지 — 권한 없는 링크맵은 펼침/드릴 대신 자물쇠 표시(봉인 박스). ExpandToggleButton 자리를 대체.
function LockedBadge() {
  const { t } = useI18n();
  return (
    <span
      className="absolute -right-2 -top-2 rounded-xs border border-hairline bg-surface p-0.5 text-ink-secondary shadow-sm"
      title={t("subprocess.locked")}
    >
      <Lock size={16} strokeWidth={1.5} />
    </span>
  );
}

// 호버 시 노드 우상단에 뜨는 인라인 펼치기/접기 토글 — onToggleExpand 있을 때만(compare 등에서는 숨김)
function ExpandToggleButton({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const { onToggleExpand, expandedInlineIds } = useNodeActions();
  if (!onToggleExpand) {
    return null;
  }
  const expanded = expandedInlineIds.has(nodeId);
  return (
    <button
      type="button"
      title={t(expanded ? "node.collapseChildTitle" : "node.expandChildTitle")}
      className="absolute -right-2 -top-2 z-10 rounded-xs border border-hairline bg-surface p-0.5 text-ink-secondary opacity-0 shadow-sm hover:bg-surface-alt group-hover:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        onToggleExpand(nodeId);
      }}
    >
      {expanded ? (
        <ChevronDown size={14} strokeWidth={1.5} />
      ) : (
        <ChevronRight size={14} strokeWidth={1.5} />
      )}
    </button>
  );
}

// 하위프로세스 노드의 핸들 — 좌측 단일 입력, 우측 끝 노드별 출력 (끝 없으면 단일 PRIMARY_END_HANDLE)
function SubprocessHandles({ ends }: { ends: SubEnd[] }) {
  return (
    <>
      <Handle id={SUBPROCESS_IN_HANDLE} type="target" position={Position.Left} />
      {ends.length === 0 ? (
        <Handle id={PRIMARY_END_HANDLE} type="source" position={Position.Right} />
      ) : (
        ends.map((end, i) => (
          <Handle
            key={end.key}
            id={end.key}
            type="source"
            position={Position.Right}
            style={{ top: `${((i + 1) / (ends.length + 1)) * 100}%` }}
            title={end.title}
          />
        ))
      )}
    </>
  );
}

const NODE_SIDES: HandleSide[] = ["left", "right", "top", "bottom"];

// 4변 각각에 source·target 핸들(총 8개) — 엣지가 어느 변에든 붙도록. 어느 핸들에 붙을지는 엣지가 id로 지정.
function NodeHandles() {
  return (
    <>
      {NODE_SIDES.map((side) => (
        <Fragment key={side}>
          <Handle id={`t-${side}`} type="target" position={toPosition(side)} />
          <Handle id={`s-${side}`} type="source" position={toPosition(side)} />
        </Fragment>
      ))}
    </>
  );
}

// 노드 테두리/배경 + 호버 강조 링용 노드색 CSS 변수(--nc). @types/react가 커스텀 속성 인덱스
// 시그니처를 갖지 않아 unknown 경유 캐스팅(런타임은 React가 그대로 전달).
function nodeStyle(color: string, fill: string): CSSProperties {
  return {
    borderColor: color,
    borderWidth: "1.5px",
    borderStyle: "solid",
    background: fill,
    "--nc": color,
  } as unknown as CSSProperties;
}

// 프로세스 단계 노드 — node_type별 모양(사각/마름모/알약), 좌(입력)/우(출력) 핸들로 선후 연결.
export function ProcessNode({ id, data }: NodeProps<AppNode>) {
  const { t } = useI18n();
  const color = data.color || DEFAULT_COLORS[data.nodeType];
  const fill = deriveFill(color);
  const commentCount = data.commentCount ?? 0;
  // 비교화면 diff — diff색 테두리/틴트/뱃지로 표시(에디터에선 diffStatus 미설정 → 자기색). 선택 링은 오버레이 담당.
  const diff = data.diffStatus;
  const style = diff ? diffNodeStyle(diff) : nodeStyle(color, fill);
  const diffFields = data.diffFields ?? [];

  if (data.nodeType === "subprocess") {
    return (
      <div
        className="group bpm-node-emph relative flex w-[180px] min-h-[64px] items-center gap-2 rounded-sm px-3 py-2 text-sm transition-all duration-150"
        style={style}
        title={data.diffNote}
      >
        {diff && <DiffBadge status={diff} />}
        {diffFields.length > 0 && <DiffFieldPills fields={diffFields} />}
        <Workflow size={16} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">
            <NodeTitle id={id} label={data.label} />
          </div>
          {/* 지정 어트리뷰트 줄 — 표시 필드 설정(displayFields)을 따르고, 미지정이면 sp* 비어 자동 생략 */}
          <NodeFields data={data} />
          {data.updateAvailable && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-accent" title={t("subprocess.updateAvailable")}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {t("subprocess.updateAvailable")}
            </div>
          )}
        </div>
        {data.hasDescendantChange && <DescendantChangeBadge />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
        {data.assigneeWarning && <AssigneeWarningBadge />}
        {/* 미지정 경고가 권한 잠금보다 우선 — 원인(지정 해제)을 보여야 오너가 조치 가능 */}
        {data.undesignated ? (
          <UndesignatedBadge />
        ) : data.locked ? (
          <LockedBadge />
        ) : (
          (data.subEnds ?? []).length > 0 && <ExpandToggleButton nodeId={id} />
        )}
        {/* 핸들은 잠금 무관 유지 — 호스트의 입력/대표출력 엣지가 살아있어야 봉인 박스가 흐름에 연결됨.
            비교뷰(diff)에선 방향 토글(LR/TB)로 상/하 진입이 필요해 4변 핸들(NodeHandles)을 쓴다. */}
        {diff ? <NodeHandles /> : <SubprocessHandles ends={data.subEnds ?? []} />}
      </div>
    );
  }

  if (data.nodeType === "decision") {
    return (
      <div
        className="group relative flex h-24 w-24 items-center justify-center"
        title={data.diffNote}
      >
          {/* 마름모는 회전한 사각형으로 그리고 텍스트는 회전하지 않은 레이어에 둔다 */}
        <div
          className="bpm-node-emph absolute inset-3 rotate-45 rounded-sm transition-all duration-150"
          style={style}
        />
        {diff && <DiffBadge status={diff} className="-top-1 left-1/2 -translate-x-1/2" />}
        {diffFields.length > 0 && <DiffFieldPills fields={diffFields} />}
        <div className="relative max-w-20 text-center text-xs font-medium text-ink">
          <NodeTitle id={id} label={data.label} />
          {data.hasChildren && (
            <div className="inline-flex items-center gap-0.5 text-[10px] text-accent">
              <CornerDownRight size={12} strokeWidth={1.5} />
              {t("node.childBadge")}
            </div>
          )}
        </div>
        {data.hasDescendantChange && <DescendantChangeBadge />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
        {data.assigneeWarning && <AssigneeWarningBadge />}
        {/* decision 노드는 기존 하위가 있을 때만 펼침 토글 */}
        {data.hasChildren && <ExpandToggleButton nodeId={id} />}
        <NodeHandles />
      </div>
    );
  }

  const isTerminal = data.nodeType === "start" || data.nodeType === "end";
  return (
    <div
      className={`group bpm-node-emph relative px-3 py-2 text-sm transition-all duration-150 ${
        isTerminal
          ? "min-w-[90px] rounded-full text-center"
          : "min-w-[150px] rounded-sm"
      }`}
      style={style}
      title={data.diffNote}
    >
      {diff && <DiffBadge status={diff} />}
      {diffFields.length > 0 && <DiffFieldPills fields={diffFields} />}
      <div className="font-medium text-ink">
        <NodeTitle
          id={id}
          label={data.label}
          displayLabel={
            isTerminal ? terminalDisplayLabel(data.nodeType, data.label) : undefined
          }
        />
      </div>
      <NodeFields data={data} />
      {data.hasChildren && (
        <div className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-accent">
          <CornerDownRight size={12} strokeWidth={1.5} />
          {t("node.openChildTitle")}
        </div>
      )}
      {data.hasDescendantChange && <DescendantChangeBadge />}
      {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
      {data.assigneeWarning && <AssigneeWarningBadge />}
      {data.hasChildren && <ExpandToggleButton nodeId={id} />}
      <NodeHandles />
    </div>
  );
}
