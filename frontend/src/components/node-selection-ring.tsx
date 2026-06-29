"use client";

import { useStore } from "@xyflow/react";

import type { NodeData } from "@/lib/canvas";

interface RingRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  terminal: boolean;
  dragging: boolean;
}

function eq(a: RingRect[], b: RingRect[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (r, i) =>
      r.id === b[i].id &&
      r.x === b[i].x &&
      r.y === b[i].y &&
      r.w === b[i].w &&
      r.h === b[i].h &&
      r.dragging === b[i].dragging,
  );
}

// 선택 노드 위에 뜨는 테두리 인디케이터. 단일 선택은 같은 DOM(고정 key)을 유지해
// 선택이 바뀌면 위치/크기가 CSS 트랜지션으로 '슬라이드'한다. 드래그 중에는 트랜지션을
// 꺼 즉시 추종(랙 방지). ViewportPortal 안에 두어 flow 좌표로 노드와 정합(팬/줌 포함).
export function NodeSelectionRing() {
  const selected = useStore((s): RingRect[] => {
    const out: RingRect[] = [];
    for (const n of s.nodeLookup.values()) {
      if (!n.selected) continue;
      const w = n.measured?.width ?? 0;
      const h = n.measured?.height ?? 0;
      if (!w || !h) continue;
      const data = n.data as NodeData;
      out.push({
        id: n.id,
        x: n.internals.positionAbsolute.x,
        y: n.internals.positionAbsolute.y,
        w,
        h,
        terminal: data.nodeType === "start" || data.nodeType === "end",
        dragging: n.dragging ?? false,
      });
    }
    return out;
  }, eq);

  if (selected.length === 0) return null;
  const solo = selected.length === 1;

  return (
    <>
      {selected.map((r) => (
        <div
          key={solo ? "node-sel-solo" : r.id}
          className={`node-ring-selected pointer-events-none absolute ${
            r.terminal ? "rounded-full" : "rounded-sm"
          } ${solo && !r.dragging ? "transition-all duration-350 ease-smooth" : ""}`}
          style={{
            left: 0,
            top: 0,
            transform: `translate(${r.x}px, ${r.y}px)`,
            width: r.w,
            height: r.h,
            zIndex: 5,
          }}
        />
      ))}
    </>
  );
}
