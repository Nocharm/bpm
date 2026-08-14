"use client";

// 경량 호버 툴팁 — 포털+뷰포트 클램프, 진입 150ms 지연. 내용은 비인터랙티브(pointer-events 없음)라
// 인물 카드(0.7초·인터랙티브)보다 가벼운 정보 배지·필용. tip이 없으면 래퍼만 렌더.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { clampToViewport } from "@/lib/clamp-viewport";

const TIP_DELAY_MS = 150; // 스치는 이동엔 안 뜨는 최소 지연

interface HoverTipProps {
  tip: ReactNode;
  className?: string;
  children: ReactNode;
}

export function HoverTip({ tip, className, children }: HoverTipProps) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (tip == null) {
    return <span className={className}>{children}</span>;
  }

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={() => {
        if (timer.current !== null) return;
        timer.current = window.setTimeout(() => {
          timer.current = null;
          const rect = ref.current?.getBoundingClientRect();
          if (rect) setPos(clampToViewport(rect.left, rect.bottom + 6, 240, 80));
        }, TIP_DELAY_MS);
      }}
      onMouseLeave={() => {
        if (timer.current !== null) {
          window.clearTimeout(timer.current);
          timer.current = null;
        }
        setPos(null);
      }}
    >
      {children}
      {pos !== null &&
        createPortal(
          <div
            data-id="hover-tip"
            className="animate-item-in pointer-events-none fixed z-[1400] w-max max-w-60 rounded-md border border-hairline bg-surface p-2 shadow-lg"
            style={{ left: pos.left, top: pos.top }}
          >
            {tip}
          </div>,
          document.body,
        )}
    </span>
  );
}
