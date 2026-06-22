"use client";

// 유저 그룹 상세 (실 API) — 멤버·관리자 조회 및 편집 / User group detail (real API).
// 서버가 진실: 로드는 GET /api/groups/{id}, 멤버 add/remove·관리자 PUT는 실 API.
// 각 변경은 갱신된 그룹을 응답으로 받아 state에 반영(낙관적 갱신 없음). 권한/상태 위반은
// 서버가 403/409/422로 막고, 메시지를 토스트로 노출한다. 표시명은 실 디렉터리에서 해석.

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { User, Building2 } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import {
  addGroupMember,
  getDirectory,
  getGroup,
  removeGroupMember,
  setGroupManagers,
  type DirectoryDept,
  type DirectoryUser,
  type Group,
  type GroupMember,
  type GroupStatus,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import type { Department, User as MockUser } from "@/lib/mock/permissions-types";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";

// 그룹 상태 pill / Group status pill.
function GroupStatusBadge({ status }: { status: GroupStatus }) {
  const { t } = useI18n();
  const styles: Record<GroupStatus, string> = {
    active: "border-added text-added",
    pending: "border-changed text-changed",
    rejected: "border-error text-error",
  };
  const labels: Record<GroupStatus, string> = {
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

interface MemberRowProps {
  member: GroupMember;
  displayName: string;
  canEdit: boolean;
  onRemove: () => void;
}

function MemberRow({ member, displayName, canEdit, onRemove }: MemberRowProps) {
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
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30"
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

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const groupIdNum = Number(groupId);
  const { t } = useI18n();
  const currentUser = useCurrentMockUser();

  const [group, setGroup] = useState<Group | null>(null);
  const [loadError, setLoadError] = useState(false);
  // 실 디렉터리 — 표시명 해석 + 피커 후보 / Real directory for names and picker.
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [managerDialogOpen, setManagerDialogOpen] = useState(false);

  function addToast(message: string) {
    setToasts((prev) => [{ id: genId(), message }, ...prev]);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }

  const reload = useCallback(async () => {
    try {
      setGroup(await getGroup(groupIdNum));
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
    }
  }, [groupIdNum]);

  // 초기 로드 — 그룹 + 디렉터리 / Initial load: group + directory.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [g, dir] = await Promise.all([getGroup(groupIdNum), getDirectory()]);
        if (active) {
          setGroup(g);
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
        }
      } catch {
        // 가시성 규칙상 404(존재 은닉) 포함 — not-found 화면으로 / 404 hides existence per server rule.
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [groupIdNum]);

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

  // 멤버 표시명 해석 — 실 디렉터리 우선, 없으면 id 폴백 / Resolve member name from directory.
  function resolveMemberName(member: GroupMember): string {
    if (member.member_type === "department") {
      return dirDepts.find((d) => d.id === member.member_id)?.name ?? member.member_id;
    }
    return dirUsers.find((u) => u.id === member.member_id)?.name ?? member.member_id;
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Link href="/settings" className="text-caption text-accent hover:underline">
          {t("perm.group.backToList")}
        </Link>
        <p className="text-caption text-ink-tertiary">{t("perm.group.notFound")}</p>
      </div>
    );
  }

  if (group === null) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Link href="/settings" className="text-caption text-accent hover:underline">
          {t("perm.group.backToList")}
        </Link>
        <p className="text-caption text-ink-tertiary">…</p>
      </div>
    );
  }

  // 편집 권한 판정 — 그룹 관리자 또는 sysadmin + active 그룹. 서버가 최종 강제(403/409) /
  // Client gate mirrors the server: group manager or sysadmin AND active. Server enforces too.
  const isGroupManager = currentUser != null && group.managers.includes(currentUser.id);
  const isSysadmin = currentUser?.isSysadmin ?? false;
  const canEdit = (isGroupManager || isSysadmin) && group.status === "active";

  const memberExcludeIds = new Set(group.members.map((m) => m.member_id));
  const managerExcludeIds = new Set(group.managers);

  async function handleAddMember(opt: PrincipalOption) {
    if (opt.principalType === "group") return;
    try {
      const updated = await addGroupMember(groupIdNum, {
        member_type: opt.principalType as "department" | "user",
        member_id: opt.principalId,
      });
      setGroup(updated);
      addToast(t("perm.group.toastMemberAdded"));
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
      await reload();
    }
  }

  async function handleRemoveMember(memberPk: number) {
    try {
      const updated = await removeGroupMember(groupIdNum, memberPk);
      setGroup(updated);
      addToast(t("perm.group.toastMemberRemoved"));
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
      await reload();
    }
  }

  async function handleAddManager(opt: PrincipalOption) {
    if (opt.principalType !== "user" || group === null) return;
    try {
      const updated = await setGroupManagers(groupIdNum, [
        ...group.managers,
        opt.principalId,
      ]);
      setGroup(updated);
      addToast(t("perm.group.toastManagersUpdated"));
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
      await reload();
    }
  }

  async function handleRemoveManager(userId: string) {
    if (group === null) return;
    try {
      const updated = await setGroupManagers(
        groupIdNum,
        group.managers.filter((id) => id !== userId),
      );
      setGroup(updated);
      addToast(t("perm.group.toastManagersUpdated"));
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
      await reload();
    }
  }

  // 읽기 전용 안내 / Read-only notice based on status and permissions.
  function buildReadOnlyNotice(): string | null {
    if (group === null) return null;
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
      <Link href="/settings" className="text-caption text-accent hover:underline">
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
                key={m.id}
                member={m}
                displayName={resolveMemberName(m)}
                canEdit={canEdit}
                onRemove={() => void handleRemoveMember(m.id)}
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

      {/* 멤버 추가 다이얼로그 — dept + user / Member add dialog (dept + user) */}
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

      {/* 관리자 추가 다이얼로그 — user만 / Manager add dialog (user only) */}
      {managerDialogOpen && (
        <PickerDialog
          title={t("perm.group.addManagerBtn")}
          pickerUsers={pickerUsers}
          pickerDepts={[]}
          excludeIds={managerExcludeIds}
          onSelect={(opt) => void handleAddManager(opt)}
          onClose={() => setManagerDialogOpen(false)}
        />
      )}
    </div>
  );
}
