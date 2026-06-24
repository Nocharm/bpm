"use client";

// 호버 툴팁 — 아이콘 전용 버튼 라벨을 호버 시 표시. portal+fixed라 컨테이너 overflow에 잘리지 않음.
// 아이콘만으로 명확한 버튼은 라벨을 생략하고 이 툴팁으로 의미를 보인다 (design.md §5).

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
  };

  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos !== null &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[1400] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink shadow-lg"
            style={{ left: pos.x, top: pos.y - 6 }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
