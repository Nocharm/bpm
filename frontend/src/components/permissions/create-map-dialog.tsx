"use client";

// 맵 생성 다이얼로그 — 이름·공개범위·초기협업자·결재자 설정 후 실 API로 맵 생성 /
// Map creation dialog: name, visibility, initial collaborators, required approvers.
// 맵은 createMap()으로 생성(서버 기본 private), 협업자는 addMapPermission(), 결재자는 setApprovers().
// 공개 범위는 생성 시 항상 private — 공개 전환은 Visibility 탭에서 승인 절차로 한다.
// 표시명·피커 후보: 사용자·부서는 실 /api/directory, 그룹은 실 active 그룹 (Layer 4 Task 4). /
// Display names / picker: users+departments from real /api/directory; groups from real active groups.

import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { X, Globe, Lock } from "lucide-react";

import {
  addMapPermission,
  createMap,
  getDirectory,
  listGroups,
  setApprovers as setMapApprovers,
  type DirectoryUser,
  type DirectoryDept,
  type Group,
} from "@/lib/api";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";
import type { MapRole, MapVisibility, PrincipalType } from "@/lib/mock/permissions-types";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalPicker, PrincipalIcon } from "@/components/permissions/principal-picker";
import type { PrincipalOption } from "@/components/permissions/principal-picker";

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

// ── 내부 타입 ───────────────────────────────────────────────────

interface CollaboratorEntry {
  key: string; // 목록 렌더링 key — genId() / list render key
  principalType: PrincipalType;
  principalId: string;
  displayName: string;
  role: MapRole; // viewer | editor (owner은 자동 부여)
}

interface ApproverEntry {
  key: string;
  userId: string;
  displayName: string;
}

interface Props {
  onClose: () => void;
  onCreated: () => void; // 생성 후 목록 갱신 콜백 / callback to refresh list after creation
}

export function CreateMapDialog({ onClose, onCreated }: Props) {
  const { t } = useI18n();
  const currentUser = useCurrentMockUser();

  // ── 실 디렉터리 + active 그룹 — 마운트 시 1회 조회 (Layer 4 Task 0/4) /
  // Real directory + active groups: fetch once on mount; fall back to empty arrays on error.
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all([getDirectory(), listGroups()])
      .then(([dir, groupRows]) => {
        if (active) {
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
          setGroups(groupRows);
        }
      })
      .catch((err) => {
        // Fall back to empty arrays so pickers still render (create dialog has no onToast).
        console.warn("Directory/groups fetch failed; pickers will be empty.", err);
      });
    return () => { active = false; };
  }, []);

  // 실 디렉터리 데이터를 피커 prop 형식으로 변환 (미사용 필드 빈 값으로 채움) /
  // Adapt real directory data to picker's MockUser / Department shapes.
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

  // ── 폼 상태 / form state ──
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<MapVisibility>("private");
  const [collaborators, setCollaborators] = useState<CollaboratorEntry[]>([]);
  const [approvers, setApprovers] = useState<ApproverEntry[]>([]);
  const [pendingCollab, setPendingCollab] = useState<PrincipalOption | null>(null);
  const [pendingCollabRole, setPendingCollabRole] = useState<"viewer" | "editor">("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 공개범위 변경 시 뷰어→편집자 초기화 / reset pending role when switching to public ──
  const handleVisibilityChange = useCallback((v: MapVisibility) => {
    setVisibility(v);
    if (v === "public" && pendingCollabRole === "viewer") {
      setPendingCollabRole("editor");
    }
  }, [pendingCollabRole]);

  // ── 협업자 추가 / add collaborator ──
  const handleAddCollab = useCallback(() => {
    if (!pendingCollab) return;
    const role: MapRole = visibility === "public" ? "editor" : pendingCollabRole;
    setCollaborators((prev) => {
      // 중복 방지 / dedup
      if (prev.some((c) => c.principalId === pendingCollab.principalId)) return prev;
      return [
        ...prev,
        {
          key: genId(),
          principalType: pendingCollab.principalType,
          principalId: pendingCollab.principalId,
          displayName: pendingCollab.displayName,
          role,
        },
      ];
    });
    setPendingCollab(null);
  }, [pendingCollab, pendingCollabRole, visibility]);

  // ── 협업자 제거 / remove collaborator ──
  const handleRemoveCollab = useCallback((key: string) => {
    setCollaborators((prev) => prev.filter((c) => c.key !== key));
  }, []);

  // ── 결재자 추가 (users only) / add approver (users only) ──
  const handleAddApprover = useCallback((userId: string, displayName: string) => {
    setApprovers((prev) => prev.some((a) => a.userId === userId) ? prev : [...prev, { key: genId(), userId, displayName }]);
  }, []);

  // ── 결재자 제거 / remove approver ──
  const handleRemoveApprover = useCallback((key: string) => {
    setApprovers((prev) => prev.filter((a) => a.key !== key));
  }, []);

  // ── 생성 / create ──
  const handleCreate = useCallback(async () => {
    if (!currentUser) return;
    const trimmed = name.trim();
    if (!trimmed || approvers.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. 맵 생성 — 생성자가 owner(서버 부여), 기본 가시성 private / Real map create (owner = creator).
      const detail = await createMap(trimmed, description.trim());
      // 2. 초기 협업자 권한 부여 — 즉시 적용(서버) / Grant initial collaborators (applied immediately).
      for (const c of collaborators) {
        // owner은 생성자에게 이미 부여됨 → viewer/editor만 / Owner already granted; only viewer/editor here.
        const role: "viewer" | "editor" = c.role === "viewer" ? "viewer" : "editor";
        await addMapPermission(detail.id, c.principalType, c.principalId, role);
      }
      // 3. 필수 결재자 지정 — 전체 목록 PUT / Set required approvers (full list).
      await setMapApprovers(detail.id, approvers.map((a) => a.userId));
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.createMap"));
      setSubmitting(false);
    }
  }, [currentUser, name, description, collaborators, approvers, onCreated, onClose, t]);

  // ── 버튼 활성 / button enabled ──
  const canCreate =
    currentUser !== null &&
    name.trim().length > 0 &&
    approvers.length >= 1 &&
    !submitting;

  // ── 부서 조회 맵 (사용자 ID → 부서명) / department lookup map for picker ──
  const userDepartments = Object.fromEntries(dirUsers.map((u) => [u.id, u.department]));

  // ── 협업자 picker 제외 목록 / collab picker exclude set ──
  const collabExcludeIds = new Set(
    collaborators.map((c) => c.principalId).concat(currentUser ? [currentUser.id] : []),
  );

  const dialog = (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20"
    >
      <div className="relative flex w-full max-w-lg flex-col gap-5 rounded-md bg-surface p-6 shadow-lg">
        {/* 헤더 / header */}
        <div className="flex items-center justify-between">
          <h2 className="text-body-strong text-ink">{t("perm.createDialog.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt"
            aria-label={t("perm.createDialog.cancelBtn")}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* 사용자 없음 경고 / no user warning */}
        {!currentUser && (
          <p className="text-caption text-error">{t("perm.createDialog.noUser")}</p>
        )}

        {/* 이름 / name */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-secondary">
            {t("perm.createDialog.nameLabel")}
          </label>
          <input
            type="text"
            className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-body text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
            placeholder={t("perm.createDialog.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            disabled={submitting}
            autoFocus
          />
        </div>

        {/* 설명 / description */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-secondary">
            {t("perm.createDialog.descriptionLabel")}
          </label>
          <textarea
            data-id="create-map-description"
            className="min-h-[4rem] resize-y rounded-sm border border-hairline bg-surface px-3 py-1.5 text-body text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
            placeholder={t("perm.createDialog.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* 공개 범위 / visibility */}
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-secondary">
            {t("perm.createDialog.visibilityLabel")}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleVisibilityChange("private")}
              className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-caption ${
                visibility === "private"
                  ? "border-accent bg-accent-tint text-accent"
                  : "border-hairline text-ink hover:bg-surface-alt"
              }`}
              disabled={submitting}
            >
              <Lock size={16} strokeWidth={1.5} />
              {t("perm.createDialog.visibilityPrivate")}
            </button>
            <button
              type="button"
              onClick={() => handleVisibilityChange("public")}
              className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-caption ${
                visibility === "public"
                  ? "border-accent bg-accent-tint text-accent"
                  : "border-hairline text-ink hover:bg-surface-alt"
              }`}
              disabled={submitting}
            >
              <Globe size={16} strokeWidth={1.5} />
              {t("perm.createDialog.visibilityPublic")}
            </button>
          </div>
          {visibility === "public" && (
            <p className="text-fine text-ink-tertiary">
              {t("perm.createDialog.visibilityViewerNote")}
            </p>
          )}
        </div>

        {/* 초기 협업자 / initial collaborators */}
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-secondary">
            {t("perm.createDialog.collaboratorsLabel")}
          </span>
          {/* picker + role + 추가 버튼 / picker + role + add button */}
          <div className="flex gap-2">
            <div className="flex-1">
              <PrincipalPicker
                users={pickerUsers}
                departments={pickerDepts}
                groups={toPickerGroups(groups)}
                excludeIds={collabExcludeIds}
                userDepartments={userDepartments}
                onSelect={(opt) => setPendingCollab(opt)}
              />
            </div>
            {/* 역할 선택 / role select */}
            <select
              className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink outline-none"
              value={visibility === "public" ? "editor" : pendingCollabRole}
              onChange={(e) => setPendingCollabRole(e.target.value as "viewer" | "editor")}
              disabled={submitting || visibility === "public"}
              title={visibility === "public" ? t("perm.createDialog.collaboratorRoleViewerDisabled") : undefined}
            >
              {visibility !== "public" && (
                <option value="viewer">{t("perm.createDialog.collaboratorRoleViewer")}</option>
              )}
              <option value="editor">{t("perm.createDialog.collaboratorRoleEditor")}</option>
            </select>
            <button
              type="button"
              onClick={handleAddCollab}
              disabled={!pendingCollab || submitting}
              className="rounded-sm border border-hairline px-3 py-1 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
            >
              {t("perm.createDialog.addBtn")}
            </button>
          </div>
          {/* 선택된 협업자 표시 / selected collaborator display */}
          {pendingCollab && (
            <div className="flex items-center gap-1.5 rounded-sm border border-accent bg-accent-tint px-2 py-1 text-caption text-accent">
              <PrincipalIcon type={pendingCollab.principalType} />
              <span>{pendingCollab.displayName}</span>
            </div>
          )}
          {/* 추가된 협업자 목록 / added collaborators list */}
          {collaborators.length > 0 && (
            <ul className="flex flex-col gap-1">
              {collaborators.map((c) => (
                <li
                  key={c.key}
                  className="flex items-center gap-2 rounded-sm border border-hairline px-2 py-1 text-caption text-ink"
                >
                  <PrincipalIcon type={c.principalType} />
                  <span className="flex-1">{c.displayName}</span>
                  <span className="text-fine text-ink-tertiary">
                    {c.role === "editor"
                      ? t("perm.createDialog.collaboratorRoleEditor")
                      : t("perm.createDialog.collaboratorRoleViewer")}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCollab(c.key)}
                    className="text-ink-tertiary hover:text-ink"
                    aria-label={t("perm.removeButton")}
                    disabled={submitting}
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 결재자 / approvers */}
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-secondary">
            {t("perm.createDialog.approversLabel")}
          </span>
          {/* 결재자 picker (users only) + 선택된 결재자 pills / approver picker + selected pills */}
          <PrincipalPicker
            users={pickerUsers}
            departments={[]}
            groups={[]}
            excludeIds={new Set(approvers.map((a) => a.userId))}
            userDepartments={userDepartments}
            onSelect={(opt) => {
              if (opt.principalType === "user") handleAddApprover(opt.principalId, opt.displayName);
            }}
          />
          {approvers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {approvers.map((a) => (
                <span
                  key={a.key}
                  data-id={`create-approver-pill-${a.userId}`}
                  className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-caption text-ink"
                >
                  {a.displayName}
                  <button
                    type="button"
                    className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface hover:text-error"
                    onClick={() => handleRemoveApprover(a.key)}
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 오류 / error */}
        {error && <p className="text-caption text-error">{error}</p>}

        {/* 버튼 행 / action row */}
        <div className="flex items-center justify-end gap-2">
          {!canCreate && approvers.length === 0 && name.trim().length > 0 && (
            <p className="mr-auto text-fine text-error">
              {t("perm.createDialog.approversHint")}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-sm border border-hairline px-4 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
          >
            {t("perm.createDialog.cancelBtn")}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className="rounded-sm bg-accent px-4 py-1.5 text-caption text-surface hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "…" : t("perm.createDialog.createBtn")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );

  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}
