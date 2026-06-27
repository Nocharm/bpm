"use client";

// 그룹 상세(멤버·관리자 + 편집) — 설정 패널 인라인 + /groups/[id] 페이지 공용 (실 API) /
// Group detail (members + managers, with editing): shared by the settings panel (inline) and the detail page.
// 매니저는 그룹 멤버(user) 중에서만 — 매니저 추가 피커를 멤버 user로 제한한다.

import { useState } from "react";
import { Building2, User } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import {
  addGroupMember,
  removeGroupMember,
  setGroupManagers,
  type DirectoryDept,
  type DirectoryUser,
  type Group,
  type GroupMember,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Department, User as MockUser } from "@/lib/mock/permissions-types";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";

// 멤버 타입 아이콘 / Icon for member type.
function MemberTypeIcon({ type }: { type: "department" | "user" }) {
  if (type === "department")
    return <Building2 size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
  return <User size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />;
}

function MemberRow({
  member,
  displayName,
  canEdit,
  onRemove,
}: {
  member: GroupMember;
  displayName: string;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const type = member.member_type;
  return (
    <div className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2">
      <MemberTypeIcon type={type} />
      <span className="flex-1 text-caption text-ink">{displayName}</span>
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

// 피커 다이얼로그 공통 래퍼 / Shared picker dialog wrapper.
function PickerDialog({
  title,
  pickerUsers,
  pickerDepts,
  excludeIds,
  emptyHint,
  onSelect,
  onClose,
}: {
  title: string;
  pickerUsers: MockUser[];
  pickerDepts: Department[];
  excludeIds: Set<string>;
  emptyHint?: string;
  onSelect: (opt: PrincipalOption) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30 backdrop-blur-sm"
    >
      <div className="flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border border-hairline bg-surface p-5 shadow-lg">
        <p className="text-body-strong text-ink">{title}</p>
        <PrincipalPicker
          users={pickerUsers}
          departments={pickerDepts}
          groups={[]}
          excludeIds={excludeIds}
          onSelect={(opt) => {
            onSelect(opt);
            onClose();
          }}
        />
        {/* 후보가 없을 때 안내 — 예: 멤버(user)가 없어 매니저 지정 불가 / hint when no candidate. */}
        {emptyHint && <p className="text-fine text-ink-tertiary">{emptyHint}</p>}
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

export function GroupDetail({
  group,
  dirUsers,
  dirDepts,
  onGroupChange,
  onToast,
}: {
  group: Group;
  dirUsers: DirectoryUser[];
  dirDepts: DirectoryDept[];
  onGroupChange: (g: Group) => void;
  onToast: (msg: string) => void;
}) {
  const { t } = useI18n();
  const currentUser = useCurrentMockUser();
  const groupIdNum = group.id;

  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [managerDialogOpen, setManagerDialogOpen] = useState(false);

  // 디렉터리를 피커 prop 형식으로 변환 / Adapt directory to picker shapes.
  const pickerUsers: MockUser[] = dirUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: "",
    departmentId: "",
    status: "active" as const,
    isSysadmin: false,
  }));
  const pickerDepts: Department[] = dirDepts.map((d) => ({
    id: d.id,
    code: "",
    name: d.name,
    orgLevels: [],
    parentId: null,
    rawDn: "",
  }));

  // 멤버 표시명 — 실 디렉터리 우선, 없으면 id 폴백 / Resolve member name from directory.
  function resolveMemberName(member: GroupMember): string {
    if (member.member_type === "department") {
      return dirDepts.find((d) => d.id === member.member_id)?.name ?? member.member_id;
    }
    return dirUsers.find((u) => u.id === member.member_id)?.name ?? member.member_id;
  }

  // 편집 권한 — 그룹 관리자 또는 sysadmin + active. 서버가 최종 강제(403/409) / mirrors server.
  const isGroupManager = currentUser != null && group.managers.includes(currentUser.id);
  const isSysadmin = currentUser?.isSysadmin ?? false;
  const canEdit = (isGroupManager || isSysadmin) && group.status === "active";

  const memberExcludeIds = new Set(group.members.map((m) => m.member_id));
  // 매니저 후보 = 그룹의 멤버(user)만 (이미 매니저면 제외) / managers must be member users.
  const memberUserIds = new Set(
    group.members.filter((m) => m.member_type === "user").map((m) => m.member_id),
  );
  const managerCandidates = pickerUsers.filter((u) => memberUserIds.has(u.id));
  const managerExcludeIds = new Set(group.managers);

  async function handleAddMember(opt: PrincipalOption) {
    if (opt.principalType === "group") return;
    try {
      const updated = await addGroupMember(groupIdNum, {
        member_type: opt.principalType as "department" | "user",
        member_id: opt.principalId,
      });
      onGroupChange(updated);
      onToast(t("perm.group.toastMemberAdded"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveMember(member: GroupMember) {
    try {
      const updated = await removeGroupMember(groupIdNum, member.id);
      // 매니저였던 user 멤버를 제거하면 매니저에서도 내림 (매니저⊆멤버 유지) / cascade off managers.
      if (
        member.member_type === "user" &&
        updated.managers.includes(member.member_id)
      ) {
        const cascaded = await setGroupManagers(
          groupIdNum,
          updated.managers.filter((id) => id !== member.member_id),
        );
        onGroupChange(cascaded);
      } else {
        onGroupChange(updated);
      }
      onToast(t("perm.group.toastMemberRemoved"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddManager(opt: PrincipalOption) {
    if (opt.principalType !== "user") return;
    try {
      const updated = await setGroupManagers(groupIdNum, [...group.managers, opt.principalId]);
      onGroupChange(updated);
      onToast(t("perm.group.toastManagersUpdated"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveManager(userId: string) {
    try {
      const updated = await setGroupManagers(
        groupIdNum,
        group.managers.filter((id) => id !== userId),
      );
      onGroupChange(updated);
      onToast(t("perm.group.toastManagersUpdated"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  // 읽기 전용 안내 / Read-only notice.
  let readOnlyNotice: string | null = null;
  if (group.status === "pending") readOnlyNotice = t("perm.group.readOnlyPending");
  else if (group.status === "rejected") readOnlyNotice = t("perm.group.readOnlyRejected");
  else if (!canEdit && currentUser != null) readOnlyNotice = t("perm.group.noPermission");

  return (
    <div className="flex flex-col gap-4">
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
                key={m.id}
                member={m}
                displayName={resolveMemberName(m)}
                canEdit={canEdit}
                onRemove={() => void handleRemoveMember(m)}
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
        {group.managers.length === 0 ? (
          <p className="text-fine text-ink-tertiary">{t("perm.group.noManagers")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {group.managers.map((userId) => {
              const name = dirUsers.find((u) => u.id === userId)?.name ?? userId;
              return (
                <div
                  key={userId}
                  className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2"
                >
                  <User size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  <span className="flex-1 text-caption text-ink">{name}</span>
                  {canEdit && (
                    <button
                      type="button"
                      className="text-fine text-ink-tertiary hover:text-error"
                      onClick={() => void handleRemoveManager(userId)}
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

      {/* 멤버 추가 다이얼로그 — dept + user / Member add dialog */}
      {memberDialogOpen && (
        <PickerDialog
          title={t("perm.group.addMemberBtn")}
          pickerUsers={pickerUsers}
          pickerDepts={pickerDepts}
          excludeIds={memberExcludeIds}
          onSelect={(opt) => void handleAddMember(opt)}
          onClose={() => setMemberDialogOpen(false)}
        />
      )}

      {/* 관리자 추가 다이얼로그 — 멤버(user)만 / Manager add dialog: member users only */}
      {managerDialogOpen && (
        <PickerDialog
          title={t("perm.group.addManagerBtn")}
          pickerUsers={managerCandidates}
          pickerDepts={[]}
          excludeIds={managerExcludeIds}
          emptyHint={managerCandidates.length === 0 ? t("perm.group.managerFromMembersHint") : undefined}
          onSelect={(opt) => void handleAddManager(opt)}
          onClose={() => setManagerDialogOpen(false)}
        />
      )}
    </div>
  );
}
