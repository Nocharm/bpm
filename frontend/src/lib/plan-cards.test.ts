import { describe, expect, it } from "vitest";

import { orderKeyOf, stripClientIds, swapCards, withClientIds } from "./plan-cards";

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
});
