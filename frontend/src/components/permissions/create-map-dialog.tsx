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
import { X, Globe, Lock, ChevronDown, ChevronRight, FileUp, LockKeyhole } from "lucide-react";

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
import { stripCsvExtension, type CsvImportOutcome } from "@/lib/csv-import";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { deriveDeptKoreanKeywords } from "@/lib/korean-dept";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";
import type { MapRole, MapVisibility, PrincipalType } from "@/lib/mock/permissions-types";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PrincipalPicker, PrincipalIcon } from "@/components/permissions/principal-picker";
import type { PrincipalOption } from "@/components/permissions/principal-picker";
import type { WordCreateOutcome } from "@/components/word-create-modal";

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
  onCreated: (silent?: boolean) => void; // 생성 후 목록 갱신 콜백 — silent=true면 성공 토스트 억제(임포트 실패 시) / refresh list; silent suppresses the success toast
  // CSV로 만들기 — 홈의 CSV 모달이 넘긴다. **optional 필수**: map-name-dropdown.tsx도 이 컴포넌트를 마운트한다.
  csv?: { outcome: CsvImportOutcome; fileName: string };
  // Word 문서로 만들기 — 홈의 Word 모달이 넘긴다(csv와 동형).
  word?: WordCreateOutcome;
  // 이름 프리필 — 에디터 피커의 "새 맵" 검색어 이어받기 (spec 2026-07-19)
  initialName?: string;
  // 지정 시 생성 후 이동(router.push) 대신 호출측이 후속 처리(플레이스홀더 자동 링크)
  onCreatedMap?: (mapId: number, name: string) => void;
}

export function CreateMapDialog({ onClose, onCreated, csv, word, initialName, onCreatedMap }: Props) {
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
    korean_name: u.korean_name ?? "",
  }));
  // 부서장은 login_id로만 저장된다(dept_info.manager) — 부서를 부서장 "이름"으로도 찾을 수 있게
  // 디렉터리로 한/영 이름을 해석해 검색 텍스트에 합친다. 표시엔 쓰이지 않고 검색 키워드 전용.
  const userById = new Map(dirUsers.map((u) => [u.id, u]));
  const pickerDepts: Department[] = dirDepts.map((d) => {
    const head = d.manager ? userById.get(d.manager) : undefined;
    const managerKeywords = [d.manager, head?.name, head?.korean_name]
      .filter(Boolean)
      .join(" ");
    return {
      id: d.id,
      code: "",
      name: d.name,
      orgLevels: [],
      parentId: null,
      rawDn: "",
      korean_name: d.korean_name,
      manager: managerKeywords,
    };
  });

  // ── 폼 상태 / form state ──
  // CSV로 만들 때는 파일명(확장자 제외)을 이름·설명 기본값으로
  const csvBaseName = csv ? stripCsvExtension(csv.fileName) : "";
  // Word 문서로 만들 때는 문서명(확장자 제외)을 이름 기본값으로 — csvBaseName과 동일한 우선순위로 합류
  const wordBaseName = word ? word.docName.replace(/\.docx$/i, "") : "";
  const [name, setName] = useState(initialName ?? (csvBaseName || wordBaseName));
  const [description, setDescription] = useState(csvBaseName);
  // 파일 아코디언 접힘 상태
  const [csvOpen, setCsvOpen] = useState(false);
  const [wordOpen, setWordOpen] = useState(false);
  // 생성 완료 표시 — createMap 직후 즉시 기록해야 한다. 부분 실패 후 Create 재클릭 시
  // 맵을 다시 만들면 이름 중복 409로 영영 막힌다(백엔드 _assert_unique_name).
  const createdRef = useRef<{ mapId: number; versionId: number } | null>(null);
  // 이미 부여한 협업자 권한 — addMapPermission은 중복 시 409를 던지는 비멱등 POST라
  // 재시도에서 성공분을 건너뛰어야 한다. 렌더와 무관한 진행 상태라 state가 아닌 ref.
  const grantedRef = useRef(new Set<string>());
  const [visibility, setVisibility] = useState<MapVisibility>("private");
  const [collaborators, setCollaborators] = useState<CollaboratorEntry[]>([]);
  const [approvers, setApprovers] = useState<ApproverEntry[]>([]);
  const [pendingCollabRole, setPendingCollabRole] = useState<"viewer" | "editor">("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 공개범위 변경 확인 대기 — 승인자 초기화 안내 모달용 / pending visibility change awaiting confirm.
  const [pendingVisibility, setPendingVisibility] = useState<MapVisibility | null>(null);
  const router = useRouter();
  // 오우닝 부서(필수) — DirectoryDept 그대로 보관(id=org_path, manager=리더 login_id)
  const [owningDept, setOwningDept] = useState<DirectoryDept | null>(null);
  // 자동 추가한 리더 승인자 추적 — 부서 변경 시 자동분만 교체하고 수동 추가는 보존
  const autoLeaderRef = useRef<string | null>(null);
  // 결재자 섹션 — 오우닝 부서 선택 후 여기로 스크롤 다운(맨 아래 피커를 상단 피커로 착각 방지)
  const approversRef = useRef<HTMLDivElement>(null);
  // 스크롤과 동시에 결재자 섹션을 1회 반짝여 시선 유도(오우닝 선택 핸들러에서 켜고 타이머로 해제 — 모션 설정 무관하게 리셋).
  const [flashApprovers, setFlashApprovers] = useState(false);

  // 오우닝 부서를 고르면 결재자 피커로 스크롤 다운 — 작은 뷰포트에서 아래 피커가 안 보여 헷갈리는 문제
  useEffect(() => {
    if (owningDept) {
      approversRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [owningDept]);

  // 공개범위 적용 — 승인자 후보군이 바뀌므로(public=전원 열람) 이미 고른 승인자를 초기화.
  // plain 함수 — React Compiler 자동 메모(수동 useCallback이 setter 추론과 충돌).
  const applyVisibilityChange = (v: MapVisibility) => {
    setVisibility(v);
    // 후보군 변경 → 승인자 초기화. 오우닝 부서 리더 자동 추가분은 다시 심는다(양쪽 후보군에서 유효).
    const leader = owningDept?.manager ? userById.get(owningDept.manager) : undefined;
    setApprovers(
      leader ? [{ key: genId(), userId: leader.id, displayName: leader.name }] : [],
    );
    autoLeaderRef.current = leader?.id ?? null;
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

  // 오우닝 부서 선택 — 리더를 승인자로 자동 추가(제거 가능), 이전 자동분은 교체
  const applyOwningDept = (opt: PrincipalOption) => {
    const dept = dirDepts.find((d) => d.id === opt.principalId);
    if (!dept) return;
    const removeId = autoLeaderRef.current;
    const leader = dept.manager ? userById.get(dept.manager) : undefined;
    const kept = removeId ? approvers.filter((a) => a.userId !== removeId) : approvers;
    // 자동 추가로 기록하는 건 실제로 추가했을 때만 — 수동 추가분을 auto로 오인해 clear 시 지우는 버그 방지
    const shouldAdd = leader !== undefined && !kept.some((a) => a.userId === leader.id);
    setApprovers(
      shouldAdd
        ? [...kept, { key: genId(), userId: leader.id, displayName: leader.name }]
        : kept,
    );
    autoLeaderRef.current = shouldAdd ? leader.id : null;
    setOwningDept(dept);
    setFlashApprovers(true);
    window.setTimeout(() => setFlashApprovers(false), 850); // 애니메이션 후 리셋(재선택 시 재발화)
  };

  const clearOwningDept = () => {
    const removeId = autoLeaderRef.current;
    autoLeaderRef.current = null;
    if (removeId) setApprovers((prev) => prev.filter((a) => a.userId !== removeId));
    setOwningDept(null);
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
  // plain 함수 — React Compiler 자동 메모. 자동 추가된 리더를 지우면 추적 ref도 해제.
  const handleRemoveApprover = (key: string) => {
    const target = approvers.find((a) => a.key === key);
    if (target && target.userId === autoLeaderRef.current) {
      autoLeaderRef.current = null;
    }
    setApprovers((prev) => prev.filter((a) => a.key !== key));
  };

  // ── 생성 / create ──
  const handleCreate = useCallback(async () => {
    if (!currentUser) return;
    const trimmed = name.trim();
    if (!trimmed || approvers.length === 0 || !owningDept) return;
    setSubmitting(true);
    setError(null);
    try {
      // 생성은 최초 1회만 — 협업자/결재자 단계가 실패해도 맵은 이미 있으므로
      // createMap 직후 즉시 기록해 재시도에서 재생성(이름 409)을 막는다
      if (createdRef.current === null) {
        const detail = await createMap(
          trimmed,
          description.trim(),
          visibility,
          owningDept.id,
          word ? { docName: word.docName, sections: word.sections } : undefined,
        );
        createdRef.current = { mapId: detail.id, versionId: detail.versions[0].id };
      }
      const created = createdRef.current;

      // 협업자 권한 — 매 시도마다 돌되, 이미 부여된 principal은 건너뛴다(중복 POST는 409)
      for (const c of collaborators) {
        if (grantedRef.current.has(c.principalId)) continue;
        const role: "viewer" | "editor" = c.role === "viewer" ? "viewer" : "editor";
        await addMapPermission(created.mapId, c.principalType, c.principalId, role);
        grantedRef.current.add(c.principalId);
      }
      // 결재자 — 전체 교체 PUT(멱등)이라 매 시도마다 그대로 재전송해도 안전
      await setMapApprovers(created.mapId, approvers.map((a) => a.userId));

      if (csv?.outcome.graph) {
        try {
          // 신규 As-Is 버전은 잠금 free — 체크아웃 획득 후 그래프 반영
          await acquireCheckout(created.versionId);
          await saveGraph(created.versionId, csv.outcome.graph);
        } catch (err) {
          // 맵은 이미 있다 — 목록만 갱신(성공 토스트 없이)하고 다이얼로그를 유지, Create 재클릭 시 저장만 재시도
          onCreated(true);
          setError(
            err instanceof Error
              ? `${t("csvImport.mapCreatedImportFailed")} — ${err.message}`
              : t("csvImport.mapCreatedImportFailed"),
          );
          setSubmitting(false);
          return;
        }
      }

      onCreated();
      onClose();
      if (onCreatedMap) {
        // 에디터 피커발 생성 — 현재 에디터에 남아 자동 링크 등 후속을 호출측이 잇는다
        onCreatedMap(created.mapId, trimmed);
      } else {
        router.push(`/maps/${created.mapId}`);
      }
    } catch (err) {
      if (createdRef.current !== null) {
        // 맵은 이미 생성됐다 — 목록을 갱신해 고아 맵을 보이게 하고(성공 토스트 없이),
        // 재클릭이 이어서 진행함을 알린다
        onCreated(true);
        setError(
          err instanceof Error
            ? `${t("perm.createDialog.partialFailure")} — ${err.message}`
            : t("perm.createDialog.partialFailure"),
        );
      } else {
        setError(err instanceof Error ? err.message : t("err.createMap"));
      }
      setSubmitting(false);
    }
  }, [currentUser, name, description, visibility, owningDept, collaborators, approvers, csv, word, onCreated, onClose, onCreatedMap, router, t]);

  // ── 버튼 활성 / button enabled ──
  const canCreate =
    currentUser !== null &&
    name.trim().length > 0 &&
    approvers.length >= 1 &&
    owningDept !== null &&
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
  // 오우닝 부서 소속원 — 파생 editor라 private 후보군에 포함 (org_path prefix, 서버 parity)
  const owningDeptMemberIds = owningDept
    ? dirUsers
        .filter((u) => {
          const p = u.org_path || (deptOrgPathByLeaf.get(u.department) ?? u.department);
          return p === owningDept.id || p.startsWith(`${owningDept.id}/`);
        })
        .map((u) => u.id)
    : [];
  const owningLeaderId =
    owningDept?.manager && userById.has(owningDept.manager) ? owningDept.manager : null;
  const approverEligibleIds = new Set<string>([
    ...(currentUser ? [currentUser.id] : []),
    ...collaborators.filter((c) => c.principalType === "user").map((c) => c.principalId),
    ...dirUsers.filter(inChosenDept).map((u) => u.id),
    ...groupMemberIds,
    ...owningDeptMemberIds,
    ...(owningLeaderId ? [owningLeaderId] : []),
  ]);
  const approverPickerUsers =
    visibility === "public"
      ? pickerUsers
      : pickerUsers.filter((u) => approverEligibleIds.has(u.id));

  const dialog = (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-start justify-center bg-ink/20 pt-4 backdrop-blur-sm"
    >
      {/* 상단 정렬(pt-4) — 폼이 길어 세로를 최대한 쓴다. max-h는 위아래 1rem씩만 비운다.
          내용이 다 들어가면 스크롤은 생기지 않는다(빈 패딩으로 스크롤을 만들지 않음). */}
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

        {/* 오우닝 부서(필수) — 선택 전 피커, 선택 후 잠금 표시 행 + X(재선택) */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-secondary">
            {t("perm.owningDept.label")}
          </label>
          {owningDept === null ? (
            <PrincipalPicker
              users={[]}
              departments={pickerDepts}
              groups={[]}
              excludeIds={new Set<string>()}
              deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
              myDeptsFirst
              onSelect={applyOwningDept}
            />
          ) : (
            <div
              data-id="owning-dept-selected"
              className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-2 py-1.5 text-caption text-ink"
            >
              <PrincipalIcon type="department" />
              <span className="min-w-0 flex-1 truncate">
                {owningDept.korean_name || owningDept.name}
                <span className="ml-1.5 text-fine text-ink-tertiary">{owningDept.id}</span>
              </span>
              <span
                title={t("perm.owningDept.lockedNote")}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary"
              >
                <LockKeyhole size={12} strokeWidth={1.5} />
                {t("perm.owningDept.lockedEditor")}
              </span>
              <button
                type="button"
                onClick={clearOwningDept}
                className="text-ink-tertiary hover:text-ink"
                aria-label={t("perm.removeButton")}
                disabled={submitting}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
          )}
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

        {/* CSV로 만들기 — 파일명 아코디언. 누르면 요약·경고를 펼친다. */}
        {csv && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              data-id="csv-file-accordion"
              aria-expanded={csvOpen}
              onClick={() => setCsvOpen((open) => !open)}
              className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-alt px-2.5 py-1.5 text-caption text-ink hover:bg-surface"
            >
              {csvOpen ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
              <FileUp size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="truncate">{csv.fileName}</span>
            </button>
            {csvOpen && (
              <div data-id="csv-file-summary" className="flex flex-col gap-1 rounded-sm border border-hairline px-3 py-2">
                <p className="text-caption text-ink-secondary">
                  {t("csvImport.createSummary", { nodes: csv.outcome.nodeCount, edges: csv.outcome.edgeCount })}
                </p>
                {csv.outcome.warnings.map((warn) => (
                  <p key={`${warn.line}-${warn.message}`} className="text-caption text-ink-tertiary">
                    {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Word 문서로 만들기 — 파일명 아코디언. 누르면 섹션 카탈로그 개수를 펼친다. */}
        {word && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              data-id="word-file-accordion"
              aria-expanded={wordOpen}
              onClick={() => setWordOpen((open) => !open)}
              className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-alt px-2.5 py-1.5 text-caption text-ink hover:bg-surface"
            >
              {wordOpen ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
              <FileUp size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="truncate">{word.docName}</span>
            </button>
            {wordOpen && (
              <div data-id="word-file-summary" className="flex flex-col gap-1 rounded-sm border border-hairline px-3 py-2">
                <p className="text-caption text-ink-secondary">
                  {word.sections.length} linkable section{word.sections.length === 1 ? "" : "s"} found.
                </p>
              </div>
            )}
          </div>
        )}

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
                deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
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
              {owningDept && (
                <li
                  data-id="owning-dept-locked-row"
                  className="flex shrink-0 items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-2 py-1 text-caption text-ink"
                >
                  <PrincipalIcon type="department" />
                  <span className="flex-1 truncate">
                    {owningDept.korean_name || owningDept.name}
                  </span>
                  <span
                    title={t("perm.owningDept.lockedNote")}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary"
                  >
                    <LockKeyhole size={12} strokeWidth={1.5} />
                    {t("perm.owningDept.lockedEditor")}
                  </span>
                </li>
              )}
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
              {/* 수동 추가한 협업자가 없을 때 회색 안내문구 — 박스 중앙. 오우닝 부서 잠금 행과 무관 */}
              {collaborators.length === 0 && (
                <li
                  data-id="collaborators-empty-hint"
                  className="flex flex-1 items-center justify-center px-2 text-center text-fine text-ink-tertiary"
                >
                  {t("perm.createDialog.collaboratorsEmpty")}
                </li>
              )}
          </ul>
          </div>
        </div>

        {/* 결재자 / approvers */}
        <div
          ref={approversRef}
          className={`flex flex-col gap-1.5 rounded-sm ${flashApprovers ? "motion-safe:animate-[picker-flash_800ms_var(--ease-smooth)]" : ""}`}
        >
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
            managersFirst
            pinnedIds={owningLeaderId ? new Set([owningLeaderId]) : undefined}
            onSelect={(opt) => {
              if (opt.principalType === "user") handleAddApprover(opt.principalId, opt.displayName);
            }}
          />
          {/* 결재자 pills — 1.5줄 높이 미리 확보·내부 스크롤(추가해도 모달 안 늘어남) / reserve ~1.5 rows. */}
          <div className="scroll-soft flex h-[2.5rem] flex-wrap content-start gap-1.5">
            {/* 결재자가 없을 때 회색 안내문구 — 박스 중앙 */}
            {approvers.length === 0 && (
              <span
                data-id="approvers-empty-hint"
                className="flex h-full w-full items-center justify-center text-center text-fine text-ink-tertiary"
              >
                {t("perm.createDialog.approversEmpty")}
              </span>
            )}
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
          {!canCreate && approvers.length === 0 && name.trim().length > 0 && owningDept !== null && (
            <p className="mr-auto text-fine text-error">
              {t("perm.createDialog.approversHint")}
            </p>
          )}
          {name.trim().length > 0 && owningDept === null && (
            <p className="mr-auto text-fine text-error">{t("perm.owningDept.requiredHint")}</p>
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
