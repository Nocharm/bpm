import { describe, expect, it } from "vitest";

import { computeStages, groupByStage, moveCard, moveCardToStage, orderKeyOf, renameDependency, reorderWithinStage, sortByStage, stripClientIds, swapCards, withClientIds } from "./plan-cards";

const card = (name: string) => ({ name, summary: "", owner_role: "", department: "", depends_on: [], mode: "new" as const, existing_code: null });

describe("plan cards", () => {
  it("withClientIds gives unique keys and stripClientIds removes them", () => {
    const keyed = withClientIds([card("A"), card("B")]);
    expect(new Set(keyed.map((c) => c.clientId)).size).toBe(2);
    expect(stripClientIds(keyed)).toEqual([card("A"), card("B")]);
    expect("clientId" in stripClientIds(keyed)[0]).toBe(false);
  });
  it("swapCards moves an item and keeps keys with items", () => {
    const keyed = withClientIds([card("A"), card("B"), card("C")]);
    const moved = swapCards(keyed, 0, 1);
    expect(moved.map((c) => c.name)).toEqual(["B", "A", "C"]);
    expect(moved[1].clientId).toBe(keyed[0].clientId);
    expect(swapCards(keyed, 0, -1)).toBe(keyed);
    expect(swapCards(keyed, 2, 1)).toBe(keyed);
  });
  it("orderKeyOf changes only when order changes", () => {
    const keyed = withClientIds([card("A"), card("B")]);
    expect(orderKeyOf(keyed)).toBe(orderKeyOf([...keyed]));
    expect(orderKeyOf(swapCards(keyed, 0, 1))).not.toBe(orderKeyOf(keyed));
  });
  it("moveCard lifts an item to the target slot and shifts the rest", () => {
    const keyed = withClientIds([card("A"), card("B"), card("C"), card("D")]);
    expect(moveCard(keyed, 0, 2).map((c) => c.name)).toEqual(["B", "C", "A", "D"]);
    expect(moveCard(keyed, 3, 1).map((c) => c.name)).toEqual(["A", "D", "B", "C"]);
    expect(moveCard(keyed, 1, 1)).toBe(keyed);
    expect(moveCard(keyed, 0, 4)).toBe(keyed);
  });
});

describe("plan-cards stages (depends_on)", () => {
  const dep = (name: string, depends_on: string[]) => ({ ...card(name), depends_on });
  it("computeStages follows depends_on depth, ignores unknown names and breaks cycles", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["A"]), dep("D", ["B", "C"]), dep("E", ["ghost"])]);
    const stages = keyed.map((c) => computeStages(keyed).get(c.clientId));
    expect(stages).toEqual([0, 1, 1, 2, 0]);
    // 순환: 방문 중인 카드는 선행으로 치지 않아 Y=1(X를 0으로 봄), X=2 — 무한 재귀 없이 유한한 단계
    const cyclic = withClientIds([dep("X", ["Y"]), dep("Y", ["X"])]);
    expect(cyclic.map((c) => computeStages(cyclic).get(c.clientId))).toEqual([2, 1]);
  });
  it("groupByStage keeps array order inside a stage and skips empty stages", () => {
    const keyed = withClientIds([dep("B", ["A"]), dep("A", []), dep("C", ["A"])]);
    expect(groupByStage(keyed).map((g) => g.map((c) => c.name))).toEqual([["A"], ["B", "C"]]);
    expect(sortByStage(keyed).map((c) => c.name)).toEqual(["A", "B", "C"]);
  });
  it("moveCardToStage rewrites depends_on to the previous stage and re-sorts", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["B"])]);
    const c = keyed[2];
    const up = moveCardToStage(keyed, c.clientId, 1);
    expect(up.find((x) => x.clientId === c.clientId)?.depends_on).toEqual(["A"]);
    expect(groupByStage(up).map((g) => g.map((x) => x.name))).toEqual([["A"], ["B", "C"]]);
    const first = moveCardToStage(keyed, c.clientId, 0);
    expect(first.find((x) => x.clientId === c.clientId)?.depends_on).toEqual([]);
    const fresh = moveCardToStage(keyed, keyed[0].clientId, 3);  // 마지막+1 = 새 단계
    expect(fresh.find((x) => x.clientId === keyed[0].clientId)?.depends_on).toEqual(["C"]);
    expect(moveCardToStage(keyed, c.clientId, 2)).toBe(keyed);
  });
  it("reorderWithinStage moves only inside its stage", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["A"]), dep("D", ["A"])]);
    const d = keyed[3];
    expect(reorderWithinStage(keyed, d.clientId, 0).map((c) => c.name)).toEqual(["A", "D", "B", "C"]);
    expect(reorderWithinStage(keyed, d.clientId, 9).map((c) => c.name)).toEqual(["A", "B", "C", "D"]);
  });
  it("renameDependency follows a renamed card", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"])]);
    expect(renameDependency(keyed, "A", "A2")[1].depends_on).toEqual(["A2"]);
    expect(renameDependency(keyed, "Z", "Q")).toBe(keyed);
  });
});
