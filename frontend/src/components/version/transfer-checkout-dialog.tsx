"use client";

// 점유권 이전 다이얼로그 — 검색 가능한 편집자 피커 / searchable editor picker for checkout transfer.

import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";
import { type DirectoryUser } from "@/lib/api";
import { formatRosterName } from "@/lib/korean-dept";
import { filterByQuery } from "@/lib/search";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

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
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? filterByQuery(editors, query, (e) => [
        { field: "name", text: e.name },
        ...(e.korean_name ? [{ field: "koreanName", text: e.korean_name }] : []),
        { field: "id", text: e.id },
      ]).map((h) => h.item)
    : editors;
  // 25개씩 증분 렌더 — 편집자 수가 많아도 목록 DOM 부하 없음(훅이라 early return보다 앞).
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(filtered, query);

  if (!open) return null;

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
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("approval.transferSearchPlaceholder")}
                  className="w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 pr-7 text-caption text-ink placeholder:text-ink-muted outline-none focus:border-accent"
                  autoFocus
                />
                {/* 전체 지우기 — 검색어만 비움 (batch2 ⑪) */}
                {query.length > 0 && (
                  <button
                    type="button"
                    data-id="picker-clear-query"
                    aria-label={t("perm.pickerClear")}
                    title={t("perm.pickerClear")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                    onClick={() => setQuery("")}
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-sm border border-hairline">
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-caption text-ink-tertiary">{t("approval.transferNoResults")}</p>
                ) : (
                  visible.map((editor) => (
                    <button
                      key={editor.id}
                      type="button"
                      onClick={() => onChange(editor.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-alt ${
                        editor.id === value ? "bg-accent-tint" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-caption text-ink">
                          {formatRosterName({ name: editor.name, korean_name: editor.korean_name ?? "" }, lang)}
                        </p>
                        <p className="truncate text-fine text-ink-tertiary">{editor.id}</p>
                      </div>
                      {editor.id === value && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                      )}
                    </button>
                  ))
                )}
                {hasMore && <div ref={sentinelRef} className="h-px" />}
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
