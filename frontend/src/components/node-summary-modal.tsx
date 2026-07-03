"use client";

// 노드 더블클릭 요약 모달 — 전/후 단계, 하위 프로세스 프리뷰, 코멘트(읽기+추가), 메타.
// 바깥 클릭/Esc로 닫힘. readOnly면 코멘트 추가 숨김.

import { AlertTriangle, ArrowLeft, ArrowRight, CornerDownRight, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { ScopePreview } from "@/components/scope-preview";
import { SearchSelect } from "@/components/search-select";
import {
  createComment,
  getEligibleAssignees,
  listComments,
  type CommentItem,
  type EligibleAssignees,
  type VersionGraph,
} from "@/lib/api";
import { type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

// 정보 수정 모달이 편집하는 필드 — 부분 패치
export type NodeEditPatch = Partial<{
  label: string;
  description: string;
  nodeType: ProcessNodeType;
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
}>;

const ATTR_FIELDS: { key: "assignee" | "department" | "system" | "duration"; labelKey: "field.assignee" | "field.department" | "field.system" | "field.duration" }[] = [
  { key: "assignee", labelKey: "field.assignee" },
  { key: "department", labelKey: "field.department" },
  { key: "system", labelKey: "field.system" },
  { key: "duration", labelKey: "field.duration" },
];

const COLOR_COLLAPSED = 5; // 색 스와치 기본 1줄 노출 수 — "더 보기"로 전체 펼침

interface NodeSummaryModalProps {
  versionId: number;
  nodeId: string;
  title: string;
  typeLabel: string;
  groupLabel: string | null;
  predecessors: { id: string; label: string }[];
  successors: { id: string; label: string }[];
  hasChildren: boolean;
  fullGraph: VersionGraph | null;
  readOnly: boolean;
  // 편집 데이터 + 패치 (readOnly면 입력 비활성)
  description: string;
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  colorPresets: string[];
  onPatch: (patch: NodeEditPatch) => void;
  // 제목 입력 확정(blur) 시 호출 — 이름 중복 고유화 적용
  onCommitLabel?: (label: string) => void;
  // 선행/후행 노드 클릭 시 그 노드 편집으로 전환
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
  // 하위 프로세스가 있을 때 그 캔버스로 진입 (있을 때만 버튼 노출)
  onOpenChild?: () => void;
}

export function NodeSummaryModal({
  versionId,
  nodeId,
  title,
  typeLabel,
  groupLabel,
  predecessors,
  successors,
  hasChildren,
  fullGraph,
  readOnly,
  description,
  color,
  assignee,
  department,
  system,
  duration,
  colorPresets,
  onPatch,
  onCommitLabel,
  onNavigate,
  onClose,
  onOpenChild,
}: NodeSummaryModalProps) {
  const { t } = useI18n();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorExpanded, setColorExpanded] = useState(false);
  // 담당자/부서 후보 — 맵 조회권한 보유 직원만 (F5). 편집 모드에서만 조회.
  const [eligible, setEligible] = useState<EligibleAssignees | null>(null);
  // 편집 버퍼 — 저장 눌러야 노드에 반영, 취소/Esc/바깥클릭은 폐기(버퍼 편집). 노드 초기값에서 시작.
  const [form, setForm] = useState({ label: title, description, color, assignee, department, system, duration });
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  // 노드가 바뀌면(선후행 내비 등) 버퍼를 새 노드 값으로 리셋 — 렌더 중 상태조정(effect 아님).
  if (nodeId !== prevNodeId) {
    setPrevNodeId(nodeId);
    setForm({ label: title, description, color, assignee, department, system, duration });
  }
  // 저장 — 버퍼를 노드에 반영(라벨은 onCommitLabel로 중복 고유화) 후 닫기.
  const handleSave = useCallback(() => {
    onPatch({
      description: form.description,
      color: form.color,
      assignee: form.assignee,
      department: form.department,
      system: form.system,
      duration: form.duration,
    });
    onCommitLabel?.(form.label);
    onClose();
  }, [form, onPatch, onCommitLabel, onClose]);

  // 선후행 내비 — 버퍼에 변경이 있으면 확인(저장/저장안함/취소), 없으면 바로 이동.
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const isDirty =
    form.label !== title ||
    form.description !== description ||
    form.color !== color ||
    form.assignee !== assignee ||
    form.department !== department ||
    form.system !== system ||
    form.duration !== duration;
  const requestNavigate = (id: string) => {
    if (isDirty) {
      setPendingNav(id);
    } else {
      onNavigate(id);
    }
  };
  const navSaveAndGo = () => {
    onPatch({
      description: form.description,
      color: form.color,
      assignee: form.assignee,
      department: form.department,
      system: form.system,
      duration: form.duration,
    });
    onCommitLabel?.(form.label);
    const id = pendingNav;
    setPendingNav(null);
    if (id) onNavigate(id);
  };
  const navDiscardAndGo = () => {
    const id = pendingNav;
    setPendingNav(null);
    if (id) onNavigate(id);
  };

  useEffect(() => {
    if (readOnly) {
      return;
    }
    let active = true;
    void getEligibleAssignees(versionId)
      .then((e) => {
        if (active) setEligible(e);
      })
      .catch(() => {
        /* 실패 시 현재 값만 유지 노출 */
      });
    return () => {
      active = false;
    };
  }, [versionId, readOnly]);
  const shownColors =
    colorExpanded || colorPresets.length <= COLOR_COLLAPSED
      ? colorPresets
      : colorPresets.slice(0, COLOR_COLLAPSED);

  // 해당 노드 코멘트 로드(진입 1회) — 실패해도 모달은 동작(빈 목록)
  useEffect(() => {
    let alive = true;
    void listComments(versionId)
      .then((all) => {
        if (alive) {
          setComments(all.filter((comment) => comment.node_id === nodeId));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [versionId, nodeId]);

  // Esc=취소(버퍼 폐기)·⌘S=저장. ⌘S는 브라우저 저장 대화상자를 막는다.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 확인 오버레이가 떠 있으면 그것부터 닫는다(모달 유지).
        if (pendingNav) setPendingNav(null);
        else onClose();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!pendingNav) handleSave();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleSave, onClose, pendingNav]);

  const submitComment = async () => {
    const body = draft.trim();
    if (!body || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createComment(versionId, nodeId, body);
      setComments((current) => [...current, created]);
      setDraft("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("summary.addError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop
      className="absolute inset-0 z-[1200] flex items-center justify-center backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="relative flex max-h-[80%] w-[420px] flex-col overflow-hidden rounded-sm border border-hairline bg-surface"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-body-strong text-ink">
            <SquarePen size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            {readOnly ? title : t("editor.nodeEdit")}
          </span>
          <button
            type="button"
            title={t("summary.close")}
            aria-label={t("summary.close")}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3 text-caption text-ink-secondary">
          {readOnly ? (
            <div className="flex gap-4">
              <span><span className="text-fine text-ink-tertiary">{t("summary.type")}:</span> {typeLabel}</span>
              {groupLabel && (
                <span><span className="text-fine text-ink-tertiary">{t("summary.group")}:</span> {groupLabel}</span>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* 제목 */}
              <div>
                <label className="mb-1 block text-fine text-ink-tertiary">{t("field.title")}</label>
                <input
                  className="w-full rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink"
                  value={form.label}
                  aria-label={t("field.title")}
                  onChange={(event) => setForm((f) => ({ ...f, label: event.target.value }))}
                />
              </div>
              {/* 설명 — 노드 부연(NodeData.description, 라이브 반영) */}
              <div>
                <label className="mb-1 block text-fine text-ink-tertiary">{t("field.description")}</label>
                <textarea
                  className="w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink"
                  rows={2}
                  value={form.description}
                  aria-label={t("field.description")}
                  onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
                />
              </div>
              {/* 유형 — 생성 시 고정, 변경 불가(읽기 전용 표시) */}
              <div className="flex items-center gap-2">
                <label className="w-14 shrink-0 text-fine text-ink-tertiary">{t("field.type")}</label>
                <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">{typeLabel}</span>
              </div>
              {/* 색 — 타입별 프리셋 스와치(colorsForType) + 커스텀 헥사 입력 */}
              <div className="flex items-start gap-2">
                <span className="w-14 shrink-0 pt-1 text-fine text-ink-tertiary">{t("field.color")}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {shownColors.map((preset) => (
                      <button
                        key={preset || "default"}
                        type="button"
                        title={preset || "default"}
                        aria-label={preset || "default"}
                        onClick={() => setForm((f) => ({ ...f, color: preset }))}
                        className={`h-5 w-5 rounded-full border ${
                          form.color === preset ? "ring-2 ring-accent" : "border-hairline"
                        }`}
                        style={{ background: preset || "var(--color-surface-alt)" }}
                      />
                    ))}
                    {colorPresets.length > COLOR_COLLAPSED && !colorExpanded && (
                      <button
                        type="button"
                        className="px-1 text-fine text-ink-tertiary hover:text-ink"
                        onClick={() => setColorExpanded(true)}
                      >
                        {t("editor.moreColors")}
                      </button>
                    )}
                  </div>
                  {/* 커스텀 헥사 코드(#RRGGBB) — 프리셋 외 임의 색. 좌측 미리보기 스와치. */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-5 w-5 shrink-0 rounded-full border border-hairline"
                      style={{ background: form.color || "var(--color-surface-alt)" }}
                    />
                    <input
                      type="text"
                      value={form.color}
                      onChange={(event) => setForm((f) => ({ ...f, color: event.target.value }))}
                      placeholder="#RRGGBB"
                      maxLength={7}
                      spellCheck={false}
                      aria-label={t("field.color")}
                      className="w-24 rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink"
                    />
                  </div>
                </div>
              </div>
              {/* BPM 속성 — 담당자/부서는 조회권한 보유자만 선택(F5), system/duration은 자유입력 */}
              {ATTR_FIELDS.map(({ key, labelKey }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="w-14 shrink-0 text-fine text-ink-tertiary">{t(labelKey)}</label>
                  {key === "assignee" ? (
                    <SearchSelect
                      value={form.assignee}
                      options={(eligible?.users ?? []).map((u) => ({
                        value: u.name,
                        label: u.name,
                        // 아이디·부서 표시(표시 전용) / 검색은 이름+아이디만(부서 제외)
                        sub: [u.id, u.department].filter(Boolean).join(" · ") || undefined,
                        keywords: u.id,
                      }))}
                      emptyLabel={t("summary.none")}
                      placeholder={t("field.searchPlaceholder")}
                      onChange={(value) => setForm((f) => ({ ...f, assignee: value }))}
                    />
                  ) : key === "department" ? (
                    <SearchSelect
                      value={form.department}
                      options={(eligible?.departments ?? []).map((d) => ({
                        value: d,
                        label: d,
                      }))}
                      emptyLabel={t("summary.none")}
                      placeholder={t("field.searchPlaceholder")}
                      onChange={(value) => setForm((f) => ({ ...f, department: value }))}
                    />
                  ) : (
                    <input
                      className="min-w-0 flex-1 rounded-sm border border-hairline px-2 py-1 text-caption"
                      value={form[key]}
                      onChange={(event) => {
                        const value = event.target.value;
                        setForm((f) => (key === "system" ? { ...f, system: value } : { ...f, duration: value }));
                      }}
                    />
                  )}
                </div>
              ))}
              {groupLabel && (
                <span className="text-fine text-ink-tertiary">
                  {t("summary.group")}: {groupLabel}
                </span>
              )}
            </div>
          )}

          {/* 선행/후행 — 클릭 시 그 노드 편집으로 전환(버퍼 변경 있으면 확인) */}
          <div className="grid grid-cols-2 gap-3 rounded-md border border-hairline p-2.5">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1 text-fine text-ink-tertiary">
                <ArrowLeft size={12} strokeWidth={1.5} /> {t("summary.predecessors")}
              </div>
              {predecessors.length ? (
                <div className="flex flex-wrap gap-1">
                  {predecessors.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => requestNavigate(n.id)}
                      className="max-w-full truncate rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink hover:border-accent hover:text-accent"
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-fine text-ink-tertiary">{t("summary.none")}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-end gap-1 text-fine text-ink-tertiary">
                {t("summary.successors")} <ArrowRight size={12} strokeWidth={1.5} />
              </div>
              {successors.length ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {successors.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => requestNavigate(n.id)}
                      className="max-w-full truncate rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink hover:border-accent hover:text-accent"
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="block text-right text-fine text-ink-tertiary">{t("summary.none")}</span>
              )}
            </div>
          </div>

          {hasChildren && (
            <div>
              <div className="text-fine text-ink-tertiary">{t("summary.subprocess")}</div>
              {/* 미리보기 우상단 — 호버 시에만 열기 버튼 노출 */}
              <div className="group relative mt-1 h-32 overflow-hidden rounded-sm border border-hairline">
                <ScopePreview fullGraph={fullGraph} scopeParentId={nodeId} interactive />
                {onOpenChild && (
                  <button
                    type="button"
                    title={t("summary.openSubprocess")}
                    aria-label={t("summary.openSubprocess")}
                    className="absolute right-1 top-1 rounded-xs border border-hairline bg-surface p-0.5 text-accent opacity-0 shadow-sm transition-opacity hover:bg-surface-alt group-hover:opacity-100"
                    onClick={onOpenChild}
                  >
                    <CornerDownRight size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="text-fine text-ink-tertiary">{t("summary.comments")}</div>
            {comments.length === 0 && <div className="text-ink-tertiary">{t("summary.none")}</div>}
            <ul className="mt-1 flex flex-col gap-1">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-sm bg-surface-alt px-2 py-1">
                  <span className="text-fine text-ink-tertiary">{comment.author}</span>
                  <div className="text-ink">{comment.body}</div>
                </li>
              ))}
            </ul>
            {!readOnly && !adding && (
              <button
                type="button"
                className="mt-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
                onClick={() => setAdding(true)}
              >
                {t("summary.addComment")}
              </button>
            )}
            {!readOnly && adding && (
              <div className="mt-1 flex flex-col gap-1">
                <textarea
                  className="rounded-sm border border-hairline px-2 py-1 text-caption"
                  rows={2}
                  placeholder={t("summary.commentPlaceholder")}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoFocus
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-sm border border-accent bg-accent-tint px-2 py-1 text-fine text-accent disabled:opacity-50"
                    disabled={submitting || !draft.trim()}
                    onClick={() => void submitComment()}
                  >
                    {t("summary.submit")}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary"
                    onClick={() => { setAdding(false); setDraft(""); setError(null); }}
                  >
                    {t("summary.cancel")}
                  </button>
                </div>
                {error && <span className="text-fine text-error">{error}</span>}
              </div>
            )}
          </div>
        </div>

        {/* 푸터 — 버퍼 편집: Esc=취소 / ⌘S=저장 힌트 + 취소·저장 버튼. readOnly면 닫기만. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline px-4 py-2">
          {readOnly ? (
            <>
              <span />
              <button
                type="button"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={onClose}
              >
                {t("summary.close")}
              </button>
            </>
          ) : (
            <>
              <span className="flex items-center gap-2 text-fine text-ink-tertiary">
                <span className="flex items-center gap-1">
                  <kbd className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5">Esc</kbd>
                  {t("summary.cancel")}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5">⌘S</kbd>
                  {t("editor.save")}
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={onClose}
                >
                  {t("summary.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus"
                  onClick={handleSave}
                >
                  {t("editor.save")}
                </button>
              </div>
            </>
          )}
        </div>

        {/* 저장하지 않은 변경 확인 — 선후행 이동 시 버퍼에 변경이 있으면 (저장/저장안함/취소) */}
        {pendingNav && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center p-4"
            style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
            onClick={() => setPendingNav(null)}
          >
            <div
              className="w-full max-w-[300px] rounded-sm border border-hairline bg-surface p-4"
              style={{ boxShadow: "var(--shadow-lg)" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-body-strong text-ink">
                <AlertTriangle size={18} strokeWidth={1.5} className="shrink-0 text-error" />
                {t("summary.unsavedTitle")}
              </div>
              <p className="mt-1.5 text-caption text-ink-secondary">{t("summary.unsavedBody")}</p>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setPendingNav(null)}
                >
                  {t("summary.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={navDiscardAndGo}
                >
                  {t("summary.discardAndGo")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-2.5 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus"
                  onClick={navSaveAndGo}
                >
                  {t("summary.saveAndGo")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
