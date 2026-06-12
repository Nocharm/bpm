"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";

import type { AppNode, ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

// 타입별 기본 테두리색 — data.color 미지정(빈 값) 시 사용
const DEFAULT_COLORS: Record<ProcessNodeType, string> = {
  process: "#d4d4d8",
  decision: "#f59e0b",
  start: "#22c55e",
  end: "#ef4444",
};

// 비교 화면 diff 상태별 강조 — 선택 링보다 우선
const DIFF_RINGS: Record<string, string> = {
  added: "ring-2 ring-green-500",
  removed: "ring-2 ring-red-500 opacity-60",
  changed: "ring-2 ring-amber-500",
};

// 미해결 코멘트 수 뱃지 (에디터 전용)
function UnresolvedCommentBadge({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <span
      className="absolute -left-2 -top-2 rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white"
      title={t("node.unresolvedAria", { n: count })}
    >
      💬{count}
    </span>
  );
}

// 하위 계층에 변경이 있음을 알리는 뱃지 (비교 화면 전용)
function DescendantChangeBadge() {
  const { t } = useI18n();
  return (
    <span
      className="absolute -right-2 -top-2 rounded-full bg-amber-400 px-1 text-[10px] leading-4 text-white"
      title={t("node.childChangedTitle")}
    >
      ⚡
    </span>
  );
}

// 프로세스 단계 노드 — node_type별 모양(사각/마름모/알약), 좌(입력)/우(출력) 핸들로 선후 연결.
export function ProcessNode({ data, selected }: NodeProps<AppNode>) {
  const { t } = useI18n();
  const color = data.color || DEFAULT_COLORS[data.nodeType];
  const commentCount = data.commentCount ?? 0;
  const ring = data.diffStatus
    ? DIFF_RINGS[data.diffStatus]
    : selected
      ? "ring-2 ring-blue-400"
      : "";

  if (data.nodeType === "decision") {
    return (
      <div
        className="relative flex h-24 w-24 items-center justify-center"
        title={data.diffNote}
      >
        <Handle type="target" position={Position.Left} />
        {/* 마름모는 회전한 사각형으로 그리고 텍스트는 회전하지 않은 레이어에 둔다 */}
        <div
          className={`absolute inset-3 rotate-45 rounded-sm border-2 bg-white shadow-sm ${ring}`}
          style={{ borderColor: color }}
        />
        <div className="relative max-w-20 text-center text-xs font-medium text-zinc-800">
          {data.label}
          {data.hasChildren && (
            <div className="text-[10px] text-blue-600">▾ {t("node.childBadge")}</div>
          )}
        </div>
        {data.hasDescendantChange && <DescendantChangeBadge />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  const isTerminal = data.nodeType === "start" || data.nodeType === "end";
  return (
    <div
      className={`relative bg-white px-3 py-2 text-sm shadow-sm ${ring} ${
        isTerminal
          ? "min-w-[90px] rounded-full border-2 text-center"
          : "min-w-[150px] rounded border"
      }`}
      style={{ borderColor: color }}
      title={data.diffNote}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-medium text-zinc-800">{data.label}</div>
      {data.assignee && (
        <div className="mt-0.5 text-xs text-zinc-500">👤 {data.assignee}</div>
      )}
      {data.hasChildren && (
        <div className="mt-0.5 text-xs text-blue-600">▾ {t("node.openChildTitle")}</div>
      )}
      {data.hasDescendantChange && <DescendantChangeBadge />}
      {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
