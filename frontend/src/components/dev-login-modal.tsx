"use client";

import { UserRound, X } from "lucide-react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { LOCAL_USERS } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

export function DevLoginModal({
  onPick,
  onClose,
}: {
  onPick: (loginId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        data-id="dev-login-modal"
        className="w-80 rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-body-strong text-ink">{t("login.devPick")}</p>
          <button
            type="button"
            aria-label={t("action.close")}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {LOCAL_USERS.map((user) => (
            <button
              key={user.loginId}
              type="button"
              data-id="dev-user-row"
              className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-2 text-left hover:border-accent hover:bg-accent-tint"
              onClick={() => onPick(user.loginId)}
            >
              <UserRound size={16} strokeWidth={1.6} className="shrink-0 text-ink-tertiary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption text-ink">
                  {user.name} <span className="text-fine text-ink-muted">({user.loginId})</span>
                </span>
                <span className="block text-fine text-ink-tertiary">{user.department}</span>
              </span>
              <span
                className={`shrink-0 rounded-xs border px-1.5 py-px text-fine ${
                  user.role === "admin"
                    ? "border-accent-tint-border text-accent"
                    : "border-hairline text-ink-tertiary"
                }`}
              >
                {user.role}
              </span>
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
