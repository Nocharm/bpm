"use client";

// 간단 페이지네이션 — 전체가 페이지 크기를 넘을 때만 표시. prev/next + "현재/전체".

import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  total,
  pageSize,
  page,
  onPage,
}: {
  total: number;
  pageSize: number;
  page: number;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) {
    return null;
  }
  return (
    <div className="flex items-center justify-end gap-2 text-fine text-ink-secondary">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-sm border border-hairline p-1 hover:bg-surface-alt disabled:opacity-40"
      >
        <ChevronLeft size={14} strokeWidth={1.5} />
      </button>
      <span className="tabular-nums">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
        className="rounded-sm border border-hairline p-1 hover:bg-surface-alt disabled:opacity-40"
      >
        <ChevronRight size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
