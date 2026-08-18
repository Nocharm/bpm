"use client";

// 엣지 더블클릭 시 캔버스 가운데(엣지 중점)에 뜨는 인라인 라벨 편집 박스 — page.tsx 오버레이 전용.
// 좌표는 canvasContainerRef 기준(screenRectOf와 동일). Enter/blur 커밋, Alt+Enter 줄바꿈, Esc 취소.

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
  // 내용 높이에 맞춰 늘어나는 자동 높이 — Alt+Enter 줄바꿈이 잘리지 않게
  const fitHeight = (el: HTMLTextAreaElement) => {
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      rows={1}
      // nodrag — 입력 중 React Flow가 패닝/노드 드래그하지 않게.
      // 빈 라벨도 입력 모드임이 또렷하도록: 굵은 accent ring + accent 캐럿 + placeholder (#1)
      className="nodrag absolute z-[1120] -translate-x-1/2 -translate-y-1/2 resize-none overflow-hidden rounded-sm border border-accent bg-surface px-2 py-1 text-center text-caption text-ink caret-accent shadow-lg outline-none ring-2 ring-accent/40 placeholder:text-ink-tertiary"
      style={{ left, top, minWidth: 110 }}
      ref={(el) => {
        if (el) fitHeight(el);
      }}
      onFocus={(event) => event.currentTarget.select()}
      onInput={(event) => fitHeight(event.currentTarget)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        // 끝쪽 줄바꿈만 정리 — Alt+Enter 후 그대로 커밋하면 빈 줄이 남는다
        onCommit(event.target.value.replace(/\n+$/, ""));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.altKey) {
            // Alt+Enter = 줄바꿈 삽입 (Enter는 커밋) — 비제어 입력이라 setRangeText로 충분
            const el = event.currentTarget;
            el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
            fitHeight(el);
          } else {
            event.currentTarget.blur();
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }
      }}
    />
  );
}
