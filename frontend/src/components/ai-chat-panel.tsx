"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Info,
  Lightbulb,
  Paperclip,
  Pause,
  Play,
  Route,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MarkdownView } from "@/components/markdown-view";
import {
  aiChat,
  getAiModels,
  type AiChatTurn,
  type AiFinding,
  type AiProposal,
  type AiStep,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiChatPanelProps {
  versionId: number;
  aiEnabled: boolean;
  canEdit: boolean;
  onGraphProposal: (proposal: AiProposal) => void;
  onOpsProposal: (proposal: AiProposal) => void;
  onHighlightNode: (nodeId: string) => void;
  onToast?: (message: string) => void;
  // graph/ops 제안 미리보기 — 캔버스에 미리 적용된 상태를 채팅 내 카드로 커밋/취소.
  aiPreviewActive?: boolean;
  onCommitPreview?: () => void;
  onDiscardPreview?: () => void;
  fontScale?: number; // 헤더 A−/A＋ 로 조절되는 스레드 상대 폰트 배율
  onAutoTitle?: (title: string) => void; // 마지막 답변 키워드로 자동 타이틀 보고
}

// 빠른 프롬프트 칩 — 아이콘 버튼(호버 시 이름·설명 툴팁). 클릭 시 라벨을 즉시 전송.
const QUICK_CHIPS = [
  { key: "ai.chipAnalyze", descKey: "ai.chipAnalyzeDesc", Icon: Search },
  { key: "ai.chipSummarize", descKey: "ai.chipSummarizeDesc", Icon: FileText },
  { key: "ai.chipWalkthrough", descKey: "ai.chipWalkthroughDesc", Icon: Route },
  { key: "ai.chipImprove", descKey: "ai.chipImproveDesc", Icon: Lightbulb },
] as const;

export function AiChatPanel({
  versionId,
  aiEnabled,
  canEdit,
  onGraphProposal,
  onOpsProposal,
  onHighlightNode,
  onToast,
  aiPreviewActive = false,
  onCommitPreview,
  onDiscardPreview,
  fontScale = 1,
  onAutoTitle,
}: AiChatPanelProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [findings, setFindings] = useState<AiFinding[]>([]); // 최근 analysis 결과 (Phase 4)
  const [steps, setSteps] = useState<AiStep[]>([]); // 워크스루 단계 (Phase 5)
  const [stepIndex, setStepIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 스레드가 하단에서 떨어져 있으면 "맨 아래로" 버튼 노출.
  const [showToBottom, setShowToBottom] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 입력 내용에 따라 textarea 높이 자동 확장(최대 max-h-32 = 128px)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  // 새 메시지·생각중 표시가 추가되면 항상 최신(하단)으로 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

  // 마지막 어시스턴트 답변에서 제목 키워드 추출 → 헤더 자동 타이틀
  useEffect(() => {
    if (!onAutoTitle) return;
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    if (!last) return;
    const heading = last.content.match(/^#{1,6}\s+(.+)$/m);
    const raw = (heading ? heading[1] : last.content)
      .replace(/[#>*`\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const title = raw.split(" ").slice(0, 6).join(" ").slice(0, 40);
    if (title) onAutoTitle(title);
  }, [messages, onAutoTitle]);

  // 서빙 모델 목록 조회(진입 1회, AI 활성일 때만) — 첫 모델을 기본 선택
  useEffect(() => {
    if (!aiEnabled) return;
    let alive = true;
    void getAiModels()
      .then((result) => {
        if (alive && result.models.length > 0) {
          setModels(result.models);
          setModel(result.models[0]);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [aiEnabled]);

  // 워크스루 스텝 변경 시 해당 노드 포커스 (공유 헬퍼 재사용).
  // 초기 마운트(창 열림)에는 포커스하지 않는다 — 창을 열 때 캔버스가 이동하지 않도록. 스텝이 실제로 바뀔 때만 이동.
  const focusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = steps.length > 0 ? `${stepIndex}:${steps[stepIndex]?.node_id ?? ""}` : "";
    if (focusKeyRef.current === null || key === focusKeyRef.current) {
      focusKeyRef.current = key; // 첫 실행(마운트)·변화 없음(StrictMode 재호출) → 포커스 생략
      return;
    }
    focusKeyRef.current = key;
    if (steps.length > 0 && steps[stepIndex]) {
      onHighlightNode(steps[stepIndex].node_id);
    }
  }, [steps, stepIndex, onHighlightNode]);

  // 자동재생 — 2.5초 간격, 마지막 스텝에서 정지 (D5)
  useEffect(() => {
    if (!autoplay || steps.length === 0) return;
    if (stepIndex >= steps.length - 1) {
      setAutoplay(false);
      return;
    }
    const timer = setTimeout(() => setStepIndex((index) => index + 1), 2500);
    return () => clearTimeout(timer);
  }, [autoplay, stepIndex, steps.length]);

  const send = async (override?: string) => {
    const instruction = (override ?? input).trim();
    if (!instruction || busy || !aiEnabled) return;
    if (override === undefined) setInput("");
    setBusy(true);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: instruction }];
    setMessages(nextMessages);
    // 최근 6턴만 history로 전송
    const history: AiChatTurn[] = nextMessages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    try {
      const proposal = await aiChat(versionId, instruction, history, model || null);
      // graph/ops/answer 활성 — 빈 message(핸들러 없는 kind)는 미지원 안내로 폴백 (규칙 ③b)
      const content = proposal.message || t("ai.unsupportedKind");
      setMessages((prev) => [...prev, { role: "assistant", content }]);
      setFindings(proposal.kind === "analysis" ? proposal.findings : []);
      setSteps(proposal.kind === "walkthrough" ? proposal.steps : []);
      setStepIndex(0);
      setAutoplay(false);
      if (proposal.kind === "graph") {
        onGraphProposal(proposal);
      } else if (proposal.kind === "ops") {
        onOpsProposal(proposal);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof Error ? err.message : t("ai.error") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {models.length > 0 && (
        <div className="flex items-center gap-1 border-b border-hairline p-2">
          <span className="text-fine text-ink-tertiary">{t("ai.model")}</span>
          <select
            className="min-w-0 flex-1 rounded-sm border border-hairline px-1 py-0.5 text-fine"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-label={t("ai.model")}
          >
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 헤더 경계 근처 페이드 — 스크롤 시 내용이 선에서 끊기지 않고 흐려지는 효과 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-surface to-transparent" />
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) setShowToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
        }}
        onCopy={() => onToast?.(t("ai.copied"))}
        style={{ zoom: fontScale }}
        className="scrollbar-hidden min-h-0 flex-1 select-text overflow-y-auto p-3 pt-4"
      >
        {!aiEnabled && (
          <p className="mb-2 rounded-sm bg-surface-alt p-2 text-fine text-ink-tertiary">
            {t("ai.disabled")}
          </p>
        )}
        {aiEnabled && !canEdit && (
          <p className="mb-2 text-fine text-ink-tertiary">{t("ai.readOnly")}</p>
        )}
        <ul className="flex flex-col gap-3">
          {messages.map((message, index) =>
            message.role === "user" ? (
              <li
                key={`${message.role}-${index}`}
                className="max-w-[80%] self-end whitespace-pre-wrap rounded-md rounded-br-sm bg-accent px-3 py-2 text-caption text-on-accent"
              >
                {message.content}
              </li>
            ) : (
              <li key={`${message.role}-${index}`} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Sparkles size={12} strokeWidth={1.5} />
                </span>
                <MarkdownView
                  source={message.content}
                  className="min-w-0 max-w-[80%] flex-1"
                  onCopy={() => onToast?.(t("ai.copied"))}
                />
              </li>
            ),
          )}
          {busy && (
            <li className="flex items-center gap-2 text-fine text-ink-tertiary">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
                <Sparkles size={12} strokeWidth={1.5} />
              </span>
              {t("ai.thinking")}
            </li>
          )}
        </ul>
        {findings.length > 0 && (
          <div className="mt-3 flex max-w-[80%] flex-col gap-2">
            <span className="flex items-center gap-1.5 px-0.5 text-caption-strong text-ink">
              <Search size={14} strokeWidth={1.6} className="text-accent" />
              {t("ai.analysisTitle")}
              <span className="rounded-full bg-surface-alt px-1.5 text-fine text-ink-tertiary">
                {findings.length}
              </span>
            </span>
            {findings.map((finding, index) => {
              const sev = finding.severity;
              // 심각도별 좌측 레일·아이콘 톤 — high=경고 빨강, medium=액센트, low=중성
              const rail =
                sev === "high"
                  ? "border-l-error"
                  : sev === "medium"
                    ? "border-l-accent"
                    : "border-l-divider";
              const iconTone =
                sev === "high"
                  ? "bg-error/10 text-error"
                  : sev === "medium"
                    ? "bg-accent-tint text-accent"
                    : "bg-surface-alt text-ink-tertiary";
              return (
                // finding 클릭 → 해당 노드 캔버스 하이라이트 (D4: 설명+하이라이트만)
                <button
                  key={`finding-${index}`}
                  type="button"
                  className={`group flex w-full gap-2.5 rounded-[3px] border border-l-[3px] border-hairline ${rail} bg-surface p-2.5 text-left shadow-sm hover:bg-surface-alt disabled:opacity-60`}
                  onClick={() => onHighlightNode(finding.node_ids[0])}
                  disabled={finding.node_ids.length === 0}
                >
                  <span
                    className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconTone}`}
                  >
                    {sev === "high" ? (
                      <AlertTriangle size={14} strokeWidth={1.7} />
                    ) : (
                      <Info size={14} strokeWidth={1.7} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-caption-strong text-ink">{finding.category}</span>
                      <span
                        className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase ${
                          sev === "high" ? "bg-error/10 text-error" : "bg-surface-alt text-ink-tertiary"
                        }`}
                      >
                        {finding.severity}
                      </span>
                    </span>
                    <span className="mt-1 block text-fine leading-relaxed text-ink">
                      {finding.message}
                    </span>
                    {finding.suggestion && (
                      <span className="mt-1.5 flex items-start gap-1.5 rounded-xs bg-accent-tint px-2 py-1 text-fine text-accent">
                        <Lightbulb size={13} strokeWidth={1.6} className="mt-px shrink-0" />
                        <span>{finding.suggestion}</span>
                      </span>
                    )}
                  </span>
                  {finding.node_ids.length > 0 && (
                    <ArrowUpRight
                      size={14}
                      strokeWidth={1.5}
                      className="mt-px shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {steps.length > 0 && (
          <div className="mt-3 max-w-[80%] overflow-hidden rounded-sm border border-hairline bg-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-hairline bg-surface-alt px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-caption-strong text-ink">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-accent">
                  <Route size={13} strokeWidth={1.7} />
                </span>
                {t("ai.walkthrough")}
              </span>
              <div className="flex items-center gap-0.5">
                {/* 스텝 진행 도트 — 현재/완료/예정 */}
                <span className="mr-1.5 flex items-center gap-1">
                  {steps.map((step, i) => (
                    <span
                      key={step.order}
                      className={`h-1.5 w-1.5 rounded-full ${
                        i === stepIndex
                          ? "bg-accent"
                          : i < stepIndex
                            ? "bg-accent/40"
                            : "border border-hairline bg-surface-pearl"
                      }`}
                    />
                  ))}
                </span>
                <span className="mr-1 text-fine tabular-nums text-ink-tertiary">
                  {stepIndex + 1} / {steps.length}
                </span>
                <button
                  type="button"
                  aria-label={t("ai.prevStep")}
                  className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
                  onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                  disabled={stepIndex === 0}
                >
                  <ChevronLeft size={16} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label={t("ai.nextStep")}
                  className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
                  onClick={() =>
                    setStepIndex((index) => Math.min(steps.length - 1, index + 1))
                  }
                  disabled={stepIndex === steps.length - 1}
                >
                  <ChevronRight size={16} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label={t("ai.autoplay")}
                  className={`rounded-sm p-1 hover:bg-surface-pearl ${autoplay ? "text-accent" : ""}`}
                  onClick={() => setAutoplay((value) => !value)}
                >
                  {autoplay ? (
                    <Pause size={16} strokeWidth={1.5} />
                  ) : (
                    <Play size={16} strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-start gap-2 px-2.5 py-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-on-accent">
                {stepIndex + 1}
              </span>
              <p className="text-caption leading-relaxed text-ink">{steps[stepIndex]?.narration}</p>
            </div>
          </div>
        )}
        {/* graph/ops 제안 미리보기 — 캔버스에 적용된 미리보기를 채팅 안에서 커밋/취소 */}
        {aiPreviewActive && (
          <div className="mt-3 max-w-[80%] overflow-hidden rounded-sm border border-accent-tint-border bg-surface shadow-md">
            <div className="flex items-center gap-2 border-b border-accent-tint-border bg-accent-tint px-2.5 py-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-accent">
                <Sparkles size={12} strokeWidth={1.8} />
              </span>
              <span className="text-caption-strong text-accent">{t("ai.previewTitle")}</span>
            </div>
            <div className="p-2.5">
              <p className="text-fine leading-relaxed text-ink">{t("ai.previewHint")}</p>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={onCommitPreview}
                  className="flex flex-1 items-center justify-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                >
                  <Check size={14} strokeWidth={1.8} />
                  {t("ai.previewAdd")}
                </button>
                <button
                  type="button"
                  onClick={onDiscardPreview}
                  className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                >
                  {t("approvers.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {showToBottom && (
        <button
          type="button"
          aria-label={t("ai.toBottom")}
          onClick={() =>
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
          }
          className="absolute bottom-2 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-surface text-ink-secondary shadow-lg hover:bg-surface-alt hover:text-accent"
        >
          <ChevronDown size={16} strokeWidth={1.5} />
        </button>
      )}
      </div>
      <div className="border-t border-hairline p-2">
        {/* 빠른 기능 — 첨부 + 아이콘 칩(호버 시 이름·설명 툴팁) */}
        <div className="mb-2 flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("ai.attach")}
            title={t("ai.attach")}
            onClick={() => onToast?.(t("ai.comingSoon"))}
            disabled={!aiEnabled}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-hairline text-ink-tertiary hover:border-accent hover:text-accent disabled:opacity-40"
          >
            <Paperclip size={16} strokeWidth={1.5} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-hairline" />
          {QUICK_CHIPS.map((chip) => (
            <div key={chip.key} className="group relative">
              <button
                type="button"
                disabled={!aiEnabled || busy}
                onClick={() => void send(t(chip.key))}
                aria-label={t(chip.key)}
                className="flex h-9 w-9 items-center justify-center rounded-sm border border-hairline text-ink-secondary hover:border-accent hover:bg-accent-tint hover:text-accent disabled:opacity-40"
              >
                <chip.Icon size={16} strokeWidth={1.5} />
              </button>
              {/* 호버 툴팁 — 기능 이름 + 짧은 설명 */}
              <div className="pointer-events-none absolute bottom-full left-0 z-10 mb-1.5 hidden w-44 rounded-sm border border-hairline bg-surface p-2 shadow-lg group-hover:block">
                <div className="text-caption-strong text-ink">{t(chip.key)}</div>
                <div className="mt-0.5 text-fine leading-snug text-ink-tertiary">
                  {t(chip.descKey)}
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* 입력 행 — 입력(자동 높이) + 전송 */}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className="scrollbar-hidden max-h-32 min-h-[36px] flex-1 resize-none rounded-md border border-hairline px-3 py-2 text-caption outline-none focus:border-accent disabled:bg-surface-alt"
            rows={1}
            placeholder={aiEnabled ? t("ai.placeholder") : t("ai.disabled")}
            value={input}
            disabled={!aiEnabled}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // ⌘/Ctrl+Enter=전송, Enter=줄바꿈. IME 조합 중(한글)엔 전송하지 않음.
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void send()}
            disabled={!aiEnabled || busy || input.trim().length === 0}
            aria-label={t("ai.send")}
          >
            <ArrowUp size={16} strokeWidth={1.8} />
          </button>
        </div>
        {/* 단축키 힌트 — keycap */}
        <div className="mt-1.5 flex gap-3 text-fine text-ink-tertiary">
          <span className="flex items-center gap-1">
            <kbd className="rounded-xs border border-hairline bg-surface-alt px-1 py-px text-[10px] text-ink-secondary">
              Enter
            </kbd>
            {t("ai.hintNewline")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-xs border border-hairline bg-surface-alt px-1 py-px text-[10px] text-ink-secondary">
              ⌘/Ctrl
            </kbd>
            +
            <kbd className="rounded-xs border border-hairline bg-surface-alt px-1 py-px text-[10px] text-ink-secondary">
              Enter
            </kbd>
            {t("ai.hintSend")}
          </span>
        </div>
      </div>
    </div>
  );
}
