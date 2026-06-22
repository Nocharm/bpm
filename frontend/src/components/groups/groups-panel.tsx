"use client";

// 유저 그룹 목록 + 생성 요청 — 설정 콘솔 "Groups" 탭 (이전 /groups 페이지에서 추출) /
// User group list + create-request, rendered as the Settings console "Groups" tab.
// 서버가 진실 — 목록 GET /api/groups, 생성 POST /api/groups. 변경 후 재조회(낙관적 갱신 금지).
// 멤버 피커는 실 디렉터리(getDirectory). 생성 시 ≥2 멤버 필수(클라 차단 + 서버 422).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import {
  createGroup,
  getDirectory,
  listGroups,
  type DirectoryDept,
  type DirectoryUser,
  type Group,
  type GroupStatus,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import type { Department, User as MockUser } from "@/lib/mock/permissions-types";

// 그룹 상태 pill — Group.status는 pending/active/rejected /
// Group status pill: pending / active / rejected.
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

// 멤버 피커 아이템 — dept 또는 user / Member entry restricted to department or user.
type MemberEntry = { type: "department" | "user"; id: string; displayName: string };

// 관리자 피커 아이템 — user만 / Manager entry restricted to user only.
type ManagerEntry = { id: string; displayName: string };

export function GroupsPanel() {
  const { t } = useI18n();

  // 서버 그룹 목록 / Server-sourced group list.
  const [groups, setGroups] = useState<Group[]>([]);
  // 실 디렉터리 — 피커 후보 / Real directory for picker candidates.
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);

  // 다이얼로그 / Dialog open state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  const reloadGroups = useCallback(async () => {
    try {
      setGroups(await listGroups());
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 초기 로드 — 그룹 목록 + 디렉터리 / Initial load: groups + directory.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [groupRows, dir] = await Promise.all([listGroups(), getDirectory()]);
        if (active) {
          setGroups(groupRows);
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
        }
      } catch (err) {
        if (active) addToast(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // 실 디렉터리를 피커 prop 형식으로 변환 (미사용 필드 stub) /
  // Adapt real directory to picker's MockUser / Department shapes.
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

  // 멤버 추가 — dept + user만 / Add member (department or user only).
  function handleMemberSelect(opt: PrincipalOption) {
    if (opt.principalType === "group") return;
    // 복합키(type:id)로 중복 체크 / Dedup by composite type:id.
    if (members.some((m) => m.type === opt.principalType && m.id === opt.principalId)) return;
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

  function removeMember(type: "department" | "user", id: string) {
    setMembers((prev) => prev.filter((m) => !(m.type === type && m.id === id)));
  }

  function removeManager(id: string) {
    setManagers((prev) => prev.filter((m) => m.id !== id));
  }

  // 제출 — createGroup 호출 후 목록 재조회 / Submit — createGroup then refetch list.
  async function handleSubmit() {
    if (submitDisabled) return;
    setSubmitting(true);
    try {
      await createGroup(
        name.trim(),
        description.trim(),
        members.map((m) => ({ member_type: m.type, member_id: m.id })),
        managers.map((m) => m.id),
      );
      addToast(t("perm.group.toastRequested"));
      closeDialog();
      await reloadGroups();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // 제출 비활성 — 이름 필수 + 멤버 ≥2 (서버 규칙) + 관리자 ≥1 / Disable until name, ≥2 members, ≥1 manager.
  const submitDisabled =
    !name.trim() || members.length < 2 || managers.length === 0 || submitting;

  // 피커 제외 — id 기반(PrincipalPicker가 principalId로만 비교) / Picker exclusion (id-only).
  const memberExcludeIds = new Set(members.map((m) => m.id));
  const managerExcludeIds = new Set(managers.map((m) => m.id));

  return (
    <div className="flex flex-col gap-4">
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
      {groups.length === 0 ? (
        <p className="text-caption text-ink-tertiary">{t("perm.group.noGroups")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((group) => (
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
                      key={`${m.type}:${m.id}`}
                      className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-fine text-ink"
                    >
                      {m.displayName}
                      <button
                        type="button"
                        className="text-ink-tertiary hover:text-error"
                        onClick={() => removeMember(m.type, m.id)}
                        aria-label={t("perm.group.removeBtn")}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* dept + user만 — groups: [] / Pass groups: [] to restrict to dept+user. */}
              <PrincipalPicker
                users={pickerUsers}
                departments={pickerDepts}
                groups={[]}
                excludeIds={memberExcludeIds}
                onSelect={handleMemberSelect}
              />
              {/* ≥2 멤버 안내 — 미달이면 표시 / Min-2 hint when below threshold. */}
              {members.length < 2 && (
                <p className="text-fine text-error">{t("perm.group.minMembersHint")}</p>
              )}
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
              {/* user만 — departments: [], groups: [] / Pass empty to restrict to user. */}
              <PrincipalPicker
                users={pickerUsers}
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
                onClick={() => void handleSubmit()}
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
