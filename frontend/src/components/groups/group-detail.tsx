"use client";

// 그룹 상세(멤버 + 편집) — 설정 패널 인라인 + /groups/[id] 페이지 공용 (실 API) /
// Group detail (members, with editing): shared by the settings panel (inline) and the detail page.
// 관리자는 별도 영역이 아니라 멤버(user) 카드에서 토글로 지정한다 — 관리자 ⊆ 멤버(user).

import { type ReactNode, useState } from "react";
import { Building2, Clock, Info, RotateCcw, Star, Trash2, User } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import {
  addGroupMember,
  deleteGroup,
  removeGroupMember,
  resubmitGroup,
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

// 관리자 토글/배지 — user 카드에서 관리자 지정 (관리자 ⊆ 멤버) / manager toggle on a user card.
function ManagerControl({
  isManager,
  canEdit,
  onToggle,
}: {
  isManager: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  if (!canEdit) {
    return isManager ? (
      <span className="inline-flex items-center gap-1 rounded-sm border border-accent px-1.5 py-0.5 text-fine text-accent">
        <Star size={11} strokeWidth={1.5} />
        {t("perm.group.manager")}
      </span>
    ) : null;
  }
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine transition-colors ${
        isManager
          ? "border-accent bg-accent-tint text-accent"
          : "border-hairline text-ink-tertiary hover:bg-surface-alt hover:text-ink"
      }`}
      onClick={onToggle}
      title={isManager ? t("perm.group.manager") : t("perm.group.makeManager")}
    >
      <Star size={11} strokeWidth={1.5} className={isManager ? "fill-current" : undefined} />
      {t("perm.group.manager")}
    </button>
  );
}

// 멤버/관리자 카드 — 홈 상세 카드 스타일(아이콘+이름+컨트롤) 재활용 / member card.
function PersonCard({
  icon,
  name,
  typeLabel,
  control,
  onRemove,
  removeLabel,
}: {
  icon: ReactNode;
  name: string;
  typeLabel?: string;
  control?: ReactNode;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-hairline bg-surface px-3 py-2.5">
      {icon}
      <span className="flex-1 truncate text-caption text-ink">{name}</span>
      {typeLabel && <span className="shrink-0 text-fine text-ink-tertiary">{typeLabel}</span>}
      {control}
      {onRemove && (
        <button
          type="button"
          className="shrink-0 text-fine text-ink-tertiary hover:text-error"
          onClick={onRemove}
        >
          {removeLabel}
        </button>
      )}
    </div>
  );
}

// 멤버 추가 피커 다이얼로그 / member add picker dialog.
function PickerDialog({
  title,
  pickerUsers,
  pickerDepts,
  excludeIds,
  onSelect,
  onClose,
}: {
  title: string;
  pickerUsers: MockUser[];
  pickerDepts: Department[];
  excludeIds: Set<string>;
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
  onGroupGone,
  onToast,
}: {
  group: Group;
  dirUsers: DirectoryUser[];
  dirDepts: DirectoryDept[];
  onGroupChange: (g: Group) => void;
  onGroupGone?: () => void; // 삭제로 그룹이 사라졌을 때 — 부모가 목록 갱신/이동 처리
  onToast: (msg: string) => void;
}) {
  const { t } = useI18n();
  const currentUser = useCurrentMockUser();
  const groupIdNum = group.id;

  const [memberDialogOpen, setMemberDialogOpen] = useState(false);

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

  const userName = (id: string): string => dirUsers.find((u) => u.id === id)?.name ?? id;
  function resolveMemberName(member: GroupMember): string {
    if (member.member_type === "department") {
      return dirDepts.find((d) => d.id === member.member_id)?.name ?? member.member_id;
    }
    return userName(member.member_id);
  }

  // 편집 권한 — 그룹 관리자 또는 sysadmin + active. 서버가 최종 강제(403/409) / mirrors server.
  const isGroupManager = currentUser != null && group.managers.includes(currentUser.id);
  const isSysadmin = currentUser?.isSysadmin ?? false;
  const canEdit = (isGroupManager || isSysadmin) && group.status === "active";
  // 삭제/재신청 권한 — 생성자/관리자/sysadmin (상태 무관) / delete or re-request.
  const canManage = isSysadmin || isGroupManager || currentUser?.id === group.created_by;
  // 거절/소프트삭제 자동삭제 카운트다운 — 마운트 now 고정(순수성) / lazy now for purge countdown.
  const [now] = useState(() => Date.now());
  const purgeLabel = (deletedAt: string): string => {
    const days = Math.floor((new Date(deletedAt).getTime() + 7 * 86400000 - now) / 86400000);
    return days >= 1 ? t("perm.group.autoDeleteIn", { n: days }) : t("perm.group.autoDeleteSoon");
  };

  const managerSet = new Set(group.managers);
  const memberExcludeIds = new Set(group.members.map((m) => m.member_id));
  const memberUserIds = new Set(
    group.members.filter((m) => m.member_type === "user").map((m) => m.member_id),
  );
  // 관리자인데 멤버(user)는 아닌 사람(예: 생성자) — 별도 카드로 노출 / managers not in the member list.
  const managerOnlyIds = group.managers.filter((id) => !memberUserIds.has(id));

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
      // 관리자였던 user 멤버를 빼면 관리자에서도 내림 (관리자 ⊆ 멤버) / cascade off managers.
      if (member.member_type === "user" && updated.managers.includes(member.member_id)) {
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

  async function toggleManager(userId: string, makeManager: boolean) {
    try {
      const next = makeManager
        ? [...group.managers, userId]
        : group.managers.filter((id) => id !== userId);
      const updated = await setGroupManagers(groupIdNum, next);
      onGroupChange(updated);
      onToast(t("perm.group.toastManagersUpdated"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    try {
      await deleteGroup(groupIdNum);
      onToast(t("perm.group.toastDeleted"));
      onGroupGone?.();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleResubmit() {
    try {
      const updated = await resubmitGroup(groupIdNum);
      onGroupChange(updated);
      onToast(t("perm.group.toastRequested"));
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
    <div className="flex flex-col gap-3">
      {readOnlyNotice && (
        <p className="rounded-sm border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary">
          {readOnlyNotice}
        </p>
      )}

      {/* 멤버 섹션 — user 카드의 ★ 토글로 관리자 지정 (별도 관리자 영역 없음) / single members section */}
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

      {group.members.length === 0 && managerOnlyIds.length === 0 ? (
        <p className="text-fine text-ink-tertiary">{t("perm.group.noMembers")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {group.members.map((m) => (
            <PersonCard
              key={m.id}
              icon={<MemberTypeIcon type={m.member_type} />}
              name={resolveMemberName(m)}
              typeLabel={m.member_type === "department" ? t("perm.principalDept") : undefined}
              control={
                m.member_type === "user" ? (
                  <ManagerControl
                    isManager={managerSet.has(m.member_id)}
                    canEdit={canEdit}
                    onToggle={() => void toggleManager(m.member_id, !managerSet.has(m.member_id))}
                  />
                ) : undefined
              }
              onRemove={canEdit ? () => void handleRemoveMember(m) : undefined}
              removeLabel={t("perm.group.removeBtn")}
            />
          ))}

          {/* 멤버가 아닌 관리자(생성자 등) / managers who aren't members (e.g. creator) */}
          {managerOnlyIds.map((id) => (
            <PersonCard
              key={`mgr-${id}`}
              icon={<User size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
              name={userName(id)}
              control={
                <ManagerControl
                  isManager
                  canEdit={canEdit}
                  onToggle={() => void toggleManager(id, false)}
                />
              }
              removeLabel={t("perm.group.removeBtn")}
            />
          ))}
        </div>
      )}

      {/* 관리 액션 + 기능 설명 (펼침 시 노출) / management actions + icon/pill hints */}
      {(canManage || group.status === "rejected") && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          {/* 거절/소프트삭제 자동삭제 카운트다운 / auto-delete countdown */}
          {group.deleted_at && (
            <span className="flex items-center gap-1.5 text-fine font-semibold text-error">
              <Clock size={12} strokeWidth={1.5} className="shrink-0" />
              {purgeLabel(group.deleted_at)}
            </span>
          )}
          {/* 기능 설명 — 아이콘/필 / function hints as icon pills */}
          <div className="flex flex-wrap items-center gap-1.5 text-fine text-ink-tertiary">
            <Info size={12} strokeWidth={1.5} className="shrink-0" />
            <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5">
              <Trash2 size={11} strokeWidth={1.5} />
              {t("perm.group.deleteHint")}
            </span>
            {group.status === "rejected" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5">
                <RotateCcw size={11} strokeWidth={1.5} />
                {t("perm.group.resubmitHint")}
              </span>
            )}
          </div>
          {/* 액션 버튼 / action buttons */}
          {canManage && (
            <div className="flex gap-2">
              {group.status === "rejected" && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-sm border border-accent px-3 py-1 text-fine text-accent hover:bg-accent-tint"
                  onClick={() => void handleResubmit()}
                >
                  <RotateCcw size={13} strokeWidth={1.5} />
                  {t("perm.group.resubmit")}
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt"
                onClick={() => void handleDelete()}
              >
                <Trash2 size={13} strokeWidth={1.5} />
                {t("perm.group.delete")}
              </button>
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}
