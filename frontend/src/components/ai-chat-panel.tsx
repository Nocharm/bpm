"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import { Send } from "lucide-react";
import { useEffect, useState } from "react";

import { aiChat, getAiModels, type AiChatTurn, type AiProposal } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiChatPanelProps {
  versionId: number;
  parent: string | null;
  canEdit: boolean;
  onGraphProposal: (proposal: AiProposal) => void;
}

export function AiChatPanel({ versionId, parent, canEdit, onGraphProposal }: AiChatPanelProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");

  // 서빙 모델 목록 조회(진입 1회) — 첫 모델을 기본 선택
  useEffect(() => {
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
  }, []);

  const send = async () => {
    const instruction = input.trim();
    if (!instruction || busy) return;
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
      const proposal = await aiChat(versionId, parent, instruction, history, model || null);
      setMessages((prev) => [...prev, { role: "assistant", content: proposal.message }]);
      if (proposal.kind === "graph") {
        onGraphProposal(proposal);
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
      <div className="flex-1 overflow-y-auto p-3">
        {!canEdit && (
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
      </div>
      <div className="flex items-end gap-1 border-t border-hairline p-2">
        <textarea
          className="min-h-[36px] flex-1 resize-none rounded-sm border border-hairline px-2 py-1 text-caption"
          rows={2}
          placeholder={t("ai.placeholder")}
          value={input}
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
          disabled={busy || input.trim().length === 0}
          aria-label={t("ai.send")}
        >
          <Send size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
