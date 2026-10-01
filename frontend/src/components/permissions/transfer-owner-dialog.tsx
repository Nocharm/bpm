"use client";

// 소유권 이전 확인 모달 — 위험 구역 피커와 협업자 역할 메뉴(Owner 항목)가 같은 게이트를 지난다 (2026-10-01).
// 확인 시 transfer-owner 호출 → 토스트 → 편집기로 이동(이전한 본인은 editor로 강등되어 설정 화면 권한이 줄어든다).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown } from "lucide-react";

import { transferMapOwner } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { ModalBackdrop } from "@/components/modal-backdrop";

interface TransferOwnerDialogProps {
  mapId: number;
  targetId: string;
  targetName: string;
  onToast: (msg: string, tone?: "error") => void;
  onClose: () => void;
}

export function TransferOwnerDialog({ mapId, targetId, targetName, onToast, onClose }: TransferOwnerDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await transferMapOwner(mapId, targetId);
      onToast(t("perm.transferToast", { name: targetName }));
      onClose();
      router.push(`/maps/${mapId}`);
    } catch (err) {
      onToast(humanizeApiError(err, t), "error");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/30 backdrop-blur-sm"
    >
      <div data-id="transfer-owner-dialog" className="w-80 rounded-md border border-hairline bg-surface p-4 shadow-lg">
        <p className="mb-2 flex items-center gap-2 text-caption-strong text-ink">
          <Crown size={16} strokeWidth={1.5} className="text-error" />
          {t("perm.transferConfirmTitle")}
        </p>
        <p className="mb-4 text-caption text-ink-secondary">{t("perm.transferConfirmBody", { name: targetName })}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="transfer-owner-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("perm.transferCancel")}
          </button>
          <button
            type="button"
            data-id="transfer-owner-confirm"
            disabled={busy}
            className="rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent hover:opacity-90 disabled:opacity-50"
            onClick={() => void confirm()}
          >
            {t("perm.transferConfirm")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
