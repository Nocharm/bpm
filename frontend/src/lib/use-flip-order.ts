// 목록 재정렬 FLIP — 항목의 자리가 바뀔 때 이전 위치에서 새 위치로 미끄러지게 한다(세로 목록·가로 타일 모두, 2D).
// 항목은 data-flip-key로 찍고, 호출부는 순서를 나타내는 문자열(orderKey)이 바뀔 때만 재측정한다.

import { useLayoutEffect, useRef, type RefObject } from "react";

export function useFlipOrder(ref: RefObject<HTMLElement | null>, orderKey: string): void {
  const prevRects = useRef<Map<string, { left: number; top: number }>>(new Map());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { left: number; top: number }>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      const key = el.dataset.flipKey ?? "";
      const rect = el.getBoundingClientRect();
      next.set(key, { left: rect.left, top: rect.top });
      const before = prevRects.current.get(key);
      if (before === undefined || reduced) continue;
      const dx = before.left - rect.left;
      const dy = before.top - rect.top;
      if (dx === 0 && dy === 0) continue;
      // 이전 자리에 붙여 둔 뒤 다음 프레임에 트랜지션으로 제자리로 — transform은 레이아웃을 건드리지 않는다
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 380ms var(--ease-smooth)";
        el.style.transform = "";
      });
    }
    prevRects.current = next;
  }, [ref, orderKey]);
}
