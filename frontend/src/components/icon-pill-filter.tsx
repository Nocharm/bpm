"use client";

// 아이콘 필 필터 — 비활성=아이콘만, 활성=아이콘+라벨(우측으로 펼쳐짐). 필터/세그먼트 공용.

import type { LucideIcon } from "lucide-react";

export interface IconPillOption<T extends string> {
  value: T;
  label: string;
  Icon: LucideIcon;
}

export function IconPillFilter<T extends string>({
  options,
  value,
  onChange,
}: {
  options: IconPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.Icon;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            title={opt.label}
            onClick={() => onChange(opt.value)}
            className={
              "inline-flex items-center rounded-full px-2 py-1 text-fine transition-colors " +
              (active
                ? "bg-accent-tint text-accent"
                : "border border-hairline text-ink-tertiary hover:bg-surface-alt hover:text-ink-secondary")
            }
          >
            <Icon size={14} strokeWidth={1.5} />
            <span
              className={
                "overflow-hidden whitespace-nowrap transition-all duration-350 ease-smooth " +
                (active ? "ml-1 max-w-28 opacity-100" : "max-w-0 opacity-0")
              }
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
