// AI 챗 다중 대화 스토어 — 세션(최대 4개) 직렬화/파싱·최오래 세션 선정. localStorage I/O는 호출자 몫.
import { genId } from "@/lib/id";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at?: number; // epoch ms — 표시/DB 대조용(구 포맷 메시지는 없음)
}

export interface ChatSession {
  id: string;
  createdAt: number; // epoch ms — "가장 오래전에 연" 판정 기준
  messages: ChatMessage[];
}

export interface ChatStore {
  sessions: ChatSession[]; // createdAt 오름차순(생성 순서) 유지
  activeId: string;
}

export const MAX_CHAT_SESSIONS = 4; // 동시 대화창 상한 — 초과 시 최오래 세션을 닫고 새로 연다
export const SESSION_MESSAGE_LIMIT = 40; // 세션당 저장 상한(최근 N개) — 용량 가드

function isChatMessage(item: unknown): item is ChatMessage {
  return (
    typeof item === "object" &&
    item !== null &&
    "role" in item &&
    "content" in item &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    (!("at" in item) || item.at === undefined || typeof item.at === "number")
  );
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isChatMessage);
}

function parseSession(value: unknown): ChatSession | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.createdAt !== "number") return null;
  return { id: record.id, createdAt: record.createdAt, messages: parseMessages(record.messages) };
}

export function createChatSession(now: number): ChatSession {
  return { id: genId(), createdAt: now, messages: [] };
}

export function createChatMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, at: Date.now() }; // 전송/수신 시각 스탬프
}

// 저장 raw 파싱 — 신 포맷({sessions, activeId, order?})과 구 포맷(메시지 배열, 단일 세션 이행) 모두 수용.
// order:"desc"(시간 역순 저장, 최근이 배열 앞)면 내부 표현(시간순 오름차순)으로 뒤집는다.
export function parseChatStore(raw: string | null, now: number): ChatStore | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    const messages = parseMessages(parsed);
    if (messages.length === 0) return null;
    const session: ChatSession = { ...createChatSession(now), messages };
    return { sessions: [session], activeId: session.id };
  }
  if (typeof parsed !== "object" || parsed === null || !("sessions" in parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.sessions)) return null;
  const isDesc = record.order === "desc";
  const sessions = record.sessions
    .map(parseSession)
    .filter((session): session is ChatSession => session !== null)
    .map((session) =>
      isDesc ? { ...session, messages: [...session.messages].reverse() } : session,
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_CHAT_SESSIONS);
  if (sessions.length === 0) return null;
  const activeId = sessions.some((session) => session.id === record.activeId)
    ? (record.activeId as string)
    : sessions[sessions.length - 1].id;
  return { sessions, activeId };
}

// 시간 역순(desc, 최근이 앞)으로 저장 — 세션 전환 시 앞쪽 청크(=최근)부터 읽는 로딩 전략과 정렬 일치.
export function serializeChatStore(store: ChatStore): string {
  return JSON.stringify({
    sessions: store.sessions.map((session) => ({
      ...session,
      messages: session.messages.slice(-SESSION_MESSAGE_LIMIT).reverse(),
    })),
    activeId: store.activeId,
    order: "desc",
  });
}

export function findOldestSession(sessions: ChatSession[]): ChatSession | null {
  let oldest: ChatSession | null = null;
  for (const session of sessions) {
    if (oldest === null || session.createdAt < oldest.createdAt) oldest = session;
  }
  return oldest;
}

// 대화 제목 — 첫 사용자 메시지에서 파생(공백 정리, 40자 컷). 없으면 빈 문자열(호출자가 "새 대화" 폴백).
export function deriveSessionTitle(session: ChatSession): string {
  const first = session.messages.find((message) => message.role === "user");
  if (!first) return "";
  return first.content.replace(/\s+/g, " ").trim().slice(0, 40);
}
