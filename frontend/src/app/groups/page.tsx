"use client";

// 유저 그룹 목록 + 생성 요청 페이지 / User group list and create-request page.

import Link from "next/link";
import { useState } from "react";
import { Users } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import {
  usePermissions,
  requestGroup,
} from "@/lib/mock/permissions";
import type { UserGroup } from "@/lib/mock/permissions";

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

// 멤버 피커 아이템 — PrincipalOption에서 type을 'department'|'user'로 제한 /
// Member picker item restricted to department and user types.
type MemberEntry = { type: "department" | "user"; id: string; displayName: string };

// 관리자 피커 아이템 — user만 허용 / Manager picker item restricted to user only.
type ManagerEntry = { id: string; displayName: string };

export default function GroupsPage() {
  const { t } = useI18n();
  const state = usePermissions();

  // 다이얼로그 열림 / Dialog open state
  const [dialogOpen, setDialogOpen] = useState(false);

  // 생성 요청 폼 / Create-request form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [managers, setManagers] = useState<ManagerEntry[]>([]);

  // 토스트 / Toast state
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function addToast(message: string) {
    setToasts((prev) => [{ id: genId(), message }, ...prev]);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function openDialog() {
    setName("");
    setDescription("");
    setMembers([]);
    setManagers([]);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  // 멤버 추가 — dept + user만 허용 / Add member (department or user only, not group).
  function handleMemberSelect(opt: PrincipalOption) {
    if (opt.principalType === "group") return; // 그룹은 제외 / exclude groups
    if (members.some((m) => m.id === opt.principalId)) return;
    setMembers((prev) => [
      ...prev,
      { type: opt.principalType as "department" | "user", id: opt.principalId, displayName: opt.displayName },
    ]);
  }

  // 관리자 추가 — user만 / Add manager (user only).
  function handleManagerSelect(opt: PrincipalOption) {
    if (opt.principalType !== "user") return;
    if (managers.some((m) => m.id === opt.principalId)) return;
    setManagers((prev) => [...prev, { id: opt.principalId, displayName: opt.displayName }]);
  }

  function removeMember(id: string) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  function removeManager(id: string) {
    setManagers((prev) => prev.filter((m) => m.id !== id));
  }

  // 제출 — requestGroup 호출 / Submit — call requestGroup.
  function handleSubmit() {
    if (!name.trim() || managers.length === 0) return;
    requestGroup(
      name.trim(),
      description.trim(),
      members.map((m) => ({ type: m.type, id: m.id })),
      managers.map((m) => m.id),
    );
    addToast(t("perm.group.toastRequested"));
    closeDialog();
  }

  // 제출 비활성 조건 / Disable submit until name non-empty AND ≥1 manager.
  const submitDisabled = !name.trim() || managers.length === 0;

  // 멤버 피커용 excludeIds — 이미 추가된 멤버 제외 / ExcludeIds for member picker.
  const memberExcludeIds = new Set(members.map((m) => m.id));
  // 관리자 피커용 excludeIds / ExcludeIds for manager picker.
  const managerExcludeIds = new Set(managers.map((m) => m.id));

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* 헤더 / Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} strokeWidth={1.5} className="text-ink-tertiary" />
          <p className="text-body-strong text-ink">{t("perm.group.pageTitle")}</p>
        </div>
        <button
          type="button"
          className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus"
          onClick={openDialog}
        >
          {t("perm.group.createBtn")}
        </button>
      </div>

      {/* 그룹 목록 / Group list */}
      {state.groups.length === 0 ? (
        <p className="text-caption text-ink-tertiary">{t("perm.group.noGroups")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {state.groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="flex items-center gap-3 rounded-sm border border-hairline bg-surface px-4 py-3 hover:bg-surface-alt"
            >
              <Users size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-caption text-ink">{group.name}</span>
                {group.description && (
                  <span className="text-fine text-ink-tertiary">{group.description}</span>
                )}
              </div>
              <GroupStatusBadge status={group.status} />
            </Link>
          ))}
        </div>
      )}

      {/* 생성 요청 다이얼로그 / Create-request dialog */}
      {dialogOpen && (
        <ModalBackdrop
          onClose={closeDialog}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30"
        >
          <div className="flex w-[480px] max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-md border border-hairline bg-surface p-6 shadow-lg">
            <p className="text-body-strong text-ink">{t("perm.group.createTitle")}</p>

            {/* 이름 / Name */}
            <div className="flex flex-col gap-1">
              <label className="text-fine text-ink-tertiary">{t("perm.group.nameLabel")}</label>
              <input
                type="text"
                className="rounded-sm border border-hairline bg-transparent px-2 py-1.5 text-caption text-ink outline-none focus:border-accent placeholder:text-ink-tertiary"
                placeholder={t("perm.group.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            {/* 설명 / Description */}
            <div className="flex flex-col gap-1">
              <label className="text-fine text-ink-tertiary">{t("perm.group.descLabel")}</label>
              <textarea
                className="rounded-sm border border-hairline bg-transparent px-2 py-1.5 text-caption text-ink outline-none focus:border-accent placeholder:text-ink-tertiary resize-none"
                placeholder={t("perm.group.descPlaceholder")}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* 멤버 (부서+개인) / Members (dept + user) */}
            <div className="flex flex-col gap-1">
              <label className="text-fine text-ink-tertiary">{t("perm.group.membersLabel")}</label>
              {members.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {members.map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-fine text-ink"
                    >
                      {m.displayName}
                      <button
                        type="button"
                        className="text-ink-tertiary hover:text-error"
                        onClick={() => removeMember(m.id)}
                        aria-label={t("perm.group.removeBtn")}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* dept + user만 허용 — groups: [] 전달 / Pass groups: [] to restrict to dept+user only. */}
              <PrincipalPicker
                users={state.users}
                departments={state.departments}
                groups={[]}
                excludeIds={memberExcludeIds}
                onSelect={handleMemberSelect}
              />
            </div>

            {/* 관리자 (user만) / Managers (user only) */}
            <div className="flex flex-col gap-1">
              <label className="text-fine text-ink-tertiary">{t("perm.group.managersLabel")}</label>
              {managers.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {managers.map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-fine text-ink"
                    >
                      {m.displayName}
                      <button
                        type="button"
                        className="text-ink-tertiary hover:text-error"
                        onClick={() => removeManager(m.id)}
                        aria-label={t("perm.group.removeBtn")}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* user만 허용 — departments: [], groups: [] 전달 / Pass departments: [], groups: [] to restrict to user only. */}
              <PrincipalPicker
                users={state.users}
                departments={[]}
                groups={[]}
                excludeIds={managerExcludeIds}
                onSelect={handleManagerSelect}
              />
            </div>

            {/* 액션 버튼 / Action buttons */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                onClick={closeDialog}
              >
                {t("perm.group.cancelBtn")}
              </button>
              <button
                type="button"
                className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
                onClick={handleSubmit}
                disabled={submitDisabled}
              >
                {t("perm.group.submitBtn")}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
