"use client";

// 범용 확인 모달 — ModalBackdrop + portal. danger=true면 confirm 버튼 error 토큰 /
// Generic confirm dialog. First use: delete map.

import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20"
    >
      <div
        data-id="confirm-dialog"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{title}</h2>
          <p className="text-caption text-ink-secondary">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="confirm-dialog-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-id="confirm-dialog-confirm"
            className={`rounded-sm px-3 py-1.5 text-caption ${
              danger
                ? "bg-error text-on-accent hover:opacity-90"
                : "bg-accent text-on-accent hover:bg-accent-focus"
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
