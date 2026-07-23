"use client";

// 인터뷰 좌측 패널 — 메시지 스트림(질문·선택지·알림) + 입력 + 첨부 (design 2026-07-23 §6)

import { useEffect, useRef, useState } from "react";
import { Headset, Info, Loader2, Paperclip, RotateCcw, Send } from "lucide-react";

import type { InterviewState } from "@/lib/api";
import { choiceOptionsOf } from "@/lib/interview";
import { ChoiceCard } from "@/components/interview/choice-card";
import { MarkdownView } from "@/components/markdown-view";

interface InterviewPanelProps {
  interview: InterviewState;
  busy: boolean;
  error: string | null;
  onSend: (content: string) => void;
  onChoose: (choiceId: string) => void;
  onRetry: () => void;
  onAttach: (file: File) => void;
}

export function InterviewPanel({
  interview, busy, error, onSend, onChoose, onRetry, onAttach,
}: InterviewPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const live = interview.messages.filter((m) => !m.superseded);
  const choices = interview.status === "active" ? choiceOptionsOf(live) : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [live.length, busy]);

  function submit() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    onSend(content);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-id="interview-panel">
      <ul ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {live.map((message) => (
          <li key={message.id} data-id={`iv-msg-${message.kind}`}>
            {message.role === "user" ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3 py-2 text-caption text-ink">
                  {message.content}
                </div>
              </div>
            ) : message.kind === "notice" ? (
              <div className="flex items-start gap-2 rounded-md bg-surface-alt px-3 py-2">
                <Info size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-tertiary" />
                <span className="text-fine text-ink-secondary">{message.content}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Headset size={12} strokeWidth={1.5} />
                </span>
                <MarkdownView source={message.content} className="min-w-0 max-w-[90%] flex-1" />
              </div>
            )}
          </li>
        ))}
        {choices ? (
          <li data-id="iv-choices" className="ml-7">
            <div className="grid gap-2">
              {choices.map((option) => (
                <ChoiceCard key={option.id} option={option} disabled={busy} onChoose={onChoose} />
              ))}
            </div>
          </li>
        ) : null}
        {busy ? (
          <li className="ml-7 flex items-center gap-2 text-caption text-ink-muted" data-id="iv-thinking">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
            Consultant is thinking…
          </li>
        ) : null}
        {error ? (
          <li className="rounded-md border border-error/40 bg-error/5 px-3 py-2 text-caption text-error" data-id="iv-error">
            {error}
            <button className="ml-2 inline-flex items-center gap-1 text-caption-strong" onClick={onRetry}>
              <RotateCcw size={16} strokeWidth={1.5} /> Retry
            </button>
          </li>
        ) : null}
      </ul>
      <div className="border-t border-hairline p-2">
        {interview.attachments.length > 0 ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {interview.attachments.map((a) => (
              <span
                key={a.id}
                className={
                  "rounded-xs px-1.5 py-0.5 text-fine " +
                  (a.status === "parsed" ? "bg-surface-alt text-ink-secondary" : "bg-error/10 text-error")
                }
                title={a.error || a.filename}
              >
                {a.filename}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <button
            className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt"
            title="Attach document (pdf, docx, xlsx, txt, md)"
            onClick={() => fileRef.current?.click()}
            data-id="iv-attach"
          >
            <Paperclip size={16} strokeWidth={1.5} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onAttach(file);
              e.target.value = "";
            }}
          />
          <textarea
            className="max-h-32 flex-1 resize-none rounded-sm border border-hairline bg-surface px-2 py-1.5 text-body outline-none focus:border-accent"
            rows={2}
            placeholder={interview.status === "active" ? "Type your answer…" : "Interview finished"}
            disabled={interview.status !== "active" || busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            data-id="iv-input"
          />
          <button
            className="rounded-sm bg-accent p-1.5 text-on-accent disabled:opacity-40"
            disabled={interview.status !== "active" || busy || !input.trim()}
            onClick={submit}
            data-id="iv-send"
          >
            <Send size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
