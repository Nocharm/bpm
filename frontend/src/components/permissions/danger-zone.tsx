"use client";

// 위험 구역 — 소유권 이전·맵 삭제 (실 API) /
// Danger zone wired to the real Layer-2 transfer-owner and map-delete endpoints.
// 소유권 이전은 즉시 적용. owner-1 불변식은 서버가 보장하므로 클라 검증은 두지 않고
// 확인 모달만 유지한다. 삭제는 DELETE 후 홈으로 이동한다.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteMap,
  listMapPermissions,
  transferMapOwner,
  type MapPermission,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { DeleteMapDialog } from "@/components/maps/delete-map-dialog";
import { usePermissions } from "@/lib/mock/permissions";

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
  const mapIdNum = Number(mapId);

  // 서버 권한 목록 — 이전 대상 후보(editor 이상 user) 도출에 사용 / Server perms for transfer targets.
  const [perms, setPerms] = useState<MapPermission[]>([]);

  const [transferTarget, setTransferTarget] = useState("");
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await listMapPermissions(mapIdNum);
        if (active) setPerms(rows);
      } catch (err) {
        if (active) onToast(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum, onToast]);

  // 표시명 해석 — mock 시드 사용 / Resolve display name from mock seed.
  const userName = useCallback(
    (userId: string): string => state.users.find((u) => u.id === userId)?.name ?? userId,
    [state.users],
  );

  // 이전 대상 후보 — editor 이상 user(현재 유저 제외) / Eligible targets: editor+ users, excluding self.
  const eligible = perms
    .filter(
      (p) =>
        p.principal_type === "user" &&
        (p.role === "editor" || p.role === "owner") &&
        p.principal_id !== currentUserId,
    )
    .map((p) => ({ userId: p.principal_id, name: userName(p.principal_id) }));

  const targetName =
    eligible.find((e) => e.userId === transferTarget)?.name ?? transferTarget;

  async function handleTransferConfirm() {
    if (!transferTarget) return;
    try {
      await transferMapOwner(mapIdNum, transferTarget);
      onToast(sub(t("perm.transferToast"), { name: targetName }));
      setShowTransferModal(false);
      setTransferTarget("");
      // 이전 후 자신의 역할은 editor로 강등 — 설정 화면을 떠나 편집기로 / Demoted to editor: leave settings.
      router.push(`/maps/${mapId}`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
      setShowTransferModal(false);
    }
  }

  async function handleDeleteConfirm() {
    try {
      await deleteMap(mapIdNum);
      onToast(t("perm.deleteToast"));
      setShowDeleteModal(false);
      router.push("/");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
      setShowDeleteModal(false);
    }
  }

  return (
    <>
      {/* 소유권 이전 확인 모달 / Transfer confirm modal */}
      {showTransferModal && (
        <ModalBackdrop
          onClose={() => setShowTransferModal(false)}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30 backdrop-blur-sm"
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
                onClick={() => void handleTransferConfirm()}
              >
                {t("perm.transferConfirm")}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* 맵 삭제 확인 — 시각적 안내 모달 (DL) */}
      {showDeleteModal && (
        <DeleteMapDialog
          onConfirm={() => void handleDeleteConfirm()}
          onClose={() => setShowDeleteModal(false)}
        />
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
              {t("perm.transferNoEligible")}
            </p>
          )}
        </div>

        {/* ── 맵 삭제 / Map delete ── */}
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
