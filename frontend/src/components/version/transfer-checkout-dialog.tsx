"use client";

// 점유권 이전 다이얼로그 — 검색 가능한 편집자 피커 / searchable editor picker for checkout transfer.

import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";
import { type DirectoryUser } from "@/lib/api";

interface TransferCheckoutDialogProps {
  open: boolean;
  editors: DirectoryUser[];
  value: string;
  onChange: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TransferCheckoutDialog({
  open,
  editors,
  value,
  onChange,
  onConfirm,
  onCancel,
}: TransferCheckoutDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  if (!open) return null;

  const q = query.toLowerCase().trim();
  const filtered = q
    ? editors.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q),
      )
    : editors;

  return createPortal(
    <ModalBackdrop
      onClose={onCancel}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="transfer-checkout-dialog"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        {/* Accent icon circle — matches ConfirmDialog rich layout */}
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-tint text-accent">
          <ArrowLeftRight size={28} strokeWidth={1.5} />
        </div>

        {/* Title */}
        <h2 className="w-full text-body-strong text-ink">{t("approval.transferTitle")}</h2>

        {/* Editor picker */}
        <div className="flex w-full flex-col gap-2">
          {editors.length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("perm.transferNoEligible")}</p>
          ) : (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("approval.transferSearchPlaceholder")}
                className="w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink placeholder:text-ink-muted outline-none focus:border-accent"
                autoFocus
              />
              <div className="max-h-48 overflow-y-auto rounded-sm border border-hairline">
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-caption text-ink-tertiary">No results</p>
                ) : (
                  filtered.map((editor) => (
                    <button
                      key={editor.id}
                      type="button"
                      onClick={() => onChange(editor.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-alt ${
                        editor.id === value ? "bg-accent-tint" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-caption text-ink">{editor.name}</p>
                        <p className="truncate text-fine text-ink-tertiary">{editor.id}</p>
                      </div>
                      {editor.id === value && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            data-id="transfer-dialog-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onCancel}
          >
            {t("approval.transferCancel")}
          </button>
          <button
            type="button"
            data-id="transfer-dialog-confirm"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            disabled={!value}
            onClick={onConfirm}
          >
            {t("approval.transferConfirm")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
