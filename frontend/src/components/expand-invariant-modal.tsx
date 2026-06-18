"use client";

// 하위 프로세스 불변식 확인 모달 — 후속없음(생성)·삭제 불변식 양쪽이 쓰는 공용 확인 다이얼로그.
// 제목 + 본문 + 액션 버튼 목록만 받는 얇은 래퍼. 모달 크롬은 capPrompt(page.tsx)와 동일.
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";

export interface InvariantAction {
  label: string;
  onClick: () => void;
  // default=중립(테두리), accent=주동작(바이올렛), danger=파괴(에러)
  variant?: "default" | "accent" | "danger";
}

function actionClass(variant: InvariantAction["variant"]): string {
  if (variant === "accent") {
    return "rounded-sm bg-accent px-3 py-1.5 text-caption text-white hover:opacity-90";
  }
  if (variant === "danger") {
    return "rounded-sm bg-error px-3 py-1.5 text-caption text-surface hover:opacity-90";
  }
  return "rounded-sm border border-hairline px-3 py-1.5 text-caption hover:bg-surface-alt";
}

export function ExpandInvariantModal({
  title,
  body,
  actions,
  onClose,
}: {
  title: string;
  body: string;
  actions: InvariantAction[];
  onClose: () => void;
}) {
  // Esc로 취소 — onClose(취소 액션과 동일 의미)
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center px-4"
      style={{ background: "color-mix(in srgb, var(--color-ink) 12%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="w-full max-w-sm rounded-md border border-hairline bg-surface p-4"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-body-strong text-ink">{title}</h2>
        <p className="mt-2 text-caption text-ink-secondary">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={actionClass(action.variant)}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
