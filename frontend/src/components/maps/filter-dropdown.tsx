"use client";

// 홈 목록 필터용 멀티셀렉트 드롭다운 — 버튼(아이콘+라벨+선택수) + 체크 목록(옵션별 아이콘) /
// multi-select filter dropdown with leading icons.

import { type ReactNode, useEffect, useRef, useState } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const count = selected.size;

  // 바깥 클릭 닫기 — 전체화면 오버레이(`fixed inset-0`)는 페이지 호버를 가로채므로 document 리스너로 대체
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
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
      )}
    </div>
  );
}
