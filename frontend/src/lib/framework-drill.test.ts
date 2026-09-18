import { afterEach, describe, expect, it } from "vitest";

import type { CategoryNode } from "@/lib/api";
import {
  DRILL_STATE_KEY,
  RECENT_CAP,
  bumpRecent,
  getCanvasState,
  getSiblingRows,
  layoutChips,
  orderChipsByRecency,
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

  it("sibling chips exclude L5 nodes and the current node resolves counts from the parent list", () => {
    const kids = [node(1, 4, { l5_count: 3 }), node(2, 5), node(3, 4)];
    expect(getSiblingRows(kids).map((n) => n.id)).toEqual([1, 3]);
    const chainNode = node(1, 4); // 체인 응답 — 카운트 0
    expect(resolveCurrentNode(chainNode, kids).l5_count).toBe(3);
    expect(resolveCurrentNode(chainNode, undefined)).toBe(chainNode);
  });

  it("orders chips current-first, then most recently opened, then original order", () => {
    const sibs = [node(1, 3), node(2, 3), node(3, 3), node(4, 3)];
    const ordered = orderChipsByRecency(sibs, 3, [4, 3, 1]);
    expect(ordered.map((s) => s.id)).toEqual([3, 4, 1, 2]);
    // 방문 기록이 없으면 현재 칩만 앞으로
    expect(orderChipsByRecency(sibs, 2, []).map((s) => s.id)).toEqual([2, 1, 3, 4]);
  });

  it("shows every chip in original order when they fit", () => {
    const sibs = [node(1, 3), node(2, 3), node(3, 3)];
    const widths = new Map([[1, 50], [2, 50], [3, 50]]);
    const out = layoutChips(sibs, orderChipsByRecency(sibs, 3, [3, 2]), widths, 200, 28, 6);
    expect(out.order.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(out.visibleCount).toBe(3);
  });

  it("on overflow fills by priority after reserving the more-button width", () => {
    const sibs = [node(1, 3), node(2, 3), node(3, 3), node(4, 3)];
    const widths = new Map([[1, 50], [2, 50], [3, 50], [4, 50]]);
    // 206 필요 > 150 가용 → more(28)+gap(6) 예약 후 116 안에 50+6+50=106 → 우선순위 앞 2개(현재 3, 최근 4)
    const out = layoutChips(sibs, orderChipsByRecency(sibs, 3, [4, 1]), widths, 150, 28, 6);
    expect(out.order.map((s) => s.id)).toEqual([3, 4, 1, 2]);
    expect(out.visibleCount).toBe(2);
  });

  it("keeps at least the current chip even when nothing fits", () => {
    const sibs = [node(1, 3), node(2, 3)];
    const widths = new Map([[1, 80], [2, 80]]);
    const out = layoutChips(sibs, orderChipsByRecency(sibs, 2, []), widths, 60, 28, 6);
    expect(out.order[0].id).toBe(2);
    expect(out.visibleCount).toBe(1);
  });
});
