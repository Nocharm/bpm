// 목록 재정렬 FLIP — 포커스로 항목 순서가 바뀔 때 이전 위치에서 새 위치로 미끄러지게 한다.
// 항목은 data-flip-key로 찍고, 호출부는 순서를 나타내는 문자열(orderKey)이 바뀔 때만 재측정한다.

import { useLayoutEffect, useRef, type RefObject } from "react";

export function useFlipOrder(ref: RefObject<HTMLElement | null>, orderKey: string): void {
  const prevTops = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      const key = el.dataset.flipKey ?? "";
      const top = el.getBoundingClientRect().top;
      next.set(key, top);
      const before = prevTops.current.get(key);
      if (before === undefined || before === top || reduced) continue;
      // 이전 자리에 붙여 둔 뒤 다음 프레임에 트랜지션으로 제자리로 — transform은 레이아웃을 건드리지 않는다
      el.style.transition = "none";
      el.style.transform = `translateY(${before - top}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 380ms var(--ease-smooth)";
        el.style.transform = "";
      });
    }
    prevTops.current = next;
  }, [ref, orderKey]);
}
