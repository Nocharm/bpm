"use client";

// 위험 구역 — 소유권 이전, 맵 mock 삭제 / Danger zone: ownership transfer and mock map delete.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n";
import { ModalBackdrop } from "@/components/modal-backdrop";
import {
  deleteMapMock,
  transferOwner,
  usePermissions,
} from "@/lib/mock/permissions";

interface DangerZoneProps {
  mapId: string;
  /** 현재 유저 id / Current user id. */
  currentUserId: string;
  /** 토스트 발행 콜백 / Callback to show a toast. */
  onToast: (msg: string) => void;
}

// 문자열 치환 헬퍼 / Simple string substitution helper.
function sub(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(`{${k}}`, v),
    template,
  );
}

export function DangerZone({ mapId, currentUserId, onToast }: DangerZoneProps) {
  const { t } = useI18n();
  const router = useRouter();
  const state = usePermissions();

  // 소유권 이전 대상 선택 / Transfer target user selection.
  const [transferTarget, setTransferTarget] = useState("");
  const [showTransferModal, setShowTransferModal] = useState(false);

  // 맵 삭제 확인 모달 / Delete confirm modal.
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // 소유권 이전 대상 후보 — editor 이상인 유저(현 소유자 제외) /
  // Eligible transfer targets: users with editor+ role on this map, excluding current owner.
  const eligible = state.permissions
    .filter(
      (p) =>
        p.mapId === mapId &&
        p.principalType === "user" &&
        (p.role === "editor" || p.role === "owner") &&
        p.principalId !== currentUserId,
    )
    .map((p) => {
      const user = state.users.find((u) => u.id === p.principalId);
      return { userId: p.principalId, name: user?.name ?? p.principalId };
    });

  // 이전 대상 표시명 / Display name of transfer target.
  const targetName =
    eligible.find((e) => e.userId === transferTarget)?.name ?? transferTarget;

  function handleTransferConfirm() {
    if (!transferTarget) return;
    transferOwner(mapId, transferTarget, currentUserId);
    onToast(sub(t("perm.transferToast"), { name: targetName }));
    setShowTransferModal(false);
    setTransferTarget("");
  }

  function handleDeleteConfirm() {
    deleteMapMock(mapId);
    onToast(t("perm.deleteToast"));
    setShowDeleteModal(false);
    // mock 삭제 후 홈으로 이동 / Redirect to home after mock delete.
    router.push("/");
  }

  return (
    <>
      {/* 소유권 이전 확인 모달 / Transfer confirm modal */}
      {showTransferModal && (
        <ModalBackdrop
          onClose={() => setShowTransferModal(false)}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30"
        >
          <div className="w-80 rounded-md border border-hairline bg-surface p-4 shadow-lg">
            <p className="mb-2 text-caption-strong text-ink">
              {t("perm.transferConfirmTitle")}
            </p>
            <p className="mb-4 text-caption text-ink-secondary">
              {sub(t("perm.transferConfirmBody"), { name: targetName })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                onClick={() => setShowTransferModal(false)}
              >
                {t("perm.transferCancel")}
              </button>
              <button
                type="button"
                className="rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent hover:opacity-90"
                onClick={handleTransferConfirm}
              >
                {t("perm.transferConfirm")}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* 맵 삭제 확인 모달 / Delete confirm modal */}
      {showDeleteModal && (
        <ModalBackdrop
          onClose={() => setShowDeleteModal(false)}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30"
        >
          <div className="w-80 rounded-md border border-hairline bg-surface p-4 shadow-lg">
            <p className="mb-2 text-caption-strong text-ink">
              {t("perm.deleteConfirmTitle")}
            </p>
            <p className="mb-4 text-caption text-ink-secondary">
              {t("perm.deleteConfirmBody")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                onClick={() => setShowDeleteModal(false)}
              >
                {t("perm.deleteCancel")}
              </button>
              <button
                type="button"
                className="rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent hover:opacity-90"
                onClick={handleDeleteConfirm}
              >
                {t("perm.deleteConfirm")}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      <div className="flex flex-col gap-6">
        <p className="text-caption-strong text-error">{t("perm.dangerTitle")}</p>

        {/* ── 소유권 이전 / Ownership transfer ── */}
        <div className="rounded-sm border border-hairline p-3">
          <p className="mb-1 text-caption-strong text-ink">{t("perm.transferTitle")}</p>
          <p className="mb-3 text-fine text-ink-tertiary">{t("perm.transferHint")}</p>
          <div className="flex items-center gap-2">
            <select
              className="flex-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
            >
              <option value="">{t("perm.transferPickPlaceholder")}</option>
              {eligible.map((e) => (
                <option key={e.userId} value={e.userId}>
                  {e.name} ({e.userId})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!transferTarget}
              className="rounded-sm border border-error px-2 py-1 text-caption text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => setShowTransferModal(true)}
            >
              {t("perm.transferButton")}
            </button>
          </div>
          {eligible.length === 0 && (
            <p className="mt-2 text-fine text-ink-tertiary">
              편집자 이상 협업자가 없으면 이전 불가합니다.
            </p>
          )}
        </div>

        {/* ── 맵 mock 삭제 / Mock map delete ── */}
        <div className="rounded-sm border border-error p-3">
          <p className="mb-1 text-caption-strong text-error">{t("perm.deleteTitle")}</p>
          <p className="mb-3 text-fine text-ink-tertiary">{t("perm.deleteHint")}</p>
          <button
            type="button"
            className="rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent hover:opacity-90"
            onClick={() => setShowDeleteModal(true)}
          >
            {t("perm.deleteButton")}
          </button>
        </div>
      </div>
    </>
  );
}
