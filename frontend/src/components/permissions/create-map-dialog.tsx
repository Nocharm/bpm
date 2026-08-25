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
import { X, Globe, Lock, ChevronDown, ChevronRight, FileUp, LockKeyhole, TriangleAlert, User as UserIcon } from "lucide-react";

import {
  acquireCheckout,
  addMapPermission,
  copyMap,
  createMap,
  getDirectory,
  getSubprocessUsage,
  listGroups,
  saveGraph,
  setApprovers as setMapApprovers,
  type DirectoryUser,
  type DirectoryDept,
  type Group,
  type SubprocessUsage,
  type VersionSummary,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
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
import { RolePopover } from "@/components/permissions/role-popover";
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
  /** Word 맵 승격 복사 — 지정 시 createMap 대신 copyMap(convertToNormal)으로 생성 (design 2026-07-24 §6). */
  promote?: { mapId: number; defaultName: string };
  /** 맵 복사 — 지정 시 copyMap으로 생성. 버전 선택·오너 알림 안내·원본 은퇴(retire) 지원 (copy workflow 재편). */
  copy?: {
    mapId: number;
    sourceName: string;
    versions: VersionSummary[];
    myRole: "viewer" | "editor" | "owner" | null;
    owningDepartment: string | null;
  };
}

// 복사 버전 드롭다운 표기 — 게시 번호(v3)·라벨·상태(상태 문자열은 영어 고정 규칙)
function formatVersionOption(v: VersionSummary): string {
  const number = v.version_number ? `v${v.version_number} · ` : "";
  return `${number}${v.label} · ${v.status}`;
}

export function CreateMapDialog({ onClose, onCreated, csv, word, initialName, onCreatedMap, promote, copy }: Props) {
  const { t, lang } = useI18n();
  const currentUser = useCurrentMockUser();

  // ── 실 디렉터리 + active 그룹 — 마운트 시 1회 조회 (Layer 4 Task 0/4) /
  // Real directory + active groups: fetch once on mount; fall back to empty arrays on error.
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  // 오우닝 부서(필수) — DirectoryDept 그대로 보관(id=org_path). 아래 마운트 이펙트(복사 프리필)가
  // setter를 참조하므로 이펙트보다 먼저 선언한다(react-hooks/immutability TDZ).
  const [owningDept, setOwningDept] = useState<DirectoryDept | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([getDirectory(), listGroups()])
      .then(([dir, groupRows]) => {
        if (active) {
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
          setGroups(groupRows);
          // 복사 모드 — 오우닝 부서를 원본 값으로 프리필(변경 가능). 직접 set: 스크롤/플래시 부수효과 없이.
          if (copy?.owningDepartment) {
            const inherited = dir.departments.find((d) => d.id === copy.owningDepartment);
            if (inherited) setOwningDept((prev) => prev ?? inherited);
          }
        }
      })
      .catch((err) => {
        // Fall back to empty arrays so pickers still render (create dialog has no onToast).
        console.warn("Directory/groups fetch failed; pickers will be empty.", err);
      });
    return () => { active = false; };
  }, [copy]);

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
  const pickerDepts: Department[] = dirDepts.map((d) => ({
    id: d.id,
    code: "",
    name: d.name,
    orgLevels: [],
    parentId: null,
    rawDn: "",
    korean_name: d.korean_name,
  }));

  // ── 폼 상태 / form state ──
  // CSV로 만들 때는 파일명(확장자 제외)을 이름·설명 기본값으로
  const csvBaseName = csv ? stripCsvExtension(csv.fileName) : "";
  // Word 문서로 만들 때는 문서명(확장자 제외)을 이름 기본값으로 — csvBaseName과 동일한 우선순위로 합류
  const wordBaseName = word ? word.docName.replace(/\.docx$/i, "") : "";
  const [name, setName] = useState(
    initialName ?? promote?.defaultName ?? (copy ? `${copy.sourceName} (Copy)` : csvBaseName || wordBaseName),
  );
  const [description, setDescription] = useState(csvBaseName);
  // ── 복사 모드 상태 — 원본 버전 선택 + 원본 은퇴(retire) + SP 사용처 확인 ──
  const copyVersions = copy ? [...copy.versions].sort((a, b) => b.id - a.id) : [];
  const [copyVersionId, setCopyVersionId] = useState<number | undefined>(() => {
    if (!copy) return undefined;
    const sorted = [...copy.versions].sort((a, b) => b.id - a.id);
    // 기본 = 최신 게시본 — 없으면(이론상 게이트로 차단) 최신 버전
    return (sorted.find((v) => v.status === "published") ?? sorted[0])?.id;
  });
  const [retire, setRetire] = useState(false);
  // SP 사용처 — retire 첫 체크 시 lazy fetch. null=미로드(로드 전 제출 차단)
  const [spUsage, setSpUsage] = useState<SubprocessUsage | null>(null);
  const [spOpen, setSpOpen] = useState(true); // 확인 체크가 아코디언 최하단이라 기본 펼침
  const [spConfirm, setSpConfirm] = useState(false);
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
  // 협업자 피커 wrapper — Enter 경로(좌표 없음) 폴백: 입력창 하단 기준으로 역할 팝오버를 띄운다 (T3, add-collaborator.tsx와 동일 패턴).
  const collabPickerWrapRef = useRef<HTMLDivElement>(null);
  // 클릭(또는 Enter)된 협업자 후보 — 역할 팝오버가 열린 동안의 로컬 의도. 역할 선택 시 로컬 append 후 소거.
  const [pendingPick, setPendingPick] = useState<{ option: PrincipalOption; x: number; y: number } | null>(
    null,
  );
  // 방금 추가된 협업자 행 — 해당 행에 플래시 강조(1.2s 후 자연 소멸, collaborators-panel.tsx의 lastAddedKey 패턴 재사용).
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 공개범위 변경 확인 대기 — 승인자 초기화 안내 모달용 / pending visibility change awaiting confirm.
  const [pendingVisibility, setPendingVisibility] = useState<MapVisibility | null>(null);
  const router = useRouter();
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

  // 방금 추가된 협업자 고스트 행을 화면 안으로 — 페이지 이탈 없이 "nearest"만 사용 (T3, collaborators-panel.tsx와 동일 패턴).
  useEffect(() => {
    if (!lastAddedKey) return;
    document.querySelector(`[data-id="create-collab-row-${lastAddedKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [lastAddedKey]);

  // 공개범위 적용 — 승인자 후보군이 바뀌므로(public=전원 열람) 이미 고른 승인자를 초기화.
  // plain 함수 — React Compiler 자동 메모(수동 useCallback이 setter 추론과 충돌).
  const applyVisibilityChange = (v: MapVisibility) => {
    setVisibility(v);
    // 후보군 변경 → 승인자 초기화.
    setApprovers([]);
    autoLeaderRef.current = null;
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

  // ── 협업자 추가 — 역할 팝오버에서 Viewer/Editor 선택 시 로컬 스테이징 리스트에 append(맵 생성 전, 서버 호출 없음) ──
  // (T3) 우측 role select 대신 클릭 위치 팝오버 2-step — add-collaborator.tsx의 RolePopover 공용.
  const addCollaborator = (opt: PrincipalOption, role: "viewer" | "editor") => {
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
    const addKey = `${opt.principalType}:${opt.principalId}`;
    setLastAddedKey(addKey);
    window.setTimeout(() => setLastAddedKey(null), 1200); // 플래시 애니메이션 후 리셋(재추가 시 재발화)
  };

  // 오우닝 부서 선택 — 리더를 승인자로 자동 추가(제거 가능), 이전 자동분은 교체
  const applyOwningDept = (opt: PrincipalOption) => {
    const dept = dirDepts.find((d) => d.id === opt.principalId);
    if (!dept) return;
    const removeId = autoLeaderRef.current;
    const kept = removeId ? approvers.filter((a) => a.userId !== removeId) : approvers;
    setApprovers(kept);
    autoLeaderRef.current = null;
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

  // ── 원본 은퇴 토글(복사 모드) — 체크 시 이름을 원본명으로 고정(B5) + SP 사용처 lazy 로드 ──
  const toggleRetire = (next: boolean) => {
    if (!copy) return;
    setRetire(next);
    setSpConfirm(false);
    if (next) {
      setName(copy.sourceName);
      if (spUsage === null) {
        getSubprocessUsage(copy.mapId)
          .then(setSpUsage)
          // 로드 실패 시 null 유지 → 제출 차단. 체크 해제 후 재체크로 재시도.
          .catch((err) => setError(humanizeApiError(err, t)));
      }
    }
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
        const detail = promote
          ? await copyMap(promote.mapId, trimmed, {
              convertToNormal: true,
              owningDepartment: owningDept.id,
            })
          : copy
            ? await copyMap(copy.mapId, trimmed, {
                versionId: copyVersionId,
                owningDepartment: owningDept.id,
                visibility,
                retireSource: retire,
              })
            : await createMap(
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
              ? `${t("csvImport.mapCreatedImportFailed")} - ${humanizeApiError(err, t)}`
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
            ? `${t("perm.createDialog.partialFailure")} - ${humanizeApiError(err, t)}`
            : t("perm.createDialog.partialFailure"),
        );
      } else {
        setError(humanizeApiError(err, t));
      }
      setSubmitting(false);
    }
  }, [currentUser, name, description, visibility, owningDept, collaborators, approvers, csv, word, promote, copy, copyVersionId, retire, onCreated, onClose, onCreatedMap, router, t]);

  // 복사+은퇴 시 SP 게이트 — 사용처 로드 전엔 차단, SP 지정 맵은 확인 체크 필수 (B4)
  const retireBlocked =
    retire && (spUsage === null || (spUsage.designated && !spConfirm));

  // ── 버튼 활성 / button enabled ──
  const canCreate =
    currentUser !== null &&
    name.trim().length > 0 &&
    approvers.length >= 1 &&
    owningDept !== null &&
    !submitting &&
    (!copy || copyVersionId !== undefined) &&
    !retireBlocked;

  // ── 부서 조회 맵 (사용자 ID → 부서명) / department lookup map for picker ──
  const userDepartments = Object.fromEntries(dirUsers.map((u) => [u.id, u.department]));

  // ── 협업자 picker 제외 목록 / collab picker exclude set ──
  const collabExcludeIds = new Set(
    collaborators.map((c) => c.principalId).concat(currentUser ? [currentUser.id] : []),
  );

  // ── 역할 팝오버에 표시할 후보 이름 — lang에 따라 한글/영문 주표시 전환 (add-collaborator.tsx와 동일 규칙) ──
  const pendingCollabName = pendingPick
    ? lang === "ko" && pendingPick.option.koreanName
      ? pendingPick.option.koreanName
      : pendingPick.option.displayName
    : "";

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
  // 오우닝 부서 리더 자동 핀 — DirectoryDept.manager 폐기로 상시 null (design 2026-08-11 §5 후속)
  const owningLeaderId: string | null = null;
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
          <h2 className="text-body-strong text-ink">
            {promote ? "Convert to process map" : copy ? t("home.copyTitle") : t("perm.createDialog.title")}
          </h2>
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
            data-id="create-map-name"
            className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-body text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
            placeholder={t("perm.createDialog.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            disabled={submitting || retire}
            autoFocus
          />
          {retire && (
            <p data-id="copy-name-locked-note" className="text-fine text-ink-tertiary">
              {t("copyDialog.nameLockedNote")}
            </p>
          )}
        </div>

        {/* 복사 원본 버전 — 전체 버전 최신순, 기본=최신 게시본. 비게시 버전 선택 시 안내 (B1) */}
        {copy && (
          <div className="flex flex-col gap-1">
            <label className="text-caption text-ink-secondary">{t("home.copyVersionLabel")}</label>
            <select
              data-id="copy-version-select"
              className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
              value={copyVersionId ?? ""}
              onChange={(e) => setCopyVersionId(Number(e.target.value))}
              disabled={submitting}
            >
              {copyVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {formatVersionOption(v)}
                </option>
              ))}
            </select>
            {copyVersions.find((v) => v.id === copyVersionId)?.status !== "published" && (
              <p data-id="copy-version-unpublished-note" className="flex items-center gap-1 text-fine text-changed">
                <TriangleAlert size={12} strokeWidth={1.5} />
                {t("copyDialog.versionNotPublished")}
              </p>
            )}
            <span className="text-fine text-ink-tertiary">{t("home.copyOpensDraft")}</span>
          </div>
        )}

        {/* 설명 / description — promote·copy 모드에선 원본 설명 상속(백엔드)이라 UI 숨김 */}
        {!promote && !copy && (
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
        )}

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
              deptTreeBrowse
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

        {/* 오너(사용자) — 복사자는 새 맵의 오너로 자동 부여(변경 불가) + 원본 오너 알림 안내 (B2·B3) */}
        {copy && (
          <div className="flex flex-col gap-1">
            <label className="text-caption text-ink-secondary">{t("home.owner")}</label>
            <div
              data-id="copy-owner-row"
              className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-2 py-1.5 text-caption text-ink"
            >
              <UserIcon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="min-w-0 flex-1 truncate">
                {currentUser?.name || currentUser?.id}
                {currentUser && (
                  <span className="ml-1.5 text-fine text-ink-tertiary">{currentUser.id}</span>
                )}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
                <LockKeyhole size={12} strokeWidth={1.5} />
                {t("copyDialog.ownerYou")}
              </span>
            </div>
            <p data-id="copy-notify-owner-note" className="text-fine text-ink-tertiary">
              {t("copyDialog.notifyOwnerNote")}
            </p>
          </div>
        )}

        {/* 공개 범위 / visibility — promote 모드는 항상 private 생성이라 숨김(copy는 선택 가능) */}
        {!promote && (
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
        )}

        {/* 원본 은퇴(오너 전용) — 복사 후 기존 맵 휴지통행. SP 지정 맵은 사용처 목록+확인 체크 (B4·B5) */}
        {copy && copy.myRole === "owner" && (
          <div className="flex flex-col gap-2 rounded-sm border border-hairline p-3">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                data-id="copy-retire-checkbox"
                className="mt-0.5 accent-[var(--color-accent)]"
                checked={retire}
                onChange={(e) => toggleRetire(e.target.checked)}
                disabled={submitting}
              />
              <span className="min-w-0">
                <span className="block text-caption text-ink">{t("copyDialog.retireCheckbox")}</span>
                <span className="block text-fine text-ink-tertiary">{t("copyDialog.retireHint")}</span>
              </span>
            </label>
            {retire && (
              <p data-id="copy-retire-notify-note" className="text-fine text-ink-tertiary">
                {t("copyDialog.retireNotifyNote")}
              </p>
            )}
            {retire && spUsage === null && (
              <p className="text-fine text-ink-tertiary">…</p>
            )}
            {retire && spUsage !== null && spUsage.designated && (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-start gap-1.5 text-fine text-changed">
                  <TriangleAlert size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                  {t("copyDialog.retireSpWarning")}
                </p>
                <button
                  type="button"
                  data-id="copy-retire-sp-accordion"
                  aria-expanded={spOpen}
                  onClick={() => setSpOpen((open) => !open)}
                  className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-alt px-2.5 py-1.5 text-caption text-ink hover:bg-surface"
                >
                  {spOpen ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
                  <span className="truncate">
                    {t("copyDialog.retireSpListTitle", {
                      n: spUsage.used_by.length + spUsage.hidden_count,
                    })}
                  </span>
                </button>
                {spOpen && (
                  <div className="flex flex-col gap-1 rounded-sm border border-hairline px-3 py-2">
                    <ul className="scroll-soft flex max-h-[7rem] flex-col gap-1 overflow-y-auto">
                      {spUsage.used_by.map((u) => (
                        <li
                          key={u.map_id}
                          data-id={`copy-retire-sp-row-${u.map_id}`}
                          className="flex items-center justify-between gap-2 text-caption text-ink-secondary"
                        >
                          <span className="min-w-0 truncate">{u.name}</span>
                          <span className="shrink-0 text-fine text-ink-tertiary">
                            {u.node_count} node{u.node_count === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                      {spUsage.hidden_count > 0 && (
                        <li className="text-fine text-ink-tertiary">
                          {t("copyDialog.retireSpHidden", { n: spUsage.hidden_count })}
                        </li>
                      )}
                      {spUsage.used_by.length === 0 && spUsage.hidden_count === 0 && (
                        <li className="text-fine text-ink-tertiary">{t("copyDialog.retireSpNone")}</li>
                      )}
                    </ul>
                    {/* 확인 체크 — 아코디언 최하단(B4) */}
                    <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-hairline pt-2">
                      <input
                        type="checkbox"
                        data-id="copy-retire-sp-confirm"
                        className="accent-[var(--color-accent)]"
                        checked={spConfirm}
                        onChange={(e) => setSpConfirm(e.target.checked)}
                        disabled={submitting}
                      />
                      <span className="text-fine text-ink">{t("copyDialog.retireSpConfirm")}</span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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

        {/* 초기 협업자 / initial collaborators — promote 모드에선 UI 숨김(설계: 2026-07-24-word-map-lifecycle-design.md §6) */}
        {!promote && (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-secondary">
              {t("perm.createDialog.collaboratorsLabel")}
            </span>
            {/* 목록을 피커 위로 표시(드롭다운이 아래로 열려도 실시간 추가가 안 가려지게) — col-reverse: DOM은 picker→list, 화면은 list 위 */}
            <div className="flex flex-col-reverse gap-1.5">
            {/* picker — 선택(클릭/Enter) 시 클릭 위치(또는 입력창 하단 폴백)에 역할 팝오버 2-step (T3, add-collaborator.tsx와 공용 RolePopover) */}
            <div ref={collabPickerWrapRef}>
              <PrincipalPicker
                users={pickerUsers}
                departments={pickerDepts}
                groups={toPickerGroups(groups)}
                excludeIds={collabExcludeIds}
                userDepartments={userDepartments}
                deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
                highlightId={
                  pendingPick ? `${pendingPick.option.principalType}:${pendingPick.option.principalId}` : null
                }
                onSelect={(opt, coords) => {
                  const fallback = collabPickerWrapRef.current?.getBoundingClientRect();
                  const { x, y } = coords ?? { x: fallback?.left ?? 0, y: fallback?.bottom ?? 0 };
                  setPendingPick({ option: opt, x, y });
                }}
              />
            </div>
            {pendingPick && (
              <RolePopover
                name={pendingCollabName}
                x={pendingPick.x}
                y={pendingPick.y}
                viewerGrantDisabled={visibility === "public"}
                onPick={(role) => {
                  addCollaborator(pendingPick.option, role);
                  setPendingPick(null);
                }}
                onCancel={() => setPendingPick(null)}
              />
            )}
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
                {collaborators.map((c) => {
                  const addKey = `${c.principalType}:${c.principalId}`;
                  return (
                  <li
                    key={c.key}
                    data-id={`create-collab-row-${addKey}`}
                    className={`animate-item-in flex shrink-0 items-center gap-2 rounded-sm border border-hairline px-2 py-1 text-caption text-ink ${
                      lastAddedKey === addKey ? "motion-safe:animate-[picker-flash_1200ms_ease-in-out]" : ""
                    }`}
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
                  );
                })}
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
        )}

        {/* 결재자 / approvers */}
        <div
          ref={approversRef}
          className={`flex flex-col gap-1.5 rounded-sm ${flashApprovers ? "motion-safe:animate-[picker-flash_1400ms_ease-in-out]" : ""}`}
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
            data-id="create-map-submit"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className="rounded-sm bg-accent px-4 py-1.5 text-caption text-surface hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "…" : copy ? t("home.copyFromApproved") : t("perm.createDialog.createBtn")}
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
