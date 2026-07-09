"use client";

// 협업자 관리 패널 — 서버 권한 목록 조회·역할 변경·제거·추가 (실 API) /
// Collaborators panel wired to the real Layer-2 permissions API.
// 서버가 진실: 모든 변경은 API 호출 후 목록을 재조회해 반영한다. 다운그레이드/에디터제거는
// pending 응답을 받으면 역할을 즉시 바꾸지 않고 "승인 대기"만 표시한다(낙관적 갱신 금지).
// 표시명·피커 후보: 사용자·부서는 실 /api/directory, 그룹은 실 active 그룹(Layer 4 Task 4). /
// Display names / picker: users+departments from real /api/directory; groups from real active groups.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import {
  addMapPermission,
  changeMapPermission,
  getDirectory,
  listApprovers,
  listGroups,
  listMapPermissions,
  removeMapPermission,
  type DirectoryDept,
  type DirectoryUser,
  type Group,
  type MapPermission as ApiPermission,
  type MapRole,
  type PrincipalType,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { deriveDeptKoreanKeywords } from "@/lib/korean-dept";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";

import { PrincipalIcon, PrincipalPicker } from "./principal-picker";
import { RoleBadge } from "./role-badge";
import { SkeletonRows } from "./loading-skeleton";

// 실 active 그룹을 피커 prop(UserGroup) 형식으로 변환 — principalId = 문자열 그룹 id /
// Adapt real active groups to the picker's UserGroup shape (principalId = string group id).
function toPickerGroups(groups: Group[]): UserGroup[] {
  return groups
    .filter((g) => g.status === "active")
    .map((g) => ({
      id: String(g.id),
      name: g.name,
      description: g.description,
      status: "active" as const,
      managerIds: [],
      members: [],
    }));
}

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

// 표시명 해석 — 실 디렉터리/그룹 우선, 없으면 principalId 폴백 /
// Resolve display name from real directory (users/depts) and real groups; fall back to id.
function resolvePrincipalName(
  principalType: PrincipalType,
  principalId: string,
  dirUsers: DirectoryUser[],
  dirDepts: DirectoryDept[],
  groups: Group[],
): string {
  if (principalType === "user") {
    return dirUsers.find((u) => u.id === principalId)?.name ?? principalId;
  }
  if (principalType === "department") {
    return dirDepts.find((d) => d.id === principalId)?.name ?? principalId;
  }
  return groups.find((g) => String(g.id) === principalId)?.name ?? principalId;
}

// 개별 행 — 이름, 아이콘, 역할, 변경/제거 컨트롤 / Individual permission row.
function CollaboratorRow({
  perm,
  currentUserId,
  canEdit,
  isPending,
  viewerGrantDisabled,
  dirUsers,
  dirDepts,
  groups,
  onChangeRole,
  onRemove,
}: {
  perm: ApiPermission;
  currentUserId: string;
  canEdit: boolean;
  isPending: boolean;
  /** 퍼블릭 맵이면 viewer 선택지 숨김 — 단, 현재 역할이 viewer면 표시(editor로 교정 가능) /
   * Public map: hide viewer option (unless this grant is already viewer, so it can be fixed to editor). */
  viewerGrantDisabled?: boolean;
  dirUsers: DirectoryUser[];
  dirDepts: DirectoryDept[];
  groups: Group[];
  onChangeRole: (perm: ApiPermission, toRole: MapRole) => void;
  onRemove: (perm: ApiPermission) => void;
}) {
  const { t } = useI18n();
  const principalType = perm.principal_type as PrincipalType;
  const displayName = resolvePrincipalName(principalType, perm.principal_id, dirUsers, dirDepts, groups);
  // 유령 principal — 디렉터리에서 사라진 유저(퇴사) / 현 조직에 없는 부서(조직개편).
  // 목록 로딩 전(빈 배열) 오탐 방지를 위해 로드된 뒤에만 판정.
  const isGhost =
    principalType === "user"
      ? dirUsers.length > 0 && !dirUsers.some((u) => u.id === perm.principal_id)
      : principalType === "department"
        ? dirDepts.length > 0 && !dirDepts.some((d) => d.id === perm.principal_id)
        : false;
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
      <span className="min-w-0 flex-1 truncate text-caption text-ink">
        {displayName}
        {isGhost && (
          <span
            data-id="ghost-badge"
            className="ml-1.5 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-error"
            title={t(principalType === "department" ? "perm.badgeMissingNote" : "perm.badgeDepartedNote")}
          >
            {t(principalType === "department" ? "perm.badgeMissing" : "perm.badgeDeparted")}
          </span>
        )}
      </span>

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
          {/* 퍼블릭 맵은 viewer 선택지 숨김 — 단 기존 viewer는 표시(editor로 교정 가능) */}
          {(!viewerGrantDisabled || role === "viewer") && (
            <option value="viewer">{t("perm.roleViewer")}</option>
          )}
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
  dirUsers,
  dirDepts,
  groups,
  onAdd,
}: {
  excludeIds: Set<string>;
  /** 공개 맵이면 viewer 선택 비활성 / Disable viewer option on public maps. */
  viewerGrantDisabled?: boolean;
  /** 실 디렉터리 사용자 / Real directory users for the picker. */
  dirUsers: DirectoryUser[];
  /** 실 디렉터리 부서 / Real directory departments for the picker. */
  dirDepts: DirectoryDept[];
  /** 실 active 그룹 / Real active groups for the picker. */
  groups: Group[];
  onAdd: (
    principalType: PrincipalType,
    principalId: string,
    role: "viewer" | "editor",
  ) => void;
}) {
  const { t } = useI18n();
  // 공개 맵이면 editor 기본값 / Default to editor on public maps (viewer disabled).
  const [role, setRole] = useState<"viewer" | "editor">(viewerGrantDisabled ? "editor" : "viewer");

  // 실 디렉터리 데이터를 피커 prop 형식으로 변환 — 미사용 필드는 빈 값으로 채움.
  // Adapt real directory data to picker's MockUser / Department shapes (unused fields stubbed).
  const pickerUsers: MockUser[] = dirUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: "",
    departmentId: "",
    status: "active" as const,
    isSysadmin: false,
    korean_name: u.korean_name ?? "",
  }));
  const pickerDepts: Department[] = dirDepts.map((d) => ({
    id: d.id,
    code: "",
    name: d.name,
    orgLevels: [],
    parentId: null,
    rawDn: "",
    korean_name: d.korean_name,
    manager: d.manager,
  }));

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
      <p className="text-caption-strong text-ink">{t("perm.addCollaborator")}</p>

      {/* 선택한 역할로 드롭다운 선택(클릭/Enter) 즉시 추가 — 별도 Add 버튼 없음 (3차 수정) */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <PrincipalPicker
            users={pickerUsers}
            departments={pickerDepts}
            groups={toPickerGroups(groups)}
            excludeIds={excludeIds}
            deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
            onSelect={(opt) => onAdd(opt.principalType, opt.principalId, role)}
          />
        </div>
        {/* 역할 — 퍼블릭 맵이면 editor 1옵션이라 드롭다운 대신 정적 표시(화살표 없음) */}
        {viewerGrantDisabled ? (
          <span className="rounded-sm border border-hairline bg-surface-alt px-2 py-1.5 text-fine text-ink-secondary">
            {t("perm.roleEditor")}
          </span>
        ) : (
          <select
            className="rounded-sm border border-hairline bg-surface px-1.5 py-1.5 text-fine text-ink"
            value={role}
            onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
          >
            <option value="viewer">{t("perm.roleViewer")}</option>
            <option value="editor">{t("perm.roleEditor")}</option>
          </select>
        )}
      </div>
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
  // 맵의 지정 승인자 login_id 목록 — 다운그레이드가 지연될 때 "누가 승인 가능한지" 안내에 사용.
  const [approverIds, setApproverIds] = useState<string[]>([]);
  // 초기 로드 중 — 데이터 도착 전 "협업자 없음" 대신 스켈레톤 표시 (F8).
  const [loading, setLoading] = useState(true);

  // 실 디렉터리 — 피커 후보와 표시명 해석에 사용 (Layer 4 Task 0) /
  // Real directory for picker candidates and display-name resolution.
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  // 실 active 그룹 — 그룹 협업자 옵션·표시명 (Layer 4 Task 4) /
  // Real active groups for group collaborator options and display names.
  const [groups, setGroups] = useState<Group[]>([]);

  // 승인 권한자 표시명 — 지정 승인자 login_id → 디렉터리 표시명, 없으면 안내 문구(시스템 관리자 포함).
  const approverDisplayNames =
    approverIds.length > 0
      ? approverIds.map((id) => dirUsers.find((u) => u.id === id)?.name ?? id).join(", ")
      : t("perm.approversNone");

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
        const [rows, dir, groupRows, approvers] = await Promise.all([
          listMapPermissions(mapIdNum),
          getDirectory(),
          listGroups(),
          listApprovers(mapIdNum),
        ]);
        if (active) {
          setPerms(rows);
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
          setGroups(groupRows);
          setApproverIds(approvers);
        }
      } catch (err) {
        if (active) onToast(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
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
          // 지연 — 역할 미변경. "승인 대기" 표시 + 승인 권한자 안내 / Pending: show badge + who can approve.
          setPendingIds((prev) => new Set(prev).add(perm.id));
          onToast(t("perm.toastGatedBy", { names: approverDisplayNames }));
        } else {
          await reload();
        }
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err));
      }
    },
    [mapIdNum, reload, onToast, t, approverDisplayNames],
  );

  const handleRemove = useCallback(
    async (perm: ApiPermission) => {
      try {
        const result = await removeMapPermission(mapIdNum, perm.id);
        if (result.pending) {
          // 에디터 제거는 승인 지연 — 행 유지, "승인 대기" + 승인 권한자 안내 / Gated: keep row, show who can approve.
          setPendingIds((prev) => new Set(prev).add(perm.id));
          onToast(t("perm.toastGatedBy", { names: approverDisplayNames }));
        } else {
          await reload();
        }
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err));
      }
    },
    [mapIdNum, reload, onToast, t, approverDisplayNames],
  );

  // 이미 부여된 principalId 집합 (피커 제외용) / Set of already-granted principalIds.
  const excludeIds = new Set(perms.map((p) => p.principal_id));

  return (
    <div className="flex flex-col gap-0.5">
      {/* 로딩 중 스켈레톤 / Skeleton while loading (F8) */}
      {loading && <SkeletonRows />}

      {/* 빈 목록 안내 — 로딩 끝난 뒤에만 / Empty-state only after load */}
      {!loading && perms.length === 0 && (
        <p className="py-4 text-caption text-ink-tertiary">{t("perm.noCollaborators")}</p>
      )}

      {perms.map((perm) => (
        <CollaboratorRow
          key={perm.id}
          perm={perm}
          currentUserId={currentUserId}
          canEdit={canEdit}
          isPending={pendingIds.has(perm.id)}
          viewerGrantDisabled={viewerGrantDisabled}
          dirUsers={dirUsers}
          dirDepts={dirDepts}
          groups={groups}
          onChangeRole={handleChangeRole}
          onRemove={handleRemove}
        />
      ))}

      {/* 협업자 추가 폼 — 편집자 이상만 / Add form for editor+ only */}
      {canEdit && (
        <AddCollaboratorForm
          excludeIds={excludeIds}
          viewerGrantDisabled={viewerGrantDisabled}
          dirUsers={dirUsers}
          dirDepts={dirDepts}
          groups={groups}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}
