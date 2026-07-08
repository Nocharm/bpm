// AI 챗 서버 저장 히스토리 — 메시지 뷰모델 변환·낙관 표시용 로컬 메시지. 서버가 원장(localStorage 폐기).
import type { AiChatMessageRow } from "@/lib/api";

export interface ChatMessage {
  id: number; // 서버 메시지 id — 낙관(미저장 표시) 메시지는 음수 임시 id
  role: "user" | "assistant";
  content: string;
  at: number | null; // epoch ms — 렌더에서 KST 포맷
}

let localSeq = 0;

// 낙관 표시용 로컬 메시지 — Date.now()는 컴포넌트 밖 팩토리에서만(react-hooks/purity)
export function createLocalMessage(role: ChatMessage["role"], content: string): ChatMessage {
  localSeq -= 1;
  return { id: localSeq, role, content, at: Date.now() };
}

export function toChatMessage(row: AiChatMessageRow): ChatMessage {
  const at = Date.parse(row.created_at);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    at: Number.isNaN(at) ? null : at,
  };
}
