"use client";

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
        className="w-80 rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-3 text-body-strong text-ink">{t("login.devPick")}</p>
        <div className="flex flex-col gap-1.5">
          {LOCAL_USERS.map((user) => (
            <button
              key={user.loginId}
              type="button"
              className="flex items-center justify-between rounded-sm border border-hairline px-3 py-2 text-caption text-ink hover:bg-surface-alt"
              onClick={() => onPick(user.loginId)}
            >
              <span>
                {user.name} <span className="text-ink-tertiary">({user.loginId})</span>
              </span>
              <span className="text-fine text-ink-tertiary">
                {user.department} · {user.role}
              </span>
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
