"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Pause,
  Play,
  Route,
  Search,
  Send,
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
}

export function AiChatPanel({
  versionId,
  aiEnabled,
  canEdit,
  onGraphProposal,
  onOpsProposal,
  onHighlightNode,
  onToast,
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

  // 새 메시지·생각중 표시가 추가되면 항상 최신(하단)으로 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy]);

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

  const send = async () => {
    const instruction = input.trim();
    if (!instruction || busy || !aiEnabled) return;
    setInput("");
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
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) setShowToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
        }}
        onCopy={() => onToast?.(t("ai.copied"))}
        className="scrollbar-hidden min-h-0 flex-1 select-text overflow-y-auto p-3"
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
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 px-0.5 text-fine text-ink-tertiary">
              <Search size={13} strokeWidth={1.5} />
              {t("ai.analysisTitle")}
            </span>
            {findings.map((finding, index) => {
              const isHigh = finding.severity === "high";
              return (
                // finding 클릭 → 해당 노드 캔버스 하이라이트 (D4: 설명+하이라이트만)
                <button
                  key={`finding-${index}`}
                  type="button"
                  className="group flex w-full gap-2 rounded-sm border border-hairline bg-surface-alt p-2 text-left hover:bg-surface-pearl disabled:opacity-60"
                  onClick={() => onHighlightNode(finding.node_ids[0])}
                  disabled={finding.node_ids.length === 0}
                >
                  <span className={`mt-px shrink-0 ${isHigh ? "text-error" : "text-ink-tertiary"}`}>
                    {isHigh ? (
                      <AlertTriangle size={15} strokeWidth={1.6} />
                    ) : (
                      <Info size={15} strokeWidth={1.6} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-caption-strong text-ink">{finding.category}</span>
                      <span
                        className={`rounded-full px-1.5 py-px text-fine ${
                          isHigh ? "bg-error/10 text-error" : "bg-surface-pearl text-ink-tertiary"
                        }`}
                      >
                        {finding.severity}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-fine text-ink">{finding.message}</span>
                    {finding.suggestion && (
                      <span className="mt-1 block border-l-2 border-accent-tint-border pl-2 text-fine text-ink-tertiary">
                        {finding.suggestion}
                      </span>
                    )}
                  </span>
                  {finding.node_ids.length > 0 && (
                    <ArrowUpRight
                      size={13}
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
          <div className="mt-3 overflow-hidden rounded-sm border border-hairline bg-surface-alt">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-caption-strong text-ink">
                <Route size={14} strokeWidth={1.5} className="text-accent" />
                {t("ai.walkthrough")}
              </span>
              <div className="flex items-center gap-0.5">
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
            {/* 진행바 — 현재 스텝 비율 */}
            <div className="h-0.5 bg-surface-pearl">
              <div
                className="h-full bg-accent transition-all duration-350"
                style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
            <p className="px-2 py-2 text-fine text-ink">{steps[stepIndex]?.narration}</p>
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
      <div className="flex items-end gap-1 border-t border-hairline p-2">
        <textarea
          className="min-h-[36px] flex-1 resize-none rounded-sm border border-hairline px-2 py-1 text-caption disabled:bg-surface-alt"
          rows={2}
          placeholder={aiEnabled ? t("ai.placeholder") : t("ai.disabled")}
          value={input}
          disabled={!aiEnabled}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="rounded-sm border border-hairline p-2 hover:bg-surface-alt disabled:opacity-40"
          onClick={() => void send()}
          disabled={!aiEnabled || busy || input.trim().length === 0}
          aria-label={t("ai.send")}
        >
          <Send size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
