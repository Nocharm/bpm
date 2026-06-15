"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useRef } from "react";
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

import type { AppNode, ProcessNodeType } from "@/lib/canvas";
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
function NodeTitle({ id, label }: { id: string; label: string }) {
  const { editingNodeId, onRename, onCancelRename } = useNodeActions();
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
  return <span className={onRename ? "cursor-text" : undefined}>{label}</span>;
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
        <Handle type="target" position={Position.Left} />
        {/* 마름모는 회전한 사각형으로 그리고 텍스트는 회전하지 않은 레이어에 둔다 */}
        <div
          className={`absolute inset-3 rotate-45 rounded-sm transition-shadow group-hover:shadow-sm ${ring}`}
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
        <Handle type="source" position={Position.Right} />
        <DrillButton nodeId={id} />
      </div>
    );
  }

  const isTerminal = data.nodeType === "start" || data.nodeType === "end";
  return (
    <div
      className={`group relative px-3 py-2 text-sm transition-shadow hover:shadow-sm ${ring} ${
        isTerminal
          ? "min-w-[90px] rounded-full text-center"
          : "min-w-[150px] rounded-sm"
      }`}
      style={{ borderColor: color, borderWidth: "1.5px", borderStyle: "solid", background: fill }}
      title={data.diffNote}
    >
      <Handle type="target" position={Position.Left} />
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
      <Handle type="source" position={Position.Right} />
      <DrillButton nodeId={id} />
    </div>
  );
}
