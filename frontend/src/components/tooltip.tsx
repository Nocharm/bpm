"use client";

// 호버 툴팁 — 아이콘 전용 버튼 라벨을 호버 시 표시. portal+fixed라 컨테이너 overflow에 잘리지 않음.
// 아이콘만으로 명확한 버튼은 라벨을 생략하고 이 툴팁으로 의미를 보인다 (design.md §5).

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { getViewportOverflow } from "@/lib/clamp-viewport";

// label(텍스트) 또는 content(리치 카드 ReactNode) 중 하나. className으로 래퍼 폭 제어(예: flex-1 min-w-0).
export function Tooltip({
  label,
  content,
  className,
  children,
}: {
  label?: string;
  content?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const body = content ?? label;

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
  };

  // 화면 가장자리 보정 — 앵커 기준으로 배치한 뒤 실측해 안쪽으로 민다(리치 카드는 높이가 가변,
  // 가로는 -translate-x-1/2로 중앙정렬돼 있어 추정 배치로는 잘린다). left/top·visibility는 이 이펙트가 단독 소유.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || pos === null) {
      return;
    }
    tip.style.left = `${pos.x}px`;
    tip.style.top = `${pos.y - 6}px`;
    const { dx, dy } = getViewportOverflow(tip);
    tip.style.left = `${pos.x + dx}px`;
    tip.style.top = `${pos.y - 6 + dy}px`;
    tip.style.visibility = "visible";
  }, [pos]);

  return (
    <span
      ref={ref}
      className={`inline-flex ${className ?? ""}`}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos !== null &&
        body != null &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            // content(리치 카드)는 라벨보다 크게 — 본문 caption·넓은 폭·여유 패딩으로 가독 확보 (사용자 결정 2026-08-20)
            className={`pointer-events-none fixed z-[1400] -translate-x-1/2 -translate-y-full rounded-sm border border-hairline bg-surface shadow-lg ${
              content
                ? "max-w-72 px-2.5 py-2 text-caption leading-snug text-ink"
                : "whitespace-nowrap px-2 py-1 text-fine text-ink"
            }`}
            // 위치는 위 레이아웃 이펙트가 확정 — 측정 전 한 프레임 어긋난 자리에 보이지 않게 숨겨서 붙인다
            style={{ visibility: "hidden" }}
          >
            {body}
          </span>,
          document.body,
        )}
    </span>
  );
}
