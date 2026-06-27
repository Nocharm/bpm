"use client";

// 범용 확인 모달 — ModalBackdrop + portal. danger=true면 confirm 버튼 error 토큰 /
// Generic confirm dialog. Simple form (title+message) or rich form (icon circle + bullet lines, L5).

import { createPortal } from "react-dom";
import { type ReactNode } from "react";

import { ModalBackdrop } from "@/components/modal-backdrop";

type LineTone = "ink" | "accent" | "error" | "muted";

export interface ConfirmLine {
  icon: ReactNode;
  text: string;
  tone?: LineTone;
}

const LINE_TEXT_TONE: Record<LineTone, string> = {
  ink: "text-ink",
  accent: "text-ink",
  error: "text-ink-tertiary",
  muted: "text-ink-tertiary",
};
const LINE_ICON_TONE: Record<LineTone, string> = {
  ink: "text-ink-tertiary",
  accent: "text-accent",
  error: "text-error",
  muted: "text-ink-tertiary",
};

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  // 리치 폼(L5) — icon 제공 시 아이콘 원 + 요점 줄 중앙 레이아웃 / rich layout when icon is set.
  icon?: ReactNode;
  lines?: ConfirmLine[];
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
  icon,
  lines,
}: ConfirmDialogProps) {
  const confirmBtn = danger
    ? "bg-error text-on-accent hover:opacity-90"
    : "bg-accent text-on-accent hover:bg-accent-focus";
  const iconCircle = danger ? "bg-error/10 text-error" : "bg-accent-tint text-accent";
  const isRich = icon != null;
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="confirm-dialog"
        className={`flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg ${
          isRich ? "items-center text-center" : ""
        }`}
      >
        {isRich && (
          <div className={`flex h-16 w-16 items-center justify-center rounded-full ${iconCircle}`}>
            {icon}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{title}</h2>
          {message && (
            <p className={`text-caption ${isRich ? "text-ink-tertiary" : "text-ink-secondary"}`}>
              {message}
            </p>
          )}
        </div>
        {lines && lines.length > 0 && (
          <ul className="flex w-full flex-col gap-2 rounded-sm bg-surface-alt p-3 text-left">
            {lines.map((line, i) => (
              <li
                key={i}
                className={`flex items-center gap-2 text-caption ${LINE_TEXT_TONE[line.tone ?? "ink"]}`}
              >
                <span className={`shrink-0 ${LINE_ICON_TONE[line.tone ?? "ink"]}`}>{line.icon}</span>
                {line.text}
              </li>
            ))}
          </ul>
        )}
        <div className={`flex w-full justify-end gap-2 ${isRich ? "" : ""}`}>
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
            className={`rounded-sm px-3 py-1.5 text-caption ${confirmBtn}`}
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
