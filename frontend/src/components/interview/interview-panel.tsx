"use client";

// 인터뷰 우측 대화 패널 — 메시지 스트림(마크다운)·퀵리플라이 보기·첨부 관리 (design 2026-07-23 §6)
// 선택지(맵 안) 비교는 캔버스 플로팅 창에서 — 여기서는 안내만. 노드 멘션은 window 이벤트로 수신.

import { useEffect, useRef, useState } from "react";
import { Headset, Info, Layers, Loader2, Paperclip, RotateCcw, Send, SkipForward, X } from "lucide-react";

import type { InterviewState } from "@/lib/api";
import { choiceOptionsOf } from "@/lib/interview";
import { MarkdownView } from "@/components/markdown-view";
import { QuestionOptions } from "@/components/interview/question-options";

// 프리뷰 노드 "Ask about this node" 버튼 → 입력창 멘션 삽입용 커스텀 이벤트 이름
export const MENTION_EVENT = "iv-mention";

interface InterviewPanelProps {
  interview: InterviewState;
  busy: boolean;
  error: string | null;
  // 서버 반영 전의 낙관적 사용자 메시지 — 실패 시에도 유지되어 Retry 재전송 대상을 보여준다
  pending: string | null;
  hasChoices: boolean;
  onSend: (content: string) => void;
  onSkip: () => void;
  onRetry: () => void;
  onAttach: (file: File) => void;
  onDeleteAttachment: (attachmentId: number) => void;
}

export function InterviewPanel({
  interview, busy, error, pending, hasChoices, onSend, onSkip, onRetry, onAttach, onDeleteAttachment,
}: InterviewPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const live = interview.messages.filter((m) => !m.superseded);
  const last = live[live.length - 1];
  // 퀵리플라이 보기 — 마지막 메시지가 컨설턴트 질문 + options payload일 때만
  const quickReplies =
    interview.status === "active" && !busy && last?.role === "consultant" && last.kind === "question"
      ? ((last.payload as { options?: string[] } | null)?.options ?? [])
      : [];
  const activeChoices = interview.status === "active" ? choiceOptionsOf(live) : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [live.length, busy, pending]);

  // 프리뷰 노드 멘션 수신 — setState는 이벤트 핸들러 안에서만 (react-hooks/set-state-in-effect 준수)
  useEffect(() => {
    const handleMention = (event: Event) => {
      const label = (event as CustomEvent<string>).detail;
      if (!label) return;
      setInput((prev) => (prev ? `${prev} [노드: ${label}] ` : `[노드: ${label}] `));
      inputRef.current?.focus();
    };
    window.addEventListener(MENTION_EVENT, handleMention);
    return () => window.removeEventListener(MENTION_EVENT, handleMention);
  }, []);

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
        {pending !== null ? (
          <li data-id="iv-pending">
            <div className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3 py-2 text-caption text-ink opacity-70">
                {pending}
              </div>
            </div>
          </li>
        ) : null}
        {activeChoices && hasChoices ? (
          <li
            className="ml-7 flex items-center gap-2 rounded-md border border-accent-tint-border bg-accent-tint/50 px-3 py-2 text-caption text-ink-secondary"
            data-id="iv-choices-hint"
          >
            <Layers size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
            Compare the proposed maps on the canvas and pick one.
          </li>
        ) : null}
        {quickReplies.length > 0 ? (
          <li className="ml-7" data-id="iv-quickreplies">
            <QuestionOptions
              options={quickReplies}
              disabled={busy}
              onSelect={onSend}
              onFreeType={() => inputRef.current?.focus()}
            />
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
        {interview.status === "active" && interview.current_stage !== "review" ? (
          <div className="mb-1 flex justify-end">
            <button
              className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-accent disabled:opacity-40"
              title="Mark unanswered items as TBD and move on"
              disabled={busy}
              onClick={onSkip}
              data-id="iv-skip-stage"
            >
              <SkipForward size={12} strokeWidth={1.5} />
              Skip to next stage
            </button>
          </div>
        ) : null}
        {interview.attachments.length > 0 ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {interview.attachments.map((a) => (
              <span
                key={a.id}
                className={
                  "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-fine " +
                  (a.status === "parsed" ? "bg-surface-alt text-ink-secondary" : "bg-error/10 text-error")
                }
                title={a.error || a.filename}
                data-id="iv-attachment-chip"
              >
                {a.filename}
                <button
                  className="rounded-xs text-ink-muted hover:text-error"
                  title="Remove document"
                  onClick={() => onDeleteAttachment(a.id)}
                  data-id="iv-attachment-delete"
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
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
            ref={inputRef}
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
