"use client";

// 노드 더블클릭 요약 모달 — 전/후 단계, 하위 프로세스 프리뷰, 코멘트(읽기+추가), 메타.
// 바깥 클릭/Esc로 닫힘. readOnly면 코멘트 추가 숨김.

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Circle,
  CircleDot,
  CornerDownRight,
  Diamond,
  Square,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
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
import { addAssignee, driftedAssignees, formatAssignees, parseAssignees } from "@/lib/assignee";
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

const ATTR_FIELDS: { key: "system" | "duration"; labelKey: "field.system" | "field.duration" }[] = [
  { key: "system", labelKey: "field.system" },
  { key: "duration", labelKey: "field.duration" },
];

const COLOR_COLLAPSED = 5; // 색 스와치 기본 1줄 노출 수 — "더 보기"로 전체 펼침

// 선후행 칩의 노드 타입별 아이콘 (캔버스 노드타입 아이콘과 동일 매핑)
const NAV_TYPE_ICONS: Record<string, LucideIcon> = {
  process: Square,
  decision: Diamond,
  start: Circle,
  end: CircleDot,
  subprocess: Boxes,
};

// 선행/후행 노드 칩 — 타입 아이콘 + 라벨, 클릭 시 그 노드 편집으로 이동.
function NavChip({
  node,
  onClick,
}: {
  node: { id: string; label: string; nodeType: string };
  onClick: () => void;
}) {
  const Icon = NAV_TYPE_ICONS[node.nodeType] ?? Square;
  return (
    <button
      type="button"
      onClick={onClick}
      title={node.label}
      className="flex min-w-0 items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink hover:border-accent hover:text-accent"
    >
      <Icon size={11} strokeWidth={1.5} className="shrink-0" />
      <span className="min-w-0 truncate">{node.label}</span>
    </button>
  );
}

interface NodeSummaryModalProps {
  versionId: number;
  nodeId: string;
  title: string;
  typeLabel: string;
  groupLabel: string | null;
  predecessors: { id: string; label: string; nodeType: string }[];
  successors: { id: string; label: string; nodeType: string }[];
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
  // process·decision만 true — start/end/subprocess는 BPM 속성 입력 없음
  showAttributes: boolean;
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
  showAttributes,
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
  // 부서 변경 시 담당자가 있으면 확인 오버레이 표시 — 확인 후 담당자 초기화.
  const [pendingDept, setPendingDept] = useState<string | null>(null);
  const users = eligible?.users ?? [];
  const assignees = parseAssignees(form.assignee);
  const drifted = driftedAssignees(form.department, assignees, users);

  const changeDept = (dept: string) => {
    if (dept === form.department) return; // 같은 부서 재선택 — SearchSelect는 onChange를 항상 발화하므로 no-op(담당자 무단 초기화 방지)
    if (assignees.length > 0) {
      setPendingDept(dept);
    } else {
      setForm((f) => ({ ...f, department: dept, assignee: "" }));
    }
  };

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
        if (pendingDept) setPendingDept(null);
        else if (pendingNav) setPendingNav(null);
        else onClose();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!pendingNav && !pendingDept) handleSave();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleSave, onClose, pendingDept, pendingNav]);

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
              {/* BPM 속성 — process·decision만 표시. start/end/subprocess는 숨김 */}
              {showAttributes && (
                <>
                  {/* 부서 단일 픽커 — 변경 시 담당자 있으면 확인 오버레이 */}
                  <div className="flex items-center gap-2">
                    <label className="w-14 shrink-0 text-fine text-ink-tertiary">{t("field.department")}</label>
                    <SearchSelect
                      value={form.department}
                      options={(eligible?.departments ?? []).map((d) => ({ value: d, label: d }))}
                      emptyLabel={t("summary.none")}
                      placeholder={t("field.searchPlaceholder")}
                      onChange={changeDept}
                    />
                  </div>
                  {/* 담당자 칩 + 부서 필터링 추가 픽커 */}
                  <div className="flex items-start gap-2">
                    <label className="mt-1 w-14 shrink-0 text-fine text-ink-tertiary">{t("field.assignee")}</label>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {assignees.map((name) => {
                          const isDrift = drifted.includes(name);
                          return (
                            <span
                              key={name}
                              className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
                                isDrift ? "border-error/40 bg-error/10 text-error" : "border-hairline bg-surface-alt text-ink"
                              }`}
                            >
                              {name}
                              <button
                                type="button"
                                aria-label={t("summary.close")}
                                onClick={() =>
                                  setForm((f) => ({ ...f, assignee: formatAssignees(parseAssignees(f.assignee).filter((n) => n !== name)) }))
                                }
                              >
                                <X size={11} strokeWidth={1.5} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <SearchSelect
                        value=""
                        options={users
                          .filter((u) => form.department === "" || u.department === form.department)
                          .filter((u) => !assignees.includes(u.name))
                          .map((u) => ({ value: u.name, label: u.name, sub: [u.id, u.department].filter(Boolean).join(" · ") || undefined, keywords: u.id }))}
                        emptyLabel={t("field.assignee")}
                        placeholder={t("field.searchPlaceholder")}
                        onChange={(name) => {
                          if (!name) return;
                          const next = addAssignee(form.department, parseAssignees(form.assignee), name, users);
                          setForm((f) => ({ ...f, department: next.department, assignee: formatAssignees(next.assignees) }));
                        }}
                      />
                    </div>
                  </div>
                  {ATTR_FIELDS.map(({ key, labelKey }) => (
                    <div key={key} className="flex items-center gap-2">
                      <label className="w-14 shrink-0 text-fine text-ink-tertiary">{t(labelKey)}</label>
                      <input
                        className="min-w-0 flex-1 rounded-sm border border-hairline px-2 py-1 text-caption"
                        value={form[key]}
                        onChange={(event) => {
                          const value = event.target.value;
                          setForm((f) => (key === "system" ? { ...f, system: value } : { ...f, duration: value }));
                        }}
                      />
                    </div>
                  ))}
                </>
              )}
              {groupLabel && (
                <span className="text-fine text-ink-tertiary">
                  {t("summary.group")}: {groupLabel}
                </span>
              )}
            </div>
          )}

          {/* 선행/후행 — 타입 아이콘 칩(세로 나열)·가운데 세로선·양 가장자리 화살표(hover 시 Previous/Next). 클릭=그 노드 편집(변경 있으면 확인) */}
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-hairline">
            {/* 선행(좌) — 좌측 가장자리 화살표 */}
            <div className="group/prev flex min-w-0 items-stretch border-r border-hairline">
              <div className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 text-ink-tertiary">
                <ArrowLeft size={14} strokeWidth={1.5} />
                <span className="whitespace-nowrap text-[9px] leading-none opacity-0 transition-opacity group-hover/prev:opacity-100">
                  {t("summary.prev")}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5 pr-1.5">
                {predecessors.length ? (
                  predecessors.map((n) => (
                    <NavChip key={n.id} node={n} onClick={() => requestNavigate(n.id)} />
                  ))
                ) : (
                  <span className="text-fine text-ink-tertiary">{t("summary.none")}</span>
                )}
              </div>
            </div>
            {/* 후행(우) — 우측 가장자리 화살표 */}
            <div className="group/next flex min-w-0 items-stretch">
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5 pl-1.5">
                {successors.length ? (
                  successors.map((n) => (
                    <NavChip key={n.id} node={n} onClick={() => requestNavigate(n.id)} />
                  ))
                ) : (
                  <span className="text-fine text-ink-tertiary">{t("summary.none")}</span>
                )}
              </div>
              <div className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 text-ink-tertiary">
                <span className="whitespace-nowrap text-[9px] leading-none opacity-0 transition-opacity group-hover/next:opacity-100">
                  {t("summary.next")}
                </span>
                <ArrowRight size={14} strokeWidth={1.5} />
              </div>
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

        {/* 부서 변경 확인 — 담당자 있을 때 부서 변경 시 (확인/취소) */}
        {pendingDept !== null && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center p-4"
            style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
            onClick={() => setPendingDept(null)}
          >
            <div
              className="w-full max-w-[300px] rounded-sm border border-hairline bg-surface p-4"
              style={{ boxShadow: "var(--shadow-lg)" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-body-strong text-ink">
                <AlertTriangle size={18} strokeWidth={1.5} className="shrink-0 text-error" />
                {t("assignee.deptChangeTitle")}
              </div>
              <p className="mt-1.5 text-caption text-ink-secondary">{t("assignee.deptChangeBody")}</p>
              <div className="mt-3 flex justify-end gap-1.5">
                <button
                  type="button"
                  className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  onClick={() => setPendingDept(null)}
                >
                  {t("summary.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-2.5 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus"
                  onClick={() => {
                    setForm((f) => ({ ...f, department: pendingDept, assignee: "" }));
                    setPendingDept(null);
                  }}
                >
                  {t("editor.save")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
