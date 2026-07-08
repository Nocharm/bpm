import { describe, expect, it } from "vitest";

import { createLocalMessage, toChatMessage } from "./chat-sessions";

describe("chat-sessions view model", () => {
  it("converts a server row to a view message with epoch time", () => {
    const msg = toChatMessage({
      id: 12,
      role: "assistant",
      content: "안녕하세요",
      kind: "answer",
      version_id: 3,
      created_at: "2026-07-08T10:00:00+09:00",
    });
    expect(msg).toEqual({
      id: 12,
      role: "assistant",
      content: "안녕하세요",
      at: Date.parse("2026-07-08T10:00:00+09:00"),
    });
  });

  it("keeps at null when created_at is unparsable", () => {
    const msg = toChatMessage({
      id: 1,
      role: "user",
      content: "x",
      kind: null,
      version_id: null,
      created_at: "not-a-date",
    });
    expect(msg.at).toBeNull();
  });

  it("creates optimistic local messages with unique negative ids", () => {
    const a = createLocalMessage("user", "질문");
    const b = createLocalMessage("assistant", "답변");
    expect(a.id).toBeLessThan(0);
    expect(b.id).toBeLessThan(0);
    expect(a.id).not.toBe(b.id);
    expect(a.role).toBe("user");
    expect(typeof a.at).toBe("number");
  });
});
