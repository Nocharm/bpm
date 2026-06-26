"use client";

// 홈 목록 필터용 멀티셀렉트 드롭다운 — 버튼(아이콘+라벨+선택수) + 체크 목록(옵션별 아이콘) /
// multi-select filter dropdown with leading icons.

import { type ReactNode, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

interface FilterOption {
  value: string;
  label: string;
  // 옵션별 선행 아이콘(상태 색 점·역할 아이콘 등) / per-option leading icon.
  icon?: ReactNode;
}

export function FilterDropdown({
  label,
  icon,
  options,
  selected,
  onToggle,
  dataId,
}: {
  label: string;
  // 버튼 선행 아이콘 / button leading icon.
  icon?: ReactNode;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  dataId?: string;
}) {
  const [open, setOpen] = useState(false);
  const count = selected.size;

  return (
    <div className="relative">
      <button
        type="button"
        data-id={dataId}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-caption transition-colors ${
          count > 0
            ? "border-accent-tint-border bg-accent-tint text-accent"
            : "border-hairline text-ink-tertiary hover:bg-surface-alt hover:text-ink"
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {count > 0 ? `${label} · ${count}` : label}
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>
      {open && (
        <>
          {/* 바깥 클릭 닫기 / click-away */}
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-[1001] mt-1 min-w-[10rem] rounded-md border border-hairline bg-surface py-1 shadow-lg">
            {options.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                  onClick={() => onToggle(o.value)}
                >
                  {o.icon}
                  <span className="flex-1 truncate">{o.label}</span>
                  {on && <Check size={14} strokeWidth={1.7} className="shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
