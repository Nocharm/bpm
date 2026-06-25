"use client";

// 엣지 더블클릭 시 캔버스 가운데(엣지 중점)에 뜨는 인라인 라벨 편집 박스 — page.tsx 오버레이 전용.
// 좌표는 canvasContainerRef 기준(screenRectOf와 동일). Enter/blur 커밋, Esc 취소.

import { useRef } from "react";

interface EdgeLabelEditorProps {
  left: number;
  top: number;
  initial: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function EdgeLabelEditor({
  left,
  top,
  initial,
  placeholder,
  onCommit,
  onCancel,
}: EdgeLabelEditorProps) {
  // Esc 취소 시 onBlur가 값을 다시 커밋하지 않도록 가드
  const cancelledRef = useRef(false);
  return (
    <input
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      // nodrag — 입력 중 React Flow가 패닝/노드 드래그하지 않게.
      // 빈 라벨도 입력 모드임이 또렷하도록: 굵은 accent ring + accent 캐럿 + placeholder (#1)
      className="nodrag absolute z-[1120] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-accent bg-surface px-2 py-1 text-center text-caption text-ink caret-accent shadow-lg outline-none ring-2 ring-accent/40 placeholder:text-ink-tertiary"
      style={{ left, top, minWidth: 110 }}
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
