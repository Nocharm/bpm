"use client";

// 비교 필드 diff 공용 렌더 — 상태별 색(생성=초록·삭제=빨강·변경=노랑), 변경 텍스트 부분 강조
// (이전=취소선 빨강 / 이후=굵게 초록), 잘린 값 호버 시 전체 내용 팝오버. 변경 목록 행과
// 캔버스 DiffFieldPills가 공유한다 (피드백 2026-08-28).
import { type CSSProperties, type MouseEvent, type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { clampToViewport } from "@/lib/clamp-viewport";
import { type FieldDiffStatus, splitTextDiff } from "@/lib/compare-field-diff";

export interface FieldDiffRowData {
  label: string;
  // 표시값 — None 폴백 적용 후. status 분류는 폴백 전 원시값으로 이미 끝난 상태.
  before: string;
  after: string;
  status: FieldDiffStatus;
}

// 목록 행 — 반투명 틴트 + 호버 강조 (Tailwind JIT: 완성형 클래스 문자열 유지)
export const FIELD_DIFF_ROW_CLASS: Record<FieldDiffStatus, string> = {
  added: "border-added/30 bg-added/10 hover:bg-added/20",
  removed: "border-removed/30 bg-removed/10 hover:bg-removed/20",
  changed: "border-changed/30 bg-changed/10 hover:bg-changed/20",
};

export const FIELD_DIFF_BORDER_CLASS: Record<FieldDiffStatus, string> = {
  added: "border-added/30",
  removed: "border-removed/30",
  changed: "border-changed/30",
};

export const FIELD_DIFF_LABEL_CLASS: Record<FieldDiffStatus, string> = {
  added: "text-added",
  removed: "text-removed",
  changed: "text-changed",
};

// 캔버스 필 불투명 배경 — 뒤로 지나는 엣지가 비치지 않게 (기존 CHANGED_PILL_BG 패턴의 상태별 확장).
export function getFieldDiffPillBg(status: FieldDiffStatus): string {
  return `color-mix(in srgb, var(--color-${status}) 12%, white)`;
}

// 값 스팬 — 변경 행은 before→after(바뀐 부분만 취소선/굵게), 생성 행은 최종 값만,
// 삭제 행은 취소선 값만(화살표·None 미표기, 피드백 2026-08-28).
// 값 스팬은 data-diff-val 마킹 — 호버 래퍼가 잘림(overflow) 판정에 쓴다.
export function FieldDiffValues({ row, truncate }: { row: FieldDiffRowData; truncate: boolean }) {
  const valueClass = truncate ? "min-w-0 truncate" : "min-w-0 whitespace-pre-wrap break-words";
  if (row.status === "added") {
    return (
      <span data-diff-val="" className={`${valueClass} font-semibold text-ink`}>
        {row.after}
      </span>
    );
  }
  if (row.status === "removed") {
    return (
      <span data-diff-val="" className={`${valueClass} text-removed line-through`}>
        {row.before}
      </span>
    );
  }
  const parts = splitTextDiff(row.before, row.after);
  return (
    <>
      <span data-diff-val="" className={`${valueClass} text-ink-muted`}>
        {parts.prefix}
        <span className="text-removed line-through">{parts.removedMid}</span>
        {parts.suffix}
      </span>
      <span className="shrink-0 text-ink-tertiary">→</span>
      <span data-diff-val="" className={`${valueClass} text-ink`}>
        {parts.prefix}
        <span className="font-semibold text-added">{parts.addedMid}</span>
        {parts.suffix}
      </span>
    </>
  );
}

// 행/필 래퍼 — 값이 잘렸을 때만 마우스 근처에 전체 내용 팝오버를 띄운다.
export function FieldDiffHoverable({
  row,
  className,
  style,
  children,
}: {
  row: FieldDiffRowData;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const handleEnter = (event: MouseEvent<HTMLSpanElement>) => {
    const overflowed = Array.from(
      event.currentTarget.querySelectorAll("[data-diff-val]"),
    ).some((el) => el.scrollWidth > el.clientWidth + 1);
    if (!overflowed) return;
    setPos(clampToViewport(event.clientX + 12, event.clientY + 14, 336, 200));
  };

  return (
    <span className={className} style={style} onMouseEnter={handleEnter} onMouseLeave={() => setPos(null)}>
      {children}
      {pos &&
        createPortal(
          <div
            data-id="compare-field-popover"
            className="pointer-events-none fixed z-[1300] max-w-[336px] rounded-md border border-hairline bg-surface p-2.5 shadow-lg"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className={`mb-1 text-fine font-semibold ${FIELD_DIFF_LABEL_CLASS[row.status]}`}>
              {row.label}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-caption">
              <FieldDiffValues row={row} truncate={false} />
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
