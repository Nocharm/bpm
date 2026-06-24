"use client";

// 엣지 더블클릭 시 캔버스 가운데(엣지 중점)에 뜨는 인라인 라벨 편집 박스 — page.tsx 오버레이 전용.
// 좌표는 canvasContainerRef 기준(screenRectOf와 동일). Enter/blur 커밋, Esc 취소.

import { useRef } from "react";

interface EdgeLabelEditorProps {
  left: number;
  top: number;
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function EdgeLabelEditor({ left, top, initial, onCommit, onCancel }: EdgeLabelEditorProps) {
  // Esc 취소 시 onBlur가 값을 다시 커밋하지 않도록 가드
  const cancelledRef = useRef(false);
  return (
    <input
      autoFocus
      defaultValue={initial}
      // nodrag — 입력 중 React Flow가 패닝/노드 드래그하지 않게
      className="nodrag absolute z-[1120] -translate-x-1/2 -translate-y-1/2 rounded-xs border border-accent bg-surface px-1 py-0.5 text-center text-caption text-ink shadow-md"
      style={{ left, top, minWidth: 80 }}
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        onCommit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }
      }}
    />
  );
}
