import { describe, expect, it } from "vitest";

import {
  MAX_CHAT_SESSIONS,
  SESSION_MESSAGE_LIMIT,
  createChatSession,
  deriveSessionTitle,
  findOldestSession,
  parseChatStore,
  serializeChatStore,
  type ChatSession,
} from "@/lib/chat-sessions";

const makeSession = (over: Partial<ChatSession> = {}): ChatSession => ({
  id: "s1",
  createdAt: 100,
  messages: [{ role: "user", content: "hello" }],
  ...over,
});

describe("parseChatStore", () => {
  it("returns null for null/invalid raw", () => {
    expect(parseChatStore(null, 100)).toBeNull();
    expect(parseChatStore("not json", 100)).toBeNull();
    expect(parseChatStore('{"foo":1}', 100)).toBeNull();
    expect(parseChatStore("42", 100)).toBeNull();
  });

  it("migrates a legacy message array into a single session", () => {
    const legacy = JSON.stringify([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "bogus", content: "drop me" },
      "junk",
    ]);
    const store = parseChatStore(legacy, 555);
    expect(store).not.toBeNull();
    expect(store!.sessions).toHaveLength(1);
    expect(store!.sessions[0].createdAt).toBe(555);
    expect(store!.sessions[0].messages).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    expect(store!.activeId).toBe(store!.sessions[0].id);
  });

  it("returns null for a legacy array with no valid messages", () => {
    expect(parseChatStore("[]", 100)).toBeNull();
    expect(parseChatStore('["junk"]', 100)).toBeNull();
  });

  it("round-trips a serialized store", () => {
    const a = makeSession({ id: "a", createdAt: 1 });
    const b = makeSession({ id: "b", createdAt: 2, messages: [] });
    const store = { sessions: [a, b], activeId: "b" };
    expect(parseChatStore(serializeChatStore(store), 999)).toEqual(store);
  });

  it("stores messages newest-first (order desc) but parses back to chronological", () => {
    const session = makeSession({
      messages: [
        { role: "user", content: "first", at: 10 },
        { role: "assistant", content: "second", at: 20 },
      ],
    });
    const raw = serializeChatStore({ sessions: [session], activeId: "s1" });
    const stored = JSON.parse(raw);
    expect(stored.order).toBe("desc");
    expect(stored.sessions[0].messages.map((m: { content: string }) => m.content)).toEqual([
      "second",
      "first",
    ]);
    // 내부 표현은 시간순 복원 + at 보존
    const parsed = parseChatStore(raw, 999)!;
    expect(parsed.sessions[0].messages).toEqual(session.messages);
  });

  it("keeps chronological order for v2 stores without order marker", () => {
    const raw = JSON.stringify({
      sessions: [
        {
          id: "s1",
          createdAt: 1,
          messages: [
            { role: "user", content: "first" },
            { role: "assistant", content: "second" },
          ],
        },
      ],
      activeId: "s1",
    });
    const parsed = parseChatStore(raw, 999)!;
    expect(parsed.sessions[0].messages.map((m) => m.content)).toEqual(["first", "second"]);
  });

  it("drops messages with a non-numeric at", () => {
    const raw = JSON.stringify({
      sessions: [
        {
          id: "s1",
          createdAt: 1,
          messages: [
            { role: "user", content: "ok", at: 5 },
            { role: "user", content: "bad", at: "yesterday" },
          ],
        },
      ],
      activeId: "s1",
    });
    expect(parseChatStore(raw, 999)!.sessions[0].messages).toEqual([
      { role: "user", content: "ok", at: 5 },
    ]);
  });

  it("drops malformed sessions and messages", () => {
    const raw = JSON.stringify({
      sessions: [
        makeSession({ id: "ok" }),
        { id: "no-created", messages: [] },
        { id: 7, createdAt: 1, messages: [] },
        {
          id: "dirty",
          createdAt: 2,
          messages: [{ role: "user", content: "keep" }, { role: "user" }, null],
        },
      ],
      activeId: "ok",
    });
    const store = parseChatStore(raw, 100);
    // createdAt 오름차순 정렬 — dirty(2) < ok(100)
    expect(store!.sessions.map((s) => s.id)).toEqual(["dirty", "ok"]);
    expect(store!.sessions[0].messages).toEqual([{ role: "user", content: "keep" }]);
  });

  it("returns null when no valid session remains", () => {
    const raw = JSON.stringify({ sessions: [{ bogus: true }], activeId: "x" });
    expect(parseChatStore(raw, 100)).toBeNull();
  });

  it("falls back to the newest session when activeId is dangling", () => {
    const raw = JSON.stringify({
      sessions: [makeSession({ id: "old", createdAt: 1 }), makeSession({ id: "new", createdAt: 9 })],
      activeId: "gone",
    });
    expect(parseChatStore(raw, 100)!.activeId).toBe("new");
  });

  it("clamps to MAX_CHAT_SESSIONS keeping the newest, ordered oldest-first", () => {
    const sessions = [1, 2, 3, 4, 5, 6].map((n) =>
      makeSession({ id: `s${n}`, createdAt: n * 10 }),
    );
    const store = parseChatStore(JSON.stringify({ sessions, activeId: "s6" }), 100);
    expect(store!.sessions).toHaveLength(MAX_CHAT_SESSIONS);
    expect(store!.sessions.map((s) => s.id)).toEqual(["s3", "s4", "s5", "s6"]);
  });
});

describe("serializeChatStore", () => {
  it("caps each session's messages to the most recent SESSION_MESSAGE_LIMIT", () => {
    const messages = Array.from({ length: SESSION_MESSAGE_LIMIT + 5 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
    }));
    const raw = serializeChatStore({ sessions: [makeSession({ messages })], activeId: "s1" });
    const stored = parseChatStore(raw, 100)!;
    expect(stored.sessions[0].messages).toHaveLength(SESSION_MESSAGE_LIMIT);
    expect(stored.sessions[0].messages[0].content).toBe("m5");
  });
});

describe("createChatSession", () => {
  it("creates an empty session stamped with now", () => {
    const session = createChatSession(777);
    expect(session.createdAt).toBe(777);
    expect(session.messages).toEqual([]);
    expect(session.id.length).toBeGreaterThan(0);
  });
});

describe("findOldestSession", () => {
  it("returns null for an empty list", () => {
    expect(findOldestSession([])).toBeNull();
  });

  it("picks the smallest createdAt; first wins on tie", () => {
    const first = makeSession({ id: "first", createdAt: 5 });
    const tie = makeSession({ id: "tie", createdAt: 5 });
    const newer = makeSession({ id: "newer", createdAt: 50 });
    expect(findOldestSession([newer, first, tie])).toBe(first);
  });
});

describe("deriveSessionTitle", () => {
  it("uses the first user message, whitespace collapsed, capped at 40 chars", () => {
    const session = makeSession({
      messages: [
        { role: "assistant", content: "greeting" },
        { role: "user", content: "  draft   the\n purchase   approval flow with extra words beyond forty chars " },
      ],
    });
    const title = deriveSessionTitle(session);
    expect(title.startsWith("draft the purchase approval flow")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(40);
  });

  it("returns empty string when there is no user message", () => {
    expect(deriveSessionTitle(makeSession({ messages: [] }))).toBe("");
    expect(
      deriveSessionTitle(makeSession({ messages: [{ role: "assistant", content: "x" }] })),
    ).toBe("");
  });
});
