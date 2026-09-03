"use client";

// SP 지정 모달 필드 타일 — 2열 그리드의 단추. 빈 값=아이콘+라벨, 값 있음=아이콘+강조 값(라벨은 호버 title).
// 클릭한 마우스 좌표를 넘겨 입력 팝오버가 그 자리에 뜬다 (design 2026-09-03 followups §5).

import type { LucideIcon } from "lucide-react";

interface SpFieldTileProps {
  dataId: string;
  icon: LucideIcon;
  label: string;
  // 표시용 값 — 비어 있으면 라벨만 보인다
  value: string;
  disabled?: boolean;
  disabledHint?: string;
  active?: boolean;
  onOpen: (at: { x: number; y: number }) => void;
}

export function SpFieldTile({ dataId, icon: Icon, label, value, disabled, disabledHint, active, onOpen }: SpFieldTileProps) {
  const filled = value.trim() !== "";
  return (
    <button
      type="button"
      data-id={dataId}
      data-filled={filled ? "true" : "false"}
      disabled={disabled}
      title={disabled && disabledHint ? disabledHint : filled ? `${label}: ${value}` : label}
      aria-label={label}
      onClick={(e) => onOpen({ x: e.clientX, y: e.clientY })}
      className={`flex min-w-0 items-center gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-accent bg-accent-tint"
          : filled
            ? "border-accent-tint-border bg-accent-tint/40 hover:bg-accent-tint"
            : "border-hairline bg-surface hover:bg-surface-alt"
      }`}
    >
      <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${filled ? "text-accent" : "text-ink-tertiary"}`} />
      {filled ? (
        <span className="min-w-0 truncate text-caption font-semibold text-ink">{value}</span>
      ) : (
        <span className="min-w-0 truncate text-caption text-ink-secondary">{label}</span>
      )}
    </button>
  );
}
