import { afterEach, describe, expect, it } from "vitest";

import type { CategoryNode } from "@/lib/api";
import {
  DRILL_STATE_KEY,
  RECENT_CAP,
  bumpRecent,
  getCanvasState,
  getSiblingRows,
  readPersistedDrill,
  resolveCurrentNode,
  writePersistedDrill,
} from "@/lib/framework-drill";

const node = (id: number, level: number, extra: Partial<CategoryNode> = {}): CategoryNode => ({
  id,
  code: `C${id}`,
  name: `Cat ${id}`,
  level,
  sort_order: id,
  child_count: 0,
  map_count: 0,
  linkage_map_id: null,
  can_edit_linkage: false,
  l5_count: 0,
  canvas_state: null,
  admin: null,
  slot_pending_count: 0,
  ...extra,
});

describe("framework-drill helpers", () => {
  afterEach(() => {
    window.localStorage.removeItem(DRILL_STATE_KEY);
  });

  it("persists the current id with the recent list and tolerates broken storage", () => {
    expect(readPersistedDrill()).toEqual({ currentId: null, recent: [] });
    writePersistedDrill({ currentId: 42, recent: [42, 7] });
    expect(readPersistedDrill()).toEqual({ currentId: 42, recent: [42, 7] });
    writePersistedDrill({ currentId: null, recent: [] });
    expect(readPersistedDrill()).toEqual({ currentId: null, recent: [] });
    window.localStorage.setItem(DRILL_STATE_KEY, "{broken");
    expect(readPersistedDrill()).toEqual({ currentId: null, recent: [] });
    // 구 포맷(recent 없음)·오염된 항목은 걸러낸다
    window.localStorage.setItem(DRILL_STATE_KEY, JSON.stringify({ currentId: "x", recent: [1, "b", null, 3] }));
    expect(readPersistedDrill()).toEqual({ currentId: null, recent: [1, 3] });
  });

  it("bumpRecent moves the id to the front, dedupes and caps", () => {
    expect(bumpRecent([3, 1], 1)).toEqual([1, 3]);
    expect(bumpRecent([], 9)).toEqual([9]);
    const full = Array.from({ length: RECENT_CAP }, (_, i) => i + 1000);
    const bumped = bumpRecent(full, 1);
    expect(bumped).toHaveLength(RECENT_CAP);
    expect(bumped[0]).toBe(1);
  });

  it("derives canvas state from the server field, falling back to linkage presence", () => {
    expect(getCanvasState(node(1, 5, { canvas_state: "confirmed" }))).toBe("confirmed");
    expect(getCanvasState(node(1, 5, { canvas_state: null, linkage_map_id: 9 }))).toBe("draft");
    expect(getCanvasState(node(1, 5, { canvas_state: null, linkage_map_id: null }))).toBe("none");
  });

  it("sibling rows exclude L5 nodes and the current node resolves counts from the parent list", () => {
    const kids = [node(1, 4, { l5_count: 3 }), node(2, 5), node(3, 4)];
    expect(getSiblingRows(kids).map((n) => n.id)).toEqual([1, 3]);
    const chainNode = node(1, 4); // 체인 응답 — 카운트 0
    expect(resolveCurrentNode(chainNode, kids).l5_count).toBe(3);
    expect(resolveCurrentNode(chainNode, undefined)).toBe(chainNode);
  });
});
