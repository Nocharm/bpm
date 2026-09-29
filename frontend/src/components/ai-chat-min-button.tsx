"use client";

// 최소화된 AI 채팅의 플로팅 스파클 버튼 — 에디터 AI 도우미와 캠페인 L6 연결 피드백 채팅이 같은 룩·같은 동작을 쓴다(사용자 지시 2026-09-29).
// 호스트 영역(bounds) 안 어디든 끌 수 있고, 제자리 클릭이면 그 위치를 넘겨 창이 거기서 펴진다. 위치 상태는 호스트가 든다.
import { Sparkles } from "lucide-react";
import { useRef } from "react";

export const AI_MIN_BUTTON_SIZE = 44;  // h-11/w-11 — 드래그 클램프와 복원 위치 계산이 같은 값을 본다
const DRAG_THRESHOLD_PX = 4;  // 이보다 덜 움직이면 클릭(복원)

export interface MinButtonPos {
  x: number;
  y: number;
}

interface AiChatMinButtonProps {
  pos: MinButtonPos;
  // 호스트 영역 크기 — 버튼이 이 안에서만 움직인다
  bounds: { w: number; h: number };
  title: string;
  zIndex: number;
  dataId?: string;
  onMove: (pos: MinButtonPos) => void;
  // 제자리 클릭 — 버튼 위치를 넘긴다(호스트가 창을 그 자리에서 펴되 영역 안으로 클램프한다)
  onRestore: (pos: MinButtonPos) => void;
}

export function AiChatMinButton({ pos, bounds, title, zIndex, dataId, onMove, onRestore }: AiChatMinButtonProps) {
  const dragRef = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-id={dataId}
      className="absolute flex h-11 w-11 touch-none items-center justify-center rounded-md border border-accent-tint-border bg-gradient-to-br from-surface to-accent-tint text-accent opacity-70 shadow-md transition hover:opacity-100 hover:shadow-lg"
      style={{ left: pos.x, top: pos.y, zIndex }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { px: event.clientX, py: event.clientY, x: pos.x, y: pos.y, moved: false };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (Math.abs(event.clientX - drag.px) + Math.abs(event.clientY - drag.py) > DRAG_THRESHOLD_PX) drag.moved = true;
        onMove({
          x: Math.min(Math.max(drag.x + (event.clientX - drag.px), 0), Math.max(0, bounds.w - AI_MIN_BUTTON_SIZE)),
          y: Math.min(Math.max(drag.y + (event.clientY - drag.py), 0), Math.max(0, bounds.h - AI_MIN_BUTTON_SIZE)),
        });
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (drag && !drag.moved) onRestore(pos);
      }}
    >
      <Sparkles size={20} strokeWidth={1.5} />
    </button>
  );
}
