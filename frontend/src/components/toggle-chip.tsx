"use client";

// 켜짐/꺼짐 아이콘 칩 — 켜지면 액센트 틴트, 꺼지면 헤어라인 테두리만(폭은 내용만큼).
// PNG 내보내기 옵션 창(png-export-modal)과 비교 화면 PNG 옵션 창(compare-png-export-modal)이 공유.

import type { ReactNode } from "react";

interface ToggleChipProps {
  dataId: string;
  icon: ReactNode;
  label: string;
  on: boolean;
  onToggle: () => void;
}

export function ToggleChip({ dataId, icon, label, on, onToggle }: ToggleChipProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-id={dataId}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-fine transition-colors duration-150 ${
        on ? "border-accent bg-accent-tint text-accent" : "border-hairline text-ink-tertiary hover:bg-surface-alt"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
