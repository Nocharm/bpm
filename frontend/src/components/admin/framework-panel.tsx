"use client";

// 설정 Framework 탭 — 컨설턴트 업무 체계 카테고리 관리 트리(CRUD). 홈의 lib/framework-tree-state.ts는
// 맵 목록까지 함께 로드하는 브라우징 전용 캐시라 여기(뮤테이션 후 영향받는 노드를 전체 재조회)엔
// 그대로 맞지 않는다 — brief가 admin 전용 확장을 금지해 이 파일 안에 별도의 단순 상태를 둔다.
// 인터뷰 임포트 섹션(트리 하단)은 클라이언트 JSON 파싱만 하고, 키/스키마 검증은 서버 어댑터
// dry-run(POST /categories/import-interview apply=false)이 진실 — 실제 저장은 apply 확인 후에만.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderTree,
  Hash,
  Move as MoveIcon,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Workflow,
  X,
  XCircle,
} from "lucide-react";

import {
  createCategory,
  deleteCategory,
  getApiErrorDetail,
  getCategoryChain,
  getDirectory,
  importInterview,
  listCategoryNodes,
  listAllCategoryPermissions,
  listCategoryPermissions,
  listGroups,
  setCategoryPermissions,
  updateCategory,
  type CategoryNode,
  type CategoryPermissionEntry,
  type CategoryPermissionRow,
  type DirectoryUser,
  type Group,
  type InterviewImportResult,
} from "@/lib/api";
import { canManageInScope } from "@/lib/framework-admin-scope";
import { parseInterviewFile } from "@/lib/framework-import-parse";
import { useI18n } from "@/lib/i18n";
import {
  buildImportReportView,
  buildInterviewIndex,
  governanceKey,
  parseGovernanceKey,
  type DigestGroup,
  type ReportMapEntry,
  type ReportMessage,
} from "@/lib/interview-report";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";
import { CountTag } from "@/components/maps/count-tag";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FrameworkOverview } from "@/components/admin/framework-overview";
import { ImportGovernanceReview } from "@/components/admin/import-governance-review";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalIcon, PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import { PromptDialog } from "@/components/prompt-dialog";
import { Tooltip } from "@/components/tooltip";

const MAX_CATEGORY_LEVEL = 5; // backend MAX_CATEGORY_LEVEL과 동기 — 이 미만 레벨에서만 자식 추가 허용

const ROW_ICON_BTN =
  "hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface-alt group-hover:block";

const IMPORT_FILE_BTN =
  "inline-flex items-center gap-1.5 truncate rounded-sm border border-hairline px-2.5 py-1.5 " +
  "text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

// dry-run 리포트 맵 행의 결과 배지 — 색은 diff 토큰과 같은 의미축(added/changed/error)을 쓴다.
const OUTCOME_PILL = {
  created: "border-added/40 bg-added/10 text-added",
  updated: "border-changed/40 bg-changed/10 text-changed",
  unchanged: "border-hairline bg-surface-alt text-ink-tertiary",
  error: "border-error/40 bg-error/10 text-error",
} as const;

const OUTCOME_LABEL = {
  created: "framework.importCreated",
  updated: "framework.importUpdated",
  unchanged: "framework.importUnchanged",
  error: "framework.interviewFileError",
} as const;

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
  | { kind: "rename"; id: number; currentName: string };

export function FrameworkPanel({ onToast, scopeRootIds }: FrameworkPanelProps) {
  const { t, lang } = useI18n();
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
  const [interviewBusy, setInterviewBusy] = useState(false);
  // 거버넌스 체크 키(`code:field`) — dry-run 결과마다 비우고, 파일 변경 시 리포트와 함께 무효화 (spec 2026-09-03 §6)
  const [governanceChecked, setGovernanceChecked] = useState<Set<string>>(new Set());
  const [openReportFiles, setOpenReportFiles] = useState<Set<number>>(new Set());

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
    setInterviewBusy(true);
    try {
      const result = await importInterview({ files: getInterviewPayloadFiles(), apply: false });
      setInterviewResult(result);
      setGovernanceChecked(new Set());
      // 전 파일 자동 펼침 — 결과 본문(맵·연계 캔버스)이 파일 카드 안에 있어 접힌 채로는 읽을 게 없다.
      setOpenReportFiles(new Set(result.files.map((_, i) => i)));
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setInterviewBusy(false);
    }
  }

  async function handleInterviewApply() {
    if (!interviewResult) return;
    setInterviewBusy(true);
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
      setInterviewBusy(false);
    }
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

  // 요약 칩 5종 — 전부 summary에서 읽는다(0이면 키 자체가 없음). warning은 backend
  // ImportReport.counts() 집계에서 제외되지만, endpoint가 rows 전체(500행 캡 이전) 기준으로
  // summary["warning"]을 별도로 채워 보낸다 — rows에서 세면 캡 초과 시 undercount된다(fix round 1).
  function renderImportSummary(result: { summary: Record<string, number> }) {
    const chips: { key: string; label: string; count: number; danger?: boolean }[] = [
      { key: "created", label: t("framework.importCreated"), count: result.summary.created ?? 0 },
      { key: "updated", label: t("framework.importUpdated"), count: result.summary.updated ?? 0 },
      { key: "unchanged", label: t("framework.importUnchanged"), count: result.summary.unchanged ?? 0 },
      { key: "errors", label: t("framework.importErrors"), count: result.summary.error ?? 0, danger: true },
      { key: "warnings", label: t("framework.importWarnings"), count: result.summary.warning ?? 0 },
    ];
    // 인터뷰 임포트 전용 카운트 — 키가 있을 때만(기존 canonical 임포트 응답엔 없음)
    if (result.summary.notes !== undefined) {
      chips.push({ key: "notes", label: t("framework.interviewNotes"), count: result.summary.notes });
    }
    if (result.summary.linkage !== undefined) {
      chips.push({
        key: "linkage",
        label: t("framework.interviewLinkage"),
        count: result.summary.linkage,
      });
    }
    if (result.summary.governance !== undefined) {
      chips.push({
        key: "governance",
        label: t("framework.interviewGovernance"),
        count: result.summary.governance,
      });
    }
    return (
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip.key}
            className={`rounded-sm border px-2 py-1 text-fine ${
              chip.danger && chip.count > 0
                ? "border-error/40 bg-error/10 text-error"
                : "border-hairline bg-surface-alt text-ink-secondary"
            }`}
          >
            {chip.label} {chip.count}
          </span>
        ))}
      </div>
    );
  }

  function handleToggle(id: number) {
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
        } else {
          await updateCategory(prompt.id, { name });
          await refreshTree();
        }
        onToast(
          prompt.kind === "rename" ? t("framework.adminRenamed") : t("framework.adminCreated"),
        );
      } catch (err) {
        onToast(getApiErrorDetail(err));
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

  // 코드 옆 인라인 권한자 — 그 카테고리에 직접 붙은 행만(하향 상속은 안내 문구가 담당).
  // 2명까지 이름 노출, 초과분은 +N 배지 호버 툴팁으로 전체 나열 (2026-09-02 요청)
  const INLINE_ADMIN_MAX = 2;
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

  const renderInlineAdmins = (categoryId: number): ReactNode => {
    const names = permNamesByCategory.get(categoryId);
    if (!names || names.length === 0) return null;
    const shown = names.slice(0, INLINE_ADMIN_MAX);
    const rest = names.length - shown.length;
    return (
      <span
        data-id={`framework-admin-inline-${categoryId}`}
        className="flex min-w-0 shrink items-center gap-1 text-fine text-ink-tertiary"
      >
        <ShieldCheck size={11} strokeWidth={1.5} className="shrink-0 text-accent" />
        <span className="truncate">{shown.join(", ")}</span>
        {rest > 0 && (
          <Tooltip label={names.join(", ")}>
            <span className="shrink-0 rounded-sm border border-hairline bg-surface-alt px-1 text-fine">
              +{rest}
            </span>
          </Tooltip>
        )}
      </span>
    );
  };

  const renderNode = (node: CategoryNode, depth: number): ReactNode => {
    const open = openIds.has(node.id);
    const children = childrenByParent.get(node.id);
    return (
      <li key={node.id} className="flex flex-col gap-1">
        <div
          data-id={`framework-admin-node-${node.id}`}
          className="group flex items-center gap-1 rounded-sm hover:bg-surface-alt"
        >
          <button
            type="button"
            aria-expanded={open}
            onClick={() => handleToggle(node.id)}
            style={{ paddingLeft: `${depth * 14 + 4}px` }}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
          >
            {open ? (
              <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            )}
            <span className="truncate text-fine text-ink">{node.name}</span>
            <span className="shrink-0 text-fine text-ink-muted">{node.code}</span>
            {renderInlineAdmins(node.id)}
            {/* 접힌 행에만 — 펼치면 하위 행이 다 보여 롤업 숫자가 중복(count-tag.tsx 계약) */}
            {!open && <CountTag count={node.map_count} />}
          </button>
          <div className="flex shrink-0 items-center gap-0.5 pr-1">
            {node.level < MAX_CATEGORY_LEVEL && (
              <button
                type="button"
                data-id={`framework-admin-add-${node.id}`}
                title={t("framework.adminAddChild")}
                className={ROW_ICON_BTN}
                onClick={() => setNamePrompt({ kind: "add-child", parentId: node.id })}
              >
                <FolderPlus size={14} strokeWidth={1.5} />
              </button>
            )}
            <button
              type="button"
              data-id={`framework-admin-rename-${node.id}`}
              title={t("framework.adminRename")}
              className={ROW_ICON_BTN}
              onClick={() =>
                setNamePrompt({ kind: "rename", id: node.id, currentName: node.name })
              }
            >
              <Pencil size={14} strokeWidth={1.5} />
            </button>
            {canManageInScope(node, "perms", scopeRootIds, minSeedLevel) && (
              <button
                type="button"
                data-id={`framework-admin-perms-${node.id}`}
                title={t("framework.adminPerms")}
                className={ROW_ICON_BTN}
                onClick={() => setPermsNode(node)}
              >
                <ShieldCheck size={14} strokeWidth={1.5} />
              </button>
            )}
            {canManageInScope(node, "move", scopeRootIds, minSeedLevel) && (
              <button
                type="button"
                data-id={`framework-admin-move-${node.id}`}
                title={t("framework.adminMove")}
                className={ROW_ICON_BTN}
                onClick={() => setMovingNode(node)}
              >
                <MoveIcon size={14} strokeWidth={1.5} />
              </button>
            )}
            {canManageInScope(node, "delete", scopeRootIds, minSeedLevel) && (
              <button
                type="button"
                data-id={`framework-admin-delete-${node.id}`}
                title={t("framework.adminDelete")}
                className={ROW_ICON_BTN}
                onClick={() => openDelete(node)}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
        {open &&
          (children === undefined ? (
            <p
              style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}
              className="text-fine text-ink-tertiary"
            >
              {t("common.loading")}
            </p>
          ) : children.length > 0 ? (
            <ul className="flex flex-col gap-1">{children.map((c) => renderNode(c, depth + 1))}</ul>
          ) : null)}
      </li>
    );
  };

  // 상세 문구 사람말 — 백엔드 영문 원문(kind 미등록)은 그대로 통과시켜 정보를 잃지 않는다.
  function describeMessage(kind: ReportMessage["kind"], subject: string, raw: string): string {
    switch (kind) {
      case "owner-fallback":
        return t("framework.importMsgOwnerFallback");
      case "owner-not-found":
        return `${t("framework.importMsgOwnerNotFound")}: ${subject}`;
      case "approver-not-found":
        return `${t("framework.importMsgApproverNotFound")}: ${subject}`;
      case "sp-department-empty":
        return t("framework.importMsgSpDepartment");
      case "duplicate-name":
        return `${t("framework.importMsgDuplicateName")}: ${subject}`;
      case "duplicate-code":
        return t("framework.importMsgDuplicateCode");
      case "unknown-category":
        return `${t("framework.importMsgUnknownCategory")}: ${subject}`;
      case "in-trash":
        return t("framework.importMsgInTrash");
      case "no-landing":
        return t("framework.importMsgNoLanding");
      case "linkage-skipped":
        return `${t("framework.importMsgLinkageSkipped")} — ${subject}`;
      case "canvas":
        return subject === "created"
          ? t("framework.importMsgCanvasCreated")
          : t("framework.importMsgCanvasAugmented");
      default:
        return raw;
    }
  }

  // 고유키 카드 — 행에는 이름만 두고, 실데이터 키는 Hash 아이콘 호버로만 꺼내 본다.
  // 폭 고정(w-60)이 필수: 툴팁은 fixed라 화면 오른쪽 끝 앵커에서 가용폭이 0에 수렴해 한 글자씩 세로로 접힌다.
  function renderKeyCard(entries: [string, string][]) {
    return (
      <span className="flex w-60 flex-col gap-1">
        {entries
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <span key={label} className="flex gap-2">
              <span className="shrink-0 text-fine text-ink-tertiary">{label}</span>
              <span className="min-w-0 flex-1 break-all font-mono text-fine text-ink">{value}</span>
            </span>
          ))}
      </span>
    );
  }

  function renderKeyIcon(entries: [string, string][], dataId: string) {
    return (
      <Tooltip content={renderKeyCard(entries)}>
        <span data-id={dataId} className="shrink-0 cursor-help text-ink-muted hover:text-ink-secondary">
          <Hash size={13} strokeWidth={1.5} />
        </span>
      </Tooltip>
    );
  }

  // 반복 경고 접기 — 같은 종류를 한 줄로 모으고, 영향받은 맵은 이름으로(코드는 툴팁) 보여준다.
  function renderDigest(digest: DigestGroup[]) {
    if (digest.length === 0) return null;
    return (
      <div className="rounded-sm border border-hairline" data-id="interview-import-digest">
        <p className="border-b border-divider bg-surface-alt px-2 py-1 text-fine text-ink-tertiary">
          {t("framework.importAttention")}
        </p>
        <ul className="flex flex-col">
          {digest.map((group) => (
            <li
              key={group.key}
              data-id={`interview-digest-${group.key}`}
              className="flex items-center gap-2 border-b border-divider px-2 py-1.5 last:border-b-0"
            >
              {group.severity === "error" ? (
                <XCircle size={14} strokeWidth={1.5} className="shrink-0 text-error" />
              ) : (
                <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0 text-changed" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-caption text-ink">
                  {/* 가변부(승인자 id 등)는 3개까지만 — 나머지 수는 옆 배지 툴팁이 전부 보여준다 */}
                  {describeMessage(
                    group.kind,
                    group.subjects.slice(0, 3).join(", ") +
                      (group.subjects.length > 3 ? ` +${group.subjects.length - 3}` : ""),
                    group.raw,
                  )}
                </span>
                <span className="truncate text-fine text-ink-tertiary">
                  {group.maps
                    .slice(0, 4)
                    .map((m) => m.name)
                    .join(" · ")}
                  {group.maps.length > 4 ? ` +${group.maps.length - 4}` : ""}
                </span>
              </span>
              <Tooltip
                content={renderKeyCard(group.maps.map((m) => [m.name, m.code] as [string, string]))}
              >
                <span className="shrink-0 cursor-help rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
                  {t("framework.importAffectedMaps", { count: group.maps.length })}
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // 맵 1행 = [결과 배지][맵 이름][버전][경고 수(호버=문구)][고유키(호버=코드)] — 코드는 화면에서 뺀다.
  function renderMapRows(entries: ReportMapEntry[], dataId: string) {
    return (
      <ul className="flex flex-col" data-id={dataId}>
        {entries.map((entry) => {
          const hasError = entry.messages.some((m) => m.severity === "error");
          return (
            <li
              key={entry.code}
              data-id={`interview-map-${entry.code}`}
              className="flex items-center gap-2 border-t border-divider px-2 py-1 first:border-t-0"
            >
              <span
                className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine ${
                  OUTCOME_PILL[entry.outcome ?? "unchanged"]
                }`}
              >
                {t(OUTCOME_LABEL[entry.outcome ?? "unchanged"])}
              </span>
              <span className="min-w-0 flex-1 truncate text-caption text-ink">{entry.name}</span>
              {entry.version !== null && (
                <span className="shrink-0 text-fine text-ink-muted">v{entry.version}</span>
              )}
              {entry.messages.length > 0 && (
                <Tooltip
                  content={
                    <span className="flex w-60 flex-col gap-1">
                      {entry.messages.map((msg, i) => (
                        <span key={i} className="text-fine text-ink">
                          {describeMessage(msg.kind, msg.subject, msg.raw)}
                        </span>
                      ))}
                    </span>
                  }
                >
                  <span
                    className={`inline-flex shrink-0 cursor-help items-center gap-0.5 text-fine ${
                      hasError ? "text-error" : "text-changed"
                    }`}
                  >
                    <AlertTriangle size={12} strokeWidth={1.5} />
                    {entry.messages.length}
                  </span>
                </Tooltip>
              )}
              {renderKeyIcon(
                [
                  [t("framework.importIdTask"), entry.code],
                  [t("framework.importIdUnit"), entry.unitId],
                  [t("framework.importIdDept"), entry.department],
                  [t("framework.importIdRole"), entry.ownerRole],
                ],
                `interview-map-key-${entry.code}`,
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const roots = childrenByParent.get(null) ?? [];
  // 스코프 모드의 roots는 항상 seed 노드 자신 — 임명 버튼 게이팅 기준 최소 레벨 (Track C Task 6)
  const minSeedLevel = scopeRootIds ? Math.min(...roots.map((r) => r.level)) : undefined;

  // 리포트 뷰모델 — 맵 이름·카테고리 경로는 업로드한 JSON에서만 나온다(서버 rows는 코드만 싣는다).
  // 파일 목록이 바뀌면 결과를 지우므로(handleInterviewFiles/RemoveFile) 둘은 항상 같은 전달분이다.
  const interviewView = useMemo(
    () =>
      interviewResult
        ? buildImportReportView(
            interviewResult.rows,
            buildInterviewIndex(
              interviewFiles.filter((f) => !f.error).map((f) => ({ name: f.name, content: f.content })),
            ),
          )
        : null,
    [interviewResult, interviewFiles],
  );
  const orphanGroup = interviewView?.groups.find((g) => g.file === "") ?? null;

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
      <div data-id="framework-admin-tree" className="rounded-sm border border-hairline p-2">
        {rootError ? (
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
          <ul className="flex flex-col gap-1">{roots.map((r) => renderNode(r, 0))}</ul>
        )}
      </div>

      {/* 대량 임포트는 sysadmin 전용 — 위임 스코프는 자기 서브트리 밖의 카테고리를 만들 수 있어 배제 */}
      {!scopeRootIds && (
      <div className="flex flex-col gap-3 border-t border-hairline pt-4" data-id="interview-import">
        <div>
          <h3 className="text-body-strong text-ink">{t("framework.interviewImportTitle")}</h3>
          <p className="pt-1 text-caption text-ink-tertiary">{t("framework.interviewImportHint")}</p>
        </div>

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
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            data-id="interview-import-pick"
            disabled={interviewBusy}
            className={IMPORT_FILE_BTN}
            onClick={() => interviewInputRef.current?.click()}
          >
            <Upload size={14} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{t("framework.interviewImportPick")}</span>
          </button>
          {interviewFiles.length > 0 && (
            <ul className="flex flex-col gap-0.5" data-id="interview-import-file-list">
              {interviewFiles.map((file, i) => (
                <li key={`${file.name}-${i}`} className="flex items-center gap-1.5 text-fine">
                  <span className={`truncate ${file.error ? "text-error" : "text-ink-secondary"}`}>
                    {file.name}
                    {file.error ? ` - ${file.error}` : ""}
                  </span>
                  <button
                    type="button"
                    data-id={`interview-import-remove-${i}`}
                    aria-label={t("framework.interviewRemoveFile")}
                    className="shrink-0 rounded-sm p-0.5 text-ink-muted hover:bg-surface-alt"
                    onClick={() => handleRemoveInterviewFile(i)}
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            data-id="interview-import-dryrun"
            disabled={interviewBusy || getInterviewPayloadFiles().length === 0}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
            onClick={() => void handleInterviewDryRun()}
          >
            {t("framework.importDryRun")}
          </button>
        </div>

        {interviewResult && interviewView && (
          <div className="flex flex-col gap-2" data-id="interview-import-report">
            {renderImportSummary(interviewResult)}
            {renderDigest(interviewView.digest)}
            <ul className="flex flex-col gap-1" data-id="interview-import-file-reports">
              {interviewResult.files.map((file, i) => {
                const open = openReportFiles.has(i);
                // 파일 순서는 요청 payload 그대로 돌아온다 — 이름까지 맞을 때만 그룹을 붙인다.
                const group =
                  interviewView.groups[i]?.file === file.name ? interviewView.groups[i] : undefined;
                const canvas = group?.canvas;
                return (
                  <li key={`${file.name}-${i}`} className="rounded-sm border border-hairline">
                    <button
                      type="button"
                      data-id={`interview-file-toggle-${i}`}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-alt"
                      onClick={() =>
                        setOpenReportFiles((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) {
                            next.delete(i);
                          } else {
                            next.add(i);
                          }
                          return next;
                        })
                      }
                    >
                      {open ? (
                        <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        {/* 파일명보다 사람이 아는 이름(L5 프로세스)이 먼저 — 파일명은 출처 표시로 강등 */}
                        <span className="truncate text-caption text-ink">{canvas?.name ?? file.name}</span>
                        <span className="truncate text-fine text-ink-tertiary">
                          {canvas ? `${file.name}${canvas.path ? ` · ${canvas.path}` : ""}` : ""}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine ${
                          file.ok
                            ? "border-hairline bg-surface-alt text-ink-secondary"
                            : "border-error/40 bg-error/10 text-error"
                        }`}
                      >
                        {file.ok ? t("framework.interviewFileOk") : t("framework.interviewFileError")}
                      </span>
                      <span className="shrink-0 text-fine text-ink-tertiary">
                        {t("framework.interviewMaps")} {file.map_count} · {t("framework.interviewNotes")}{" "}
                        {file.note_count}
                      </span>
                    </button>
                    {open && (
                      <div className="border-t border-divider">
                        {file.issues.length > 0 && (
                          <div className="scroll-soft max-h-48 overflow-y-auto">
                            <table className="w-full text-fine">
                              <thead className="sticky top-0 z-[1]">
                                <tr className="border-b border-hairline bg-surface-alt text-left text-ink-tertiary">
                                  <th className="px-2 py-1.5">{t("framework.interviewIssueColSeverity")}</th>
                                  <th className="px-2 py-1.5">{t("framework.interviewIssueColPath")}</th>
                                  <th className="px-2 py-1.5">{t("framework.interviewIssueColMessage")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {file.issues.map((issue, j) => (
                                  <tr
                                    key={j}
                                    className={`border-b border-divider last:border-0 ${
                                      issue.severity === "error" ? "bg-error/10" : "bg-changed/10"
                                    }`}
                                  >
                                    <td
                                      className={`px-2 py-1 ${
                                        issue.severity === "error" ? "text-error" : "text-changed"
                                      }`}
                                    >
                                      {issue.severity}
                                    </td>
                                    <td className="px-2 py-1 font-mono text-ink-secondary">{issue.path}</td>
                                    <td className="px-2 py-1 text-ink-tertiary">{issue.message}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {canvas && (
                          <div
                            data-id={`interview-file-canvas-${i}`}
                            className="flex items-center gap-2 bg-surface-pearl px-2 py-1.5"
                          >
                            <Workflow size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                            <span className="min-w-0 flex-1 truncate text-caption text-ink">
                              {t("framework.importCanvas")}
                            </span>
                            {canvas.messages.map((msg, j) => (
                              <span
                                key={j}
                                className={`shrink-0 text-fine ${
                                  msg.severity === "info" ? "text-ink-tertiary" : "text-changed"
                                }`}
                              >
                                {describeMessage(msg.kind, msg.subject, msg.raw)}
                                {msg.kind === "canvas" && (msg.numbers[1] ?? 0) > 0
                                  ? ` · ${t("framework.importNodesEdges", { count: msg.numbers[1] })}`
                                  : ""}
                              </span>
                            ))}
                            {renderKeyIcon(
                              [
                                [t("framework.importIdCategory"), canvas.code],
                                [t("framework.importIdPath"), canvas.path],
                              ],
                              `interview-canvas-key-${i}`,
                            )}
                          </div>
                        )}
                        {group && group.maps.length > 0 ? (
                          renderMapRows(group.maps, `interview-file-maps-${i}`)
                        ) : (
                          <p className="px-2 py-1.5 text-fine text-ink-tertiary">
                            {file.issues.length > 0
                              ? t("framework.importNoMaps")
                              : t("framework.interviewNoIssues")}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {orphanGroup && orphanGroup.maps.length > 0 && (
              <div className="rounded-sm border border-hairline" data-id="interview-import-unmatched">
                <p className="border-b border-divider bg-surface-alt px-2 py-1 text-fine text-ink-tertiary">
                  {t("framework.importUnmatched")}
                </p>
                {renderMapRows(orphanGroup.maps, "interview-unmatched-maps")}
              </div>
            )}
            {interviewResult.truncated && (
              <p className="text-fine text-ink-tertiary">{t("framework.importTruncated")}</p>
            )}
            {/* 거버넌스 확인 + 하단 고정 바 — 체크한 것만 교체, 명시적 Apply가 확인 역할 (spec 2026-09-03 §6) */}
            <ImportGovernanceReview
              diffs={interviewResult.governance}
              checked={governanceChecked}
              onToggle={toggleGovernance}
              onToggleAll={toggleAllGovernance}
              applied={interviewResult.applied}
            />
            <div
              data-id="interview-import-actions"
              className="sticky bottom-0 z-[1] flex items-center gap-2 border-t border-hairline bg-surface py-2"
            >
              <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">
                {t("framework.importApplyBar", {
                  maps: (interviewResult.summary.created ?? 0) + (interviewResult.summary.updated ?? 0),
                  changes: governanceChecked.size,
                })}
              </span>
              <button
                type="button"
                data-id="interview-import-cancel"
                disabled={interviewBusy}
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
                onClick={() => {
                  setInterviewResult(null);
                  setGovernanceChecked(new Set());
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="interview-import-apply"
                disabled={interviewBusy || interviewResult.applied}
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
                onClick={() => void handleInterviewApply()}
              >
                {t("framework.importApply")}
              </button>
            </div>
          </div>
        )}
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
                : t("framework.adminRenameTitle")
          }
          defaultValue={namePrompt.kind === "rename" ? namePrompt.currentName : ""}
          placeholder={t("framework.adminNamePlaceholder")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={(value) => handleNameSubmit(namePrompt, value)}
          onClose={() => setNamePrompt(null)}
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
