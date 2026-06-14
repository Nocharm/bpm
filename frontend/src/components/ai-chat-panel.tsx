"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import { Send } from "lucide-react";
import { useState } from "react";

import { aiChat, type AiChatTurn, type AiProposal } from "@/lib/api";
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
      const proposal = await aiChat(versionId, parent, instruction, history);
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
