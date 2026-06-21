"use client";

// 협업자 관리 패널 — 서버 권한 목록 조회·역할 변경·제거·추가 (실 API) /
// Collaborators panel wired to the real Layer-2 permissions API.
// 서버가 진실: 모든 변경은 API 호출 후 목록을 재조회해 반영한다. 다운그레이드/에디터제거는
// pending 응답을 받으면 역할을 즉시 바꾸지 않고 "승인 대기"만 표시한다(낙관적 갱신 금지).
// 표시명·피커 후보는 아직 Layer-4 디렉터리 API가 없어 mock 시드를 사용한다.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import {
  addMapPermission,
  changeMapPermission,
  listMapPermissions,
  removeMapPermission,
  type MapPermission as ApiPermission,
  type MapRole,
  type PrincipalType,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/mock/permissions";

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
  /** 공개 맵이면 viewer 그랜트 비활성 — 전원 열람 가능 / Disable viewer role when map is public. */
  viewerGrantDisabled?: boolean;
}

// 표시명 해석 — mock 시드(디렉터리) 사용. 미일치 시 principalId 폴백 /
// Resolve principal display name from mock seed directory; fall back to id.
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

// 개별 행 — 이름, 아이콘, 역할, 변경/제거 컨트롤 / Individual permission row.
function CollaboratorRow({
  perm,
  currentUserId,
  canEdit,
  isPending,
  onChangeRole,
  onRemove,
}: {
  perm: ApiPermission;
  currentUserId: string;
  canEdit: boolean;
  isPending: boolean;
  onChangeRole: (perm: ApiPermission, toRole: MapRole) => void;
  onRemove: (perm: ApiPermission) => void;
}) {
  const { t } = useI18n();
  const principalType = perm.principal_type as PrincipalType;
  const displayName = usePrincipalName(principalType, perm.principal_id);
  const role = perm.role as MapRole;
  const isOwner = role === "owner";
  // 자기 자신 행은 역할/제거 비활성 / Disable controls on own row.
  const isSelf = principalType === "user" && perm.principal_id === currentUserId;
  const controlsDisabled = !canEdit || isOwner || isSelf;

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
          onChange={(e) => onChangeRole(perm, e.target.value as MapRole)}
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
          onClick={() => onRemove(perm)}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

// 협업자 추가 폼 — 추가는 즉시 적용(서버) / Add-collaborator form; add is applied immediately by the server.
function AddCollaboratorForm({
  excludeIds,
  viewerGrantDisabled,
  onAdd,
}: {
  excludeIds: Set<string>;
  /** 공개 맵이면 viewer 선택 비활성 / Disable viewer option on public maps. */
  viewerGrantDisabled?: boolean;
  onAdd: (
    principalType: PrincipalType,
    principalId: string,
    role: "viewer" | "editor",
  ) => void;
}) {
  const { t } = useI18n();
  const state = usePermissions();
  const [selected, setSelected] = useState<PrincipalOption | null>(null);
  // 공개 맵이면 editor 기본값 / Default to editor on public maps (viewer disabled).
  const [role, setRole] = useState<"viewer" | "editor">(viewerGrantDisabled ? "editor" : "viewer");

  function handleAdd() {
    if (!selected) return;
    onAdd(selected.principalType, selected.principalId, role);
    setSelected(null);
    setRole(viewerGrantDisabled ? "editor" : "viewer");
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
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-caption text-ink">{selected.displayName}</span>

            {/* 역할 선택 / Role select */}
            <label className="text-fine text-ink-tertiary">{t("perm.addRoleLabel")}</label>
            <select
              className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink"
              value={role}
              onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
            >
              {/* 공개 맵은 전원 열람 가능 → viewer 비활성 / Public map: viewer disabled */}
              <option value="viewer" disabled={viewerGrantDisabled}>
                {t("perm.roleViewer")}
                {viewerGrantDisabled ? ` — ${t("perm.visibilityViewerNote")}` : ""}
              </option>
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

          {/* 그룹 권한은 저장되나 Layer 4부터 적용 / Group grants stored but effective from Layer 4 */}
          {selected.principalType === "group" && (
            <p className="text-fine text-ink-tertiary">{t("perm.groupLayer4Note")}</p>
          )}
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
  viewerGrantDisabled = false,
}: CollaboratorsPanelProps) {
  const { t } = useI18n();
  const mapIdNum = Number(mapId);

  // 서버 권한 목록 / Server-sourced permissions list.
  const [perms, setPerms] = useState<ApiPermission[]>([]);
  // 다운그레이드/제거 요청이 pending 인 permission id 집합 — mutation 응답에서 채움.
  // 서버 진실(역할 미변경)은 perms 가 그대로 유지하고, 이 집합은 "승인 대기" 배지만 구동한다.
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    try {
      const rows = await listMapPermissions(mapIdNum);
      setPerms(rows);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }, [mapIdNum, onToast]);

  // 초기 로드 — 인라인 async + active 가드(언마운트 후 setState 방지) /
  // Initial load: inline async with an active guard (avoids set-state-after-unmount).
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

  const handleAdd = useCallback(
    async (
      principalType: PrincipalType,
      principalId: string,
      role: "viewer" | "editor",
    ) => {
      try {
        await addMapPermission(mapIdNum, principalType, principalId, role);
        await reload();
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err));
      }
    },
    [mapIdNum, reload, onToast],
  );

  const handleChangeRole = useCallback(
    async (perm: ApiPermission, toRole: MapRole) => {
      try {
        const result = await changeMapPermission(mapIdNum, perm.id, toRole);
        if (result.pending) {
          // 지연 — 역할 미변경. "승인 대기" 표시만 / Pending: role unchanged, show badge only.
          setPendingIds((prev) => new Set(prev).add(perm.id));
          onToast(t("perm.toastGated"));
        } else {
          await reload();
        }
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err));
      }
    },
    [mapIdNum, reload, onToast, t],
  );

  const handleRemove = useCallback(
    async (perm: ApiPermission) => {
      try {
        const result = await removeMapPermission(mapIdNum, perm.id);
        if (result.pending) {
          // 에디터 제거는 승인 지연 — 행 유지, "승인 대기" 표시 / Editor removal gated: keep row, show badge.
          setPendingIds((prev) => new Set(prev).add(perm.id));
          onToast(t("perm.toastGated"));
        } else {
          await reload();
        }
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err));
      }
    },
    [mapIdNum, reload, onToast, t],
  );

  // 이미 부여된 principalId 집합 (피커 제외용) / Set of already-granted principalIds.
  const excludeIds = new Set(perms.map((p) => p.principal_id));

  return (
    <div className="flex flex-col gap-0.5">
      {/* 빈 목록 안내 / Empty-state message when no collaborators */}
      {perms.length === 0 && (
        <p className="py-4 text-caption text-ink-tertiary">{t("perm.noCollaborators")}</p>
      )}

      {perms.map((perm) => (
        <CollaboratorRow
          key={perm.id}
          perm={perm}
          currentUserId={currentUserId}
          canEdit={canEdit}
          isPending={pendingIds.has(perm.id)}
          onChangeRole={handleChangeRole}
          onRemove={handleRemove}
        />
      ))}

      {/* 협업자 추가 폼 — 편집자 이상만 / Add form for editor+ only */}
      {canEdit && (
        <AddCollaboratorForm
          excludeIds={excludeIds}
          viewerGrantDisabled={viewerGrantDisabled}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}
