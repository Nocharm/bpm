"use client";

// 유저 그룹 상세 — 멤버·관리자 조회 및 편집 / User group detail: view and edit members and managers.

import Link from "next/link";
import { use, useState } from "react";
import { User, Building2 } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import {
  usePermissions,
  addGroupMember,
  removeGroupMember,
  setGroupManagers,
} from "@/lib/mock/permissions";
import type { UserGroup } from "@/lib/mock/permissions";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";

// 그룹 상태 pill — UserGroup.status는 VersionStatus와 달리 "active"를 포함 /
// Group status pill: UserGroup.status includes "active" unlike VersionStatus.
function GroupStatusBadge({ status }: { status: UserGroup["status"] }) {
  const { t } = useI18n();
  const styles: Record<UserGroup["status"], string> = {
    active: "border-added text-added",
    pending: "border-changed text-changed",
    rejected: "border-error text-error",
  };
  const labels: Record<UserGroup["status"], string> = {
    active: t("perm.group.statusActive"),
    pending: t("perm.group.statusPending"),
    rejected: t("perm.group.statusRejected"),
  };
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-fine ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// 멤버 타입 아이콘 / Icon for member type.
function MemberTypeIcon({ type }: { type: "department" | "user" }) {
  if (type === "department")
    return <Building2 size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
  return <User size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
}

// 멤버 표시명 해석 — dept/user 이름 매핑 / Resolve member display name from dept or user.
function useMemberDisplayName(
  type: "department" | "user",
  id: string,
  state: ReturnType<typeof usePermissions>,
): string {
  if (type === "department") {
    return state.departments.find((d) => d.id === id)?.name ?? id;
  }
  return state.users.find((u) => u.id === id)?.name ?? id;
}

interface MemberRowProps {
  type: "department" | "user";
  id: string;
  state: ReturnType<typeof usePermissions>;
  canEdit: boolean;
  onRemove: () => void;
}

function MemberRow({ type, id, state, canEdit, onRemove }: MemberRowProps) {
  const { t } = useI18n();
  const name = useMemberDisplayName(type, id, state);
  return (
    <div className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2">
      <MemberTypeIcon type={type} />
      <span className="flex-1 text-caption text-ink">{name}</span>
      <span className="text-fine text-ink-tertiary">
        {type === "department" ? t("perm.principalDept") : t("perm.principalUser")}
      </span>
      {canEdit && (
        <button
          type="button"
          className="ml-2 text-fine text-ink-tertiary hover:text-error"
          onClick={onRemove}
        >
          {t("perm.group.removeBtn")}
        </button>
      )}
    </div>
  );
}

// 관리자 추가 다이얼로그 / Manager-add dialog.
interface ManagerPickerDialogProps {
  state: ReturnType<typeof usePermissions>;
  excludeIds: Set<string>;
  onSelect: (opt: PrincipalOption) => void;
  onClose: () => void;
}

function ManagerPickerDialog({ state, excludeIds, onSelect, onClose }: ManagerPickerDialogProps) {
  const { t } = useI18n();
  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30"
    >
      <div className="flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border border-hairline bg-surface p-5 shadow-lg">
        <p className="text-body-strong text-ink">{t("perm.group.addManagerBtn")}</p>
        {/* user만 허용 — departments: [], groups: [] / User-only picker. */}
        <PrincipalPicker
          users={state.users}
          departments={[]}
          groups={[]}
          excludeIds={excludeIds}
          onSelect={(opt) => {
            onSelect(opt);
            onClose();
          }}
        />
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("perm.group.cancelBtn")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// 멤버 추가 다이얼로그 / Member-add dialog.
interface MemberPickerDialogProps {
  state: ReturnType<typeof usePermissions>;
  excludeIds: Set<string>;
  onSelect: (opt: PrincipalOption) => void;
  onClose: () => void;
}

function MemberPickerDialog({ state, excludeIds, onSelect, onClose }: MemberPickerDialogProps) {
  const { t } = useI18n();
  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30"
    >
      <div className="flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border border-hairline bg-surface p-5 shadow-lg">
        <p className="text-body-strong text-ink">{t("perm.group.addMemberBtn")}</p>
        {/* dept + user만 허용 — groups: [] / Dept+user picker, no groups. */}
        <PrincipalPicker
          users={state.users}
          departments={state.departments}
          groups={[]}
          excludeIds={excludeIds}
          onSelect={(opt) => {
            if (opt.principalType === "group") return;
            onSelect(opt);
            onClose();
          }}
        />
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("perm.group.cancelBtn")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const { t } = useI18n();
  const state = usePermissions();
  const currentUser = useCurrentMockUser();

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [managerDialogOpen, setManagerDialogOpen] = useState(false);

  function addToast(message: string) {
    setToasts((prev) => [{ id: genId(), message }, ...prev]);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }

  const foundGroup = state.groups.find((g) => g.id === groupId);

  if (!foundGroup) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Link href="/groups" className="text-caption text-accent hover:underline">
          {t("perm.group.backToList")}
        </Link>
        <p className="text-caption text-ink-tertiary">{t("perm.group.notFound")}</p>
      </div>
    );
  }

  // TS 클로저 내 narrowing 유지용 — foundGroup은 위 guard 이후 undefined 불가 /
  // Capture as const so TS narrows it to UserGroup inside closures below.
  const group: UserGroup = foundGroup;

  // 편집 권한 판정 — 그룹 관리자 또는 시스템 관리자 /
  // Can edit if current user is a group manager or sysadmin.
  const isGroupManager = currentUser != null && group.managerIds.includes(currentUser.id);
  const isSysadmin = currentUser?.isSysadmin ?? false;
  const canEdit = (isGroupManager || isSysadmin) && group.status === "active";
  // pending/rejected 그룹은 편집 불가 — active 이후에만 멤버 변경 허용 /
  // Pending/rejected groups: read-only until active (no edits until approved).

  const memberExcludeIds = new Set(group.members.map((m) => m.id));
  const managerExcludeIds = new Set(group.managerIds);

  function handleAddMember(opt: PrincipalOption) {
    if (opt.principalType === "group") return;
    addGroupMember(groupId, {
      type: opt.principalType as "department" | "user",
      id: opt.principalId,
    });
    addToast(t("perm.group.toastMemberAdded"));
  }

  function handleRemoveMember(type: "department" | "user", id: string) {
    removeGroupMember(groupId, { type, id });
    addToast(t("perm.group.toastMemberRemoved"));
  }

  function handleAddManager(opt: PrincipalOption) {
    if (opt.principalType !== "user") return;
    const newIds = [...group.managerIds, opt.principalId];
    setGroupManagers(groupId, newIds);
    addToast(t("perm.group.toastManagersUpdated"));
  }

  function handleRemoveManager(userId: string) {
    const newIds = group.managerIds.filter((id) => id !== userId);
    setGroupManagers(groupId, newIds);
    addToast(t("perm.group.toastManagersUpdated"));
  }

  // 읽기 전용 안내 메시지 / Read-only notice based on status and permissions.
  function buildReadOnlyNotice(): string | null {
    if (group.status === "pending") return t("perm.group.readOnlyPending");
    if (group.status === "rejected") return t("perm.group.readOnlyRejected");
    if (!canEdit && currentUser != null) return t("perm.group.noPermission");
    return null;
  }
  const readOnlyNotice = buildReadOnlyNotice();

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* 뒤로가기 / Back link */}
      <Link href="/groups" className="text-caption text-accent hover:underline">
        {t("perm.group.backToList")}
      </Link>

      {/* 제목 + 상태 / Title + status */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <p className="text-body-strong text-ink">{group.name}</p>
          <GroupStatusBadge status={group.status} />
        </div>
        <p className="text-caption text-ink-tertiary">
          {group.description || t("perm.group.descEmpty")}
        </p>
      </div>

      {/* 읽기 전용 안내 / Read-only notice */}
      {readOnlyNotice && (
        <p className="rounded-sm border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary">
          {readOnlyNotice}
        </p>
      )}

      {/* 멤버 섹션 / Members section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-caption font-semibold text-ink">{t("perm.group.membersSection")}</p>
          {canEdit && (
            <button
              type="button"
              className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt"
              onClick={() => setMemberDialogOpen(true)}
            >
              {t("perm.group.addMemberBtn")}
            </button>
          )}
        </div>
        {group.members.length === 0 ? (
          <p className="text-fine text-ink-tertiary">{t("perm.group.noMembers")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {group.members.map((m) => (
              <MemberRow
                key={`${m.type}:${m.id}`}
                type={m.type}
                id={m.id}
                state={state}
                canEdit={canEdit}
                onRemove={() => handleRemoveMember(m.type, m.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 관리자 섹션 / Managers section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-caption font-semibold text-ink">{t("perm.group.managersSection")}</p>
          {canEdit && (
            <button
              type="button"
              className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt"
              onClick={() => setManagerDialogOpen(true)}
            >
              {t("perm.group.addManagerBtn")}
            </button>
          )}
        </div>
        {group.managerIds.length === 0 ? (
          <p className="text-fine text-ink-tertiary">{t("perm.group.noManagers")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {group.managerIds.map((userId) => {
              const user = state.users.find((u) => u.id === userId);
              return (
                <div
                  key={userId}
                  className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2"
                >
                  <User size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  <span className="flex-1 text-caption text-ink">{user?.name ?? userId}</span>
                  {canEdit && (
                    <button
                      type="button"
                      className="text-fine text-ink-tertiary hover:text-error"
                      onClick={() => handleRemoveManager(userId)}
                    >
                      {t("perm.group.removeBtn")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 멤버 추가 다이얼로그 / Member add dialog */}
      {memberDialogOpen && (
        <MemberPickerDialog
          state={state}
          excludeIds={memberExcludeIds}
          onSelect={handleAddMember}
          onClose={() => setMemberDialogOpen(false)}
        />
      )}

      {/* 관리자 추가 다이얼로그 / Manager add dialog */}
      {managerDialogOpen && (
        <ManagerPickerDialog
          state={state}
          excludeIds={managerExcludeIds}
          onSelect={handleAddManager}
          onClose={() => setManagerDialogOpen(false)}
        />
      )}
    </div>
  );
}
