"use client";

// 되돌리기 확인 모달 — 직전 저장분의 역방향 항목을 필+아이콘으로 가시화(모달 컨벤션:
// 아이콘 + 요약 박스 + 필 압축). 실행은 호출측 onConfirm.

import { createPortal } from "react-dom";
import { Hourglass, Loader2, RotateCcw, Zap } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";
import type { UndoPlanItem } from "@/lib/permission-undo";
import type { PrincipalType } from "@/lib/api";

import { PrincipalIcon } from "./principal-picker";

export function UndoLastApplyModal({
  items,
  resolveName,
  busy,
  onConfirm,
  onClose,
}: {
  items: UndoPlanItem[];
  resolveName: (type: PrincipalType, id: string) => string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return createPortal(
    /* 백드롭·카드·버튼 행은 confirm-dialog.tsx 패턴 그대로(z-[1300]) — 목록만 커스텀 */
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="undo-last-apply-modal"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-1.5 text-body-strong text-ink">
            <RotateCcw size={16} strokeWidth={1.5} className="text-ink-tertiary" />
            {t("perm.undo.title")}
          </h2>
          <p className="text-caption text-ink-secondary">{t("perm.undo.desc", { count: items.length })}</p>
        </div>
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-sm bg-surface-alt p-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-caption text-ink">
              <PrincipalIcon type={item.principalType} />
              <span className="min-w-0 flex-1 truncate">{resolveName(item.principalType, item.principalId)}</span>
              <span className="rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-secondary">
                {item.action === "remove-added" && `${t("perm.undo.removeAdded")} (${item.fromRole})`}
                {item.action === "restore-role" && `${item.fromRole} → ${item.toRole}`}
                {item.action === "re-add" && `${t("perm.undo.reAdd")} ${item.toRole}`}
                {item.action === "withdraw" && t("perm.undo.withdrawReq")}
              </span>
              <span
                title={t(item.forecast === "approval" ? "perm.staged.forecastApproval" : "perm.staged.forecastInstant")}
                className="text-ink-tertiary"
              >
                {item.forecast === "approval" ? (
                  <Hourglass size={12} strokeWidth={1.5} />
                ) : (
                  <Zap size={12} strokeWidth={1.5} />
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            data-id="undo-last-apply-cancel"
            disabled={busy}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
            onClick={onClose}
          >
            {t("perm.undo.cancel")}
          </button>
          <button
            type="button"
            data-id="undo-last-apply-confirm"
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={onConfirm}
          >
            {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            {t("perm.undo.confirm")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
