"use client";

// 위험 구역 — 소유권 이전·맵 삭제 (실 API) /
// Danger zone wired to the real Layer-2 transfer-owner and map-delete endpoints.
// 소유권 이전은 즉시 적용. owner-1 불변식은 서버가 보장하므로 클라 검증은 두지 않고
// 확인 모달(TransferOwnerDialog, 협업자 역할 메뉴와 공용)만 유지한다. 삭제는 DELETE 후 홈으로 이동한다.
// 이전 후보 = 명시 editor+ ∪ 오우닝 부서 소속(파생 editor) — lib/owner-candidates, 이름은 실 디렉터리 (2026-10-01).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Crown } from "lucide-react";

import {
  deleteMap,
  getDirectory,
  listMapPermissions,
  type DirectoryUser,
  type MapPermission,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { buildOwnerCandidates } from "@/lib/owner-candidates";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { DeleteMapDialog } from "@/components/maps/delete-map-dialog";
import { SearchSelect, type SelectOption } from "@/components/search-select";

import { TransferOwnerDialog } from "./transfer-owner-dialog";

interface DangerZoneProps {
  mapId: string;
  /** 현재 유저 id / Current user id. */
  currentUserId: string;
  /** 오우닝 부서 org_path — 소속원은 권한 행 없이도 이전 후보 / Owning dept: members are derived-editor candidates. */
  owningDepartment?: string | null;
  /** 토스트 발행 콜백 / Callback to show a toast. */
  onToast: (msg: string, tone?: "error") => void;
}

export function DangerZone({ mapId, currentUserId, owningDepartment, onToast }: DangerZoneProps) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const mapIdNum = Number(mapId);

  // 서버 권한 목록 + 실 디렉터리 — 이전 대상 후보 도출 / Server perms + directory for transfer targets.
  const [perms, setPerms] = useState<MapPermission[]>([]);
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);

  const [transferTarget, setTransferTarget] = useState("");
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, dir] = await Promise.all([listMapPermissions(mapIdNum), getDirectory()]);
        if (active) {
          setPerms(rows);
          setDirUsers(dir.users);
        }
      } catch (err) {
        if (active) onToast(humanizeApiError(err, t), "error");
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum, onToast, t]);

  const candidates = buildOwnerCandidates(perms, dirUsers, owningDepartment, currentUserId);
  // 명시 편집자 먼저, 오우닝 부서 소속은 그 뒤 — 태그로 출처 구분(그룹 헤더 대신)
  const options: SelectOption[] = candidates.map((c) => {
    const user = c.user;
    const korean = user?.korean_name ?? "";
    const label = lang === "ko" && korean ? `${korean} (${c.name})` : c.name;
    const dept = user ? deptLeaf(user.org_path ?? "") || user.department : "";
    return {
      value: c.userId,
      label,
      sub: [c.userId, dept].filter(Boolean).join(" · "),
      keywords: [c.userId, korean, dept].filter(Boolean).join(" "),
      tag: c.source === "derived" ? t("perm.transferDerivedTag") : c.role === "owner" ? t("perm.roleOwner") : t("perm.roleEditor"),
    };
  });

  const targetName = candidates.find((c) => c.userId === transferTarget)?.name ?? transferTarget;

  async function handleDeleteConfirm() {
    try {
      await deleteMap(mapIdNum);
      onToast(t("perm.deleteToast"));
      setShowDeleteModal(false);
      router.push("/");
    } catch (err) {
      onToast(humanizeApiError(err, t), "error");
      setShowDeleteModal(false);
    }
  }

  return (
    <>
      {/* 소유권 이전 확인 모달 — 협업자 역할 메뉴와 공용 / Transfer confirm modal, shared with the role menu */}
      {showTransferModal && transferTarget && (
        <TransferOwnerDialog
          mapId={mapIdNum}
          targetId={transferTarget}
          targetName={targetName}
          onToast={onToast}
          onClose={() => setShowTransferModal(false)}
        />
      )}

      {/* 맵 삭제 확인 — 시각적 안내 모달 (DL) */}
      {showDeleteModal && (
        <DeleteMapDialog
          onConfirm={() => void handleDeleteConfirm()}
          onClose={() => setShowDeleteModal(false)}
        />
      )}

      <div className="flex flex-col gap-4">
        {/* ── 소유권 이전 / Ownership transfer ── */}
        <div data-id="danger-transfer-card" className="rounded-md border border-hairline p-3">
          <p className="mb-1 flex items-center gap-1.5 text-caption-strong text-ink">
            <Crown size={14} strokeWidth={1.5} className="text-ink-tertiary" />
            {t("perm.transferTitle")}
          </p>
          <p className="mb-3 text-fine text-ink-tertiary">{t("perm.transferHint")}</p>
          <div className="flex items-center gap-2">
            <SearchSelect
              value={transferTarget}
              options={options}
              emptyLabel={t("perm.transferPickPlaceholder")}
              placeholder={t("perm.transferSearchPlaceholder")}
              onChange={setTransferTarget}
            />
            <button
              type="button"
              data-id="danger-transfer-button"
              disabled={!transferTarget}
              className="shrink-0 rounded-sm border border-error px-2.5 py-1 text-caption text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => setShowTransferModal(true)}
            >
              {t("perm.transferButton")}
            </button>
          </div>
          {candidates.length === 0 && (
            <p className="mt-2 text-fine text-ink-tertiary">
              {t("perm.transferNoEligible")}
            </p>
          )}
        </div>

        {/* ── 맵 삭제 / Map delete ── */}
        <div data-id="danger-delete-card" className="rounded-md border border-error p-3">
          <p className="mb-1 flex items-center gap-1.5 text-caption-strong text-error">
            <AlertTriangle size={14} strokeWidth={1.5} />
            {t("perm.deleteTitle")}
          </p>
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
