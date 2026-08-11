"use client";

// 설정 Framework 탭 — 컨설턴트 업무 체계 카테고리 관리 트리(CRUD). 홈의 lib/framework-tree-state.ts는
// 맵 목록까지 함께 로드하는 브라우징 전용 캐시라 여기(뮤테이션 후 영향받는 노드를 전체 재조회)엔
// 그대로 맞지 않는다 — brief가 admin 전용 확장을 금지해 이 파일 안에 별도의 단순 상태를 둔다.
// 대량 임포트 섹션(트리 하단)은 클라이언트 파싱(framework-import-parse.ts)만 하고, 스키마 검증은
// 서버 dry-run(POST /categories/import apply=false)이 진실 — 실제 저장은 apply=true 확인 후에만.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderTree,
  Move as MoveIcon,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  createCategory,
  deleteCategory,
  getApiErrorDetail,
  importFramework,
  listCategoryNodes,
  updateCategory,
  type CategoryNode,
  type FrameworkImportResult,
} from "@/lib/api";
import { pickCascadeLevel } from "@/lib/category-cascade";
import { parseCategoriesFile, parseMapsFile } from "@/lib/framework-import-parse";
import { useI18n } from "@/lib/i18n";
import { CountTag } from "@/components/maps/count-tag";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PromptDialog } from "@/components/prompt-dialog";

const MAX_CATEGORY_LEVEL = 5; // backend MAX_CATEGORY_LEVEL과 동기 — 이 미만 레벨에서만 자식 추가 허용

const ROW_ICON_BTN =
  "hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface-alt group-hover:block";

const IMPORT_FILE_BTN =
  "inline-flex items-center gap-1.5 truncate rounded-sm border border-hairline px-2.5 py-1.5 " +
  "text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

interface CategoriesFileState {
  name: string;
  categories: unknown[];
  error?: string;
}

interface MapsFileState {
  name: string;
  maps: unknown[];
  lineErrors: string[];
}

interface FrameworkPanelProps {
  onToast: (message: string) => void;
}

// PromptDialog 하나를 3용도(최상위 추가/하위 추가/이름변경)로 재사용 — 구현 단순화(brief §3).
type NamePrompt =
  | { kind: "add-root" }
  | { kind: "add-child"; parentId: number }
  | { kind: "rename"; id: number; currentName: string };

export function FrameworkPanel({ onToast }: FrameworkPanelProps) {
  const { t } = useI18n();
  const [childrenByParent, setChildrenByParent] = useState<Map<number | null, CategoryNode[]>>(
    new Map(),
  );
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [rootLoading, setRootLoading] = useState(true);
  const [rootError, setRootError] = useState(false);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [movingNode, setMovingNode] = useState<CategoryNode | null>(null);
  const [deletingNode, setDeletingNode] = useState<CategoryNode | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // 대량 임포트 섹션 — 파일 2개(클라이언트 파싱만) + dry-run 리포트 + apply.
  const categoriesInputRef = useRef<HTMLInputElement>(null);
  const mapsInputRef = useRef<HTMLInputElement>(null);
  const [categoriesFile, setCategoriesFile] = useState<CategoriesFileState | null>(null);
  const [mapsFile, setMapsFile] = useState<MapsFileState | null>(null);
  const [importResult, setImportResult] = useState<FrameworkImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  // 펼침 집합 ref 미러 — refreshTree가 effect deps 없이 최신 openIds를 읽기 위함(react-ts-patterns.md #2).
  const openIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    openIdsRef.current = openIds;
  }, [openIds]);

  useEffect(() => {
    let active = true;
    void listCategoryNodes()
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
  }, []);

  function handleRetryRoot() {
    setRootError(false);
    setRootLoading(true);
    void listCategoryNodes()
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
      listCategoryNodes(),
      ...openList.map((id) => listCategoryNodes(id)),
    ]);
    setChildrenByParent((prev) => {
      const next = new Map(prev);
      next.set(null, rootNodes);
      openList.forEach((id, i) => next.set(id, childLists[i]));
      return next;
    });
  }

  // 파일 선택 → 클라이언트 파싱만(스키마 검증은 서버 dry-run). 선택이 바뀌면 이전 dry-run은 무효.
  async function handleCategoriesFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCategoriesFile({ name: file.name, ...parseCategoriesFile(text) });
    setImportResult(null);
  }

  async function handleMapsFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setMapsFile({ name: file.name, ...parseMapsFile(text) });
    setImportResult(null);
  }

  async function handleDryRun() {
    setImportBusy(true);
    try {
      const result = await importFramework({
        categories: categoriesFile?.categories ?? [],
        maps: mapsFile?.maps ?? [],
        apply: false,
      });
      setImportResult(result);
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setImportBusy(false);
    }
  }

  async function handleApply() {
    setConfirmApply(false);
    setImportBusy(true);
    try {
      const result = await importFramework({
        categories: categoriesFile?.categories ?? [],
        maps: mapsFile?.maps ?? [],
        apply: true,
      });
      setImportResult(result);
      await refreshTree();
      onToast(t("framework.importApplySuccess"));
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setImportBusy(false);
    }
  }

  // 요약 칩 5종 — created/updated/unchanged/error는 summary(0이면 키 자체가 없음), warnings는
  // summary 집계 대상에서 제외돼(backend ImportReport.counts()) rows에서 직접 센다.
  function renderImportSummary(result: FrameworkImportResult) {
    const chips: { key: string; label: string; count: number; danger?: boolean }[] = [
      { key: "created", label: t("framework.importCreated"), count: result.summary.created ?? 0 },
      { key: "updated", label: t("framework.importUpdated"), count: result.summary.updated ?? 0 },
      { key: "unchanged", label: t("framework.importUnchanged"), count: result.summary.unchanged ?? 0 },
      { key: "errors", label: t("framework.importErrors"), count: result.summary.error ?? 0, danger: true },
      {
        key: "warnings",
        label: t("framework.importWarnings"),
        count: result.rows.filter((row) => row.action === "warning").length,
      },
    ];
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
            <button
              type="button"
              data-id={`framework-admin-move-${node.id}`}
              title={t("framework.adminMove")}
              className={ROW_ICON_BTN}
              onClick={() => setMovingNode(node)}
            >
              <MoveIcon size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              data-id={`framework-admin-delete-${node.id}`}
              title={t("framework.adminDelete")}
              className={ROW_ICON_BTN}
              onClick={() => openDelete(node)}
            >
              <Trash2 size={14} strokeWidth={1.5} />
            </button>
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

  const roots = childrenByParent.get(null) ?? [];

  return (
    <div className="flex flex-col gap-4" data-id="framework-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-body-strong text-ink">{t("framework.adminTab")}</h2>
          <p className="pt-1 text-caption text-ink-tertiary">{t("framework.adminReimportHint")}</p>
        </div>
        <button
          type="button"
          data-id="framework-admin-add-root"
          className="flex shrink-0 items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
          onClick={() => setNamePrompt({ kind: "add-root" })}
        >
          <Plus size={14} strokeWidth={1.5} />
          {t("framework.adminAddRoot")}
        </button>
      </div>

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

      <div className="flex flex-col gap-3 border-t border-hairline pt-4" data-id="framework-import">
        <div>
          <h3 className="text-body-strong text-ink">{t("framework.importTitle")}</h3>
          <p className="pt-1 text-caption text-ink-tertiary">{t("framework.importCliHint")}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              ref={categoriesInputRef}
              type="file"
              accept=".json,application/json"
              data-id="framework-import-categories-file"
              className="hidden"
              onChange={(event) => void handleCategoriesFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className={IMPORT_FILE_BTN}
              onClick={() => categoriesInputRef.current?.click()}
            >
              <Upload size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">
                {categoriesFile ? categoriesFile.name : t("framework.importCategoriesPick")}
              </span>
            </button>
            {categoriesFile && !categoriesFile.error && (
              <p className="text-fine text-ink-tertiary">
                {t("framework.importItemCount", { n: categoriesFile.categories.length })}
              </p>
            )}
            {categoriesFile?.error && <p className="text-fine text-error">{categoriesFile.error}</p>}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              ref={mapsInputRef}
              type="file"
              accept=".jsonl,.json,application/json,text/plain"
              data-id="framework-import-maps-file"
              className="hidden"
              onChange={(event) => void handleMapsFile(event.target.files?.[0] ?? null)}
            />
            <button type="button" className={IMPORT_FILE_BTN} onClick={() => mapsInputRef.current?.click()}>
              <Upload size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">
                {mapsFile ? mapsFile.name : t("framework.importMapsPick")}
              </span>
            </button>
            {mapsFile && (
              <p className="text-fine text-ink-tertiary">
                {t("framework.importItemCount", { n: mapsFile.maps.length })}
              </p>
            )}
            {mapsFile && mapsFile.lineErrors.length > 0 && (
              <ul className="scroll-soft flex max-h-24 flex-col gap-0.5">
                {mapsFile.lineErrors.map((msg) => (
                  <li key={msg} className="text-fine text-error">
                    {msg}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            data-id="framework-import-dryrun"
            disabled={importBusy}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
            onClick={() => void handleDryRun()}
          >
            {t("framework.importDryRun")}
          </button>
          <button
            type="button"
            data-id="framework-import-apply"
            disabled={importBusy || !importResult}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => setConfirmApply(true)}
          >
            {t("framework.importApply")}
          </button>
        </div>

        {importResult && (
          <div className="flex flex-col gap-2" data-id="framework-import-report">
            {renderImportSummary(importResult)}
            <div className="scroll-soft max-h-64 overflow-y-auto rounded-sm border border-hairline">
              <table className="w-full text-fine">
                <thead className="sticky top-0 z-[1]">
                  <tr className="border-b border-hairline bg-surface-alt text-left text-ink-tertiary">
                    <th className="px-2 py-1.5">{t("framework.importColCode")}</th>
                    <th className="px-2 py-1.5">{t("framework.importColAction")}</th>
                    <th className="px-2 py-1.5">{t("framework.importColDetail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.rows.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b border-divider last:border-0 ${
                        row.action === "error"
                          ? "bg-error/10"
                          : row.action === "warning"
                            ? "bg-changed/10"
                            : ""
                      }`}
                    >
                      <td className="px-2 py-1 text-ink">{row.code}</td>
                      <td
                        className={`px-2 py-1 ${
                          row.action === "error"
                            ? "text-error"
                            : row.action === "warning"
                              ? "text-changed"
                              : "text-ink-secondary"
                        }`}
                      >
                        {row.action}
                      </td>
                      <td className="px-2 py-1 text-ink-tertiary">{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importResult.truncated && (
              <p className="text-fine text-ink-tertiary">{t("framework.importTruncated")}</p>
            )}
          </div>
        )}
      </div>

      {confirmApply && importResult && (
        <ConfirmDialog
          title={t("framework.importApplyTitle")}
          message={t("framework.importApplyMessage")}
          banner={renderImportSummary(importResult)}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          confirmDisabled={importBusy}
          onConfirm={() => void handleApply()}
          onClose={() => setConfirmApply(false)}
        />
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

      {movingNode && (
        <MoveCategoryModal
          node={movingNode}
          onClose={() => setMovingNode(null)}
          onToast={onToast}
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
  onClose: () => void;
  onMoved: () => void;
  onToast: (message: string) => void;
}

// 이동 대상(새 부모) 캐스케이드 셀렉트 — framework-assign-modal.tsx의 레벨별 lazy 셀렉트 패턴을
// 참고하되 이양 섹션 없이 단순화. depth 0에만 "(root)" 옵션을 추가해 최상위로도 이동 가능하게 한다.
// 자기 자신/자손으로의 이동은 서버 422를 신뢰(클라 필터링 생략) — 실패 시 토스트로만 알림.
function MoveCategoryModal({ node, onClose, onMoved, onToast }: MoveCategoryModalProps) {
  const { t } = useI18n();
  const [chain, setChain] = useState<number[]>([]);
  const [rootPicked, setRootPicked] = useState(false);
  const [optionsByDepth, setOptionsByDepth] = useState<CategoryNode[][]>([]);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [fetchedParentIds, setFetchedParentIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void listCategoryNodes().then((nodes) => {
      if (active) {
        setOptionsByDepth([nodes]);
        setLoadingRoot(false);
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

  // 체인 끝(마지막 선택)의 자식을 lazy 로드 — framework-assign-modal.tsx와 동일 패턴.
  useEffect(() => {
    if (chain.length === 0) return;
    const depth = chain.length - 1;
    const parentId = chain[depth];
    if (optionsByDepth[depth + 1] || fetchedParentIds.has(parentId)) return;
    let active = true;
    void listCategoryNodes(parentId).then((nodes) => {
      if (!active) return;
      if (nodes.length > 0) {
        setOptionsByDepth((prev) => {
          const next = prev.slice(0, depth + 1);
          next[depth + 1] = nodes;
          return next;
        });
      }
      setFetchedParentIds((prev) => new Set(prev).add(parentId));
    });
    return () => {
      active = false;
    };
  }, [chain, optionsByDepth, fetchedParentIds]);

  function pickAt(depth: number, value: string) {
    if (depth === 0 && value === "root") {
      setRootPicked(true);
      setChain([]);
      setOptionsByDepth((prev) => prev.slice(0, 1));
      // optionsByDepth를 잘라낸 만큼 fetchedParentIds도 리셋 — 안 그러면 예전에 "리프로 확인됨"
      // 표시가 남아, 옵션이 이미 잘려나간 노드를 다시 선택해도 effect 가드가 재조회를 막는다.
      setFetchedParentIds(new Set());
      return;
    }
    setRootPicked(false);
    setChain((prev) => pickCascadeLevel(prev, depth, Number(value)));
    setOptionsByDepth((prev) => prev.slice(0, depth + 1));
    setFetchedParentIds(new Set());
  }

  const canConfirm = rootPicked || chain.length > 0;

  async function handleMove() {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await updateCategory(node.id, { parent_id: rootPicked ? null : chain[chain.length - 1] });
      onMoved();
    } catch (err) {
      onToast(getApiErrorDetail(err));
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

        <div className="flex flex-col gap-2 rounded-sm bg-surface-alt p-2">
          <p className="text-fine text-ink-tertiary">{t("framework.adminMovePickParent")}</p>
          {loadingRoot ? (
            <p className="text-caption text-ink-tertiary">{t("common.loading")}</p>
          ) : (
            optionsByDepth.map((options, depth) => (
              <select
                key={depth}
                data-id={`framework-move-level-${depth}`}
                className="w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
                value={depth === 0 && rootPicked ? "root" : (chain[depth] ?? "")}
                onChange={(event) => pickAt(depth, event.target.value)}
              >
                <option value="" disabled>
                  {t("framework.adminMovePickParent")}
                </option>
                {depth === 0 && <option value="root">{t("framework.adminMoveRootOption")}</option>}
                {options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
            ))
          )}
        </div>

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
            disabled={!canConfirm || submitting}
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
