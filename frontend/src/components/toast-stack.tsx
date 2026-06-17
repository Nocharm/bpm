"use client";

// 우상단(Nav 아래) 토스트 스택 — 오른쪽에서 슬라이드 인, 유지 후 다시 오른쪽으로 슬라이드 아웃.
// 새 토스트는 위에 쌓이고(prepend), 가장 오래된 것부터 아래에서 사라진다.

import { useEffect, useState } from "react";

export interface ToastItem {
  id: string;
  message: string;
}

const HOLD_MS = 2500; // 표시 유지 시간
const SLIDE_MS = 350; // 슬라이드 인/아웃 트랜지션 길이 (duration-350)

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  const [shown, setShown] = useState(false); // 마운트 후 다음 프레임에 true → 슬라이드 인
  const [leaving, setLeaving] = useState(false); // 유지 시간 경과 후 true → 슬라이드 아웃

  useEffect(() => {
    const enter = requestAnimationFrame(() => setShown(true));
    const hold = setTimeout(() => setLeaving(true), HOLD_MS);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(hold);
    };
  }, []);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const remove = setTimeout(onDone, SLIDE_MS); // 아웃 트랜지션 끝나면 실제 제거
    return () => clearTimeout(remove);
  }, [leaving, onDone]);

  const offscreen = !shown || leaving;
  return (
    <div
      className="rounded-md bg-ink px-3 py-2 text-caption text-surface shadow-lg"
      style={{
        transform: offscreen ? "translateX(120%)" : "translateX(0)",
        opacity: offscreen ? 0 : 1,
        transition: `transform ${SLIDE_MS}ms var(--ease-spring), opacity ${SLIDE_MS}ms var(--ease-smooth)`,
      }}
    >
      {message}
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 top-14 z-[1300] flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} message={toast.message} onDone={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}
