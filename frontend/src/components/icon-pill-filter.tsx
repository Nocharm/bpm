"use client";

// 아이콘 필 필터 — 비활성=아이콘만, 활성=아이콘+라벨(우측으로 펼쳐짐). 필터/세그먼트 공용.
// 개수(count)를 주면 활성 여부와 상관없이 아이콘 뒤에 늘 보인다(홈 대시보드 펼침 목록).

import type { LucideIcon } from "lucide-react";

export interface IconPillOption<T extends string> {
  value: T;
  label: string;
  Icon: LucideIcon;
  count?: number;
}

export function IconPillFilter<T extends string>({
  options,
  value,
  onChange,
  dataId,
}: {
  options: IconPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 필마다 `${dataId}-${value}` 식별자 */
  dataId?: string;
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
            data-id={dataId ? `${dataId}-${opt.value}` : undefined}
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
            {opt.count !== undefined && <span className="ml-1 tabular-nums">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
