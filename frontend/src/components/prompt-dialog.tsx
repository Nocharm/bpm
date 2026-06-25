"use client";

// 플로팅 입력 모달 — 네이티브 window.prompt 대체. 주변 블러(backdrop-blur), 바깥 mousedown 시 닫힘
// (ModalBackdrop), Esc 닫힘, Enter 제출(단일행). 빈 값은 제출 비활성.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";

interface PromptDialogProps {
  title: string;
  /** 입력 위 설명/라벨 (선택) */
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** true면 textarea (예: 반려 사유) */
  multiline?: boolean;
  /** 제출 실패 안내(예: 이름 중복) — 표시되면 모달 유지 */
  error?: string | null;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

export function PromptDialog({
  title,
  label,
  defaultValue = "",
  placeholder,
  confirmLabel,
  cancelLabel,
  multiline = false,
  error,
  onConfirm,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
    >
      <div
        data-id="prompt-dialog"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{title}</h2>
          {label && <p className="text-caption text-ink-secondary">{label}</p>}
        </div>
        {multiline ? (
          <textarea
            autoFocus
            data-id="prompt-dialog-input"
            className="min-h-20 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <input
            autoFocus
            data-id="prompt-dialog-input"
            className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        )}
        {error && <p className="text-fine text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="prompt-dialog-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-id="prompt-dialog-confirm"
            disabled={!value.trim()}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
