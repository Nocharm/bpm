import { describe, expect, it } from "vitest";

import {
  addCardAtStage, collapseEmptyStages, computeStages, groupByStage, hasEmptyStage, listDependencyLinks, moveCard, moveCardToStage,
  normalizeDependencies, orderKeyOf, renameDependency, reorderWithinStage, setPredecessors, settleCards, sortByStage, stripClientIds,
  swapCards, withClientIds,
} from "./plan-cards";

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

describe("plan-cards stages (explicit stage, depends_on invariant)", () => {
  const dep = (name: string, depends_on: string[]) => ({ ...card(name), depends_on });
  const names = (groups: { name: string }[][]) => groups.map((g) => g.map((c) => c.name));
  const deps = (cards: { name: string; depends_on: string[] }[], name: string) => cards.find((c) => c.name === name)?.depends_on;

  it("computeStages follows depends_on depth, ignores unknown names and breaks cycles", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["A"]), dep("D", ["B", "C"]), dep("E", ["ghost"])]);
    expect(keyed.map((c) => c.stage)).toEqual([0, 1, 1, 2, 0]);
    // 순환: 방문 중인 카드는 선행으로 치지 않아 Y=1(X를 0으로 봄), X=2 — 무한 재귀 없이 유한한 단계
    const cyclic = withClientIds([dep("X", ["Y"]), dep("Y", ["X"])]);
    expect(cyclic.map((c) => computeStages(cyclic).get(c.clientId))).toEqual([2, 1]);
  });
  it("stripClientIds drops the key and the stage", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"])]);
    expect(stripClientIds(keyed)).toEqual([dep("A", []), dep("B", ["A"])]);
  });
  it("groupByStage keeps array order inside a stage and keeps empty stages as gaps", () => {
    const keyed = withClientIds([dep("B", ["A"]), dep("A", []), dep("C", ["A"])]);
    expect(names(groupByStage(keyed))).toEqual([["A"], ["B", "C"]]);
    expect(sortByStage(keyed).map((c) => c.name)).toEqual(["A", "B", "C"]);
    const gapped = keyed.map((c) => (c.name === "A" ? c : { ...c, stage: 2 }));
    expect(names(groupByStage(gapped))).toEqual([["A"], [], ["B", "C"]]);
    expect(hasEmptyStage(gapped)).toBe(true);
    expect(hasEmptyStage(keyed)).toBe(false);
  });
  it("moveCardToStage moves only that card, rewrites its depends_on and leaves a gap for the vacated row", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["B"])]);
    const c = keyed[2];
    const up = moveCardToStage(keyed, c.clientId, 1);
    expect(deps(up, "C")).toEqual(["A"]);
    expect(names(groupByStage(up))).toEqual([["A"], ["B", "C"]]);
    // B(1단계)를 0단계로 — C는 자리를 지키고(2단계), 1단계가 비어 갭이 남는다. C의 선행 B는 직전 행이 비어 잠시 그대로
    const b = keyed[1];
    const lifted = moveCardToStage(keyed, b.clientId, 0);
    expect(names(groupByStage(lifted))).toEqual([["A", "B"], [], ["C"]]);
    expect(deps(lifted, "B")).toEqual([]);
    expect(deps(lifted, "C")).toEqual(["B"]);
    // 접으면 C가 1단계로 당겨진다. 선행 B는 이제 직전 행에 있으니 그대로 살아남는다(전부로 리셋하지 않는다)
    const settled = settleCards(lifted);
    expect(names(groupByStage(settled))).toEqual([["A", "B"], ["C"]]);
    expect(deps(settled, "C")).toEqual(["B"]);
    // 새 단계(마지막+1)
    const fresh = moveCardToStage(keyed, keyed[0].clientId, 3);
    expect(deps(fresh, "A")).toEqual(["C"]);
    expect(names(groupByStage(fresh))).toEqual([[], ["B"], ["C"], ["A"]]);
    // 제자리·혼자 있는 마지막 행을 새 단계로 = 같은 참조
    expect(moveCardToStage(keyed, c.clientId, 2)).toBe(keyed);
    expect(moveCardToStage(keyed, c.clientId, 3)).toBe(keyed);
  });
  it("moving a card away does not shift the cards that depended on it", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["A"]), dep("D", ["B"]), dep("E", ["D"])]);
    const b = keyed[1];
    const moved = settleCards(moveCardToStage(keyed, b.clientId, 0));
    expect(names(groupByStage(moved))).toEqual([["A", "B"], ["C"], ["D"], ["E"]]);
    expect(deps(moved, "D")).toEqual(["C"]);
    expect(deps(moved, "E")).toEqual(["D"]);
  });
  it("collapseEmptyStages renumbers densely and normalizeDependencies resets invalid predecessors only", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["A"]), dep("D", ["B"])]);
    const gapped = keyed.map((c) => (c.name === "D" ? { ...c, stage: 3 } : c));
    expect(collapseEmptyStages(gapped).map((c) => c.stage)).toEqual([0, 1, 1, 2]);
    expect(collapseEmptyStages(keyed)).toBe(keyed);
    expect(normalizeDependencies(keyed)).toBe(keyed);
    const broken = keyed.map((c) => (c.name === "D" ? { ...c, depends_on: ["ghost"] } : c.name === "A" ? { ...c, depends_on: ["B"] } : c));
    const fixed = normalizeDependencies(broken);
    expect(deps(fixed, "D")).toEqual(["B", "C"]);
    expect(deps(fixed, "A")).toEqual([]);
    expect(deps(fixed, "B")).toEqual(["A"]);
  });
  it("reorderWithinStage moves only inside its stage", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"]), dep("C", ["A"]), dep("D", ["A"])]);
    const d = keyed[3];
    expect(reorderWithinStage(keyed, d.clientId, 0).map((c) => c.name)).toEqual(["A", "D", "B", "C"]);
    expect(reorderWithinStage(keyed, d.clientId, 9).map((c) => c.name)).toEqual(["A", "B", "C", "D"]);
  });
  it("addCardAtStage appends with the previous row as predecessors", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"])]);
    const added = addCardAtStage(keyed, card("N"), "n1", 2);
    expect(added[2]).toMatchObject({ clientId: "n1", stage: 2, depends_on: ["B"] });
    expect(addCardAtStage(keyed, card("M"), "m1", 0)[2].depends_on).toEqual([]);
  });
  it("setPredecessors accepts only previous-row names and never an empty set", () => {
    const keyed = withClientIds([dep("A", []), dep("B", []), dep("C", ["A", "B"])]);
    const c = keyed[2];
    expect(deps(setPredecessors(keyed, c.clientId, ["B"]), "C")).toEqual(["B"]);
    expect(setPredecessors(keyed, c.clientId, [])).toBe(keyed);
    expect(setPredecessors(keyed, c.clientId, ["ghost"])).toBe(keyed);
    expect(setPredecessors(keyed, keyed[0].clientId, ["B"])).toBe(keyed);
  });
  it("listDependencyLinks pairs each card with its previous-row predecessors", () => {
    const keyed = withClientIds([dep("A", []), dep("B", []), dep("C", ["A", "B"]), dep("D", ["C"])]);
    const [a, b, c, d] = keyed;
    expect(listDependencyLinks(keyed)).toEqual([
      { from: a.clientId, to: c.clientId }, { from: b.clientId, to: c.clientId }, { from: c.clientId, to: d.clientId },
    ]);
  });
  it("renameDependency follows a renamed card", () => {
    const keyed = withClientIds([dep("A", []), dep("B", ["A"])]);
    expect(renameDependency(keyed, "A", "A2")[1].depends_on).toEqual(["A2"]);
    expect(renameDependency(keyed, "Z", "Q")).toBe(keyed);
  });
});
