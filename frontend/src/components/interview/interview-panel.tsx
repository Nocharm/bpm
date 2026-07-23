"use client";

// 인터뷰 우측 대화 패널 — 메시지 스트림(마크다운)·퀵리플라이 보기·첨부 관리 (design 2026-07-23 §6)
// 선택지(맵 안) 비교는 캔버스 플로팅 창에서 — 여기서는 안내만. 노드 멘션은 window 이벤트로 수신.

import { useEffect, useRef, useState } from "react";
import {
  FileText, HardDrive, Headset, Info, Layers, Lightbulb, Loader2, Paperclip,
  RotateCcw, Send, SkipForward, Type, X,
} from "lucide-react";

import { getAiTips, type InterviewState } from "@/lib/api";
import { choiceOptionsOf } from "@/lib/interview";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkdownView } from "@/components/markdown-view";
import { QuestionOptions } from "@/components/interview/question-options";

// 프리뷰 노드 "Ask about this node" 버튼 → 입력창 멘션 삽입용 커스텀 이벤트 이름
export const MENTION_EVENT = "iv-mention";

// 채팅 글자 크기(px) — 브라우저별 저장. 기본 13(기존 14 caption보다 한 단계 작게)
const FONT_KEY = "bpm.consultChatFont";
const FONT_STEPS = [12, 13, 14, 16] as const;
const FONT_DEFAULT = 13;

const INPUT_MAX_LEN = 4000; // 백엔드 InterviewTurnIn.content max_length와 동일
const INPUT_MAX_PX = 128; // 입력창 자동 확장 상한 — max-h-32와 동기
const CHARCOUNT_SHOW_AT = INPUT_MAX_LEN - 400; // 상한 근접 시에만 카운터 노출

// 답변 대기 팁 — 서버 관리 팁(getAiTips) 우선, 미설정 시 i18n 폴백 (AI 챗과 동일 소스)
const TIP_KEYS = ["ai.tip1", "ai.tip2", "ai.tip3", "ai.tip4", "ai.tip5"] as const;

function readFontPx(): number {
  if (typeof window === "undefined") return FONT_DEFAULT;
  const stored = Number(window.localStorage.getItem(FONT_KEY));
  return (FONT_STEPS as readonly number[]).includes(stored) ? stored : FONT_DEFAULT;
}

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
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [fontPx, setFontPx] = useState(readFontPx);
  const [tips, setTips] = useState<string[]>([]);
  const [showAttachInfo, setShowAttachInfo] = useState(false);
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

  // 대기 팁 — 서버 관리 팁 1회 로드(실패 시 i18n 폴백 유지)
  useEffect(() => {
    let alive = true;
    void getAiTips()
      .then((result) => {
        if (alive && result.tips.length > 0) setTips(result.tips);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // `/` 단축키 — 입력 요소 밖에서 누르면 채팅 입력창 포커스 (플레이스홀더에 표기)
  useEffect(() => {
    const handleSlash = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
      )
        return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", handleSlash);
    return () => window.removeEventListener("keydown", handleSlash);
  }, []);

  // 전송/답변 후 포커스 복원 — busy 동안 disabled로 포커스가 풀리는 문제.
  // 보기 픽커(quickReplies)가 떠 있으면 픽커의 키보드 포커스를 뺏지 않는다(픽커 autofocus가 자식 effect로 선행).
  useEffect(() => {
    if (!busy && interview.status === "active" && quickReplies.length === 0)
      inputRef.current?.focus();
  }, [busy, interview.status, quickReplies.length]);

  // 입력창 높이 반응형 — 내용에 맞춰 min(1행)~INPUT_MAX_PX 자동 확장 (DOM만 조정, setState 없음)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_PX)}px`;
  }, [input]);

  function submit() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    onSend(content);
  }

  function changeFont(step: number) {
    const idx = (FONT_STEPS as readonly number[]).indexOf(fontPx);
    const next = FONT_STEPS[Math.min(FONT_STEPS.length - 1, Math.max(0, idx + step))];
    setFontPx(next);
    window.localStorage.setItem(FONT_KEY, String(next)); // 영속은 핸들러에서 (StrictMode effect 리셋 함정)
  }

  // 팁 로테이션 — 턴이 쌓일 때마다 다음 팁 (별도 상태 없이 렌더 파생)
  const tipCount = tips.length > 0 ? tips.length : TIP_KEYS.length;
  const tipText =
    tips.length > 0 ? tips[live.length % tipCount] : t(TIP_KEYS[live.length % tipCount]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-id="interview-panel">
      {/* 채팅 글자 크기 — .md는 자체 font-size(caption)가 있어 상속 개방 오버라이드 필요 */}
      <style>{`[data-id="interview-panel"] .md{font-size:inherit;}`}</style>
      <ul
        ref={listRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
        style={{ fontSize: fontPx }}
      >
        {live.map((message) => (
          <li key={message.id} data-id={`iv-msg-${message.kind}`}>
            {message.role === "user" ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3 py-2 text-ink">
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
              <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3 py-2 text-ink opacity-70">
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
          <li className="ml-7 flex flex-col items-start gap-1.5" data-id="iv-thinking">
            <span className="flex items-center gap-2 text-caption text-ink-muted">
              <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
              Consultant is thinking…
            </span>
            <span
              className="flex items-center gap-1.5 rounded-sm bg-accent-tint px-2 py-1 text-fine text-accent"
              data-id="iv-tip"
            >
              <Lightbulb size={12} strokeWidth={1.6} className="shrink-0" />
              {tipText}
            </span>
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
        <div className="mb-1 flex items-center justify-between">
          {/* 채팅 글자 크기 — 브라우저별 저장(localStorage) */}
          <div className="flex items-center gap-0.5 text-ink-tertiary">
            <Type size={12} strokeWidth={1.5} />
            <button
              className="rounded-xs px-1 py-0.5 text-fine hover:bg-surface-alt hover:text-ink disabled:opacity-40"
              title="Smaller text"
              disabled={fontPx === FONT_STEPS[0]}
              onClick={() => changeFont(-1)}
              data-id="iv-font-dec"
            >
              A−
            </button>
            <button
              className="rounded-xs px-1 py-0.5 text-fine hover:bg-surface-alt hover:text-ink disabled:opacity-40"
              title="Larger text"
              disabled={fontPx === FONT_STEPS[FONT_STEPS.length - 1]}
              onClick={() => changeFont(1)}
              data-id="iv-font-inc"
            >
              A+
            </button>
          </div>
          {interview.status === "active" && interview.current_stage !== "review" ? (
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
          ) : null}
        </div>
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
            title="Attach document"
            onClick={() => setShowAttachInfo(true)}
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
            className="max-h-32 min-h-9 flex-1 resize-none rounded-sm border border-hairline bg-surface px-2 py-1.5 text-body outline-none focus:border-accent"
            rows={1}
            maxLength={INPUT_MAX_LEN}
            placeholder={
              interview.status === "active" ? "Type your answer…  ( / to focus)" : "Interview finished"
            }
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
        {input.length >= CHARCOUNT_SHOW_AT ? (
          <div className="mt-0.5 pr-9 text-right text-fine text-ink-muted" data-id="iv-charcount">
            {input.length.toLocaleString()} / {INPUT_MAX_LEN.toLocaleString()}
          </div>
        ) : null}
      </div>
      {showAttachInfo ? (
        <ConfirmDialog
          title="Attach a document"
          message="The consultant reads the document and uses it as interview context."
          confirmLabel="Choose file"
          cancelLabel="Cancel"
          icon={<Paperclip size={22} strokeWidth={1.5} />}
          lines={[
            { icon: <FileText size={16} strokeWidth={1.5} />, text: "Formats: PDF, DOCX, XLSX, TXT, MD" },
            { icon: <HardDrive size={16} strokeWidth={1.5} />, text: "Max size: 20MB per file" },
          ]}
          onConfirm={() => {
            setShowAttachInfo(false);
            fileRef.current?.click();
          }}
          onClose={() => setShowAttachInfo(false)}
        />
      ) : null}
    </div>
  );
}
