"use client";

// 그룹 상세(멤버 + 편집) — 설정 패널 인라인 + /groups/[id] 페이지 공용 (실 API) /
// Group detail (members, with editing): shared by the settings panel (inline) and the detail page.
// 관리자는 별도 영역이 아니라 멤버(user) 카드에서 토글로 지정한다 — 관리자 ⊆ 멤버(user).

import { type ReactNode, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  Clock,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  Undo2,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { IconActionButton } from "@/components/icon-action-button";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import {
  addGroupMember,
  deactivateGroup,
  deleteGroup,
  reactivateGroup,
  removeGroupMember,
  renameGroup,
  setGroupManagers,
  withdrawGroup,
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

// 멤버/관리자 카드 — 매니저 배지는 항상 노출, 리무브·매니저 토글은 카드 호버 시 노출 (홈 상세 카드 스타일) /
// member card: manager badge always visible; remove & manager-toggle reveal on card hover.
function PersonCard({
  icon,
  name,
  typeLabel,
  isManager,
  canEdit,
  canToggleManager,
  onToggleManager,
  onRemove,
  labels,
}: {
  icon: ReactNode;
  name: string;
  typeLabel?: string;
  isManager: boolean;
  canEdit: boolean;
  canToggleManager: boolean;
  onToggleManager?: () => void;
  onRemove?: () => void;
  labels: { manager: string; makeManager: string; unset: string; remove: string };
}) {
  return (
    <div className="group flex items-center gap-2.5 rounded-md border border-hairline bg-surface px-3 py-2.5 transition-colors hover:bg-surface-alt">
      {icon}
      <span className="flex-1 truncate text-caption text-ink">{name}</span>
      {typeLabel && <span className="shrink-0 text-fine text-ink-tertiary">{typeLabel}</span>}
      {/* 매니저 배지 — 항상 노출 / manager badge always shown */}
      {isManager && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-accent px-1.5 py-0.5 text-fine text-accent">
          <Star size={11} strokeWidth={1.5} className="fill-current" />
          {labels.manager}
        </span>
      )}
      {/* 호버 시 컨트롤 — 매니저 토글 + 리무브 / hover-revealed controls */}
      {canEdit && (onRemove || canToggleManager) && (
        <div className="hidden shrink-0 items-center gap-1.5 group-hover:flex">
          {canToggleManager && onToggleManager && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary hover:bg-surface hover:text-ink"
              onClick={onToggleManager}
            >
              {isManager ? (
                <StarOff size={11} strokeWidth={1.5} />
              ) : (
                <Star size={11} strokeWidth={1.5} />
              )}
              {isManager ? labels.unset : labels.makeManager}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary hover:border-error hover:text-error"
              onClick={onRemove}
            >
              <X size={11} strokeWidth={1.5} />
              {labels.remove}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 멤버 추가 피커 다이얼로그 — 여러 명을 선택(칩)한 뒤 Add로 일괄 추가 / multi-select then add together.
function PickerDialog({
  title,
  pickerUsers,
  pickerDepts,
  excludeIds,
  onAdd,
  onClose,
}: {
  title: string;
  pickerUsers: MockUser[];
  pickerDepts: Department[];
  excludeIds: Set<string>;
  onAdd: (opts: PrincipalOption[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<PrincipalOption[]>([]);
  // 이미 선택된 것은 피커 후보에서 제외 / hide already-picked from the candidate list.
  const exclude = new Set([...excludeIds, ...selected.map((s) => s.principalId)]);
  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div className="flex w-[400px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md bg-surface p-6 shadow-lg">
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{title}</h2>
          <p className="text-caption text-ink-tertiary">{t("perm.group.pickerHint")}</p>
        </div>
        <PrincipalPicker
          users={pickerUsers}
          departments={pickerDepts}
          groups={[]}
          excludeIds={exclude}
          onSelect={(opt) => setSelected((prev) => [...prev, opt])}
        />
        {/* 선택 칩 / selected chips */}
        {selected.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-fine text-ink-tertiary">{t("perm.group.pickerSelected")}</span>
            <div className="flex flex-wrap gap-1.5">
              {selected.map((s) => (
                <span
                  key={`${s.principalType}:${s.principalId}`}
                  className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-alt py-0.5 pl-2 pr-1 text-fine text-ink"
                >
                  {s.principalType === "department" ? (
                    <Building2 size={11} strokeWidth={1.5} className="text-ink-tertiary" />
                  ) : (
                    <User size={11} strokeWidth={1.5} className="text-ink-tertiary" />
                  )}
                  <span className="truncate">{s.displayName}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-ink-tertiary hover:bg-surface hover:text-error"
                    aria-label={t("perm.group.removeBtn")}
                    onClick={() =>
                      setSelected((prev) => prev.filter((x) => x.principalId !== s.principalId))
                    }
                  >
                    <X size={11} strokeWidth={1.5} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("perm.group.cancelBtn")}
          </button>
          <button
            type="button"
            disabled={selected.length === 0}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => {
              onAdd(selected);
              onClose();
            }}
          >
            {t("perm.group.pickerAdd", { n: selected.length })}
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
  onReRequest,
  onToast,
}: {
  group: Group;
  dirUsers: DirectoryUser[];
  dirDepts: DirectoryDept[];
  onGroupChange: (g: Group) => void;
  onGroupGone?: () => void; // 삭제/철회로 그룹이 사라졌을 때 — 부모가 목록 갱신/이동 처리
  onReRequest?: (group: Group) => void; // 재신청 — 부모가 생성 모달을 프리필로 연다
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
  const [renaming, setRenaming] = useState(false); // active 인라인 이름변경
  const [renameValue, setRenameValue] = useState(group.name);
  // 확인 모달 게이트 — 삭제/비활성/재활성은 즉시 실행 대신 모달 확인 후 / confirm before destructive actions.
  const [pendingAction, setPendingAction] = useState<"delete" | "deactivate" | "reactivate" | null>(
    null,
  );
  const [hoveredHint, setHoveredHint] = useState<string | null>(null); // 헤더 하단 안내문구(스페이서 아래)
  // 매니저 추가/제거 확인 모달 / confirm before changing a member's manager role.
  const [pendingManager, setPendingManager] = useState<{ id: string; makeManager: boolean } | null>(
    null,
  );

  const managerSet = new Set(group.managers);
  const memberExcludeIds = new Set(group.members.map((m) => m.member_id));
  const memberUserIds = new Set(
    group.members.filter((m) => m.member_type === "user").map((m) => m.member_id),
  );
  // 관리자인데 멤버(user)는 아닌 사람(예: 생성자) — 별도 카드로 노출 / managers not in the member list.
  const managerOnlyIds = group.managers.filter((id) => !memberUserIds.has(id));

  // 정렬 — 매니저 먼저, 그다음 유저, 마지막 부서(팀). 동일 순위는 안정 정렬 / managers → users → teams.
  type MemberRow =
    | { kind: "member"; member: GroupMember; isManager: boolean }
    | { kind: "managerOnly"; id: string };
  const rank = (r: MemberRow): number => {
    if (r.kind === "managerOnly") return 0;
    if (r.member.member_type === "user") return r.isManager ? 0 : 1;
    return 2; // department(team)
  };
  const memberRows: MemberRow[] = [
    ...group.members.map((m) => ({
      kind: "member" as const,
      member: m,
      isManager: m.member_type === "user" && managerSet.has(m.member_id),
    })),
    ...managerOnlyIds.map((id) => ({ kind: "managerOnly" as const, id })),
  ];
  const sortedRows = memberRows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);

  async function handleAddMembers(opts: PrincipalOption[]) {
    const targets = opts.filter((o) => o.principalType !== "group");
    if (targets.length === 0) return;
    try {
      let updated: Group | null = null;
      for (const opt of targets) {
        updated = await addGroupMember(groupIdNum, {
          member_type: opt.principalType as "department" | "user",
          member_id: opt.principalId,
        });
      }
      if (updated) onGroupChange(updated);
      onToast(
        targets.length === 1
          ? t("perm.group.toastMemberAdded")
          : t("perm.group.toastMembersAdded", { n: targets.length }),
      );
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

  async function handleWithdraw() {
    try {
      await withdrawGroup(groupIdNum);
      onToast(t("perm.group.toastWithdrawn"));
      onGroupGone?.();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeactivate() {
    try {
      onGroupChange(await deactivateGroup(groupIdNum));
      onToast(t("perm.group.toastDeactivated"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReactivate() {
    try {
      onGroupChange(await reactivateGroup(groupIdNum));
      onToast(t("perm.group.toastReactivated"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRename() {
    const next = renameValue.trim();
    if (!next || next === group.name) {
      setRenaming(false);
      return;
    }
    try {
      onGroupChange(await renameGroup(groupIdNum, next));
      onToast(t("perm.group.toastRenamed"));
      setRenaming(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  // 상태별 라이프사이클 액션 — 버튼은 멤버 헤더 우측, 설명은 호버 시 페이드인 / status-based actions.
  type GroupAction = {
    key: string;
    label: string;
    hint: string;
    icon: ReactNode;
    onClick: () => void;
    variant?: "plain" | "accent" | "error";
  };
  const actions: GroupAction[] = [];
  if (group.status === "pending") {
    actions.push({
      key: "withdraw",
      label: t("perm.group.withdraw"),
      hint: t("perm.group.withdrawHint"),
      icon: <Undo2 size={13} strokeWidth={1.5} />,
      onClick: () => void handleWithdraw(),
    });
  } else if (group.status === "active") {
    actions.push({
      key: "rename",
      label: t("perm.group.rename"),
      hint: t("perm.group.renameHint"),
      icon: <Pencil size={13} strokeWidth={1.5} />,
      onClick: () => {
        setRenameValue(group.name);
        setRenaming(true);
      },
    });
    actions.push({
      key: "deactivate",
      label: t("perm.group.deactivate"),
      hint: t("perm.group.deactivateHint"),
      icon: <PauseCircle size={13} strokeWidth={1.5} />,
      onClick: () => setPendingAction("deactivate"),
    });
  } else if (group.status === "inactive") {
    actions.push({
      key: "reactivate",
      label: t("perm.group.reactivate"),
      hint: t("perm.group.inactiveHint"),
      icon: <PlayCircle size={13} strokeWidth={1.5} />,
      onClick: () => setPendingAction("reactivate"),
      variant: "accent",
    });
    actions.push({
      key: "delete",
      label: t("perm.group.delete"),
      hint: t("perm.group.deleteHint"),
      icon: <Trash2 size={13} strokeWidth={1.5} />,
      onClick: () => setPendingAction("delete"),
      variant: "error",
    });
  } else if (group.status === "rejected") {
    if (onReRequest) {
      actions.push({
        key: "resubmit",
        label: t("perm.group.resubmit"),
        hint: t("perm.group.resubmitHint"),
        icon: <RotateCcw size={13} strokeWidth={1.5} />,
        onClick: () => onReRequest(group),
        variant: "accent",
      });
    }
    actions.push({
      key: "delete",
      label: t("perm.group.delete"),
      hint: t("perm.group.deleteHint"),
      icon: <Trash2 size={13} strokeWidth={1.5} />,
      onClick: () => setPendingAction("delete"),
      variant: "error",
    });
  }

  // 읽기 전용 안내 / Read-only notice.
  let readOnlyNotice: string | null = null;
  if (group.status === "pending") readOnlyNotice = t("perm.group.readOnlyPending");
  else if (group.status === "rejected") readOnlyNotice = t("perm.group.readOnlyRejected");
  else if (group.status === "inactive") readOnlyNotice = t("perm.group.readOnlyInactive");
  else if (!canEdit && currentUser != null) readOnlyNotice = t("perm.group.noPermission");

  return (
    <div className="flex flex-col gap-3">
      {readOnlyNotice && (
        <p className="rounded-sm border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary">
          {readOnlyNotice}
        </p>
      )}

      {/* 멤버 헤더 — 스페이서(구분선) 위줄: 아이콘+수(좌) + 액션버튼(우, 아이콘전용 호버펼침) /
          top row above the spacer: member count (left) + icon-only actions (right). */}
      <div className="flex items-center justify-between gap-2">
        <p className="flex shrink-0 items-center gap-1.5 text-caption font-semibold text-ink">
          <Users size={15} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          {group.members.length}
          <span className="font-normal text-ink-secondary">{t("perm.group.membersSection")}</span>
        </p>
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          {canManage &&
            !renaming &&
            actions.map((a) => (
              <IconActionButton
                key={a.key}
                icon={a.icon}
                label={a.label}
                align="right"
                tone={a.variant}
                hint={a.hint}
                onHoverChange={setHoveredHint}
                onClick={a.onClick}
              />
            ))}
          {canEdit && (
            <IconActionButton
              icon={<UserPlus size={14} strokeWidth={1.5} />}
              label={t("perm.group.addMemberBtn")}
              align="right"
              hint={t("perm.group.addMemberBtn")}
              onHoverChange={setHoveredHint}
              onClick={() => setMemberDialogOpen(true)}
            />
          )}
        </div>
      </div>

      {/* 스페이서(구분선) 아래줄: 호버한 버튼의 안내문구 페이드인 / below the spacer: hovered action's hint */}
      {(canManage || canEdit) && !renaming && (
        <div className="flex min-h-[1.1rem] items-center justify-end border-t border-hairline pt-1.5">
          <span
            className={`truncate text-fine text-ink-tertiary transition-opacity duration-200 ${
              hoveredHint ? "opacity-100" : "opacity-0"
            }`}
          >
            {hoveredHint}
          </span>
        </div>
      )}

      {/* 거절/소프트삭제 자동삭제 카운트다운 / auto-delete countdown */}
      {group.deleted_at && (
        <span className="flex items-center gap-1.5 text-fine font-semibold text-error">
          <Clock size={12} strokeWidth={1.5} className="shrink-0" />
          {purgeLabel(group.deleted_at)}
        </span>
      )}

      {/* 인라인 이름변경 (active) / inline rename */}
      {renaming && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="flex-1 rounded-sm border border-accent bg-transparent px-2 py-1 text-caption text-ink outline-none"
          />
          <button
            type="button"
            onClick={() => void handleRename()}
            className="rounded-sm border border-accent p-1 text-accent hover:bg-accent-tint"
            aria-label={t("perm.group.rename")}
          >
            <Check size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="rounded-sm border border-hairline p-1 text-ink-tertiary hover:bg-surface-alt"
            aria-label={t("common.cancel")}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {sortedRows.length === 0 ? (
        <p className="text-fine text-ink-tertiary">{t("perm.group.noMembers")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sortedRows.map((row) => {
            const cardLabels = {
              manager: t("perm.group.manager"),
              makeManager: t("perm.group.makeManager"),
              unset: t("perm.group.unsetManager"),
              remove: t("perm.group.removeBtn"),
            };
            if (row.kind === "managerOnly") {
              // 멤버가 아닌 관리자(생성자 등) — 토글로 해제만 / manager who isn't a member.
              return (
                <PersonCard
                  key={`mgr-${row.id}`}
                  icon={<User size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
                  name={userName(row.id)}
                  isManager
                  canEdit={canEdit}
                  canToggleManager
                  onToggleManager={() => setPendingManager({ id: row.id, makeManager: false })}
                  labels={cardLabels}
                />
              );
            }
            const m = row.member;
            return (
              <PersonCard
                key={m.id}
                icon={<MemberTypeIcon type={m.member_type} />}
                name={resolveMemberName(m)}
                typeLabel={m.member_type === "department" ? t("perm.principalDept") : undefined}
                isManager={row.isManager}
                canEdit={canEdit}
                canToggleManager={m.member_type === "user"}
                onToggleManager={
                  m.member_type === "user"
                    ? () => setPendingManager({ id: m.member_id, makeManager: !row.isManager })
                    : undefined
                }
                onRemove={canEdit ? () => void handleRemoveMember(m) : undefined}
                labels={cardLabels}
              />
            );
          })}
        </div>
      )}

      {/* 멤버 추가 다이얼로그 — dept + user / Member add dialog */}
      {memberDialogOpen && (
        <PickerDialog
          title={t("perm.group.addMemberBtn")}
          pickerUsers={pickerUsers}
          pickerDepts={pickerDepts}
          excludeIds={memberExcludeIds}
          onAdd={(opts) => void handleAddMembers(opts)}
          onClose={() => setMemberDialogOpen(false)}
        />
      )}

      {/* 삭제/비활성/재활성 확인 모달 — 즉시 실행 대신 확인 / confirm before destructive actions */}
      {pendingAction === "delete" && (
        <ConfirmDialog
          icon={<Trash2 size={28} strokeWidth={1.5} />}
          title={t("perm.group.confirmDeleteTitle")}
          message={group.name}
          danger
          lines={
            [
              { icon: <Trash2 size={14} strokeWidth={1.5} />, text: t("delete.lineTrash") },
              { icon: <Clock size={14} strokeWidth={1.5} />, text: t("delete.lineRecover"), tone: "accent" },
              { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("delete.linePurge"), tone: "error" },
            ] satisfies ConfirmLine[]
          }
          confirmLabel={t("delete.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setPendingAction(null);
            void handleDelete();
          }}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === "deactivate" && (
        <ConfirmDialog
          icon={<PauseCircle size={28} strokeWidth={1.5} />}
          title={t("perm.group.confirmDeactivateTitle")}
          lines={
            [
              { icon: <PauseCircle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmDeactivateL1") },
              { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmDeactivateL3"), tone: "error" },
              { icon: <PlayCircle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmDeactivateL2"), tone: "accent" },
            ] satisfies ConfirmLine[]
          }
          confirmLabel={t("perm.group.deactivate")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setPendingAction(null);
            void handleDeactivate();
          }}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === "reactivate" && (
        <ConfirmDialog
          icon={<PlayCircle size={28} strokeWidth={1.5} />}
          title={t("perm.group.confirmReactivateTitle")}
          danger={false}
          lines={
            [
              { icon: <PlayCircle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmReactivateL1"), tone: "accent" },
            ] satisfies ConfirmLine[]
          }
          confirmLabel={t("perm.group.reactivate")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setPendingAction(null);
            void handleReactivate();
          }}
          onClose={() => setPendingAction(null)}
        />
      )}

      {/* 매니저 추가/제거 확인 모달 — L5 모달 재사용 / confirm manager role change */}
      {pendingManager && (
        <ConfirmDialog
          icon={
            pendingManager.makeManager ? (
              <Star size={28} strokeWidth={1.5} />
            ) : (
              <StarOff size={28} strokeWidth={1.5} />
            )
          }
          danger={false}
          title={
            pendingManager.makeManager
              ? t("perm.group.confirmMakeManagerTitle")
              : t("perm.group.confirmUnsetManagerTitle")
          }
          message={userName(pendingManager.id)}
          lines={
            (pendingManager.makeManager
              ? [
                  { icon: <Star size={14} strokeWidth={1.5} />, text: t("perm.group.confirmMakeManagerL1"), tone: "accent" },
                  { icon: <User size={14} strokeWidth={1.5} />, text: t("perm.group.confirmMakeManagerL2") },
                ]
              : [
                  { icon: <StarOff size={14} strokeWidth={1.5} />, text: t("perm.group.confirmUnsetManagerL1") },
                  { icon: <User size={14} strokeWidth={1.5} />, text: t("perm.group.confirmUnsetManagerL2") },
                ]) satisfies ConfirmLine[]
          }
          confirmLabel={
            pendingManager.makeManager
              ? t("perm.group.makeManager")
              : t("perm.group.unsetManager")
          }
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const p = pendingManager;
            setPendingManager(null);
            void toggleManager(p.id, p.makeManager);
          }}
          onClose={() => setPendingManager(null)}
        />
      )}
    </div>
  );
}
