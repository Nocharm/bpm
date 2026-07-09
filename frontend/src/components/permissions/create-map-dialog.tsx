"use client";

// 맵 생성 다이얼로그 — 이름·공개범위·초기협업자·결재자 설정 후 실 API로 맵 생성 /
// Map creation dialog: name, visibility, initial collaborators, required approvers.
// 맵은 createMap()으로 생성(서버 기본 private), 협업자는 addMapPermission(), 결재자는 setApprovers().
// 공개 범위는 생성 시 항상 private — 공개 전환은 Visibility 탭에서 승인 절차로 한다.
// 표시명·피커 후보: 사용자·부서는 실 /api/directory, 그룹은 실 active 그룹 (Layer 4 Task 4). /
// Display names / picker: users+departments from real /api/directory; groups from real active groups.

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Globe, Lock } from "lucide-react";

import {
  acquireCheckout,
  addMapPermission,
  createMap,
  getDirectory,
  listGroups,
  saveGraph,
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CsvImportSection } from "@/components/csv-import-section";
import { PrincipalPicker, PrincipalIcon } from "@/components/permissions/principal-picker";
import type { PrincipalOption } from "@/components/permissions/principal-picker";
import type { CsvImportOutcome } from "@/lib/csv-import";

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
  const [pendingCollabRole, setPendingCollabRole] = useState<"viewer" | "editor">("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 공개범위 변경 확인 대기 — 승인자 초기화 안내 모달용 / pending visibility change awaiting confirm.
  const [pendingVisibility, setPendingVisibility] = useState<MapVisibility | null>(null);
  const router = useRouter();
  // CSV로 시작(선택) — 파싱 결과와 파일명. 에러 있으면 생성 차단
  const [csv, setCsv] = useState<CsvImportOutcome | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  // 생성 완료 표시(맵/버전 id) — CSV 체크아웃·저장 실패 후 재시도 시 맵 재생성(중복) 방지용
  const createdRef = useRef<{ mapId: number; versionId: number } | null>(null);

  // 공개범위 적용 — 승인자 후보군이 바뀌므로(public=전원 열람) 이미 고른 승인자를 초기화.
  // plain 함수 — React Compiler 자동 메모(수동 useCallback이 setter 추론과 충돌).
  const applyVisibilityChange = (v: MapVisibility) => {
    setVisibility(v);
    setApprovers([]); // 후보군 변경 → 승인자 초기화
    if (v === "public" && pendingCollabRole === "viewer") {
      setPendingCollabRole("editor");
    }
  };

  // ── 공개범위 변경 — 승인자가 이미 있으면 초기화 안내 모달, 없으면 바로 적용 ──
  const handleVisibilityChange = (v: MapVisibility) => {
    if (v === visibility) return;
    if (approvers.length > 0) {
      setPendingVisibility(v);
    } else {
      applyVisibilityChange(v);
    }
  };

  // ── 협업자 추가 — 드롭다운에서 선택(클릭/Enter) 즉시 현재 역할로 추가(별도 Add 버튼 없음) ──
  const addCollaborator = (opt: PrincipalOption) => {
    const role: MapRole = visibility === "public" ? "editor" : pendingCollabRole;
    setCollaborators((prev) =>
      prev.some((c) => c.principalId === opt.principalId)
        ? prev // 중복 방지 / dedup
        : [
            ...prev,
            {
              key: genId(),
              principalType: opt.principalType,
              principalId: opt.principalId,
              displayName: opt.displayName,
              role,
            },
          ],
    );
  };

  // ── 협업자 제거 / remove collaborator ──
  const handleRemoveCollab = useCallback((key: string) => {
    setCollaborators((prev) => prev.filter((c) => c.key !== key));
  }, []);

  // ── 추가된 협업자 권한 클릭 토글 (생성 단계, viewer↔editor) — public은 editor 고정 (#9) ──
  const handleToggleCollabRole = (key: string) => {
    if (visibility === "public") return;
    setCollaborators((prev) =>
      prev.map((c) =>
        c.key === key ? { ...c, role: c.role === "editor" ? "viewer" : "editor" } : c,
      ),
    );
  };

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
      // 생성 단계는 최초 1회만 — 재시도(CSV 실패 후 Create 재클릭) 시 이미 만든 맵을 재사용해 중복 생성 방지
      if (createdRef.current === null) {
        // 1. 맵 생성 — 생성자가 owner(서버 부여), 선택한 공개 범위 즉시 반영 / Real map create (owner = creator).
        const detail = await createMap(trimmed, description.trim(), visibility);
        // 2. 초기 협업자 권한 부여 — 즉시 적용(서버) / Grant initial collaborators (applied immediately).
        for (const c of collaborators) {
          // owner은 생성자에게 이미 부여됨 → viewer/editor만 / Owner already granted; only viewer/editor here.
          const role: "viewer" | "editor" = c.role === "viewer" ? "viewer" : "editor";
          await addMapPermission(detail.id, c.principalType, c.principalId, role);
        }
        // 3. 필수 결재자 지정 — 전체 목록 PUT / Set required approvers (full list).
        await setMapApprovers(detail.id, approvers.map((a) => a.userId));
        createdRef.current = { mapId: detail.id, versionId: detail.versions[0].id };
      }
      const created = createdRef.current;
      // 4. CSV 첨부 시 — 신규 As-Is 버전은 잠금 free: 체크아웃 획득 → 그래프 반영 → 에디터로 이동
      if (csv?.graph) {
        try {
          await acquireCheckout(created.versionId);
          await saveGraph(created.versionId, csv.graph);
        } catch (err) {
          // 맵은 이미 생성됨 — 목록 갱신 + 다이얼로그 유지·인라인 에러(Create 재클릭 시 체크아웃·저장만 재시도)
          onCreated();
          setError(
            err instanceof Error
              ? `${t("csvImport.mapCreatedImportFailed")} — ${err.message}`
              : t("csvImport.mapCreatedImportFailed"),
          );
          setSubmitting(false);
          return;
        }
        onCreated();
        onClose();
        router.push(`/maps/${created.mapId}`);
        return;
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.createMap"));
      setSubmitting(false);
    }
  }, [currentUser, name, description, visibility, collaborators, approvers, csv, onCreated, onClose, router, t]);

  // ── 버튼 활성 / button enabled ──
  const canCreate =
    currentUser !== null &&
    name.trim().length > 0 &&
    approvers.length >= 1 &&
    (csv === null || (csv.errors.length === 0 && csv.graph !== null)) &&
    !submitting;

  // ── 부서 조회 맵 (사용자 ID → 부서명) / department lookup map for picker ──
  const userDepartments = Object.fromEntries(dirUsers.map((u) => [u.id, u.department]));

  // ── 협업자 picker 제외 목록 / collab picker exclude set ──
  const collabExcludeIds = new Set(
    collaborators.map((c) => c.principalId).concat(currentUser ? [currentUser.id] : []),
  );

  // ── 승인자 후보 (AP, 생성 시점엔 맵이 없어 클라 산정) ──
  // public=전원 열람이라 모든 직원 후보. private=생성자 + 선택한 협업자(user) +
  // 협업자로 추가된 부서의 부서원(상위 조직이면 하위 팀/그룹 전원) + 그룹의 멤버.
  // 부서 협업자 principalId=org_path → 직원 org_path가 그 하위면 포함 (AP 계층, belongs_to_department parity).
  const deptOrgPathByLeaf = new Map(dirDepts.map((d) => [d.name, d.id])); // 말단명 → org_path
  const chosenDeptPaths = collaborators
    .filter((c) => c.principalType === "department")
    .map((c) => c.principalId);
  const inChosenDept = (u: DirectoryUser): boolean => {
    const orgPath = deptOrgPathByLeaf.get(u.department) ?? u.department;
    return chosenDeptPaths.some((dp) => orgPath === dp || orgPath.startsWith(`${dp}/`));
  };
  const groupCollabIds = new Set(
    collaborators.filter((c) => c.principalType === "group").map((c) => c.principalId),
  );
  const groupMemberIds = new Set<string>();
  for (const g of groups) {
    if (groupCollabIds.has(String(g.id))) {
      for (const m of g.members) {
        if (m.member_type === "user") groupMemberIds.add(m.member_id);
      }
    }
  }
  const approverEligibleIds = new Set<string>([
    ...(currentUser ? [currentUser.id] : []),
    ...collaborators.filter((c) => c.principalType === "user").map((c) => c.principalId),
    ...dirUsers.filter(inChosenDept).map((u) => u.id),
    ...groupMemberIds,
  ]);
  const approverPickerUsers =
    visibility === "public"
      ? pickerUsers
      : pickerUsers.filter((u) => approverEligibleIds.has(u.id));

  const dialog = (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-5 rounded-md bg-surface p-6 shadow-lg">
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

        {/* 본문 — 작은 뷰포트에서만 내부 스크롤(스크롤바 숨김), 헤더·버튼 행은 고정 (batch2 ①) */}
        <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
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
          </div>
          {visibility === "public" && (
            <p className="text-fine text-ink-tertiary">
              {t("perm.createDialog.visibilityViewerNote")}
            </p>
          )}
        </div>

        {/* CSV로 시작 (선택) — 양식 다운로드 + 파일 첨부 시 생성 직후 그래프 반영 후 에디터 이동 */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-secondary">{t("csvImport.sectionTitle")}</label>
          <CsvImportSection
            outcome={csv}
            fileName={csvFileName}
            onChange={(nextOutcome, nextFileName) => {
              setCsv(nextOutcome);
              setCsvFileName(nextFileName);
            }}
            disabled={submitting}
          />
        </div>

        {/* 초기 협업자 / initial collaborators */}
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-secondary">
            {t("perm.createDialog.collaboratorsLabel")}
          </span>
          {/* 목록을 피커 위로 표시(드롭다운이 아래로 열려도 실시간 추가가 안 가려지게) — col-reverse: DOM은 picker→list, 화면은 list 위 */}
          <div className="flex flex-col-reverse gap-1.5">
          {/* picker + role — 선택한 역할로 드롭다운 선택 즉시 추가(Add 버튼 없음). items-start로 드롭다운 플로팅 시 역할 컨트롤 안 늘어남 */}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <PrincipalPicker
                users={pickerUsers}
                departments={pickerDepts}
                groups={toPickerGroups(groups)}
                excludeIds={collabExcludeIds}
                userDepartments={userDepartments}
                onSelect={addCollaborator}
              />
            </div>
            {/* 역할 선택 — public이면 editor 1옵션이라 드롭다운 대신 정적 표시(화살표 없음, PV) */}
            {visibility === "public" ? (
              <span
                className="rounded-sm border border-hairline bg-surface-alt px-2 py-1.5 text-caption text-ink-secondary"
                title={t("perm.createDialog.collaboratorRoleViewerDisabled")}
              >
                {t("perm.createDialog.collaboratorRoleEditor")}
              </span>
            ) : (
              <select
                className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink outline-none"
                value={pendingCollabRole}
                onChange={(e) => setPendingCollabRole(e.target.value as "viewer" | "editor")}
                disabled={submitting}
              >
                <option value="viewer">{t("perm.createDialog.collaboratorRoleViewer")}</option>
                <option value="editor">{t("perm.createDialog.collaboratorRoleEditor")}</option>
              </select>
            )}
          </div>
          {/* 추가된 협업자 목록 — 높이 고정(~3.5행)·내부 스크롤로 모달 크기 불변(추가해도 안 늘어남) /
              fixed ~3.5-row scroll area so the modal stays the same size as collaborators stack. */}
          <ul className="scroll-soft flex h-[7.5rem] flex-col gap-1">
              {collaborators.map((c) => (
                <li
                  key={c.key}
                  className="animate-item-in flex shrink-0 items-center gap-2 rounded-sm border border-hairline px-2 py-1 text-caption text-ink"
                >
                  <PrincipalIcon type={c.principalType} />
                  <span className="flex-1 truncate">{c.displayName}</span>
                  {/* 권한 클릭 토글(생성 단계) — public은 editor 고정 (#9) */}
                  <button
                    type="button"
                    disabled={submitting || visibility === "public"}
                    onClick={() => handleToggleCollabRole(c.key)}
                    title={t("perm.createDialog.clickToToggleRole")}
                    className="rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-ink disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-ink-tertiary"
                  >
                    {c.role === "editor"
                      ? t("perm.createDialog.collaboratorRoleEditor")
                      : t("perm.createDialog.collaboratorRoleViewer")}
                  </button>
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
          </div>
        </div>

        {/* 결재자 / approvers */}
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-secondary">
            {t("perm.createDialog.approversLabel")}
          </span>
          {/* pills를 피커 위로 표시(실시간 추가가 드롭다운에 안 가려지게) — col-reverse */}
          <div className="flex flex-col-reverse gap-1.5">
          {/* 결재자 picker (users only) + 선택된 결재자 pills / approver picker + selected pills */}
          {/* 후보 = 생성자 + 선택한 user 협업자 (AP) */}
          <PrincipalPicker
            users={approverPickerUsers}
            departments={[]}
            groups={[]}
            excludeIds={new Set(approvers.map((a) => a.userId))}
            userDepartments={userDepartments}
            onSelect={(opt) => {
              if (opt.principalType === "user") handleAddApprover(opt.principalId, opt.displayName);
            }}
          />
          {/* 결재자 pills — 1.5줄 높이 미리 확보·내부 스크롤(추가해도 모달 안 늘어남) / reserve ~1.5 rows. */}
          <div className="scroll-soft flex h-[2.5rem] flex-wrap content-start gap-1.5">
            {approvers.map((a) => (
              <span
                key={a.key}
                data-id={`create-approver-pill-${a.userId}`}
                className="animate-item-in inline-flex h-fit items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-caption text-ink"
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
          </div>
        </div>
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
  return createPortal(
    <>
      {dialog}
      {/* 공개범위 변경 시 승인자 초기화 안내 → 확인하면 변경+초기화 */}
      {pendingVisibility && (
        <ConfirmDialog
          title={t("perm.createDialog.visibilityResetTitle")}
          message={t("perm.createDialog.visibilityResetMessage")}
          confirmLabel={t("perm.createDialog.visibilityResetConfirm")}
          cancelLabel={t("perm.createDialog.cancelBtn")}
          onConfirm={() => {
            applyVisibilityChange(pendingVisibility);
            setPendingVisibility(null);
          }}
          onClose={() => setPendingVisibility(null)}
        />
      )}
    </>,
    document.body,
  );
}
