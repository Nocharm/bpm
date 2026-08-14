"use client";

// 호버 스왑 필 — 기본 필이 호버/키보드 포커스 시 같은 자리·같은 크기의 회색 액션 필로
// 크로스페이드(150ms). 스테이지 취소·pending 회수 공용 문법 (map-detail-card 역할→Remove 스왑 선례).

import type { ReactNode } from "react";

export function HoverSwapPill({
  base,
  swapLabel,
  onActivate,
  title,
  disabled = false,
  dataId,
  className = "",
}: {
  base: ReactNode;
  swapLabel: string;
  onActivate: () => void;
  title?: string;
  disabled?: boolean;
  dataId?: string;
  className?: string;
}) {
  if (disabled) {
    return <span className={`relative inline-flex items-center justify-center ${className}`}>{base}</span>;
  }
  return (
    <button
      type="button"
      data-id={dataId}
      title={title}
      className={`group/swap relative inline-flex items-center justify-center ${className}`}
      onClick={(e) => {
        e.stopPropagation(); // 카드 유저 행은 클릭=펼침 토글 — 필 클릭이 행 토글로 새지 않게
        onActivate();
      }}
    >
      <span className="inline-flex items-center transition-opacity duration-150 group-hover/swap:opacity-0 group-focus-visible/swap:opacity-0">
        {base}
      </span>
      {/* 오버레이가 래퍼(=base 크기)를 그대로 채워 지오메트리 불변 */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center rounded-sm border border-hairline bg-surface text-fine text-ink-secondary opacity-0 transition-opacity duration-150 group-hover/swap:bg-surface-alt group-hover/swap:opacity-100 group-focus-visible/swap:opacity-100"
      >
        {swapLabel}
      </span>
    </button>
  );
}
