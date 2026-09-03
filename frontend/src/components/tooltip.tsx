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
  wide = false,
  children,
}: {
  label?: string;
  content?: ReactNode;
  className?: string;
  // 리치 카드 폭 확대(max-w-96) — 한 문장이 두 줄 안에 읽히게(인스펙터 SP 참고치, 사용자 피드백 2026-09-03)
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null);
  const body = content ?? label;

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setPos({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
    }
  };

  // 배치는 위쪽 기본 + 공간 없으면 아래로 플립, 그 뒤 실측 클램프 — 상단 경계에서 위로 밀어붙이면
  // 툴팁이 앵커 행을 덮어 정작 가리키는 내용이 안 보인다(리치 카드는 높이가 가변이라 추정 불가).
  // 가로는 -translate-x-1/2 중앙정렬이라 클램프로만 민다. left/top/transform·visibility는 이 이펙트가 단독 소유.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || pos === null) {
      return;
    }
    const gap = 6;
    const margin = 8;
    // 정렬은 CSS translate 속성으로 — Tailwind v4의 -translate-* 도 같은 속성이라, transform으로 덮으면
    // 둘이 합성돼 두 번 밀린다. 높이는 최종 폭이 정해진 뒤에만 정확하니(줄바꿈) 위쪽에 한 번 붙여 재고 플립을 판정한다.
    tip.style.translate = "-50% -100%";
    tip.style.left = `${pos.x}px`;
    tip.style.top = `${pos.top - gap}px`;
    const height = tip.getBoundingClientRect().height;
    const flipDown =
      pos.top - gap - height < margin && pos.bottom + gap + height <= window.innerHeight - margin;
    const anchorY = flipDown ? pos.bottom + gap : pos.top - gap;
    if (flipDown) {
      tip.style.translate = "-50% 0";
      tip.style.top = `${anchorY}px`;
    }
    const { dx, dy } = getViewportOverflow(tip);
    tip.style.left = `${pos.x + dx}px`;
    tip.style.top = `${anchorY + dy}px`;
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
            className={`pointer-events-none fixed z-[1400] rounded-sm border border-hairline bg-surface shadow-lg ${
              // w-max — fixed 박스는 앵커 오른쪽 남은 폭에 맞춰 쪼그라든다(인스펙터 우측 앵커에서 150px까지).
              // 내용 폭으로 잡고 max-w로만 접은 뒤 클램프가 화면 안으로 민다 (사용자 피드백 2026-09-03)
              content
                ? `w-max ${wide ? "max-w-96" : "max-w-72"} px-2.5 py-2 text-caption leading-snug text-ink`
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
