"use client";

// 모달 백드롭 — 외부 클릭 닫기를 "mousedown 출처" 기준으로 판정.
// click(=mouseup)만 보면, 모달 내부에서 드래그를 시작해 바깥에서 손을 떼는 경우
// 백드롭에 click이 떨어져 창이 잘못 닫힌다. mousedown과 click이 모두 백드롭
// 자신에서 발생했을 때만 onClose 한다.
import { useRef, type CSSProperties, type ReactNode } from "react";

interface ModalBackdropProps {
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function ModalBackdrop({ onClose, className, style, children }: ModalBackdropProps) {
  const pressedOnBackdrop = useRef(false);
  return (
    <div
      className={className}
      style={style}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnBackdrop.current && event.target === event.currentTarget) {
          onClose();
        }
        pressedOnBackdrop.current = false;
      }}
    >
      {children}
    </div>
  );
}
