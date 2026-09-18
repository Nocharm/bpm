import { afterEach, describe, expect, it } from "vitest";

import type { CategoryNode } from "@/lib/api";
import {
  DRILL_STATE_KEY,
  getCanvasState,
  getSiblingRows,
  pickVisibleChips,
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

  it("persists the current category id and tolerates broken storage", () => {
    expect(readPersistedDrill()).toBeNull();
    writePersistedDrill(42);
    expect(readPersistedDrill()).toBe(42);
    writePersistedDrill(null);
    expect(readPersistedDrill()).toBeNull();
    window.localStorage.setItem(DRILL_STATE_KEY, "{broken");
    expect(readPersistedDrill()).toBeNull();
    window.localStorage.setItem(DRILL_STATE_KEY, JSON.stringify({ currentId: "x" }));
    expect(readPersistedDrill()).toBeNull();
  });

  it("derives canvas state from the server field, falling back to linkage presence", () => {
    expect(getCanvasState(node(1, 5, { canvas_state: "confirmed" }))).toBe("confirmed");
    expect(getCanvasState(node(1, 5, { canvas_state: null, linkage_map_id: 9 }))).toBe("draft");
    expect(getCanvasState(node(1, 5, { canvas_state: null, linkage_map_id: null }))).toBe("none");
  });

  it("sibling chips exclude L5 nodes and the current node resolves counts from the parent list", () => {
    const kids = [node(1, 4, { l5_count: 3 }), node(2, 5), node(3, 4)];
    expect(getSiblingRows(kids).map((n) => n.id)).toEqual([1, 3]);
    const chainNode = node(1, 4); // 체인 응답 — 카운트 0
    expect(resolveCurrentNode(chainNode, kids).l5_count).toBe(3);
    expect(resolveCurrentNode(chainNode, undefined)).toBe(chainNode);
  });

  it("shows every chip when they fit, otherwise reserves the more-button width", () => {
    expect([...pickVisibleChips([50, 50, 50], 0, 200, 28, 6)]).toEqual([0, 1, 2]);
    // 156 필요 > 150 가용 → more(28)+gap(6) 예약 후 116 안에 50+6+50=106 → 2개
    expect([...pickVisibleChips([50, 50, 50], 0, 150, 28, 6)]).toEqual([0, 1]);
  });

  it("keeps the current chip visible by swapping it into the last slot", () => {
    expect([...pickVisibleChips([50, 50, 50, 50], 3, 150, 28, 6)]).toEqual([0, 3]);
    // 아무것도 안 들어가는 극단 폭에서도 현재 칩만은 남긴다
    expect([...pickVisibleChips([80, 80], 1, 60, 28, 6)]).toEqual([1]);
  });
});
