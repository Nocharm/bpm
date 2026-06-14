"use client";

// 최소화된 스코프 창들의 좌하단 dock — 칩 클릭 시 복원. presentational.

import { Square } from "lucide-react";

import { useI18n } from "@/lib/i18n";

interface WindowDockProps {
  items: { key: string; title: string }[];
  onRestore: (key: string) => void;
}

export function WindowDock({ items, onRestore }: WindowDockProps) {
  const { t } = useI18n();
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="absolute bottom-2 left-2 z-[1100] flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          title={t("window.restore")}
          className="inline-flex max-w-[160px] items-center gap-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink-secondary shadow-sm hover:bg-surface-alt"
          onClick={() => onRestore(item.key)}
        >
          <Square size={12} strokeWidth={1.5} />
          <span className="truncate">{item.title}</span>
        </button>
      ))}
    </div>
  );
}
