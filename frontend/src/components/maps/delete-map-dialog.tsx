"use client";

// 맵 삭제 확인 — 글 위주 대신 아이콘+요점 3줄로 한눈에(휴지통 이동/7일 복구/이후 영구삭제). (DL)

import { createPortal } from "react-dom";
import { AlertTriangle, Clock, Trash2 } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";

export function DeleteMapDialog({
  mapName,
  onConfirm,
  onClose,
}: {
  mapName?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="delete-map-dialog"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-md bg-surface p-6 text-center shadow-lg"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-error/10">
          <Trash2 size={28} strokeWidth={1.5} className="text-error" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{t("home.confirmDeleteTitle")}</h2>
          {mapName && <p className="max-w-full truncate text-caption text-ink-tertiary">{mapName}</p>}
        </div>
        <ul className="flex w-full flex-col gap-2 rounded-sm bg-surface-alt p-3 text-left">
          <li className="flex items-center gap-2 text-caption text-ink">
            <Trash2 size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            {t("delete.lineTrash")}
          </li>
          <li className="flex items-center gap-2 text-caption text-ink">
            <Clock size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
            {t("delete.lineRecover")}
          </li>
          <li className="flex items-center gap-2 text-caption text-ink-tertiary">
            <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0 text-error" />
            {t("delete.linePurge")}
          </li>
        </ul>
        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-id="delete-map-confirm"
            className="rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent hover:opacity-90"
            onClick={onConfirm}
          >
            {t("delete.confirm")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
