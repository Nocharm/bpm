import { describe, expect, it } from "vitest";

import type { AiChatMessageRow } from "./api";
import { createLocalMessage, toChatMessage, toPayload } from "./chat-sessions";

describe("chat-sessions view model", () => {
  it("converts a server row to a view message with epoch time", () => {
    const msg = toChatMessage({
      id: 12,
      role: "assistant",
      content: "안녕하세요",
      kind: "answer",
      payload: null,
      version_id: 3,
      created_at: "2026-07-08T10:00:00+09:00",
    });
    expect(msg).toEqual({
      id: 12,
      role: "assistant",
      content: "안녕하세요",
      at: Date.parse("2026-07-08T10:00:00+09:00"),
      kind: "answer",
      payload: null,
    });
  });

  it("keeps at null when created_at is unparsable", () => {
    const msg = toChatMessage({
      id: 1,
      role: "user",
      content: "x",
      kind: null,
      payload: null,
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

describe("kind/payload preservation (2026-07-10)", () => {
  it("toChatMessage preserves kind and payload", () => {
    const row: AiChatMessageRow = {
      id: 5,
      role: "assistant",
      content: "분석",
      kind: "analysis",
      payload: { findings: [{ severity: "high", category: "orphan", node_ids: [], message: "m", suggestion: "s" }] },
      version_id: 1,
      created_at: "2026-07-10T09:00:00+09:00",
    };
    const message = toChatMessage(row);
    expect(message.kind).toBe("analysis");
    expect(message.payload?.findings?.[0]?.category).toBe("orphan");
  });

  it("createLocalMessage defaults kind/payload to null", () => {
    const message = createLocalMessage("user", "hi");
    expect(message.kind).toBeNull();
    expect(message.payload).toBeNull();
  });

  it("toPayload maps kind-specific subsets and returns null for answer/empty", () => {
    const base = { message: "", nodes: [], edges: [], groups: [], ops: [], steps: [], findings: [] };
    const finding = { severity: "low" as const, category: "naming", node_ids: [], message: "m", suggestion: "" };
    expect(toPayload({ ...base, kind: "analysis", findings: [finding] })).toEqual({ findings: [finding] });
    expect(toPayload({ ...base, kind: "analysis" })).toBeNull(); // 빈 findings
    expect(toPayload({ ...base, kind: "answer" })).toBeNull();
    const node = { key: "a", title: "A", node_type: "start", description: "", attributes: null, group_key: null };
    expect(toPayload({ ...base, kind: "graph", nodes: [node] })).toEqual({ nodes: [node], edges: [], groups: [] });
    const op = { action: "remove" as const, node_id: "n1", node: null, source: null, target: null, label: null, title: null, attributes: null, description: null };
    expect(toPayload({ ...base, kind: "ops", ops: [op] })).toEqual({ ops: [op] });
  });
});
