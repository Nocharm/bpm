"use client";

// 인터뷰 우측 대화 패널 — 메시지 스트림(마크다운)·퀵리플라이 보기·첨부 관리 (design 2026-07-23 §6)
// 선택지(맵 안) 비교는 캔버스 플로팅 창에서 — 여기서는 안내만. 노드 멘션은 window 이벤트로 수신.
// 2026-07-26 리디자인: 스테이지 칩·전환 디바이더·메시지 그룹핑·typing dots·컴포저 카드·픽커 핀·스크롤 다운.

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, FileText, HardDrive, Headset, Info, Layers, Lightbulb, Paperclip,
  RotateCcw, Send, SkipForward, X,
} from "lucide-react";

import { getAiTips, type InterviewState } from "@/lib/api";
import { INTERVIEW_STAGES, choiceOptionsOf, stageIndex } from "@/lib/interview";
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
const SCROLL_DOWN_AT = 160; // 바닥에서 이만큼(px) 이상 올라가면 스크롤 다운 버튼 노출

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
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fontRef = useRef<HTMLDivElement>(null);

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

  function selectFont(px: number) {
    setFontPx(px);
    setFontOpen(false);
    window.localStorage.setItem(FONT_KEY, String(px)); // 영속은 핸들러에서 (StrictMode effect 리셋 함정)
    inputRef.current?.focus();
  }

  // 글자 크기 팝오버 — 바깥 클릭(capture)·Escape 닫힘
  useEffect(() => {
    if (!fontOpen) return;
    const handleDown = (event: PointerEvent) => {
      if (fontRef.current && !fontRef.current.contains(event.target as Node)) setFontOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFontOpen(false);
    };
    window.addEventListener("pointerdown", handleDown, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleDown, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [fontOpen]);

  // 스크롤 다운 버튼 — 바닥에서 일정 이상 올라갔을 때만 (setState는 스크롤 이벤트 핸들러에서)
  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > SCROLL_DOWN_AT);
  }

  // 팁 로테이션 — 턴이 쌓일 때마다 다음 팁 (별도 상태 없이 렌더 파생)
  const tipCount = tips.length > 0 ? tips.length : TIP_KEYS.length;
  const tipText =
    tips.length > 0 ? tips[live.length % tipCount] : t(TIP_KEYS[live.length % tipCount]);

  const stageIdx = stageIndex(interview.current_stage);
  const stageLabel = INTERVIEW_STAGES[stageIdx]?.label ?? interview.current_stage;

  // 컨설턴트 아바타 — 메시지 런 헤더·typing dots 공용
  const consultantBadge = (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
      <Headset size={12} strokeWidth={1.5} />
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-id="interview-panel">
      {/* 채팅 글자 크기 — .md는 자체 font-size(caption)가 있어 상속 개방 오버라이드 필요 */}
      <style>{`[data-id="interview-panel"] .md{font-size:inherit;}`}</style>
      {/* 현재 스테이지 칩 — 스트림 위 고정 */}
      <div
        className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-1.5"
        data-id="iv-stage-chip"
      >
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (interview.status === "active" ? "bg-accent" : "bg-ink-muted")
          }
        />
        <span className="text-caption-strong">{stageLabel}</span>
        <span
          className={
            "text-fine text-ink-muted" + (interview.status === "active" ? "" : " capitalize")
          }
        >
          {interview.status === "active"
            ? `Stage ${stageIdx + 1} of ${INTERVIEW_STAGES.length}`
            : interview.status}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <ul
          ref={listRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3"
          style={{ fontSize: fontPx }}
        >
          {live.map((message, i) => {
            const prev = live[i - 1];
            const stageChanged = message.stage !== prev?.stage;
            const dividerLabel = INTERVIEW_STAGES.find((s) => s.key === message.stage)?.label;
            const isConsultantBody = message.role === "consultant" && message.kind !== "notice";
            // 같은 스테이지에서 컨설턴트 메시지가 이어지면 헤더 생략 + 간격 축소 (메시지 그룹핑)
            const continuesRun =
              !stageChanged &&
              isConsultantBody &&
              prev?.role === "consultant" &&
              prev.kind !== "notice";
            return (
              <li
                key={message.id}
                className={continuesRun ? "mt-1.5" : "mt-4 first:mt-1"}
                data-id={`iv-msg-${message.kind}`}
              >
                {stageChanged && dividerLabel ? (
                  <div className="mb-3 flex items-center gap-2 pt-1" data-id="iv-stage-divider">
                    <span className="h-px flex-1 bg-hairline" />
                    <span className="text-fine text-ink-muted">{dividerLabel}</span>
                    <span className="h-px flex-1 bg-hairline" />
                  </div>
                ) : null}
                {message.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3.5 py-2 text-ink">
                      {message.content}
                    </div>
                  </div>
                ) : message.kind === "notice" ? (
                  <div className="flex items-start gap-2 rounded-md bg-surface-alt px-3 py-2">
                    <Info size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-tertiary" />
                    <span className="text-fine text-ink-secondary">{message.content}</span>
                  </div>
                ) : (
                  <>
                    {!continuesRun ? (
                      <div className="mb-1 flex items-center gap-1.5">
                        {consultantBadge}
                        <span className="text-fine font-semibold text-ink-secondary">Consultant</span>
                      </div>
                    ) : null}
                    <MarkdownView source={message.content} className="min-w-0 max-w-[92%]" />
                  </>
                )}
              </li>
            );
          })}
          {pending !== null ? (
            <li className="mt-4" data-id="iv-pending">
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-xs bg-accent-tint px-3.5 py-2 text-ink opacity-70">
                  {pending}
                </div>
              </div>
            </li>
          ) : null}
          {activeChoices && hasChoices ? (
            <li
              className="mt-4 flex items-center gap-2 rounded-md border border-accent-tint-border bg-accent-tint/50 px-3 py-2 text-caption text-ink-secondary"
              data-id="iv-choices-hint"
            >
              <Layers size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
              Compare the proposed maps on the canvas and pick one.
            </li>
          ) : null}
          {busy ? (
            <li className="mt-4" data-id="iv-thinking">
              <div className="flex items-center gap-1.5">
                {consultantBadge}
                <span className="inline-flex items-center gap-1 px-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-ink-muted"
                      style={{ animation: `lp-dot 1.1s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </span>
              </div>
              <div
                className="mt-1.5 flex items-start gap-1.5 pl-6.5 text-fine text-ink-muted"
                data-id="iv-tip"
              >
                <Lightbulb size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                {tipText}
              </div>
            </li>
          ) : null}
          {error ? (
            <li
              className="mt-4 rounded-md border border-error/40 bg-error/5 px-3 py-2 text-caption text-error"
              data-id="iv-error"
            >
              {error}
              <button className="ml-2 inline-flex items-center gap-1 text-caption-strong" onClick={onRetry}>
                <RotateCcw size={16} strokeWidth={1.5} /> Retry
              </button>
            </li>
          ) : null}
        </ul>
        {showScrollDown ? (
          <button
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-hairline bg-surface p-1.5 text-ink-secondary shadow-lg hover:bg-surface-alt"
            title="Scroll to latest"
            onClick={() =>
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
            }
            data-id="iv-scroll-down"
          >
            <ArrowDown size={14} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
      <div className="px-2 pb-2 pt-1.5">
        {/* 보기 픽커 — 스크롤에 밀리지 않게 컴포저 위 핀 고정 */}
        {quickReplies.length > 0 ? (
          <div className="mb-1.5" data-id="iv-quickreplies">
            <QuestionOptions
              options={quickReplies}
              disabled={busy}
              onSelect={onSend}
              onFreeType={() => inputRef.current?.focus()}
            />
          </div>
        ) : null}
        {/* 컴포저 카드 — 첨부·입력·액션을 한 카드로 통합, 포커스는 카드 테두리로 표시 */}
        <div
          className="rounded-lg border border-hairline bg-surface shadow-md transition-colors duration-150 focus-within:border-accent"
          data-id="iv-composer"
        >
          {interview.attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1 px-2.5 pt-2">
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
          <textarea
            ref={inputRef}
            className="max-h-32 min-h-9 w-full resize-none bg-transparent px-3 py-2 text-body outline-none"
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
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5 text-ink-tertiary">
            <button
              className="rounded-sm p-1.5 hover:bg-surface-alt hover:text-ink"
              title="Attach document"
              onClick={() => setShowAttachInfo(true)}
              data-id="iv-attach"
            >
              <Paperclip size={15} strokeWidth={1.5} />
            </button>
            <span className="mx-0.5 h-4 w-px bg-hairline" />
            {/* 채팅 글자 크기 — Aa 팝오버에서 4단계 직접 선택, 브라우저별 저장(localStorage) */}
            <div className="relative" ref={fontRef}>
              <button
                className={
                  "rounded-sm px-1.5 py-1 text-fine hover:bg-surface-alt hover:text-ink " +
                  (fontOpen ? "bg-surface-alt text-ink" : "")
                }
                title="Text size"
                onClick={() => setFontOpen((v) => !v)}
                data-id="iv-font"
              >
                Aa
              </button>
              {fontOpen ? (
                <div
                  className="absolute bottom-full left-0 z-20 mb-1.5 flex items-end gap-0.5 rounded-md border border-hairline bg-surface p-1 shadow-lg"
                  data-id="iv-font-pop"
                >
                  {FONT_STEPS.map((px) => (
                    <button
                      key={px}
                      className={
                        "flex w-8 flex-col items-center rounded-sm px-1 pb-0.5 pt-1 leading-none " +
                        (px === fontPx
                          ? "bg-accent-tint text-accent"
                          : "text-ink-secondary hover:bg-surface-alt")
                      }
                      title={`${px}px`}
                      onClick={() => selectFont(px)}
                      data-id={`iv-font-opt-${px}`}
                    >
                      <span style={{ fontSize: px }}>A</span>
                      <span className="mt-0.5 text-fine">{px}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {interview.status === "active" && interview.current_stage !== "review" ? (
              <>
                <span className="mx-0.5 h-4 w-px bg-hairline" />
                <button
                  className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-fine hover:bg-surface-alt hover:text-accent disabled:opacity-40"
                  title="Mark unanswered items as TBD and move on"
                  disabled={busy}
                  onClick={onSkip}
                  data-id="iv-skip-stage"
                >
                  <SkipForward size={12} strokeWidth={1.5} />
                  Skip stage
                </button>
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              {input.length >= CHARCOUNT_SHOW_AT ? (
                <span className="text-fine text-ink-muted" data-id="iv-charcount">
                  {input.length.toLocaleString()} / {INPUT_MAX_LEN.toLocaleString()}
                </span>
              ) : null}
              <button
                className="rounded-md bg-accent p-1.5 text-on-accent disabled:opacity-40"
                disabled={interview.status !== "active" || busy || !input.trim()}
                onClick={submit}
                data-id="iv-send"
              >
                <Send size={15} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
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
    </div>
  );
}
