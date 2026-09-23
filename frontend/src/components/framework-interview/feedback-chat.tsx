"use client";

// 피드백 채팅 — 관계 캔버스(relations-step)와 그려진 카드(task-board 미리보기)가 공유하는 로그+작성창.

import { Loader2 } from "lucide-react";
import type { KeyboardEvent } from "react";

import { AiButton } from "@/components/ai-button";
import type { FwFeedbackEntry } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

interface FeedbackChatProps {
  log: FwFeedbackEntry[]; // session.feedback_log, scope로 필터해 보여준다(task면 task_pk 일치만)
  scope: "relations" | "task";
  taskPk?: number;
  busy: boolean;
  draft: string;
  onDraftChange: (v: string) => void; // 우클릭 "피드백에 언급"이 밖에서 텍스트를 끼워 넣을 수 있게 제어형
  onSend: (message: string) => void;
  placeholder: string;
}

export function FeedbackChat({ log, scope, taskPk, busy, draft, onDraftChange, onSend, placeholder }: FeedbackChatProps) {
  const { t } = useI18n();
  const entries = log.filter((entry) => entry.scope === scope && (scope !== "task" || entry.task_pk === taskPk));

  function handleSend() {
    const message = draft.trim();
    if (!message || busy) return;
    onSend(message);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-2" data-id="fw-feedback-chat">
      <div className="text-caption-strong text-ink">{t("fwConsult.feedbackTitle")}</div>
      <div className="flex flex-col gap-1.5">
        {entries.length === 0 && <div className="text-fine text-ink-tertiary">{t("fwConsult.feedbackEmpty")}</div>}
        {entries.map((entry, i) => (
          <div
            key={i}
            data-id={`fw-feedback-entry-${i}`}
            className="rounded-sm border border-hairline bg-surface-pearl px-2 py-1.5 text-fine text-ink"
          >
            <div className="mb-0.5 text-ink-tertiary">{formatKst(entry.at).split(" ")[1] ?? ""}</div>
            <div>{entry.message}</div>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-1.5">
        <textarea
          data-id="fw-feedback-input"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          className="flex-1 resize-none rounded-sm border border-hairline bg-surface px-2 py-1.5 text-fine text-ink outline-none focus:border-accent"
        />
        <AiButton
          data-id="fw-feedback-send"
          variant="inline"
          disabled={busy || !draft.trim()}
          icon={busy ? <Loader2 size={14} strokeWidth={1.5} className="shrink-0 animate-spin" /> : undefined}
          onClick={handleSend}
        >
          {t("fwConsult.feedbackSend")}
        </AiButton>
      </div>
    </div>
  );
}
