"use client";

import { Fragment, useRef } from "react";

import { Handle, type NodeProps } from "@xyflow/react";
import {
  Building2,
  Clock,
  CornerDownRight,
  type LucideIcon,
  MessageSquare,
  Server,
  SquareArrowOutUpRight,
  Tag,
  User,
  Zap,
} from "lucide-react";

import { type AppNode, type HandleSide, type ProcessNodeType, toPosition } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { type NodeDisplayField, useNodeActions } from "@/lib/node-actions";

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
function NodeTitle({ id, label }: { id: string; label: string }) {
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
      {label}
    </span>
  );
}

// 타입별 기본 stroke — data.color 미지정(빈 값) 시 사용. 세련된 무채도 톤(데이터/출력 예외 → raw hex 허용)
const DEFAULT_COLORS: Record<ProcessNodeType, string> = {
  process: "#909098", // stone
  decision: "#c7a062", // amber
  start: "#84a07c", // sage
  end: "#c2849a", // rose
};

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

// 호버 시 노드 우상단에 뜨는 드릴(하위 진입) 버튼 — onDrill 있을 때만(compare 등에서는 숨김)
function DrillButton({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const { onDrill } = useNodeActions();
  if (!onDrill) {
    return null;
  }
  return (
    <button
      type="button"
      title={t("node.openChildTitle")}
      className="absolute -right-2 -top-2 z-10 rounded-xs border border-hairline bg-surface p-0.5 text-ink-secondary opacity-0 shadow-sm hover:bg-surface-alt group-hover:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        onDrill(nodeId, event.clientX, event.clientY);
      }}
    >
      <SquareArrowOutUpRight size={14} strokeWidth={1.5} />
    </button>
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
export function ProcessNode({ id, data, selected }: NodeProps<AppNode>) {
  const { t } = useI18n();
  const color = data.color || DEFAULT_COLORS[data.nodeType];
  const fill = deriveFill(color);
  const commentCount = data.commentCount ?? 0;
  const ring = data.diffStatus
    ? DIFF_RINGS[data.diffStatus]
    : selected
      ? "ring-2 ring-accent"
      : "";

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
        {/* decision 노드는 하위 프로세스 생성 불가 — 기존 하위가 있을 때만 진입 버튼 */}
        {data.hasChildren && <DrillButton nodeId={id} />}
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
        <NodeTitle id={id} label={data.label} />
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
      {(data.nodeType === "process" || data.hasChildren) && <DrillButton nodeId={id} />}
      <NodeHandles />
    </div>
  );
}
