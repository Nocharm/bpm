// 드래그로 조절하는 사이드 패널 폭 — localStorage 기억, [min,max] 클램프. 비교 인스펙터·캠페인 연결 패널 공용 (2026-09-23).

import { useCallback, useState } from "react";

export function readStoredWidth(raw: string | null, min: number, max: number, fallback: number): number {
  const stored = Number(raw);
  return raw !== null && Number.isFinite(stored) && stored >= min && stored <= max ? stored : fallback;
}

interface ResizableWidthOptions {
  storageKey: string;
  min: number;
  max: number;
  fallback: number;
  // 패널이 붙은 화면 변 — right면 폭은 오른쪽 끝에서 커서까지
  edge: "left" | "right";
}

export function useResizableWidth({ storageKey, min, max, fallback, edge }: ResizableWidthOptions): {
  width: number;
  onPointerDown: (event: React.PointerEvent) => void;
} {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? fallback : readStoredWidth(window.localStorage.getItem(storageKey), min, max, fallback),
  );
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const measure = (clientX: number) =>
        Math.min(max, Math.max(min, edge === "right" ? window.innerWidth - clientX : clientX));
      const onMove = (ev: PointerEvent) => setWidth(measure(ev.clientX));
      const finish = (ev: PointerEvent) => {
        window.localStorage.setItem(storageKey, String(measure(ev.clientX)));
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [storageKey, min, max, edge],
  );
  return { width, onPointerDown };
}
