"use client";

// 설정 Framework 탭 — 컨설턴트 업무 체계 카테고리 관리 트리(CRUD). 홈의 lib/framework-tree-state.ts는
// 맵 목록까지 함께 로드하는 브라우징 전용 캐시라 여기(뮤테이션 후 영향받는 노드를 전체 재조회)엔
// 그대로 맞지 않는다 — brief가 admin 전용 확장을 금지해 이 파일 안에 별도의 단순 상태를 둔다.
// 인터뷰 임포트 섹션(트리 하단)은 클라이언트 JSON 파싱만 하고, 키/스키마 검증은 서버 어댑터
// dry-run(POST /categories/import-interview apply=false)이 진실 — 실제 저장은 apply 확인 후에만.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderTree,
  Move as MoveIcon,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  createCategory,
  deleteCategory,
  getApiErrorDetail,
  getDirectory,
  importInterview,
  listCategoryNodes,
  listCategoryPermissions,
  listGroups,
  setCategoryPermissions,
  updateCategory,
  type CategoryNode,
  type CategoryPermissionEntry,
  type DirectoryUser,
  type Group,
  type InterviewImportResult,
} from "@/lib/api";
import { parseInterviewFile } from "@/lib/framework-import-parse";
import { useI18n } from "@/lib/i18n";
import type { Department, User as MockUser, UserGroup } from "@/lib/mock/permissions-types";
import { CountTag } from "@/components/maps/count-tag";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PrincipalIcon, PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import { PromptDialog } from "@/components/prompt-dialog";

const MAX_CATEGORY_LEVEL = 5; // backend MAX_CATEGORY_LEVEL과 동기 — 이 미만 레벨에서만 자식 추가 허용

const ROW_ICON_BTN =
  "hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface-alt group-hover:block";

const IMPORT_FILE_BTN =
  "inline-flex items-center gap-1.5 truncate rounded-sm border border-hairline px-2.5 py-1.5 " +
  "text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

interface InterviewFileState {
  name: string;
  content: unknown; // 파싱 실패 시 null — error와 함께
  error?: string;
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
  // L5 연계 캔버스 권한자 관리 — 모든 레벨에서 부여 가능(하향 상속) (design 2026-08-28 §3)
  const [permsNode, setPermsNode] = useState<CategoryNode | null>(null);
  const [deletingNode, setDeletingNode] = useState<CategoryNode | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // 인터뷰 임포트 섹션 — 다중 파일, 파일별 키 검증 리포트는 서버 어댑터 dry-run이 진실 (design 2026-08-18 §6)
  const interviewInputRef = useRef<HTMLInputElement>(null);
  const [interviewFiles, setInterviewFiles] = useState<InterviewFileState[]>([]);
  const [interviewResult, setInterviewResult] = useState<InterviewImportResult | null>(null);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [confirmInterviewApply, setConfirmInterviewApply] = useState(false);
  const [openReportFiles, setOpenReportFiles] = useState<Set<number>>(new Set());

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
  }

  function handleRemoveInterviewFile(index: number) {
    setInterviewFiles((prev) => prev.filter((_, i) => i !== index));
    setInterviewResult(null);
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
      // 문제 있는 파일은 자동 펼침 — 키 검증 리포트가 이 화면의 존재 이유 (design 2026-08-18 §6)
      setOpenReportFiles(new Set(result.files.flatMap((f, i) => (f.ok ? [] : [i]))));
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setInterviewBusy(false);
    }
  }

  async function handleInterviewApply() {
    setConfirmInterviewApply(false);
    setInterviewBusy(true);
    try {
      const result = await importInterview({ files: getInterviewPayloadFiles(), apply: true });
      setInterviewResult(result);
      await refreshTree();
      onToast(t("framework.importApplySuccess"));
    } catch (err) {
      onToast(getApiErrorDetail(err));
    } finally {
      setInterviewBusy(false);
    }
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
              data-id={`framework-admin-perms-${node.id}`}
              title={t("framework.adminPerms")}
              className={ROW_ICON_BTN}
              onClick={() => setPermsNode(node)}
            >
              <ShieldCheck size={14} strokeWidth={1.5} />
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

  // 엔진 리포트 rows 테이블 — 인터뷰 임포트 응답 rows(코드/동작/상세) 렌더.
  function renderEngineRows(result: { rows: InterviewImportResult["rows"]; truncated: boolean }) {
    return (
      <>
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
              {result.rows.map((row, i) => (
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
        {result.truncated && (
          <p className="text-fine text-ink-tertiary">{t("framework.importTruncated")}</p>
        )}
      </>
    );
  }

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
          <button
            type="button"
            data-id="interview-import-apply"
            disabled={interviewBusy || !interviewResult}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => setConfirmInterviewApply(true)}
          >
            {t("framework.importApply")}
          </button>
        </div>

        {interviewResult && (
          <div className="flex flex-col gap-2" data-id="interview-import-report">
            {renderImportSummary(interviewResult)}
            <ul className="flex flex-col gap-1" data-id="interview-import-file-reports">
              {interviewResult.files.map((file, i) => {
                const open = openReportFiles.has(i);
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
                      <span className="min-w-0 flex-1 truncate text-caption text-ink">{file.name}</span>
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
                    {open &&
                      (file.issues.length === 0 ? (
                        <p className="border-t border-divider px-2 py-1.5 text-fine text-ink-tertiary">
                          {t("framework.interviewNoIssues")}
                        </p>
                      ) : (
                        <div className="scroll-soft max-h-48 overflow-y-auto border-t border-divider">
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
                      ))}
                  </li>
                );
              })}
            </ul>
            {renderEngineRows(interviewResult)}
          </div>
        )}
      </div>

      {confirmInterviewApply && interviewResult && (
        <ConfirmDialog
          title={t("framework.importApplyTitle")}
          message={t("framework.importApplyMessage")}
          banner={renderImportSummary(interviewResult)}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          confirmDisabled={interviewBusy}
          onConfirm={() => void handleInterviewApply()}
          onClose={() => setConfirmInterviewApply(false)}
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

      {permsNode && (
        <CategoryPermsModal
          node={permsNode}
          onClose={() => setPermsNode(null)}
          onToast={onToast}
        />
      )}
      {movingNode && (
        <MoveCategoryModal
          node={movingNode}
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
  onClose: () => void;
  onMoved: () => void;
}

// 이동 대상(새 부모) 선택 — 지정 모달(framework-assign-modal)과 같은 조직도식 lazy 트리.
// 자기 서브트리는 트리에서 숨겨 자기/자손 이동을 원천 차단하고, 깊이 5 초과가 확실한 행
// (레벨 하한 기준)은 비활성. 잔여 초과(깊은 서브트리)는 서버 422 detail을 모달 안 인라인으로
// 표시한다 — 백드롭 블러에 토스트가 묻혀 안 보이던 문제 교정(2026-08-12).
function MoveCategoryModal({ node, onClose, onMoved }: MoveCategoryModalProps) {
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
              {/* 최상위로 이동 — 항상 유효한 목적지 */}
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
  onToast,
}: {
  node: CategoryNode;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<CategoryPermissionEntry[] | null>(null);
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listCategoryPermissions(node.id), getDirectory(), listGroups()])
      .then(([perms, dir, groupRows]) => {
        if (!active) return;
        setEntries(perms.permissions);
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

  function save(next: CategoryPermissionEntry[]) {
    setEntries(next); // 낙관 반영 — 실패 시 서버 재조회 대신 에러 안내(재열기로 복구)
    void setCategoryPermissions(node.id, next)
      .then((result) => setEntries(result.permissions))
      .catch(() => onToast(t("framework.permsSaveError")));
  }

  const displayName = (entry: CategoryPermissionEntry): string => {
    if (entry.principal_type === "group") {
      return groups.find((g) => String(g.id) === entry.principal_id)?.name ?? entry.principal_id;
    }
    const found = dirUsers.find((u) => u.id === entry.principal_id);
    if (!found) return entry.principal_id;
    return lang === "ko" && found.korean_name ? found.korean_name : found.name;
  };

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
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
                        save(
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
                save([
                  ...entries,
                  { principal_type: opt.principalType, principal_id: opt.principalId },
                ]);
              }}
            />
          </>
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
