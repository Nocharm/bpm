"use client";

// 피드백 노트 플라이아웃 — 목록 행에서 열어 내용 + 노트 로그를 보고 누구나 노트를 단다 (2026-08-19).
// 수정은 작성자만(직전 본문은 서버가 이력으로 보존) · 삭제는 아카이브까지만(영구삭제는 관리자 DB 테이블 퍼지).
// body portal + fixed — 테이블 overflow-x-auto 안에서 열려 클리핑되는 것 방지(SearchSelect 선례).

import { Archive, History, Loader2, MessageSquarePlus, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  archiveFeedbackNote,
  createFeedbackNote,
  listFeedbackNoteRevisions,
  listFeedbackNotes,
  updateFeedbackNote,
  type FeedbackNote,
  type FeedbackNoteRevision,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { TimePills } from "@/components/time-pills";
import { UserPill } from "@/components/user-pill";

const PANEL_WIDTH = 380;
const VIEWPORT_MARGIN = 12;

export function FeedbackNotesFlyout({
  feedbackId,
  feedbackBody,
  currentLoginId,
  isSysadmin,
  anchor,
  onClose,
  onToast,
}: {
  feedbackId: number;
  feedbackBody: string;
  currentLoginId: string;
  isSysadmin: boolean;
  /** 트리거 버튼의 화면 좌표 — 패널을 그 아래에 띄운다 */
  anchor: { left: number; bottom: number };
  onClose: () => void;
  onToast: (message: string, tone?: "error") => void;
}) {
  const { t } = useI18n();
  const [nowMs] = useState(() => Date.now());
  const [notes, setNotes] = useState<FeedbackNote[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<FeedbackNoteRevision[]>([]);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void listFeedbackNotes(feedbackId, showArchived)
      .then((rows) => {
        if (alive) setNotes(rows);
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, [feedbackId, showArchived]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && !panelRef.current?.contains(event.target)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      onToast(humanizeApiError(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const addNote = () =>
    run(async () => {
      const body = draft.trim();
      if (!body) return;
      const created = await createFeedbackNote(feedbackId, body);
      setNotes((prev) => [...(prev ?? []), created]);
      setDraft("");
    });

  const saveEdit = () =>
    run(async () => {
      if (!editing || !editing.body.trim()) return;
      const updated = await updateFeedbackNote(feedbackId, editing.id, editing.body.trim());
      setNotes((prev) => (prev ?? []).map((n) => (n.id === updated.id ? updated : n)));
      setEditing(null);
      onToast(t("feedback.notes.editedToast"));
    });

  const archive = (noteId: number) =>
    run(async () => {
      const updated = await archiveFeedbackNote(feedbackId, noteId);
      setNotes((prev) =>
        showArchived
          ? (prev ?? []).map((n) => (n.id === updated.id ? updated : n))
          : (prev ?? []).filter((n) => n.id !== updated.id),
      );
      onToast(t("feedback.notes.archivedToast"));
    });

  const toggleHistory = (noteId: number) =>
    run(async () => {
      if (historyFor === noteId) {
        setHistoryFor(null);
        return;
      }
      setRevisions(await listFeedbackNoteRevisions(feedbackId, noteId));
      setHistoryFor(noteId);
    });

  const left = Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
  return createPortal(
    <div
      ref={panelRef}
      data-id="feedback-notes-flyout"
      className="fixed z-[1250] flex max-h-[65vh] flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
      style={{ left: Math.max(VIEWPORT_MARGIN, left), top: anchor.bottom + 6, width: PANEL_WIDTH }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="text-caption-strong text-ink-secondary">{t("feedback.notes.title")}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-fine text-ink-tertiary">
            <input
              type="checkbox"
              checked={showArchived}
              data-id="feedback-notes-show-archived"
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            {t("feedback.notes.showArchived")}
          </label>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("action.close")}
            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* 내용 — 어떤 피드백의 노트인지 문맥 */}
        <p className="mb-2 whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1.5 text-fine text-ink-secondary">
          {feedbackBody}
        </p>
        {notes === null ? (
          <div className="flex justify-center py-4 text-ink-tertiary">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
          </div>
        ) : notes.length === 0 ? (
          <p className="py-3 text-center text-fine text-ink-tertiary">{t("feedback.notes.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => {
              const archived = note.archived_at !== null;
              const canEdit = note.author === currentLoginId && !archived;
              const canArchive = (note.author === currentLoginId || isSysadmin) && !archived;
              return (
                <li
                  key={note.id}
                  data-id={`feedback-note-${note.id}`}
                  className={`flex flex-col gap-0.5 border-b border-hairline pb-2 last:border-0 ${
                    archived ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-fine text-ink-tertiary">
                    <UserPill loginId={note.author} />
                    <div className="flex items-center gap-1">
                      <TimePills iso={note.created_at} nowMs={nowMs} />
                      {note.edited_at && (
                        <button
                          type="button"
                          onClick={() => void toggleHistory(note.id)}
                          data-id={`feedback-note-history-${note.id}`}
                          title={t("feedback.notes.history")}
                          className="inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 hover:bg-surface-alt hover:text-ink"
                        >
                          <History size={12} strokeWidth={1.5} />
                          {t("feedback.notes.edited")}
                        </button>
                      )}
                      {archived && (
                        <span className="rounded-sm bg-surface-alt px-1.5 py-0.5">
                          {t("feedback.notes.archived")}
                        </span>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: note.id, body: note.body })}
                          data-id={`feedback-note-edit-${note.id}`}
                          title={t("feedback.notes.edit")}
                          aria-label={t("feedback.notes.edit")}
                          className="rounded-sm p-0.5 hover:bg-surface-alt hover:text-ink"
                        >
                          <Pencil size={12} strokeWidth={1.5} />
                        </button>
                      )}
                      {canArchive && (
                        <button
                          type="button"
                          onClick={() => void archive(note.id)}
                          data-id={`feedback-note-archive-${note.id}`}
                          title={t("feedback.notes.archive")}
                          aria-label={t("feedback.notes.archive")}
                          className="rounded-sm p-0.5 hover:bg-surface-alt hover:text-error"
                        >
                          <Archive size={12} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>
                  {editing?.id === note.id ? (
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={editing.body}
                        autoFocus
                        rows={2}
                        maxLength={2000}
                        data-id={`feedback-note-edit-input-${note.id}`}
                        onChange={(event) => setEditing({ id: note.id, body: event.target.value })}
                        className="w-full resize-none rounded-sm border border-accent bg-surface px-2 py-1 text-caption text-ink focus:outline-none"
                      />
                      <div className="flex justify-end gap-2 text-fine">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="text-ink-secondary hover:underline"
                        >
                          {t("feedback.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={busy || !editing.body.trim()}
                          data-id={`feedback-note-edit-save-${note.id}`}
                          className="rounded-sm bg-accent px-2 py-0.5 text-surface hover:opacity-90 disabled:opacity-40"
                        >
                          {t("feedback.notes.save")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-caption text-ink">{note.body}</p>
                  )}
                  {/* 수정 이력 — 직전 본문 스냅샷(오래된 것부터) */}
                  {historyFor === note.id && (
                    <ul
                      data-id={`feedback-note-revisions-${note.id}`}
                      className="mt-1 flex flex-col gap-1 rounded-sm bg-surface-alt px-2 py-1.5"
                    >
                      {revisions.length === 0 ? (
                        <li className="text-fine text-ink-tertiary">{t("feedback.notes.historyEmpty")}</li>
                      ) : (
                        revisions.map((rev) => (
                          <li key={rev.id} className="flex flex-col gap-0.5">
                            <TimePills iso={rev.created_at} nowMs={nowMs} />
                            <p className="whitespace-pre-wrap text-fine text-ink-tertiary line-through">
                              {rev.body}
                            </p>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-hairline px-3 py-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          rows={2}
          data-id="feedback-note-input"
          placeholder={t("feedback.notes.placeholder")}
          className="min-h-[2.5rem] flex-1 resize-none rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void addNote()}
          disabled={busy || draft.trim().length === 0}
          data-id="feedback-note-add"
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1.5 text-fine text-surface hover:opacity-90 disabled:opacity-40"
        >
          <MessageSquarePlus size={14} strokeWidth={1.5} />
          {t("feedback.notes.add")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
