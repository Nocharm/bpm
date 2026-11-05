// 실행 이력 묶기(lib/run-history) 테스트 — 이어진 같은 날·같은 단계 줄 묶기, 같은 사람 이름 생략, 같은 분 시각 생략, 날짜 구분, 노드 없는 줄.

import { describe, expect, it } from "vitest";

import type { RunHistoryItem } from "@/lib/api";
import { groupRunHistory } from "@/lib/run-history";

let nextId = 1;
function makeItem(overrides: Partial<RunHistoryItem>): RunHistoryItem {
  return {
    kind: "event",
    id: nextId++,
    actor: "kim",
    action: "complete",
    scope_path: "",
    node_id: "a",
    node_title: "접수",
    body: null,
    edited_at: null,
    created_at: "2026-11-05T10:00:00+09:00",
    ...overrides,
  };
}

const getDay = (iso: string) => iso.slice(0, 10);
const getMinute = (iso: string) => iso.slice(0, 16);

describe("groupRunHistory", () => {
  it("folds consecutive rows of the same step and hides a repeated actor", () => {
    const groups = groupRunHistory(
      [
        makeItem({ node_id: "b", action: "undo" }),
        makeItem({ node_id: "d", action: "cleared" }),
        makeItem({ node_id: "d", action: "complete" }),
        makeItem({ node_id: "d", kind: "comment", action: null, actor: "lee", body: "확인" }),
        makeItem({ node_id: "b", action: "complete" }),
      ],
      getDay,
      getMinute,
    );

    expect(groups.map((group) => [group.stepKey, group.entries.length])).toEqual([
      ["b", 1],
      ["d", 3],
      ["b", 1],
    ]);
    expect(groups[1].entries.map((entry) => entry.isSameActor)).toEqual([false, true, false]);
  });

  it("does not merge the same step across other steps or days, and marks new days", () => {
    const groups = groupRunHistory(
      [
        makeItem({ node_id: "a", created_at: "2026-11-06T09:00:00+09:00" }),
        makeItem({ node_id: "a", created_at: "2026-11-05T18:00:00+09:00" }),
        makeItem({ node_id: "a", created_at: "2026-11-05T17:00:00+09:00" }),
      ],
      getDay,
      getMinute,
    );

    expect(groups.map((group) => [group.day, group.isNewDay, group.entries.length])).toEqual([
      ["2026-11-06", true, 1],
      ["2026-11-05", true, 2],
    ]);
  });

  it("keeps rows without a node in their own group and keys sub map steps by scope", () => {
    const groups = groupRunHistory(
      [
        makeItem({ node_id: null, action: "reopen" }),
        makeItem({ node_id: null, action: "stop" }),
        makeItem({ scope_path: "sp", node_id: "x" }),
      ],
      getDay,
      getMinute,
    );

    expect(groups.map((group) => [group.stepKey, group.entries.length])).toEqual([
      [null, 2],
      ["sp/x", 1],
    ]);
  });

  it("writes a repeated minute once, across groups but not across days", () => {
    const groups = groupRunHistory(
      [
        makeItem({ node_id: "b", created_at: "2026-11-06T09:00:30+09:00" }),
        makeItem({ node_id: "a", created_at: "2026-11-06T09:00:10+09:00" }),
        makeItem({ node_id: "a", created_at: "2026-11-06T08:59:50+09:00" }),
        makeItem({ node_id: "a", created_at: "2026-11-05T08:59:50+09:00" }),
      ],
      getDay,
      getMinute,
    );

    expect(groups.flatMap((group) => group.entries.map((entry) => entry.isSameMinute))).toEqual([false, true, false, false]);
  });
});
