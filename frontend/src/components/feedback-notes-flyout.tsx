"use client";

// 피드백 노트 플라이아웃 — 목록 행에서 열어 내용 + 노트 로그를 보고 누구나 노트를 단다 (2026-08-19).
// body portal + fixed — 테이블 overflow-x-auto 안에서 열려 클리핑되는 것 방지(SearchSelect 선례).

import { Loader2, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { createFeedbackNote, listFeedbackNotes, type FeedbackNote } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { TimePills } from "@/components/time-pills";
import { UserPill } from "@/components/user-pill";

const PANEL_WIDTH = 360;
const VIEWPORT_MARGIN = 12;

export function FeedbackNotesFlyout({
  feedbackId,
  feedbackBody,
  anchor,
  onClose,
  onToast,
}: {
  feedbackId: number;
  feedbackBody: string;
  /** 트리거 버튼의 화면 좌표 — 패널을 그 아래에 띄운다 */
  anchor: { left: number; bottom: number };
  onClose: () => void;
  onToast: (message: string, tone?: "error") => void;
}) {
  const { t } = useI18n();
  const [nowMs] = useState(() => Date.now());
  const [notes, setNotes] = useState<FeedbackNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void listFeedbackNotes(feedbackId)
      .then((rows) => {
        if (alive) setNotes(rows);
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, [feedbackId]);

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

  const addNote = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const created = await createFeedbackNote(feedbackId, body);
      setNotes((prev) => [...(prev ?? []), created]);
      setDraft("");
    } catch (err) {
      onToast(humanizeApiError(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const left = Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
  return createPortal(
    <div
      ref={panelRef}
      data-id="feedback-notes-flyout"
      className="fixed z-[1250] flex max-h-[60vh] flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
      style={{ left: Math.max(VIEWPORT_MARGIN, left), top: anchor.bottom + 6, width: PANEL_WIDTH }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="text-caption-strong text-ink-secondary">{t("feedback.notes.title")}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("action.close")}
          className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
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
            {notes.map((note) => (
              <li key={note.id} className="flex flex-col gap-0.5 border-b border-hairline pb-2 last:border-0">
                <div className="flex items-center justify-between gap-2 text-fine text-ink-tertiary">
                  <UserPill loginId={note.author} />
                  <TimePills iso={note.created_at} nowMs={nowMs} />
                </div>
                <p className="whitespace-pre-wrap text-caption text-ink">{note.body}</p>
              </li>
            ))}
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
