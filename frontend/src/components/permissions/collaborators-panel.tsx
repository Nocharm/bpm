"use client";

// 협업자 관리 패널 — 목록 조회, 역할 변경, 제거, 추가 / Collaborators management panel.

import { useState } from "react";
import { X } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { MapRole, PrincipalType } from "@/lib/mock/permissions";
import {
  addCollaborator,
  changeRole,
  removeCollaborator,
  usePermissions,
} from "@/lib/mock/permissions";
import type { DowngradePayload } from "@/lib/mock/permissions";

import { PrincipalIcon, PrincipalPicker } from "./principal-picker";
import type { PrincipalOption } from "./principal-picker";
import { RoleBadge } from "./role-badge";

interface CollaboratorsPanelProps {
  mapId: string;
  /** 현재 유저 id — 자기 자신 행에 대한 역할 변경 금지 판단에 사용 / Used to disable self-change. */
  currentUserId: string;
  /** 편집 가능 여부 (editor 이상만 true) / Whether controls are enabled. */
  canEdit: boolean;
  /** 토스트 발행 콜백 / Callback to show a toast message. */
  onToast: (msg: string) => void;
}

// 역할 표시명 해석 / Resolve principal display name from seed state.
function usePrincipalName(
  principalType: PrincipalType,
  principalId: string,
): string {
  const state = usePermissions();
  if (principalType === "user") {
    return state.users.find((u) => u.id === principalId)?.name ?? principalId;
  }
  if (principalType === "department") {
    return state.departments.find((d) => d.id === principalId)?.name ?? principalId;
  }
  return state.groups.find((g) => g.id === principalId)?.name ?? principalId;
}

// 개별 행 컴포넌트 — 이름, 아이콘, 역할, 변경/제거 컨트롤 / Individual permission row.
function CollaboratorRow({
  mapId,
  principalType,
  principalId,
  role,
  currentUserId,
  canEdit,
  isPending,
  onToast,
}: {
  mapId: string;
  principalType: PrincipalType;
  principalId: string;
  role: MapRole;
  currentUserId: string;
  canEdit: boolean;
  isPending: boolean;
  onToast: (msg: string) => void;
}) {
  const { t } = useI18n();
  const displayName = usePrincipalName(principalType, principalId);
  const isOwner = role === "owner";
  // 자기 자신 행은 역할/제거 비활성 / Disable controls on own row.
  const isSelf = principalType === "user" && principalId === currentUserId;
  const controlsDisabled = !canEdit || isOwner || isSelf;

  function handleRoleChange(toRole: MapRole) {
    const result = changeRole(mapId, principalType, principalId, toRole, currentUserId);
    if (result.gated) {
      onToast(t("perm.toastGated"));
    }
  }

  function handleRemove() {
    const result = removeCollaborator(mapId, principalType, principalId, currentUserId);
    if (result.gated) {
      onToast(t("perm.toastGated"));
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-alt">
      {/* 유형 아이콘 / Type icon */}
      <PrincipalIcon type={principalType} />

      {/* 이름 / Display name */}
      <span className="min-w-0 flex-1 truncate text-caption text-ink">{displayName}</span>

      {/* 역할 뱃지 or 드롭다운 / Role badge or dropdown */}
      {isOwner || isPending ? (
        <RoleBadge role={role} pending={isPending} />
      ) : controlsDisabled ? (
        <RoleBadge role={role} />
      ) : (
        <select
          className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink"
          value={role}
          onChange={(e) => handleRoleChange(e.target.value as MapRole)}
        >
          <option value="viewer">{t("perm.roleViewer")}</option>
          <option value="editor">{t("perm.roleEditor")}</option>
        </select>
      )}

      {/* 제거 버튼 / Remove button */}
      {!isOwner && !controlsDisabled && (
        <button
          type="button"
          title={t("perm.removeButton")}
          className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-error"
          onClick={handleRemove}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

// 협업자 추가 폼 / Add-collaborator form.
// addCollaborator는 게이트 없음 — onToast 불필요 / addCollaborator is always immediate; no toast needed.
function AddCollaboratorForm({
  mapId,
  currentUserId,
  excludeIds,
}: {
  mapId: string;
  currentUserId: string;
  excludeIds: Set<string>;
}) {
  const { t } = useI18n();
  const state = usePermissions();
  const [selected, setSelected] = useState<PrincipalOption | null>(null);
  const [role, setRole] = useState<"viewer" | "editor">("viewer");

  function handleAdd() {
    if (!selected) return;
    addCollaborator(mapId, selected.principalType, selected.principalId, role, currentUserId);
    setSelected(null);
    setRole("viewer");
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
      <p className="text-caption-strong text-ink">{t("perm.addCollaborator")}</p>

      <PrincipalPicker
        users={state.users}
        departments={state.departments}
        groups={state.groups}
        excludeIds={excludeIds}
        onSelect={setSelected}
      />

      {/* 선택된 principal 표시 / Selected principal chip */}
      {selected && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-caption text-ink">{selected.displayName}</span>

          {/* 역할 선택 / Role select */}
          <label className="text-fine text-ink-tertiary">{t("perm.addRoleLabel")}</label>
          <select
            className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink"
            value={role}
            onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
          >
            <option value="viewer">{t("perm.roleViewer")}</option>
            <option value="editor">{t("perm.roleEditor")}</option>
          </select>

          <button
            type="button"
            className="rounded-sm bg-accent px-2 py-0.5 text-fine text-on-accent hover:bg-accent-focus"
            onClick={handleAdd}
          >
            {t("perm.addButton")}
          </button>
        </div>
      )}
    </div>
  );
}

export function CollaboratorsPanel({
  mapId,
  currentUserId,
  canEdit,
  onToast,
}: CollaboratorsPanelProps) {
  const { t } = useI18n();
  const state = usePermissions();

  // 이 맵의 권한 목록 / Permissions for this map.
  const perms = state.permissions.filter((p) => p.mapId === mapId);

  // 승인 대기 중인 permission_downgrade 요청 목록 / Pending downgrade requests for this map.
  const pendingDowngrades = state.requests.filter(
    (r) => r.mapId === mapId && r.kind === "permission_downgrade" && r.status === "pending",
  );

  // principal별 pending 여부 판단 / Check if a principal has a pending downgrade.
  function hasPending(principalType: PrincipalType, principalId: string): boolean {
    return pendingDowngrades.some((r) => {
      const p = r.payload as DowngradePayload;
      return p.principalType === principalType && p.principalId === principalId;
    });
  }

  // 이미 부여된 principalId 집합 (피커 제외용) / Set of already-granted principalIds.
  const excludeIds = new Set(perms.map((p) => p.principalId));

  return (
    <div className="flex flex-col gap-0.5">
      {/* 빈 목록 안내 — 목록이 비어 있을 때만 / Empty-state message when no collaborators */}
      {perms.length === 0 && (
        <p className="py-4 text-caption text-ink-tertiary">{t("perm.noCollaborators")}</p>
      )}

      {perms.map((perm) => (
        <CollaboratorRow
          key={`${perm.principalType}:${perm.principalId}`}
          mapId={mapId}
          principalType={perm.principalType}
          principalId={perm.principalId}
          role={perm.role}
          currentUserId={currentUserId}
          canEdit={canEdit}
          isPending={hasPending(perm.principalType, perm.principalId)}
          onToast={onToast}
        />
      ))}

      {/* 협업자 추가 폼 — 편집자 이상만 / Add form for editor+ only */}
      {canEdit && (
        <AddCollaboratorForm
          mapId={mapId}
          currentUserId={currentUserId}
          excludeIds={excludeIds}
        />
      )}
    </div>
  );
}
