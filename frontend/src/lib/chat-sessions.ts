// AI 챗 서버 저장 히스토리 — 메시지 뷰모델 변환·낙관 표시용 로컬 메시지. 서버가 원장(localStorage 폐기).
import type { AiChatMessageRow, AiMessagePayload, AiProposal } from "@/lib/api";

export interface ChatMessage {
  id: number; // 서버 메시지 id — 낙관(미저장 표시) 메시지는 음수 임시 id
  role: "user" | "assistant";
  content: string;
  at: number | null; // epoch ms — 렌더에서 KST 포맷
  kind: string | null; // assistant만 — 메시지 부착 카드 판별
  payload: AiMessagePayload | null; // 카드 재현 원자료 — 없으면 텍스트만
}

let localSeq = 0;

// 낙관 표시용 로컬 메시지 — Date.now()는 컴포넌트 밖 팩토리에서만(react-hooks/purity)
export function createLocalMessage(
  role: ChatMessage["role"],
  content: string,
  kind: string | null = null,
  payload: AiMessagePayload | null = null,
): ChatMessage {
  localSeq -= 1;
  return { id: localSeq, role, content, at: Date.now(), kind, payload };
}

export function toChatMessage(row: AiChatMessageRow): ChatMessage {
  const at = Date.parse(row.created_at);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    at: Number.isNaN(at) ? null : at,
    kind: row.kind,
    payload: row.payload,
  };
}

// 라이브 제안 → 메시지 payload — 백엔드 저장 서브셋(_PAYLOAD_FIELDS)과 같은 규칙
export function toPayload(proposal: AiProposal): AiMessagePayload | null {
  switch (proposal.kind) {
    case "analysis":
      return proposal.findings.length > 0 ? { findings: proposal.findings } : null;
    case "walkthrough":
      return proposal.steps.length > 0 ? { steps: proposal.steps } : null;
    case "graph":
      return proposal.nodes.length > 0 || proposal.edges.length > 0 || proposal.groups.length > 0
        ? { nodes: proposal.nodes, edges: proposal.edges, groups: proposal.groups }
        : null;
    case "ops":
      return proposal.ops.length > 0 ? { ops: proposal.ops } : null;
    default:
      return null;
  }
}
