"use client";

// 노드 더블클릭 요약 모달 — 전/후 단계, 하위 프로세스 프리뷰, 코멘트(읽기+추가), 메타.
// 바깥 클릭/Esc로 닫힘. readOnly면 코멘트 추가 숨김.

import { CornerDownRight, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { ScopePreview } from "@/components/scope-preview";
import { createComment, listComments, type CommentItem, type VersionGraph } from "@/lib/api";
import { type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

// 정보 수정 모달이 편집하는 필드 — 부분 패치
export type NodeEditPatch = Partial<{
  label: string;
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
  predecessors: string[];
  successors: string[];
  hasChildren: boolean;
  fullGraph: VersionGraph | null;
  readOnly: boolean;
  // 편집 데이터 + 패치 (readOnly면 입력 비활성)
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  colorPresets: string[];
  onPatch: (patch: NodeEditPatch) => void;
  // 제목 입력 확정(blur) 시 호출 — 이름 중복 고유화 적용
  onCommitLabel?: (label: string) => void;
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
  color,
  assignee,
  department,
  system,
  duration,
  colorPresets,
  onPatch,
  onCommitLabel,
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
  const attrValues = { assignee, department, system, duration };
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

  // Esc로 닫기
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

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
      className="absolute inset-0 z-[1200] flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="flex max-h-[80%] w-[420px] flex-col overflow-hidden rounded-sm border border-hairline bg-surface"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          {readOnly ? (
            <span className="flex-1 truncate text-body-strong text-ink">{title}</span>
          ) : (
            <input
              className="min-w-0 flex-1 rounded-sm border border-hairline px-2 py-1 text-body-strong text-ink"
              value={title}
              aria-label={t("field.title")}
              onChange={(event) => onPatch({ label: event.target.value })}
              onBlur={(event) => onCommitLabel?.(event.target.value)}
            />
          )}
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
            <div className="flex flex-col gap-2">
              {/* 유형 — 생성 시 고정, 변경 불가(읽기 전용 표시) */}
              <div className="flex items-center gap-2">
                <label className="w-14 shrink-0 text-fine text-ink-tertiary">{t("field.type")}</label>
                <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">{typeLabel}</span>
              </div>
              {/* 색 — 기본 1줄 + 더 보기 */}
              <div className="flex items-start gap-2">
                <span className="w-14 shrink-0 pt-1 text-fine text-ink-tertiary">{t("field.color")}</span>
                <div className="flex flex-wrap items-center gap-1">
                  {shownColors.map((preset) => (
                    <button
                      key={preset || "default"}
                      type="button"
                      title={preset || "default"}
                      aria-label={preset || "default"}
                      onClick={() => onPatch({ color: preset })}
                      className={`h-5 w-5 rounded-full border ${
                        color === preset ? "ring-2 ring-accent" : "border-hairline"
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
              </div>
              {/* BPM 속성 */}
              {ATTR_FIELDS.map(({ key, labelKey }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="w-14 shrink-0 text-fine text-ink-tertiary">{t(labelKey)}</label>
                  <input
                    className="min-w-0 flex-1 rounded-sm border border-hairline px-2 py-1 text-caption"
                    value={attrValues[key]}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (key === "assignee") onPatch({ assignee: value });
                      else if (key === "department") onPatch({ department: value });
                      else if (key === "system") onPatch({ system: value });
                      else onPatch({ duration: value });
                    }}
                  />
                </div>
              ))}
              {groupLabel && (
                <span className="text-fine text-ink-tertiary">
                  {t("summary.group")}: {groupLabel}
                </span>
              )}
            </div>
          )}

          <div>
            <div className="text-fine text-ink-tertiary">{t("summary.predecessors")}</div>
            <div className="text-ink">{predecessors.length ? predecessors.join(", ") : t("summary.none")}</div>
          </div>
          <div>
            <div className="text-fine text-ink-tertiary">{t("summary.successors")}</div>
            <div className="text-ink">{successors.length ? successors.join(", ") : t("summary.none")}</div>
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
      </div>
    </ModalBackdrop>
  );
}
