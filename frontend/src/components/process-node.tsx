"use client";

import { Fragment, useRef, type CSSProperties } from "react";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  AlertTriangle,
  Building2,
  Clock,
  Coins,
  CornerDownRight,
  Link as LinkIcon,
  Lock,
  type LucideIcon,
  MessageSquare,
  Plus,
  Server,
  Tag,
  Target,
  User,
  Users,
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
import { formatParamValue, PARAM_FIELDS, type ParamField } from "@/lib/params";
import {
  PRIMARY_END_HANDLE,
  SUBPROCESS_IN_HANDLE,
  type SubEnd,
} from "@/lib/subprocess-embed";

const FIELD_ICON: Record<NodeDisplayField, LucideIcon> = {
  assignee: User,
  department: Building2,
  system: Server,
  url: LinkIcon,
};

// 노드에 표시할 정보 줄들 — displayFields(컨텍스트)에서 켜진 필드 중 값이 있는 것만 여러 줄로
// start/end는 BPM 속성(담당자/부서/시스템/소요) 줄을 표시하지 않음.
// subprocess는 노드 자체 필드 대신 지정 어트리뷰트(sp*, 라이브 참조)를 표시 (spec 2026-07-06).
function NodeFields({ data }: { data: AppNode["data"] }) {
  const { displayFields } = useNodeActions();
  const isSubprocess = data.nodeType === "subprocess";
  const spValues: Record<NodeDisplayField, string | null | undefined> = {
    assignee: data.spAssignee,
    department: data.spDepartment,
    system: data.spSystem,
    url: data.spUrl,
  };
  return (
    <>
      {displayFields.map((field) => {
        // BPM 속성 줄은 process·decision(+지정 subprocess)만 — url도 동일 규칙 (batch2 ⑦)
        if (!hasBpmAttributes(data.nodeType) && !isSubprocess) {
          return null;
        }
        const raw = isSubprocess ? spValues[field] : data[field];
        // url — 라벨 있으면 라벨만, 없으면 고정 텍스트 LINK(원문 미노출) (batch2 ⑦)
        const urlLabel = isSubprocess ? data.spUrlLabel : data.urlLabel;
        const value = field === "url" ? (raw ? urlLabel || "LINK" : null) : raw;
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

const PARAM_ICON: Record<ParamField, LucideIcon> = {
  duration: Clock, cost_krw: Coins, cost_usd: Coins, headcount: Users, annual_count: Tag, fte: Target,
};

// 파라미터 칩 — 값이 작성된 파라미터 전부, 라벨 없이 아이콘+숫자 (design 2026-07-11 §2.4, 2026-07-13 §3.2)
// subprocess는 회당 4필드를 지정 어트리뷰트(sp*, 라이브 참조)로, 연간 건수·FTE는 노드 자체 값으로 표시.
// duration은 1h30m, 비용 2필드는 통화기호+천단위 콤마, 나머지는 원문 숫자.
function NodeParams({ data, className }: { data: AppNode["data"]; className?: string }) {
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const values: Partial<Record<ParamField, string | null | undefined>> = {
    annual_count: data.annual_count,
    fte: data.fte,
    ...(isSubprocess
      ? {
          duration: data.spDuration,
          cost_krw: data.spCostKrw,
          cost_usd: data.spCostUsd,
          headcount: data.spHeadcount,
        }
      : {
          duration: data.duration,
          cost_krw: data.cost_krw,
          cost_usd: data.cost_usd,
          headcount: data.headcount,
        }),
  };
  // 표시형 결과 기준으로 filled 판정 — 무효(레거시 자유텍스트)는 ""가 되어 칩 자체를 숨김
  // (백엔드가 이미 소거하므로 실제로는 도달하지 않는 방어 코드).
  const displayValue = (f: ParamField): string => formatParamValue(f, values[f]);
  const filled = PARAM_FIELDS.filter((f) => displayValue(f));
  if (filled.length === 0) return null;
  return (
    <div
      className={`mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-tertiary${className ? ` ${className}` : ""}`}
    >
      {filled.map((f) => {
        const Icon = PARAM_ICON[f];
        return (
          <span key={f} className="inline-flex items-center gap-1">
            <Icon size={12} strokeWidth={1.5} />
            {displayValue(f)}
          </span>
        );
      })}
    </div>
  );
}

// 노드 타이틀 — 더블클릭 인라인 편집(editingNodeId 일치 시 입력 모드). 평상시 호버에 I-beam 커서.
// 타이틀 더블클릭만 이름 편집으로 진입(stopPropagation) — 이름 외 영역은 노드 요약창으로.
// displayLabel: 표시 전용(시작/끝의 "Start (라벨)"). 편집 입력은 항상 원본 label을 다룬다.
function NodeTitle({
  id,
  label,
  displayLabel,
  editable = true,
}: {
  id: string;
  label: string;
  displayLabel?: string;
  // false면 인라인 이름 편집 진입 차단 — subprocess는 링크된 맵 이름 고정 (F5)
  editable?: boolean;
}) {
  const { editingNodeId, onStartRename, onRename, onCancelRename } = useNodeActions();
  // Esc 취소 시 onBlur가 값을 다시 커밋하지 않도록 가드
  const cancelledRef = useRef(false);

  if (editable && editingNodeId === id && onRename) {
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
      className={editable && onStartRename ? "cursor-text" : undefined}
      onDoubleClick={
        editable && onStartRename
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
  section: "#909098", // stone
};

// data.color 우선, 없으면 타입별 기본 stroke — 미니맵 등에서 실제 노드 색 재사용.
// subprocess는 단일색 고정이라 저장 color 무시 (spec 2026-07-06 §9)
export function resolveNodeStroke(color: string, nodeType: ProcessNodeType): string {
  if (nodeType === "subprocess") return DEFAULT_COLORS.subprocess;
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
// className — 위치 오버라이드: 마름모(분기)는 사각 경계 코너가 도형에서 멀어 안쪽 오프셋 사용 (batch2 ⑬)
function UnresolvedCommentBadge({
  count,
  className = "-left-2 -top-2",
}: {
  count: number;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute ${className} rounded-full bg-removed px-1 text-[10px] leading-4 text-white`}
      title={t("node.unresolvedAria", { n: count })}
    >
      <span className="inline-flex items-center gap-0.5">
        <MessageSquare size={10} strokeWidth={1.5} />
        {count}
      </span>
    </span>
  );
}

// URL 배지 — url 지정 노드 좌하단 표시 전용(반투명 액센트, 클릭 없음). 좌상단은 코멘트 배지,
// 우상·우하단은 경고/펼침이 사용 — 좌하단이 에디터·비교뷰 통틀어 유일하게 빈 모서리.
// 비교뷰는 노드 data에 url 미탑재(compare/page.tsx buildNodes)라 자동 미표시. (batch2 ⑧)
function UrlBadge({ url, className = "-bottom-2 -left-2" }: { url: string; className?: string }) {
  return (
    <span
      data-id="node-url-badge"
      className={`absolute ${className} rounded-xs border border-accent-tint-border bg-accent-tint/80 p-0.5 text-accent opacity-70`}
      title={url}
    >
      <LinkIcon size={12} strokeWidth={1.5} />
    </span>
  );
}

// 하위 계층에 변경이 있음을 알리는 뱃지 (비교 화면 전용)
function DescendantChangeBadge({ className = "-right-2 -top-2" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute ${className} rounded-full bg-changed px-1 text-[10px] leading-4 text-white`}
      title={t("node.childChangedTitle")}
    >
      <Zap size={10} strokeWidth={1.5} />
    </span>
  );
}

// 담당자 부서 드리프트 경고 뱃지 — 담당자의 현재 부서가 노드 부서와 다를 때 (에디터 전용)
function AssigneeWarningBadge({ className = "-bottom-2 -right-2" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute ${className} rounded-full border border-hairline bg-surface p-0.5 shadow-sm`}
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

// 잠긴 하위프로세스 뱃지 — 권한 없는 링크맵은 펼침/드릴 대신 자물쇠 표시(봉인 박스). 펼침 버튼 자리를 대체.
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

// Ctrl/⌘+드래그 사본 배지 — 이 노드를 놓으면 원위치에 사본이 남는다는 신호(잔상과 세트, 드래그 중만 표시).
function CopyDragBadge({ className = "-right-2 -top-2" }: { className?: string }) {
  return (
    <span className={`absolute ${className} rounded-full bg-accent p-0.5 text-on-accent shadow-sm`}>
      <Plus size={14} strokeWidth={1.5} />
    </span>
  );
}

// 하위프로세스 노드의 핸들 — 좌측 단일 입력, 우측 끝 노드별 출력 (끝 없으면 단일 PRIMARY_END_HANDLE)
// connectable — 노드 레벨 connectable(임베드 읽기전용 자식 false)을 Handle에 전달해야 실제로 끌기가 막힌다 (F3)
function SubprocessHandles({ ends, connectable }: { ends: SubEnd[]; connectable: boolean }) {
  return (
    <>
      <Handle id={SUBPROCESS_IN_HANDLE} type="target" position={Position.Left} isConnectable={connectable} />
      {ends.length === 0 ? (
        <Handle id={PRIMARY_END_HANDLE} type="source" position={Position.Right} isConnectable={connectable} />
      ) : (
        ends.map((end, i) => (
          <Handle
            key={end.key}
            id={end.key}
            type="source"
            position={Position.Right}
            style={{ top: `${((i + 1) / (ends.length + 1)) * 100}%` }}
            title={end.title}
            isConnectable={connectable}
          />
        ))
      )}
    </>
  );
}

const NODE_SIDES: HandleSide[] = ["left", "right", "top", "bottom"];

// 4변 각각에 source·target 핸들(총 8개) — 엣지가 어느 변에든 붙도록. 어느 핸들에 붙을지는 엣지가 id로 지정.
// connectable — SubprocessHandles와 동일하게 노드 레벨 값을 명시 전달(기본 true로 무시되는 것 방지) (F3)
function NodeHandles({ connectable }: { connectable: boolean }) {
  return (
    <>
      {NODE_SIDES.map((side) => (
        <Fragment key={side}>
          <Handle id={`t-${side}`} type="target" position={toPosition(side)} isConnectable={connectable} />
          <Handle id={`s-${side}`} type="source" position={toPosition(side)} isConnectable={connectable} />
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
// isConnectable — 노드 레벨 connectable(임베드 자식 false)이 여기로 전달됨. Handle에 명시 forward 필수 (F3).
export function ProcessNode({ id, data, isConnectable }: NodeProps<AppNode>) {
  const { t } = useI18n();
  const { ctrlDragIds } = useNodeActions();
  const showCopyBadge = ctrlDragIds.has(id);
  // subprocess는 단일색 고정 — 과거 저장된 color도 렌더에서 무시(데이터 무변경) (spec 2026-07-06 §9)
  const color =
    data.nodeType === "subprocess"
      ? DEFAULT_COLORS.subprocess
      : data.color || DEFAULT_COLORS[data.nodeType];
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
            {/* 타이틀 = 링크된 맵 이름 고정 — 인라인 이름 편집 차단 (F5) */}
            <NodeTitle id={id} label={data.label} editable={false} />
          </div>
          {/* 지정 어트리뷰트 줄 — 표시 필드 설정(displayFields)을 따르고, 미지정이면 sp* 비어 자동 생략 */}
          <NodeFields data={data} />
          <NodeParams data={data} />
          {data.updateAvailable && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-accent" title={t("subprocess.updateAvailable")}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {t("subprocess.updateAvailable")}
            </div>
          )}
        </div>
        {data.hasDescendantChange && <DescendantChangeBadge />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
        {data.spUrl && <UrlBadge url={data.spUrl} />}
        {data.assigneeWarning && <AssigneeWarningBadge />}
        {/* 미지정 경고가 권한 잠금보다 우선 — 원인(지정 해제)을 보여야 오너가 조치 가능 */}
        {data.undesignated ? (
          <UndesignatedBadge />
        ) : data.locked ? (
          <LockedBadge />
        ) : null}
        {/* 핸들은 잠금 무관 유지 — 호스트의 입력/대표출력 엣지가 살아있어야 봉인 박스가 흐름에 연결됨.
            비교뷰는 모든 엣지를 4변 핸들로 재매핑하므로 diff 여부와 무관하게 NodeHandles 필요
            (unchanged subprocess가 SubprocessHandles를 렌더하면 엣지가 앵커 실패 — F1). */}
        {diff || data.sideHandles ? (
          <NodeHandles connectable={isConnectable ?? true} />
        ) : (
          <SubprocessHandles ends={data.subEnds ?? []} connectable={isConnectable ?? true} />
        )}
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
        {/* 파라미터 칩 — 마름모 내접(h-24 w-24)을 넘치지 않게 아래 절대배치 캡션으로.
            절대배치라 React Flow 측정 크기가 불변 → 핸들·엣지 앵커 무영향 */}
        <div className="absolute left-1/2 top-full w-max max-w-40 -translate-x-1/2">
          <NodeParams data={data} className="justify-center" />
        </div>
        {/* 마름모는 코너가 도형에서 멀다 — 배지를 안쪽(12px)으로 당겨 대각 엣지 근처에 (batch2 ⑬) */}
        {data.hasDescendantChange && <DescendantChangeBadge className="right-3 top-3" />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} className="left-3 top-3" />}
        {data.url && <UrlBadge url={data.url} className="bottom-3 left-3" />}
        {data.assigneeWarning && <AssigneeWarningBadge className="bottom-3 right-3" />}
        {showCopyBadge && <CopyDragBadge className="right-3 top-3" />}
        <NodeHandles connectable={isConnectable ?? true} />
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
      <NodeParams data={data} />
      {data.hasChildren && (
        <div className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-accent">
          <CornerDownRight size={12} strokeWidth={1.5} />
          {t("node.openChildTitle")}
        </div>
      )}
      {data.hasDescendantChange && <DescendantChangeBadge />}
      {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
      {data.url && <UrlBadge url={data.url} />}
      {data.assigneeWarning && <AssigneeWarningBadge />}
      {showCopyBadge && <CopyDragBadge />}
      <NodeHandles connectable={isConnectable ?? true} />
    </div>
  );
}
