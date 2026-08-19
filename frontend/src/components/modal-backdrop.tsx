"use client";

// 모달 백드롭 — 바깥 "누름(mousedown)" 즉시 닫기 + Escape 닫기.
// mouseup/click이 아니라 mousedown 기준인 이유: 반응이 한 박자 빠르고, 모달 안에서 드래그를 시작해
// 바깥에서 손을 떼는 경우(텍스트 선택 등)에 click이 백드롭에 떨어져 잘못 닫히는 문제도 함께 사라진다.
// Escape는 겹친 모달 중 최상위 하나만 닫는다(스택) — 확인 모달을 닫으려다 부모까지 닫히지 않게.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface ModalBackdropProps {
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

// 마운트 순서 스택 — 가장 나중에 열린(=최상위) 백드롭만 Escape에 반응한다.
const openBackdrops: symbol[] = [];

export function ModalBackdrop({ onClose, className, style, children }: ModalBackdropProps) {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) {
    idRef.current = Symbol("modal-backdrop");
  }
  // 최신 onClose를 리스너에 전달 — 구독을 재생성하지 않기 위한 ref 미러
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const id = idRef.current as symbol;
    openBackdrops.push(id);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openBackdrops[openBackdrops.length - 1] !== id) return;
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      const index = openBackdrops.indexOf(id);
      if (index !== -1) openBackdrops.splice(index, 1);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      className={className}
      style={style}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      {children}
    </div>
  );
}
