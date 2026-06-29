"use client";

import { Fragment, useRef } from "react";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
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
function NodeFields({ data }: { data: AppNode["data"] }) {
  const { t } = useI18n();
  const { displayFields } = useNodeActions();
  return (
    <>
      {displayFields.map((field) => {
        const value =
          field === "nodeType"
            ? t(NODE_TYPE_LABEL_KEY[data.nodeType])
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

// 비교 화면 diff 상태별 강조 — 선택 링보다 우선
const DIFF_RINGS: Record<string, string> = {
  added: "ring-2 ring-added",
  removed: "ring-2 ring-removed opacity-60",
  changed: "ring-2 ring-changed",
};

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

// 프로세스 단계 노드 — node_type별 모양(사각/마름모/알약), 좌(입력)/우(출력) 핸들로 선후 연결.
export function ProcessNode({ id, data }: NodeProps<AppNode>) {
  const { t } = useI18n();
  const color = data.color || DEFAULT_COLORS[data.nodeType];
  const fill = deriveFill(color);
  const commentCount = data.commentCount ?? 0;
  // 선택 링은 NodeSelectionRing 오버레이가 담당(노드 사이 슬라이드). 여기선 비교화면 diff 링만.
  const ring = data.diffStatus ? DIFF_RINGS[data.diffStatus] : "";

  if (data.nodeType === "subprocess") {
    return (
      <div
        className={`group relative flex w-[180px] min-h-[64px] items-center gap-2 rounded-sm px-3 py-2 text-sm transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:scale-[1.02] hover:opacity-95 hover:shadow-md ${ring}`}
        style={{ borderColor: color, borderWidth: "1.5px", borderStyle: "solid", background: fill }}
        title={data.diffNote}
      >
        <Workflow size={16} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">
            <NodeTitle id={id} label={data.label} />
          </div>
          {data.updateAvailable && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-accent" title={t("subprocess.updateAvailable")}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {t("subprocess.updateAvailable")}
            </div>
          )}
        </div>
        {data.hasDescendantChange && <DescendantChangeBadge />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
        {data.locked ? (
          <LockedBadge />
        ) : (
          (data.subEnds ?? []).length > 0 && <ExpandToggleButton nodeId={id} />
        )}
        {/* 핸들은 잠금 무관 유지 — 호스트의 입력/대표출력 엣지가 살아있어야 봉인 박스가 흐름에 연결됨 */}
        <SubprocessHandles ends={data.subEnds ?? []} />
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
          className={`absolute inset-3 rotate-45 rounded-sm transition-all duration-150 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:opacity-95 group-hover:shadow-md ${ring}`}
          style={{ borderColor: color, borderWidth: "1.5px", borderStyle: "solid", background: fill }}
        />
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
        {/* decision 노드는 기존 하위가 있을 때만 펼침 토글 */}
        {data.hasChildren && <ExpandToggleButton nodeId={id} />}
        <NodeHandles />
      </div>
    );
  }

  const isTerminal = data.nodeType === "start" || data.nodeType === "end";
  return (
    <div
      className={`group relative px-3 py-2 text-sm transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:scale-[1.02] hover:opacity-95 hover:shadow-md ${ring} ${
        isTerminal
          ? "min-w-[90px] rounded-full text-center"
          : "min-w-[150px] rounded-sm"
      }`}
      style={{ borderColor: color, borderWidth: "1.5px", borderStyle: "solid", background: fill }}
      title={data.diffNote}
    >
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
      {data.hasChildren && <ExpandToggleButton nodeId={id} />}
      <NodeHandles />
    </div>
  );
}
