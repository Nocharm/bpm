"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import { ChevronLeft, ChevronRight, Pause, Play, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
}

export function AiChatPanel({
  versionId,
  aiEnabled,
  canEdit,
  onGraphProposal,
  onOpsProposal,
  onHighlightNode,
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

  // 워크스루 스텝 변경 시 해당 노드 포커스 (공유 헬퍼 재사용)
  useEffect(() => {
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
      <div ref={scrollRef} className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-3">
        {!aiEnabled && (
          <p className="mb-2 rounded-sm bg-surface-alt p-2 text-fine text-ink-tertiary">
            {t("ai.disabled")}
          </p>
        )}
        {aiEnabled && !canEdit && (
          <p className="mb-2 text-fine text-ink-tertiary">{t("ai.readOnly")}</p>
        )}
        <ul className="flex flex-col gap-2">
          {messages.map((message, index) => (
            <li
              key={`${message.role}-${index}`}
              className={`max-w-[90%] rounded-md px-2 py-1 text-caption ${
                message.role === "user"
                  ? "self-end bg-accent-tint text-ink"
                  : "self-start bg-surface-alt text-ink"
              }`}
            >
              {message.content}
            </li>
          ))}
          {busy && <li className="self-start text-fine text-ink-tertiary">{t("ai.thinking")}</li>}
        </ul>
        {findings.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {findings.map((finding, index) => (
              <li key={`finding-${index}`}>
                {/* finding 클릭 → 해당 노드 캔버스 하이라이트 (D4: 설명+하이라이트만) */}
                <button
                  type="button"
                  className="w-full rounded-sm border border-hairline bg-surface-alt p-2 text-left hover:bg-surface-pearl disabled:opacity-60"
                  onClick={() => onHighlightNode(finding.node_ids[0])}
                  disabled={finding.node_ids.length === 0}
                >
                  <span
                    className={`text-caption-strong ${
                      finding.severity === "high" ? "text-error" : "text-ink-tertiary"
                    }`}
                  >
                    [{finding.severity}] {finding.category}
                  </span>
                  <span className="mt-0.5 block text-fine text-ink">{finding.message}</span>
                  {finding.suggestion && (
                    <span className="mt-0.5 block text-fine text-ink-tertiary">
                      → {finding.suggestion}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {steps.length > 0 && (
          <div className="mt-2 rounded-sm border border-hairline bg-surface-alt p-2">
            <div className="flex items-center justify-between">
              <span className="text-fine text-ink-tertiary">
                {stepIndex + 1} / {steps.length}
              </span>
              <div className="flex items-center gap-1">
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
            <p className="mt-1 text-fine text-ink">{steps[stepIndex]?.narration}</p>
          </div>
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
