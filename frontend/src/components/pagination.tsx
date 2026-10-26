"use client";

// 간단 페이지네이션 — 전체가 페이지 크기를 넘을 때만 표시. prev/next + "현재/전체".

import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  total,
  pageSize,
  page,
  onPage,
  dataId,
}: {
  total: number;
  pageSize: number;
  page: number;
  onPage: (page: number) => void;
  dataId?: string; // 래퍼 data-id, 버튼은 `${dataId}-prev`·`${dataId}-next`
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) {
    return null;
  }
  return (
    <div data-id={dataId} className="flex items-center justify-end gap-2 text-fine text-ink-secondary">
      <button
        type="button"
        data-id={dataId ? `${dataId}-prev` : undefined}
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
        data-id={dataId ? `${dataId}-next` : undefined}
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
        className="rounded-sm border border-hairline p-1 hover:bg-surface-alt disabled:opacity-40"
      >
        <ChevronRight size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
