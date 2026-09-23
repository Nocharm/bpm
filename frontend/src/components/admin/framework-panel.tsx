"use client";

// 설정 Framework 탭 — 컨설턴트 업무 체계 카테고리 관리 트리(CRUD). 홈의 lib/framework-tree-state.ts는
// 맵 목록까지 함께 로드하는 브라우징 전용 캐시라 여기(뮤테이션 후 영향받는 노드를 전체 재조회)엔
// 그대로 맞지 않는다 — brief가 admin 전용 확장을 금지해 이 파일 안에 별도의 단순 상태를 둔다.
// 인터뷰 임포트 섹션(그리드 아래 전폭)은 클라이언트 JSON 파싱만 하고, 키/스키마 검증은 서버 어댑터
// dry-run(POST /categories/import-interview apply=false)이 진실 — 실제 저장은 apply 확인 후에만.
// 레이아웃(2026-09-22 설계): 좌 트리 : 우 선택 행 상세 패널(같은 340px). 행 액션 아이콘·인라인
// 관리자 표시는 상세 패널로 옮겼고, 아코디언 섹션 3종(AdminSection)은 폐기했다.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  FileJson,
  FolderPlus,
  FolderTree,
  Headset,
  Loader2,
  Move as MoveIcon,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  createCategory,
  createFrameworkInterview,
  deleteCategory,
  getApiErrorDetail,
  getCategoryChain,
  getDirectory,
  importInterview,
  listAllCategories,
  listCategoryNodes,
  listAllCategoryPermissions,
  listCategoryPermissions,
  listFrameworkInterviews,
  listGroups,
  setCategoryPermissions,
  updateCategory,
  type CategoryLite,
  type CategoryNode,
  type CategoryPermissionEntry,
  type CategoryPermissionRow,
  type DirectoryUser,
  type FwInterviewSession,
  type Group,
  type InterviewImportResult,
} from "@/lib/api";
import { canManageInScope } from "@/lib/framework-admin-scope";
import { CANVAS_STATE_LABEL_EN, getCanvasState } from "@/lib/framework-drill";
import { parseInterviewFile } from "@/lib/framework-import-parse";
import { useI18n } from "@/lib/i18n";
import type { InterviewPromptTarget } from "@/lib/interview-json-prompt";
import {
  buildImportReportView,
  buildInterviewIndex,
  governanceKey,
  parseGovernanceKey,
} from "@/lib/interview-report";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";
import { CountTag } from "@/components/maps/count-tag";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CategoryDeptModal } from "@/components/admin/category-dept-modal";
import { FrameworkOverview } from "@/components/admin/framework-overview";
import { FwLevelActions } from "@/components/admin/fw-level-actions";
import { findDuplicateSibling } from "@/lib/fw-level-actions";
import { InterviewJsonPromptButton } from "@/components/framework-interview/interview-json-prompt-button";
import { InterviewImportReport, type InterviewPhase } from "@/components/admin/import-report/interview-import-report";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalIcon, PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { Highlight } from "@/components/highlight";
import { LevelPill } from "@/components/level-pill";
import { PromptDialog } from "@/components/prompt-dialog";
import { Tooltip } from "@/components/tooltip";
import { filterByQuery } from "@/lib/search";
import { getTreeIndentStyle, TREE_INDENT_PADDING_CLASS } from "@/lib/tree-indent";
import { useSectionMotion } from "@/lib/use-closing-keys";

const MAX_CATEGORY_LEVEL = 5; // backend MAX_CATEGORY_LEVEL과 동기 — 이 미만 레벨에서만 자식 추가 허용

// 상세 패널 액션 버튼(아이콘+라벨) — 불가한 액션도 숨기지 않고 비활성 + title로 이유를 남긴다
const DETAIL_ACTION_BTN =
  "inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface px-2 py-1 " +
  "text-fine text-ink-secondary hover:bg-surface-alt disabled:opacity-40";

const IMPORT_FILE_BTN =
  "inline-flex items-center gap-1.5 truncate rounded-sm border border-hairline bg-surface px-2.5 py-1.5 " +
  "text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

// 인터뷰 임포트 스트립 · AI L5 블록의 보조 버튼 — 테두리 없는 컴팩트 액션
const STRIP_BTN =
  "shrink-0 rounded-sm px-2 py-1 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-accent disabled:opacity-40";

// 상세 정보 줄의 최대 노출 관리자 수 — 초과분은 +n 배지 툴팁으로
const DETAIL_ADMIN_MAX = 3;

interface InterviewFileState {
  name: string;
  content: unknown; // 파싱 실패 시 null — error와 함께
  error?: string;
}

interface FrameworkPanelProps {
  onToast: (message: string) => void;
  // 카테고리 관리자 위임 스코프 — seed 카테고리 id들. undefined=sysadmin(전체) (Track C Task 6)
  scopeRootIds?: number[];
}

// 스코프 모드 루트 시딩 — /chain 응답의 map_count는 소비처(캐스케이드 셀렉트) 사정으로 0 고정
// (categories.py get_category_chain 주석)이라 트리 행에 그대로 못 쓴다. chain으로 부모 id만
// 얻고 그 부모의 /nodes 목록에서 seed id를 찾아 정확한 map_count·child_count를 가져온다.
async function loadScopedRoots(ids: number[]): Promise<CategoryNode[]> {
  const nodes = await Promise.all(
    ids.map(async (id) => {
      const chain = await getCategoryChain(id);
      const parentId = chain.length >= 2 ? chain[chain.length - 2].id : undefined;
      const siblings = await listCategoryNodes(parentId);
      return siblings.find((n) => n.id === id) ?? null;
    }),
  );
  return nodes.filter((n): n is CategoryNode => n !== null);
}

// 권한자 이름 표기 — 언어 기준 주 이름 + 괄호 보조 이름(person-hover-card 규칙의 한 줄 판).
// ko: 한글명(영문명) · en: 영문명(한글명). 한글명 없으면 영문 단독, 디렉터리 미등록은 login id.
function formatAdminName(found: DirectoryUser | undefined, fallback: string, lang: string): string {
  if (!found) return fallback;
  const en = found.name;
  const ko = found.korean_name ?? "";
  const primary = lang === "ko" ? ko || en : en;
  const secondary = lang === "ko" ? (ko ? en : "") : ko;
  return secondary ? `${primary}(${secondary})` : primary;
}

// PromptDialog 하나를 3용도(최상위 추가/하위 추가/이름변경)로 재사용 — 구현 단순화(brief §3).
type NamePrompt =
  | { kind: "add-root" }
  | { kind: "add-child"; parentId: number }
  // L4 타일에서 새 L5 — 만든 뒤 바로 AI 캠페인 세션을 연다
  | { kind: "add-l5"; parentId: number }
  | { kind: "rename"; id: number; currentName: string };

export function FrameworkPanel({ onToast, scopeRootIds }: FrameworkPanelProps) {
  const { t, lang } = useI18n();
  const router = useRouter();
  // Manage(트리+임포트) ↔ Status(배치 현황판) 세그먼트 — 홈 뷰 토글(home-view-toggle) 스타일 복제 (Track C Task 7)
  const [panelView, setPanelView] = useState<"manage" | "status">("manage");
  const [childrenByParent, setChildrenByParent] = useState<Map<number | null, CategoryNode[]>>(
    new Map(),
  );
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [rootLoading, setRootLoading] = useState(true);
  const [rootError, setRootError] = useState(false);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [movingNode, setMovingNode] = useState<CategoryNode | null>(null);
  // L5 연계 캔버스 권한자 관리 — 모든 레벨에서 부여 가능(하향 상속) (design 2026-08-28 §3)
  const [permsNode, setPermsNode] = useState<CategoryNode | null>(null);
  // 관리 부서 지정 모달(B안 2026-09-21) — 권한과 별개 속성, 하위 상속
  const [deptNode, setDeptNode] = useState<CategoryNode | null>(null);
  const [deletingNode, setDeletingNode] = useState<CategoryNode | null>(null);
  // 트리 행 인라인 권한자 표시 재료 — 권한자 행 일괄 + 표시명 색인(디렉터리/그룹) (2026-09-02 요청)
  const [permRows, setPermRows] = useState<CategoryPermissionRow[]>([]);
  const [permDirUsers, setPermDirUsers] = useState<DirectoryUser[]>([]);
  const [permGroups, setPermGroups] = useState<Group[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // 인터뷰 임포트 섹션 — 다중 파일, 파일별 키 검증 리포트는 서버 어댑터 dry-run이 진실 (design 2026-08-18 §6)
  const interviewInputRef = useRef<HTMLInputElement>(null);
  const [interviewFiles, setInterviewFiles] = useState<InterviewFileState[]>([]);
  const [interviewResult, setInterviewResult] = useState<InterviewImportResult | null>(null);
  // 진행 단계 — dryrun/apply 동안 버튼 비활성, 리포트 영역은 단계별 레이어(드라이런 중 링·적용 중 스피너)
  const [interviewPhase, setInterviewPhase] = useState<InterviewPhase>(null);
  const interviewBusy = interviewPhase !== null;
  // 거버넌스 체크 키(`code:field`) — dry-run 결과마다 비우고, 파일 변경 시 리포트와 함께 무효화 (spec 2026-09-03 §6)
  const [governanceChecked, setGovernanceChecked] = useState<Set<string>>(new Set());

  // 선택 행 — id만 상태로 두고 노드는 childrenByParent에서 찾는다(이름변경·이동 후 갱신 반영,
  // 삭제로 트리에서 사라지면 자동으로 선택 해제).
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // AI 컨설턴트 L5 캠페인 진입 — sysadmin 전용(인터뷰 임포트와 같은 게이트). 대상은 트리에서 고른
  // 행이다: L5면 그 L5를 채우고, L4면 이름 모달로 새 L5를 만든 뒤 시작한다(FwLevelActions 타일).
  const [consultBusy, setConsultBusy] = useState(false);
  // 이름 모달의 현재 입력 — 형제 이름 중복을 즉시 판정해 모달 안 error로 돌려준다
  const [nameDraft, setNameDraft] = useState("");
  const [activeSessions, setActiveSessions] = useState<FwInterviewSession[]>([]);
  // 관리 트리 검색용 전 카테고리 경량 목록(sysadmin) — 탐색 모달과 같은 클라이언트 필터
  const [allCategories, setAllCategories] = useState<CategoryLite[]>([]);
  useEffect(() => {
    if (scopeRootIds) return;
    listFrameworkInterviews(true).then(setActiveSessions).catch((err) => console.warn("fw sessions", err));
    listAllCategories().then(setAllCategories).catch((err) => console.warn("fw categories", err));
  }, [scopeRootIds]);
  // 선택 노드 파생 — 로드된 모든 가지에서 id로 찾는다. 못 찾으면(삭제·접힘 후 재구성) null.
  const selectedNode = useMemo(() => {
    if (selectedId === null) return null;
    for (const list of childrenByParent.values()) {
      const found = list.find((n) => n.id === selectedId);
      if (found) return found;
    }
    return null;
  }, [childrenByParent, selectedId]);
  const consultL5Id = selectedNode?.level === 5 ? selectedNode.id : null;

  // 외부 AI 프롬프트 버튼용 target — code(L5 상세)는 chain 조회가 필요해 선택 시점에만 지연 로드.
  // fetch 결과를 id와 함께 캐시하고 렌더에서 매칭 — id가 null/변경된 프레임엔 effect가 setState하지
  // 않도록(react-hooks/set-state-in-effect) 값을 파생으로 계산한다.
  const [fetchedTarget, setFetchedTarget] = useState<{ id: number; target: InterviewPromptTarget } | null>(null);
  useEffect(() => {
    if (!consultL5Id) return undefined;
    let active = true;
    getCategoryChain(consultL5Id)
      .then((chain) => {
        if (!active || chain.length === 0) return;
        const self = chain[chain.length - 1];
        setFetchedTarget({
          id: consultL5Id,
          target: { code: self.code, name: self.name, path: chain.slice(0, -1).map((c) => c.name) },
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [consultL5Id]);
  const consultTarget = fetchedTarget?.id === consultL5Id ? fetchedTarget.target : undefined;

  // 캠페인 시작 — 선택한 L5로 세션을 연다. 새 L5 생성은 handleNameSubmit(add-l5)이 맡는다.
  async function handleStartConsult(l5Id: number) {
    setConsultBusy(true);
    try {
      const session = await createFrameworkInterview({ category_id: l5Id, lang });
      router.push(`/framework/consult/${session.id}`);
    } catch (err) {
      // 409 = 진행 중 세션 존재 → 목록에서 재개하도록 안내
      onToast(getApiErrorDetail(err));
      listFrameworkInterviews(true).then(setActiveSessions).catch(() => undefined);
    } finally {
      setConsultBusy(false);
    }
  }

  // 선택 노드가 L1~3이면 자식을 미리 받아 둔다 — 상세 패널의 하위 타일(FwLevelActions)이 트리 펼침과
  // 무관하게 보여야 한다. 트리 펼침(handleToggle)과 같은 Map에 넣으므로 이중 로드는 없고,
  // "로딩 중"은 별도 상태 없이 Map에 아직 없음으로 파생한다(effect 안 동기 setState 회피).
  const selectedLevel = selectedNode?.level ?? null;
  useEffect(() => {
    if (selectedId === null || selectedLevel === null || selectedLevel > 3) return undefined;
    if (childrenByParent.has(selectedId)) return undefined;
    let active = true;
    listCategoryNodes(selectedId)
      .then((nodes) => {
        if (active) setChildrenByParent((prev) => new Map(prev).set(selectedId, nodes));
      })
      .catch((err: unknown) => onToast(getApiErrorDetail(err)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedId·selectedLevel만 본다: Map 참조를 deps에 두면 로드 완료마다 재실행
  }, [selectedId, selectedLevel]);

  // 펼침 집합 ref 미러 — refreshTree가 effect deps 없이 최신 openIds를 읽기 위함(react-ts-patterns.md #2).
  const openIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    openIdsRef.current = openIds;
  }, [openIds]);

  useEffect(() => {
    let active = true;
    void (scopeRootIds ? loadScopedRoots(scopeRootIds) : listCategoryNodes())
      .then((nodes) => {
        if (active) {
          setChildrenByParent((prev) => new Map(prev).set(null, nodes));
          setRootLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setRootError(true);
          setRootLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [scopeRootIds]);

  // 인라인 권한자 로드 — 실패해도 트리 자체는 정상(표시만 생략).
  // 마운트 effect 인라인 + 핸들러 중복은 이 파일의 기존 관례(handleRetryRoot) — ref 미러는 react-hooks/refs 위반.
  function reloadPermRows() {
    void Promise.all([listAllCategoryPermissions(), getDirectory(), listGroups()])
      .then(([perms, dir, groupRows]) => {
        setPermRows(perms.rows);
        setPermDirUsers(dir.users);
        setPermGroups(groupRows);
      })
      .catch(() => {});
  }
  useEffect(() => {
    let active = true;
    void Promise.all([listAllCategoryPermissions(), getDirectory(), listGroups()])
      .then(([perms, dir, groupRows]) => {
        if (!active) return;
        setPermRows(perms.rows);
        setPermDirUsers(dir.users);
        setPermGroups(groupRows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function handleRetryRoot() {
    setRootError(false);
    setRootLoading(true);
    void (scopeRootIds ? loadScopedRoots(scopeRootIds) : listCategoryNodes())
      .then((nodes) => {
        setChildrenByParent((prev) => new Map(prev).set(null, nodes));
        setRootLoading(false);
      })
      .catch(() => {
        setRootError(true);
        setRootLoading(false);
      });
  }

  // 뮤테이션(생성/이름변경/이동/삭제) 후 전체 리프레시 — 루트 + 현재 펼쳐진 모든 노드를 재조회.
  // extraOpenIds: 자식 추가 직후 부모 자동펼침처럼 openIds state가 아직 커밋되지 않은 시점에도
  // 함께 새로고침해야 하는 id(같은 핸들러 안에서 setOpenIds 직후 바로 호출되므로 ref 미러가 못 따라옴).
  async function refreshTree(extraOpenIds: number[] = []): Promise<void> {
    const openList = [...new Set([...openIdsRef.current, ...extraOpenIds])];
    const [rootNodes, ...childLists] = await Promise.all([
      scopeRootIds ? loadScopedRoots(scopeRootIds) : listCategoryNodes(),
      ...openList.map((id) => listCategoryNodes(id)),
    ]);
    // prev를 베이스로 병합하지 않는다 — 병합하면 지금은 접혀 있어 재조회 대상에서 빠진(하지만
    // 예전에 펼쳤던) 노드의 자식 목록이 캐시에 영원히 남아, 웹 임포트로 그 아래 자식이 추가돼도
    // 재펼침 시 임포트 이전 목록이 그대로 보인다. 재조회한 것(루트+현재 펼친 id)만으로 새로
    // 구성해 접힌 가지는 다음 펼침에서 다시 fetch되게 한다(handleToggle의 !has(id) 가드).
    const next = new Map<number | null, CategoryNode[]>();
    next.set(null, rootNodes);
    openList.forEach((id, i) => next.set(id, childLists[i]));
    setChildrenByParent(next);
  }

  // 인터뷰 파일 선택 — 다중 append(재선택으로 누적), 파싱 실패 파일은 error 표시만 하고 payload에서 제외.
  async function handleInterviewFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: InterviewFileState[] = [];
    for (const file of Array.from(files)) {
      const text = await file.text();
      next.push({ name: file.name, ...parseInterviewFile(text) });
    }
    setInterviewFiles((prev) => [...prev, ...next]);
    setInterviewResult(null);
    setGovernanceChecked(new Set());
  }

  function handleRemoveInterviewFile(index: number) {
    setInterviewFiles((prev) => prev.filter((_, i) => i !== index));
    setInterviewResult(null);
    setGovernanceChecked(new Set());
  }

  function getInterviewPayloadFiles() {
    return interviewFiles
      .filter((file) => !file.error)
      .map((file) => ({ name: file.name, content: file.content }));
  }

  async function handleInterviewDryRun() {
    setInterviewPhase("dryrun");
    try {
      const result = await importInterview({ files: getInterviewPayloadFiles(), apply: false });
      setInterviewResult(result);
      // 기본 체크는 서버가 정한다 — 임포트 노트 교체는 사람이 고친 게 없으면 체크(현행), 거버넌스 3종은 해제
      setGovernanceChecked(new Set(result.governance.filter((d) => d.default_checked).map(governanceKey)));
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setInterviewPhase(null);
    }
  }

  async function handleInterviewApply() {
    if (!interviewResult) return;
    setInterviewPhase("apply");
    try {
      const result = await importInterview({
        files: getInterviewPayloadFiles(),
        apply: true,
        decisions: [...governanceChecked].map(parseGovernanceKey),
      });
      setInterviewResult(result);
      setGovernanceChecked(new Set());
      await refreshTree();
      onToast(t("framework.importApplySuccess"));
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setInterviewPhase(null);
    }
  }

  function handleClearInterviewFiles() {
    setInterviewFiles([]);
    setInterviewResult(null);
    setGovernanceChecked(new Set());
  }

  function toggleGovernance(key: string) {
    setGovernanceChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllGovernance(next: boolean) {
    setGovernanceChecked(
      next && interviewResult ? new Set(interviewResult.governance.map(governanceKey)) : new Set(),
    );
  }

  // 펼침/접힘 모션 — 탐색 모달의 계단식과 같은 accordion(사용자가 연 노드만 open 애니, 검색 자동 펼침은 static)
  const { closingKeys, getSectionClass, openSection, closeSection } = useSectionMotion<number>();

  function handleToggle(id: number) {
    const wasOpen = openIds.has(id);
    if (wasOpen) closeSection(id);
    else openSection(id, true);
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!childrenByParent.has(id)) {
      void listCategoryNodes(id).then((nodes) => {
        setChildrenByParent((prev) => new Map(prev).set(id, nodes));
      });
    }
  }

  // 관리 트리 검색 — 히트를 누르면 조상 체인을 펼치고 그 행을 잠깐 강조한다(탐색 모달의 결과→이동과 같은 동작)
  const [treeQuery, setTreeQuery] = useState("");
  const [flashId, setFlashId] = useState<number | null>(null);
  const treeHits = useMemo(() => {
    const q = treeQuery.trim();
    if (q === "" || allCategories.length === 0) return null;
    return filterByQuery(allCategories, q, (c) => [{ field: "name", text: c.name }]).slice(0, 60);
  }, [allCategories, treeQuery]);
  const liteById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);
  const pathOfLite = (c: CategoryLite): string => {
    const parts: string[] = [];
    for (let cur = c.parent_id === null ? undefined : liteById.get(c.parent_id); cur; cur = cur.parent_id === null ? undefined : liteById.get(cur.parent_id)) {
      parts.unshift(cur.name);
    }
    return parts.join(" › ");
  };
  async function revealCategory(id: number) {
    const chain = await getCategoryChain(id);
    const ancestorIds = chain.slice(0, -1).map((c) => c.id);
    const missing = ancestorIds.filter((a) => !childrenByParent.has(a));
    const loaded = await Promise.all(missing.map((a) => listCategoryNodes(a)));
    setChildrenByParent((prev) => {
      const next = new Map(prev);
      missing.forEach((a, i) => next.set(a, loaded[i]));
      return next;
    });
    ancestorIds.forEach((a) => openSection(a, false));
    setOpenIds((prev) => new Set([...prev, ...ancestorIds]));
    setTreeQuery("");
    setSelectedId(id);
    setFlashId(id);
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600);
    window.setTimeout(() => document.querySelector(`[data-id="framework-admin-node-${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }

  // 이름 프롬프트 제출 — 먼저 닫고 실패는 토스트로만(더블클릭 재제출 방지, versions-publish-panel.tsx
  // submitReject와 동일 컨벤션: 다이얼로그를 계속 열어두지 않는다).
  function handleNameSubmit(prompt: NamePrompt, name: string) {
    setNamePrompt(null);
    void (async () => {
      try {
        if (prompt.kind === "add-root") {
          await createCategory({ name, parent_id: null });
          await refreshTree();
        } else if (prompt.kind === "add-child") {
          await createCategory({ name, parent_id: prompt.parentId });
          setOpenIds((prev) => new Set(prev).add(prompt.parentId));
          await refreshTree([prompt.parentId]);
        } else if (prompt.kind === "add-l5") {
          // 새 L5를 고른 L4 아래 만들고 그 id로 캠페인 세션을 연다 — 관리 트리도 그 가지를 새로고침
          setConsultBusy(true);
          const created = await createCategory({ name, parent_id: prompt.parentId });
          setOpenIds((prev) => new Set(prev).add(prompt.parentId));
          await refreshTree([prompt.parentId]);
          const session = await createFrameworkInterview({ category_id: created.id, lang });
          router.push(`/framework/consult/${session.id}`);
          return;
        } else {
          await updateCategory(prompt.id, { name });
          await refreshTree();
        }
        onToast(
          prompt.kind === "rename" ? t("framework.adminRenamed") : t("framework.adminCreated"),
        );
      } catch (err) {
        onToast(getApiErrorDetail(err));
        setConsultBusy(false);
      }
    })();
  }

  function openDelete(node: CategoryNode) {
    setDeleteError(null);
    setDeletingNode(node);
  }

  async function handleDelete() {
    if (!deletingNode) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteCategory(deletingNode.id);
      setDeletingNode(null);
      await refreshTree();
      onToast(t("framework.adminDeleted"));
    } catch (err) {
      // 서버 409(자식/맵 카운트)를 다이얼로그 안에 표시 — 왜 삭제가 막혔는지 사용자가 바로 알 수 있게.
      setDeleteError(getApiErrorDetail(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  // 상세 패널 권한자 — 그 카테고리에 직접 붙은 행만(하향 상속은 권한 모달 안내 문구가 담당).
  const permNamesByCategory = useMemo(() => {
    const byId = new Map<number, string[]>();
    for (const row of permRows) {
      let name: string;
      if (row.principal_type === "group") {
        name = permGroups.find((g) => String(g.id) === row.principal_id)?.name ?? row.principal_id;
      } else {
        const found = permDirUsers.find((u) => u.id === row.principal_id);
        name = formatAdminName(found, row.principal_id, lang);
      }
      const list = byId.get(row.category_id);
      if (list) list.push(name);
      else byId.set(row.category_id, [name]);
    }
    return byId;
  }, [permRows, permDirUsers, permGroups, lang]);

  // 계단식 스타일(탐색 모달과 동일 규칙): data-tree-* 훅 + 가이드 라인 + 레벨 필 + accordion 모션.
  // 행은 선택 전용 — 액션·관리자 표시는 우측 상세 패널이 맡는다(2026-09-22 설계).
  const renderNode = (node: CategoryNode, depth: number): ReactNode => {
    const open = openIds.has(node.id);
    const children = childrenByParent.get(node.id);
    const canExpand = node.level < MAX_CATEGORY_LEVEL;
    const showKids = (open || closingKeys.has(node.id)) && children !== undefined && children.length > 0;
    const flashing = flashId === node.id;
    const selected = selectedId === node.id;
    return (
      <li key={node.id} data-tree-node className="flex flex-col">
        <div
          data-tree-head
          data-id={`framework-admin-node-${node.id}`}
          aria-current={selected ? "true" : undefined}
          style={getTreeIndentStyle(depth)}
          className={`group relative flex items-center gap-1 rounded-sm transition-colors duration-350 ${
            selected ? "bg-accent-tint" : flashing ? "bg-accent-tint" : "hover:bg-divider"
          }`}
        >
          <button
            type="button"
            aria-expanded={canExpand ? open : undefined}
            aria-label={canExpand ? (open ? "collapse" : "expand") : undefined}
            disabled={!canExpand}
            onClick={() => handleToggle(node.id)}
            className={`inline-flex h-7 w-6 shrink-0 items-center justify-center text-ink-tertiary disabled:opacity-0 ${TREE_INDENT_PADDING_CLASS}`}
          >
            <ChevronRight size={12} strokeWidth={1.5} className={`motion-safe:transition-transform motion-safe:duration-150 ease-smooth ${open ? "rotate-90" : ""}`} />
          </button>
          <button
            type="button"
            data-id={`framework-admin-pick-${node.id}`}
            onClick={() => {
              setSelectedId(node.id);
              // 드릴인은 덤 — 이미 펼쳐진 가지를 선택만으로 접어버리면 위치를 잃는다
              if (canExpand && !open) handleToggle(node.id);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left"
          >
            <LevelPill level={node.level} size="sm" />
            <span data-tree-name="" className="min-w-0 truncate text-fine text-ink-secondary group-hover:text-ink">{node.name}</span>
            <span className="shrink-0 text-fine text-ink-muted">{node.code}</span>
            {/* 우측 숫자 묶음을 하나의 ml-auto 그룹으로 — CountTag의 ml-auto와 나뉘면 열이 행마다 어긋난다 */}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {/* L5 개수는 L4 행에만 — 상위 롤업은 소음(사용자 지시 2026-09-22) */}
              {node.level === 4 && (
                <span className="text-fine text-ink-muted">{t("category.summary.l5Count", { n: node.l5_count })}</span>
              )}
              {/* 접힌 행에만 — 펼치면 하위 행이 다 보여 롤업 숫자가 중복(count-tag.tsx 계약) */}
              {!open && <CountTag count={node.map_count} />}
            </span>
          </button>
        </div>
        {open && children === undefined && (
          <p style={getTreeIndentStyle(depth + 1)} className={`text-fine text-ink-tertiary ${TREE_INDENT_PADDING_CLASS}`}>
            {t("common.loading")}
          </p>
        )}
        {showKids && (
          <div className={getSectionClass(node.id)}>
            <ul className="ml-3 flex flex-col border-l border-divider pl-1">{children.map((c) => renderNode(c, depth + 1))}</ul>
          </div>
        )}
      </li>
    );
  };

  const roots = childrenByParent.get(null) ?? [];
  // 스코프 모드의 roots는 항상 seed 노드 자신 — 임명 버튼 게이팅 기준 최소 레벨 (Track C Task 6)
  const minSeedLevel = scopeRootIds ? Math.min(...roots.map((r) => r.level)) : undefined;

  // 리포트 뷰모델 — 맵 이름·카테고리 경로는 업로드한 JSON에서만 나온다(서버 rows는 코드만 싣는다).
  // 파일 목록이 바뀌면 결과를 지우므로(handleInterviewFiles/RemoveFile) 둘은 항상 같은 전달분이다.
  const interviewPayloadFiles = useMemo(
    () => interviewFiles.filter((f) => !f.error).map((f) => ({ name: f.name, content: f.content })),
    [interviewFiles],
  );
  const interviewIndex = useMemo(() => buildInterviewIndex(interviewPayloadFiles), [interviewPayloadFiles]);
  const interviewView = useMemo(
    () =>
      interviewResult ? buildImportReportView(interviewResult.rows, interviewIndex, interviewResult.files) : null,
    [interviewResult, interviewIndex],
  );

  // ── 상세 패널 재료 ──
  const detailAdmins = selectedNode ? (permNamesByCategory.get(selectedNode.id) ?? []) : [];
  const noSelectionReason = t("framework.adminDetailEmpty");
  const scopeReason = t("framework.adminScopeDenied");
  // 액션 6종 고정 순서 — 불가해도 렌더하고 title에 이유를 남긴다(숨기면 왜 없는지 알 수 없다)
  const detailActions: {
    key: string;
    icon: ReactNode;
    label: string;
    reason?: string;
    onClick: (node: CategoryNode) => void;
  }[] = [
    {
      key: "add",
      icon: <FolderPlus size={14} strokeWidth={1.5} />,
      label: t("framework.adminAddChild"),
      reason: !selectedNode
        ? noSelectionReason
        : selectedNode.level >= MAX_CATEGORY_LEVEL
          ? t("framework.adminAddMaxDepth")
          : undefined,
      onClick: (node) => setNamePrompt({ kind: "add-child", parentId: node.id }),
    },
    {
      key: "rename",
      icon: <Pencil size={14} strokeWidth={1.5} />,
      label: t("framework.adminRename"),
      reason: selectedNode ? undefined : noSelectionReason,
      onClick: (node) => setNamePrompt({ kind: "rename", id: node.id, currentName: node.name }),
    },
    {
      key: "dept",
      icon: <Building2 size={14} strokeWidth={1.5} />,
      label: t("framework.adminDept"),
      reason: selectedNode ? undefined : noSelectionReason,
      onClick: (node) => setDeptNode(node),
    },
    {
      key: "perms",
      icon: <ShieldCheck size={14} strokeWidth={1.5} />,
      label: t("framework.adminPerms"),
      reason: !selectedNode
        ? noSelectionReason
        : canManageInScope(selectedNode, "perms", scopeRootIds, minSeedLevel)
          ? undefined
          : scopeReason,
      onClick: (node) => setPermsNode(node),
    },
    {
      key: "move",
      icon: <MoveIcon size={14} strokeWidth={1.5} />,
      label: t("framework.adminMove"),
      reason: !selectedNode
        ? noSelectionReason
        : canManageInScope(selectedNode, "move", scopeRootIds, minSeedLevel)
          ? undefined
          : scopeReason,
      onClick: (node) => setMovingNode(node),
    },
    {
      key: "delete",
      icon: <Trash2 size={14} strokeWidth={1.5} />,
      label: t("framework.adminDelete"),
      reason: !selectedNode
        ? noSelectionReason
        : canManageInScope(selectedNode, "delete", scopeRootIds, minSeedLevel)
          ? undefined
          : scopeReason,
      onClick: (node) => openDelete(node),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-id="framework-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-body-strong text-ink">{t("framework.adminTab")}</h2>
          <p className="pt-1 text-caption text-ink-tertiary">{t("framework.adminReimportHint")}</p>
        </div>
        {/* 루트 카테고리 생성은 sysadmin 전용 — 위임 스코프는 자기 서브트리 밖에 새 루트를 못 만든다 */}
        {!scopeRootIds && (
          <button
            type="button"
            data-id="framework-admin-add-root"
            className="flex shrink-0 items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
            onClick={() => setNamePrompt({ kind: "add-root" })}
          >
            <Plus size={14} strokeWidth={1.5} />
            {t("framework.adminAddRoot")}
          </button>
        )}
      </div>

      {/* 뷰 토글 — Manage(트리+임포트) ↔ Status(배치 현황판). 홈 home-view-toggle과 동일 스타일 */}
      <div
        data-id="framework-view-toggle"
        className="flex shrink-0 items-center gap-0.5 self-start rounded-sm border border-hairline bg-surface p-0.5"
      >
        {(["manage", "status"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={panelView === v}
            className={`rounded-sm px-2.5 py-1 text-caption transition-colors ${
              panelView === v
                ? "bg-accent-tint text-accent"
                : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            }`}
            onClick={() => setPanelView(v)}
          >
            {t(v === "manage" ? "framework.viewManage" : "framework.viewStatus")}
          </button>
        ))}
      </div>

      {panelView === "status" ? (
        <FrameworkOverview />
      ) : (
        <>
      {/* 복수열 — 좌: 카테고리 트리, 우: 선택 행 상세 패널(같은 높이). 임포트 스트립·리포트는 그리드 아래 전폭 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-id="framework-manage-grid">
      {/* 트리는 검색 상자 + 10행(28px)만 보이는 340px 상자 안에서 내부 스크롤 — 더 길 필요 없다는 사용자 지시 2026-09-22 */}
      <div data-id="framework-admin-tree" className="fw-tree scroll-soft h-[340px] overflow-y-auto rounded-md border border-hairline p-2">
        {!scopeRootIds && (
          <label className="mb-2 flex min-w-0 items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-caption text-ink">
            <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            <input
              data-id="framework-admin-search"
              value={treeQuery}
              onChange={(e) => setTreeQuery(e.target.value)}
              placeholder={t("framework.explorer.search")}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-muted"
            />
            {treeQuery !== "" && (
              <button type="button" aria-label="clear" className="text-ink-muted hover:text-ink" onClick={() => setTreeQuery("")}>
                <X size={12} strokeWidth={1.5} />
              </button>
            )}
          </label>
        )}
        {treeHits !== null ? (
          <ul data-id="framework-admin-search-results" className="flex flex-col gap-0.5">
            {treeHits.length === 0 ? (
              <li className="px-2 py-6 text-center text-fine text-ink-tertiary">{t("framework.explorer.noResults")}</li>
            ) : (
              treeHits.map(({ item: c, matches }) => {
                const ranges = matches.find((m) => m.field === "name")?.ranges ?? [];
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-id={`framework-admin-search-result-${c.id}`}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-alt"
                      onClick={() => void revealCategory(c.id)}
                    >
                      <LevelPill level={c.level} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-fine text-ink"><Highlight text={c.name} ranges={ranges} /></span>
                      <span className="min-w-0 max-w-[50%] truncate text-fine text-ink-tertiary">{pathOfLite(c)}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : rootError ? (
          <button
            type="button"
            data-id="framework-admin-root-retry"
            className="p-4 text-left text-caption text-error hover:underline"
            onClick={handleRetryRoot}
          >
            {t("home.frameworkLoadError")}
          </button>
        ) : rootLoading ? (
          <p className="p-4 text-caption text-ink-tertiary">{t("common.loading")}</p>
        ) : roots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 p-8 text-center text-caption text-ink-tertiary">
            <FolderTree size={16} strokeWidth={1.5} />
            {t("home.frameworkEmpty")}
          </div>
        ) : (
          <ul className="flex flex-col border-l border-transparent pl-1">{roots.map((r) => renderNode(r, 0))}</ul>
        )}
      </div>

      {/* 우측 상세 패널 — 트리에서 고른 행의 요약·액션. 캠페인·임포트 진입은 sysadmin 전용이라 안에서 한 번 더 게이팅 */}
      <div
        data-id="framework-admin-detail"
        className="scroll-soft flex h-[340px] flex-col gap-3 overflow-y-auto rounded-md border border-hairline bg-surface-pearl p-3"
      >
        {selectedNode ? (
          <div data-id="framework-admin-detail-head" className="flex min-w-0 shrink-0 items-center gap-2">
            <LevelPill level={selectedNode.level} size="sm" />
            <span className="min-w-0 truncate text-body-strong text-ink">{selectedNode.name}</span>
            <span className="shrink-0 text-fine text-ink-tertiary">{selectedNode.code}</span>
          </div>
        ) : (
          <p data-id="framework-admin-detail-empty" className="shrink-0 text-caption text-ink-muted">
            {t("framework.adminDetailEmpty")}
          </p>
        )}

        {selectedNode && (
          <div
            data-id="framework-admin-detail-info"
            className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-fine text-ink-tertiary"
          >
            <span>
              {t("framework.adminInfoMaps")}: <span className="text-ink-secondary">{selectedNode.map_count}</span>
            </span>
            {/* L5 롤업은 그 아래 L5가 있을 수 있는 레벨에서만 의미가 있다 */}
            {selectedNode.level <= 4 && (
              <span>
                {t("framework.adminInfoL5")}: <span className="text-ink-secondary">{selectedNode.l5_count}</span>
              </span>
            )}
            <span>
              {t("framework.adminInfoDept")}:{" "}
              <span className="text-ink-secondary">
                {/* 관리 부서는 조직 경로로 저장된다 — 한 줄에 들어가도록 리프만 */}
                {selectedNode.admin_department ? deptLeaf(selectedNode.admin_department) : t("framework.adminNone")}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-1">
              {t("framework.adminInfoAdmins")}:
              {detailAdmins.length === 0 ? (
                <span className="text-ink-secondary">{t("framework.adminNone")}</span>
              ) : (
                <>
                  <span className="min-w-0 truncate text-ink-secondary">
                    {detailAdmins.slice(0, DETAIL_ADMIN_MAX).join(", ")}
                  </span>
                  {detailAdmins.length > DETAIL_ADMIN_MAX && (
                    <Tooltip label={detailAdmins.join(", ")}>
                      <span className="shrink-0 rounded-sm border border-hairline bg-surface px-1">
                        +{detailAdmins.length - DETAIL_ADMIN_MAX}
                      </span>
                    </Tooltip>
                  )}
                </>
              )}
            </span>
            {selectedNode.level === 5 && (
              <span className="flex items-center gap-1">
                {t("framework.adminInfoCanvas")}:{" "}
                {/* 상태 표기는 언어 무관 영어 고정(맵 카드 상태 필과 같은 규칙) */}
                <span className="text-ink-secondary">{CANVAS_STATE_LABEL_EN[getCanvasState(selectedNode)]}</span>
                {selectedNode.linkage_map_id !== null && (
                  <Link
                    href={`/maps/${selectedNode.linkage_map_id}`}
                    data-id="framework-admin-open-canvas"
                    className="text-accent hover:underline"
                  >
                    {t("framework.adminOpenCanvas")}
                  </Link>
                )}
              </span>
            )}
          </div>
        )}

        <div data-id="framework-admin-actions" className="flex shrink-0 flex-wrap gap-1.5">
          {detailActions.map((action) => (
            <button
              key={action.key}
              type="button"
              data-id={`framework-admin-action-${action.key}`}
              className={DETAIL_ACTION_BTN}
              disabled={action.reason !== undefined}
              title={action.reason}
              onClick={() => {
                if (selectedNode) action.onClick(selectedNode);
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>

        {/* 대량 임포트·캠페인은 sysadmin 전용 — 위임 스코프는 자기 서브트리 밖의 카테고리를 만들 수 있어 배제 */}
        {!scopeRootIds && (
          <div
            data-id="framework-admin-ai"
            className="flex shrink-0 flex-col gap-2 rounded-md border border-hairline bg-surface p-2.5"
          >
            <div className="flex items-center gap-1.5">
              <Headset size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
              <span className="text-caption text-ink">{t("fwConsult.aiBlock")}</span>
              <span className="ml-auto shrink-0">
                <InterviewJsonPromptButton target={consultTarget} />
              </span>
            </div>
            {/* 선택 레벨에 따라 배타적으로 바뀐다 — L1~3 하위 타일 드릴 / L4 새 L5 / L5 AI로 작업·이어서 */}
            <FwLevelActions
              selectedNode={selectedNode}
              childNodes={selectedNode ? childrenByParent.get(selectedNode.id) : undefined}
              childrenLoading={selectedNode !== null && selectedNode.level <= 3 && !childrenByParent.has(selectedNode.id)}
              sessions={activeSessions}
              busy={consultBusy}
              onPick={(node) => {
                // 좌측 트리와 싱크 — 선택 이동 + 그 노드 펼침 + 행으로 스크롤(검색 히트와 같은 동작)
                setSelectedId(node.id);
                openSection(node.id, false);
                setOpenIds((prev) => new Set(prev).add(node.id));
                window.setTimeout(() => document.querySelector(`[data-id="framework-admin-node-${node.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
              }}
              onCreateL5={() => {
                if (selectedNode) {
                  setNameDraft("");
                  setNamePrompt({ kind: "add-l5", parentId: selectedNode.id });
                }
              }}
              onStart={(id) => void handleStartConsult(id)}
              onResume={(sessionId) => router.push(`/framework/consult/${sessionId}`)}
            />
          </div>
        )}

        {/* 임포트 진입 — 버튼이 바로 파일 탐색기를 연다. 고른 파일은 그리드 아래 전폭 스트립에 */}
        {!scopeRootIds && (
          <>
            <input
              ref={interviewInputRef}
              type="file"
              multiple
              accept=".json,application/json"
              data-id="interview-import-files"
              className="hidden"
              disabled={interviewBusy}
              onChange={(event) => {
                void handleInterviewFiles(event.target.files);
                event.target.value = ""; // 같은 파일 재선택 시에도 onChange가 다시 발화하도록
              }}
            />
            <button
              type="button"
              data-id="interview-import-pick"
              disabled={interviewBusy}
              className={`mt-auto shrink-0 self-start ${IMPORT_FILE_BTN}`}
              onClick={() => interviewInputRef.current?.click()}
            >
              <Upload size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">{t("framework.interviewImportPick")}</span>
              {interviewFiles.length > 0 && (
                <span
                  data-id="interview-import-pick-count"
                  className="shrink-0 rounded-full bg-accent-tint px-1.5 text-fine text-accent"
                >
                  {interviewFiles.length}
                </span>
              )}
            </button>
          </>
        )}
      </div>
      </div>

      {/* 고른 파일은 그리드 아래 전폭 스트립에 필로 나열 — 개수·모두 지우기·드라이런이 같은 줄 끝에 (설계 2026-09-22 §1.4) */}
      {!scopeRootIds && interviewFiles.length > 0 && (
        <div
          data-id="interview-import-strip"
          className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface p-2"
        >
          {interviewFiles.map((file, i) => (
            <span
              key={`${file.name}-${i}`}
              data-id={`interview-import-file-${i}`}
              className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
                file.error ? "border-error text-error" : "border-hairline text-ink-secondary"
              }`}
            >
              <FileJson size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="max-w-[240px] truncate" title={file.error ? `${file.name} - ${file.error}` : file.name}>
                {file.name}
              </span>
              <button
                type="button"
                data-id={`interview-import-remove-${i}`}
                aria-label={t("framework.interviewRemoveFile")}
                title={t("framework.interviewRemoveFile")}
                className="shrink-0 rounded-sm p-0.5 text-ink-muted hover:bg-surface-alt"
                onClick={() => handleRemoveInterviewFile(i)}
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </span>
          ))}
          <span data-id="interview-import-file-count" className="ml-auto shrink-0 text-fine text-ink-tertiary">
            {t("framework.interviewFileCount", { count: interviewFiles.length })}
          </span>
          {interviewFiles.some((f) => f.error) && (
            <span className="shrink-0 text-fine text-error">· {interviewFiles.filter((f) => f.error).length} error</span>
          )}
          <button
            type="button"
            data-id="interview-import-clear"
            disabled={interviewBusy}
            className={STRIP_BTN}
            onClick={handleClearInterviewFiles}
          >
            {t("framework.interviewClearFiles")}
          </button>
          <button
            type="button"
            data-id="interview-import-dryrun"
            disabled={interviewBusy || interviewPayloadFiles.length === 0}
            className="shrink-0 rounded-sm border border-hairline px-2.5 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-40"
            onClick={() => void handleInterviewDryRun()}
          >
            {t("framework.importDryRun")}
          </button>
        </div>
      )}

      {!scopeRootIds && (
      <div className="flex flex-col gap-3" data-id="interview-import-host">
        {/* 리포트 영역은 아코디언(0fr→1fr) — 드라이런을 누르면 먼저 열리며 링이 돌고, 결과가 오면 같은 자리에 리포트가 들어온다.
            래퍼는 항상 두어야 첫 열림도 전환된다(file-card 미리보기와 같은 규칙). 닫힘(Cancel)은 내용을 바로 비우므로 즉시 접힌다. */}
        <div
          data-id="interview-import-report-wrap"
          className={`grid transition-[grid-template-rows] duration-350 ease-smooth ${
            interviewResult || interviewPhase === "dryrun" ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            {interviewResult && interviewView ? (
              <InterviewImportReport
                result={interviewResult}
                view={interviewView}
                index={interviewIndex}
                files={interviewPayloadFiles}
                governanceChecked={governanceChecked}
                onToggleGovernance={toggleGovernance}
                onToggleAllGovernance={toggleAllGovernance}
                phase={interviewPhase}
                onCancel={() => {
                  setInterviewResult(null);
                  setGovernanceChecked(new Set());
                }}
                onApply={() => void handleInterviewApply()}
                onToast={onToast}
              />
            ) : interviewPhase === "dryrun" ? (
              <div
                data-id="interview-import-pending"
                className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-md border border-hairline bg-surface-pearl"
              >
                <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-accent" />
                <span className="text-caption text-ink-secondary">
                  {t("framework.importDryRunPending", { count: interviewPayloadFiles.length })}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      )}

        </>
      )}

      {namePrompt && (
        <PromptDialog
          title={
            namePrompt.kind === "add-root"
              ? t("framework.adminAddRootTitle")
              : namePrompt.kind === "add-child"
                ? t("framework.adminAddChildTitle")
                : namePrompt.kind === "add-l5"
                  ? t("fwConsult.newL5Name")
                  : t("framework.adminRenameTitle")
          }
          defaultValue={namePrompt.kind === "rename" ? namePrompt.currentName : ""}
          placeholder={t("framework.adminNamePlaceholder")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          // 새 L5는 형제 이름 중복을 모달 안에서 바로 막는다(서버 409의 선제 가드)
          error={
            namePrompt.kind === "add-l5" && findDuplicateSibling(childrenByParent.get(namePrompt.parentId) ?? [], nameDraft)
              ? t("fwLevel.duplicateName")
              : null
          }
          onChange={setNameDraft}
          onConfirm={(value) => handleNameSubmit(namePrompt, value)}
          onClose={() => {
            setNamePrompt(null);
            setNameDraft("");
          }}
        />
      )}

      {permsNode && (
        <CategoryPermsModal
          node={permsNode}
          onClose={() => setPermsNode(null)}
          onSaved={reloadPermRows}
          onToast={onToast}
        />
      )}
      {deptNode && (
        <CategoryDeptModal
          node={deptNode}
          onClose={() => setDeptNode(null)}
          onSaved={() => void refreshTree()}
          onToast={onToast}
        />
      )}
      {movingNode && (
        <MoveCategoryModal
          node={movingNode}
          hideRootOption={scopeRootIds !== undefined}
          onClose={() => setMovingNode(null)}
          onMoved={() => {
            setMovingNode(null);
            void refreshTree().then(() => onToast(t("framework.adminMoved")));
          }}
        />
      )}

      {deletingNode && (
        <ConfirmDialog
          title={t("framework.adminDeleteTitle")}
          message={t("framework.adminDeleteMessage")}
          banner={deleteError ? <p className="text-caption text-error">{deleteError}</p> : undefined}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          confirmDisabled={deleteBusy}
          onConfirm={() => void handleDelete()}
          onClose={() => {
            setDeletingNode(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}

interface MoveCategoryModalProps {
  node: CategoryNode;
  // 위임 스코프 모드 — "최상위로" 옵션 숨김(seed 서브트리 밖으로는 어차피 서버 403). 실제 최종
  // 가드는 서버(Track C Task 5) — 여기는 뻔한 실패를 목록에서 미리 걸러주는 정도 (Task 6).
  hideRootOption?: boolean;
  onClose: () => void;
  onMoved: () => void;
}

// 이동 대상(새 부모) 선택 — 지정 모달(framework-assign-modal)과 같은 조직도식 lazy 트리.
// 자기 서브트리는 트리에서 숨겨 자기/자손 이동을 원천 차단하고, 깊이 5 초과가 확실한 행
// (레벨 하한 기준)은 비활성. 잔여 초과(깊은 서브트리)는 서버 422 detail을 모달 안 인라인으로
// 표시한다 — 백드롭 블러에 토스트가 묻혀 안 보이던 문제 교정(2026-08-12).
function MoveCategoryModal({ node, hideRootOption, onClose, onMoved }: MoveCategoryModalProps) {
  const { t } = useI18n();
  const [childrenByParent, setChildrenByParent] = useState<Map<number | null, CategoryNode[]>>(new Map());
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  // 선택 — "root"(최상위로 이동) 또는 새 부모 카테고리 id. 미선택이면 버튼 비활성.
  const [selected, setSelected] = useState<number | "root" | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이동 묶음이 차지하는 최소 레벨 수 — 자식 유무까지만 클라가 확실히 안다(그 이하 깊이는 서버 판정).
  const minSpan = node.child_count > 0 ? 2 : 1;
  const isTooDeep = (row: CategoryNode) => row.level + minSpan > MAX_CATEGORY_LEVEL;

  useEffect(() => {
    let active = true;
    void listCategoryNodes()
      .then((nodes) => {
        if (active) {
          setChildrenByParent(new Map([[null, nodes]]));
          setLoadingRoot(false);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadingRoot(false);
          setError(getApiErrorDetail(err));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleOpen(row: CategoryNode) {
    if (openIds.has(row.id)) {
      setOpenIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      return;
    }
    setOpenIds((prev) => new Set(prev).add(row.id));
    if (!childrenByParent.has(row.id) && !loadingIds.has(row.id)) {
      setLoadingIds((prev) => new Set(prev).add(row.id));
      void listCategoryNodes(row.id)
        .then((nodes) => {
          setChildrenByParent((prev) => new Map(prev).set(row.id, nodes));
        })
        .catch((err: unknown) => setError(getApiErrorDetail(err)))
        .finally(() => {
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.delete(row.id);
            return next;
          });
        });
    }
  }

  // 행 — 쉐브론(펼침)과 라벨(선택)을 형제 버튼으로 분리(중첩 인터랙티브 회피). 선택 행은 accent+체크.
  const renderRow = (row: CategoryNode, depth: number): ReactNode => {
    if (row.id === node.id) return null; // 자기 서브트리 숨김 — 자기/자손 이동 원천 차단
    const open = openIds.has(row.id);
    const children = childrenByParent.get(row.id) ?? [];
    const hasChildren = row.child_count > 0;
    const disabled = isTooDeep(row);
    const isSelected = selected === row.id;
    return (
      <li key={row.id} className="flex flex-col">
        <div
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
          className={`flex items-center gap-0.5 rounded-sm pr-1.5 ${isSelected ? "bg-accent-tint" : ""}`}
        >
          {hasChildren && !disabled ? (
            <button
              type="button"
              data-id={`framework-move-toggle-${row.id}`}
              aria-expanded={open}
              aria-label={row.name}
              className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-divider"
              onClick={() => toggleOpen(row)}
            >
              {open
                ? <ChevronDown size={14} strokeWidth={1.5} />
                : <ChevronRight size={14} strokeWidth={1.5} />}
            </button>
          ) : (
            <span className="inline-block w-[22px] shrink-0" />
          )}
          <button
            type="button"
            data-id={`framework-move-pick-${row.id}`}
            disabled={disabled}
            aria-pressed={isSelected}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-left text-caption ${
              isSelected
                ? "text-accent"
                : disabled
                  ? "text-ink-tertiary opacity-50"
                  : "text-ink hover:bg-divider"
            }`}
            onClick={() => setSelected(row.id)}
          >
            <span className="min-w-0 truncate">{row.name}</span>
            {isSelected && <Check size={14} strokeWidth={2} className="ml-auto shrink-0" />}
          </button>
        </div>
        {open &&
          (loadingIds.has(row.id) ? (
            <p style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }} className="py-0.5 text-fine text-ink-tertiary">
              {t("common.loading")}
            </p>
          ) : (
            children.length > 0 && (
              <ul className="flex flex-col">{children.map((c) => renderRow(c, depth + 1))}</ul>
            )
          ))}
      </li>
    );
  };

  async function handleMove() {
    if (selected === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateCategory(node.id, { parent_id: selected === "root" ? null : selected });
      onMoved();
    } catch (err) {
      // 인라인 표시 — 백드롭 블러 위 토스트는 안 보인다(422 깊이 초과 detail 포함)
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="framework-move-modal"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
              <MoveIcon size={18} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-strong text-ink">{t("framework.adminMoveTitle")}</h2>
              <p className="truncate text-fine text-ink-tertiary">{node.name}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div
          data-id="framework-move-tree"
          className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-sm bg-surface-alt p-2"
        >
          <p className="text-fine text-ink-tertiary">{t("framework.adminMoveDepthHint")}</p>
          {loadingRoot ? (
            <p className="text-caption text-ink-tertiary">{t("common.loading")}</p>
          ) : (
            <ul className="flex flex-col">
              {/* 최상위로 이동 — 위임 스코프에서는 서버가 항상 403이라 숨김(seed 서브트리 밖) */}
              {!hideRootOption && (
                <li className="flex flex-col">
                  <button
                    type="button"
                    data-id="framework-move-pick-root"
                    aria-pressed={selected === "root"}
                    className={`flex w-full items-center gap-1.5 rounded-sm py-1 pl-1 pr-1.5 text-left text-caption ${
                      selected === "root" ? "bg-accent-tint text-accent" : "text-ink hover:bg-divider"
                    }`}
                    onClick={() => setSelected("root")}
                  >
                    <FolderTree size={14} strokeWidth={1.5} className="shrink-0" />
                    <span className="min-w-0 truncate">{t("framework.adminMoveRootOption")}</span>
                    {selected === "root" && <Check size={14} strokeWidth={2} className="ml-auto shrink-0" />}
                  </button>
                </li>
              )}
              {(childrenByParent.get(null) ?? []).map((row) => renderRow(row, 0))}
            </ul>
          )}
        </div>

        {error && <p data-id="framework-move-error" className="text-caption text-error">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="framework-move-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-id="framework-move-confirm"
            disabled={selected === null || submitting}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void handleMove()}
          >
            {t("framework.adminMove")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}


// 연계 캔버스 권한자 관리 모달 — 행 존재=권한자(user/group), 변경 즉시 replace PUT 저장
// (setApprovers 선례). 상속은 서버 판정이라 여기선 이 카테고리의 직접 부여분만 보여준다
// (design 2026-08-28 §3).
function CategoryPermsModal({
  node,
  onClose,
  onSaved,
  onToast,
}: {
  node: CategoryNode;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<CategoryPermissionEntry[] | null>(null);
  // 확인(Confirm) 전까지는 로컬 버퍼만 편집 — 서버 반영은 확인 버튼 1회 (부서 지정 모달 Confirm 게이트 선례)
  const [initialEntries, setInitialEntries] = useState<CategoryPermissionEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listCategoryPermissions(node.id), getDirectory(), listGroups()])
      .then(([perms, dir, groupRows]) => {
        if (!active) return;
        setEntries(perms.permissions);
        setInitialEntries(perms.permissions);
        setDirUsers(dir.users);
        setGroups(groupRows);
      })
      .catch(() => {
        if (active) setError(t("framework.permsLoadError"));
      });
    return () => {
      active = false;
    };
  }, [node.id, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 실 데이터를 피커 prop 형식으로 — add-collaborator.tsx 어댑터와 동일 결정(미사용 필드 스텁)
  const pickerUsers: MockUser[] = dirUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: "",
    departmentId: "",
    status: "active" as const,
    isSysadmin: false,
    korean_name: u.korean_name ?? "",
  }));
  const pickerGroups: UserGroup[] = groups
    .filter((g) => g.status === "active")
    .map((g) => ({
      id: String(g.id),
      name: g.name,
      description: g.description,
      status: "active" as const,
      managerIds: [],
      members: [],
    }));
  const pickerDepts: Department[] = [];

  // 버퍼 편집 — 서버 반영 없음(확인 버튼이 유일한 저장 경로)
  function stage(next: CategoryPermissionEntry[]) {
    setEntries(next);
  }

  const entryKey = (e: CategoryPermissionEntry) => `${e.principal_type}:${e.principal_id}`;
  const isDirty =
    entries !== null &&
    initialEntries !== null &&
    (entries.length !== initialEntries.length ||
      new Set(initialEntries.map(entryKey)).size !==
        new Set([...initialEntries, ...entries].map(entryKey)).size);

  function confirmSave() {
    if (entries === null || saving) return;
    setSaving(true);
    void setCategoryPermissions(node.id, entries)
      .then(() => {
        onSaved(); // 트리 인라인 권한자 갱신
        onClose();
      })
      .catch(() => {
        onToast(t("framework.permsSaveError"));
        setSaving(false); // 실패 시 버퍼 유지 — 재시도 가능
      });
  }

  const displayName = (entry: CategoryPermissionEntry): string => {
    if (entry.principal_type === "group") {
      return groups.find((g) => String(g.id) === entry.principal_id)?.name ?? entry.principal_id;
    }
    const found = dirUsers.find((u) => u.id === entry.principal_id);
    return formatAdminName(found, entry.principal_id, lang);
  };

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      // 피커 z 계약: 호스트 모달 ≤1200 · 피커 드롭다운 1250 — 1300이면 드롭다운이 블러 뒤로 간다
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="framework-perms-modal"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
              <ShieldCheck size={18} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-strong text-ink">{t("framework.adminPerms")}</h2>
              <p className="truncate text-fine text-ink-tertiary">
                {node.name} · {t("framework.permsLevelLabel", { level: node.level })}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* 하향 상속 안내 — 이 카테고리에서 지정한 권한자는 서브트리 전체에도 적용된다 (design 2026-08-28 §3) */}
        <p className="text-fine text-ink-tertiary">{t("framework.permsInheritHint")}</p>

        {error ? (
          <p data-id="framework-perms-error" className="text-caption text-error">{error}</p>
        ) : entries === null ? (
          <p className="text-caption text-ink-tertiary">{t("common.loading")}</p>
        ) : (
          <>
            {entries.length > 0 && (
              <ul data-id="framework-perms-list" className="flex flex-wrap gap-1.5">
                {entries.map((entry) => (
                  <li
                    key={`${entry.principal_type}:${entry.principal_id}`}
                    data-id={`framework-perms-pill-${entry.principal_id}`}
                    className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink"
                  >
                    <PrincipalIcon type={entry.principal_type} />
                    <span className="max-w-[140px] truncate">{displayName(entry)}</span>
                    <button
                      type="button"
                      data-id={`framework-perms-remove-${entry.principal_id}`}
                      aria-label={t("dashboard.accessRemove")}
                      className="rounded-xs p-0.5 text-ink-tertiary hover:bg-divider hover:text-error"
                      onClick={() =>
                        stage(
                          entries.filter(
                            (e) =>
                              !(e.principal_type === entry.principal_type &&
                                e.principal_id === entry.principal_id),
                          ),
                        )
                      }
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <PrincipalPicker
              users={pickerUsers}
              departments={pickerDepts}
              groups={pickerGroups}
              excludeIds={new Set(entries.map((e) => e.principal_id))}
              onSelect={(opt: PrincipalOption) => {
                if (opt.principalType !== "user" && opt.principalType !== "group") return;
                stage([
                  ...entries,
                  { principal_type: opt.principalType, principal_id: opt.principalId },
                ]);
              }}
            />
            {/* 버퍼 확정 — 여기서만 서버 저장. 취소/Esc/백드롭은 변경 폐기 */}
            <div className="flex items-center justify-end gap-2 border-t border-hairline pt-3">
              <button
                type="button"
                data-id="framework-perms-cancel"
                className="rounded-sm px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={onClose}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="framework-perms-confirm"
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent disabled:opacity-40"
                disabled={!isDirty || saving}
                onClick={confirmSave}
              >
                {t("common.confirm")}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
