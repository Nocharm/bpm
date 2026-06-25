import { describe, expect, it } from "vitest";

import { filterByQuery, matchTerm } from "@/lib/search";

describe("matchTerm", () => {
  it("substring (case-insensitive) returns char ranges", () => {
    expect(matchTerm("Kim Daeri", "kim")).toEqual([{ start: 0, end: 3 }]);
  });
  it("hangul chosung matches (index-aligned)", () => {
    // 결재 → ㄱㅈ
    expect(matchTerm("결재", "ㄱㅈ")).toEqual([{ start: 0, end: 2 }]);
  });
  it("roman initials of a Korean name", () => {
    // 결재 → g(ㄱ) j(ㅈ) → "gj"
    expect(matchTerm("결재", "gj")).toEqual([{ start: 0, end: 2 }]);
  });
  it("roman initials skip silent ㅇ", () => {
    // 이재 → ㅇ(skip) j(ㅈ) → roman "j"; match "j" covers the 재 syllable
    expect(matchTerm("이재", "j")).toEqual([{ start: 1, end: 2 }]);
  });
  it("returns null when nothing matches", () => {
    expect(matchTerm("Kim", "zzz")).toBeNull();
  });
  it("subsequence (order-only) matches as last resort", () => {
    // p·f·x가 순서대로 등장 (연속 아님) → subsequence 매치
    expect(matchTerm("prefix", "pfx")).not.toBeNull();
  });
  it("subsequence respects order", () => {
    // c가 a보다 뒤 → 순서 불일치 → null
    expect(matchTerm("abc", "ca")).toBeNull();
  });
});

describe("filterByQuery ordering (정확 > 접두 > 부분 > subsequence)", () => {
  const items = [
    { name: "axbxc" }, // subsequence
    { name: "xabc" }, // 부분
    { name: "abc" }, // 정확
    { name: "abcd" }, // 접두
  ];
  it("sorts hits by match quality", () => {
    const hits = filterByQuery(items, "abc", (i) => [{ field: "name", text: i.name }]);
    expect(hits.map((h) => h.item.name)).toEqual(["abc", "abcd", "xabc", "axbxc"]);
  });
});

describe("filterByQuery", () => {
  const users = [
    { name: "Kim Daeri", dept: "Procurement" },
    { name: "Lee Minjae", dept: "Sales" },
    { name: "결재팀장", dept: "Procurement" },
  ];
  const fields = (u: { name: string; dept: string }) => [
    { field: "name", text: u.name },
    { field: "dept", text: u.dept },
  ];

  it("empty query returns all with no matches", () => {
    const hits = filterByQuery(users, "", fields);
    expect(hits).toHaveLength(3);
    expect(hits[0].matches).toEqual([]);
  });
  it("comma = AND across terms (each term in any field)", () => {
    // "kim, procurement" → name matches kim AND dept matches procurement
    const hits = filterByQuery(users, "kim, procurement", fields);
    expect(hits.map((h) => h.item.name)).toEqual(["Kim Daeri"]);
  });
  it("department field search", () => {
    const hits = filterByQuery(users, "sales", fields);
    expect(hits.map((h) => h.item.name)).toEqual(["Lee Minjae"]);
  });
  it("collects highlight ranges per field", () => {
    const hits = filterByQuery(users, "kim", fields);
    const nameMatch = hits[0].matches.find((m) => m.field === "name");
    expect(nameMatch?.ranges).toEqual([{ start: 0, end: 3 }]);
  });
});
