// 고아 참조 카드 순수 로직 — 버킷·집계·정렬·맵 줄 요약·링 비율·적용 예고 (design 2026-10-23)
import { describe, expect, it } from "vitest";

import type { RefCard, RefCardLine, RefOutcome } from "@/lib/api";
import {
  OUTCOME_META,
  REMOVE_BLOCKED,
  SOURCE_ICON,
  bucketOf,
  buildRingGradient,
  forecastOutcomes,
  isLineCheckable,
  sortCards,
  summarizeMapRows,
  tallyCard,
} from "@/lib/ref-audit";

const line = (over: Partial<RefCardLine>): RefCardLine => ({
  source: "map_grant", target_id: "map_grant:1", from_value: "Old Team", count: 1, outcome: "direct",
  map_id: 1, map_name: "Map A", ...over,
});

const card = (label: string, lines: RefCardLine[]): RefCard => ({
  kind: "dept", key: label, label, sub: "Org / Division", lines,
});

// 설계 예시 카드: 고칠 곳 6(direct 3·checkout 1·new_draft 1·approval 1) + 알림 2
const exampleCard = card("Old Team", [
  line({ target_id: "map_grant:1", count: 3, outcome: "direct" }),
  line({ source: "node_dept", target_id: "node_dept:10", count: 1, outcome: "checkout", map_id: 2, map_name: "Map B" }),
  line({ source: "node_dept", target_id: "node_dept:11", count: 1, outcome: "new_draft", map_id: 3, map_name: "Map C" }),
  line({ source: "map_collab", target_id: "map_collab:5", count: 1, outcome: "approval", map_id: 4, map_name: "Map D" }),
  line({ source: "sp_dept", target_id: "sp_dept:6", count: 2, outcome: "notify", map_id: 5, map_name: "Map E" }),
]);

describe("bucketOf", () => {
  it("고칠 수 있는 4결과는 fix, 나머지는 각자 버킷", () => {
    for (const outcome of ["direct", "checkout", "new_draft", "approval"] as RefOutcome[]) {
      expect(bucketOf(outcome)).toBe("fix");
    }
    expect(bucketOf("notify")).toBe("notify");
    expect(bucketOf("locked")).toBe("lock");
    expect(bucketOf("pending")).toBe("pend");
  });
});

describe("tallyCard", () => {
  it("곳 수(count 합)를 버킷별로 센다", () => {
    expect(tallyCard(exampleCard)).toEqual({ fix: 6, notify: 2, lock: 0, pend: 0, places: 8 });
  });
  it("잠김·게시 대기도 places에 포함", () => {
    const t = tallyCard(card("X", [
      line({ outcome: "locked", count: 2 }),
      line({ outcome: "pending", count: 4 }),
    ]));
    expect(t).toEqual({ fix: 0, notify: 0, lock: 2, pend: 4, places: 6 });
  });
});

describe("sortCards", () => {
  it("전부 게시 대기인 카드는 맨 뒤, 나머지는 고칠 곳 내림차순 → 알림 내림차순 → 이름", () => {
    const pendOnly = card("A pending", [line({ outcome: "pending", count: 5 })]);
    const small = card("B small", [line({ outcome: "direct", count: 1 })]);
    const notifyHeavy = card("C notify", [line({ outcome: "notify", count: 9 })]);
    const big = card("D big", [line({ outcome: "direct", count: 4 })]);
    const tieA = card("E tie", [line({ outcome: "direct", count: 1 })]);
    const sorted = sortCards([pendOnly, small, notifyHeavy, big, tieA]);
    expect(sorted.map((c) => c.label)).toEqual(["D big", "B small", "E tie", "C notify", "A pending"]);
  });
  it("원본 배열을 바꾸지 않는다", () => {
    const a = card("A", [line({ outcome: "pending" })]);
    const b = card("B", [line({ outcome: "direct" })]);
    const input = [a, b];
    sortCards(input);
    expect(input.map((c) => c.label)).toEqual(["A", "B"]);
  });
});

describe("summarizeMapRows", () => {
  const three = card("Old Team", [
    line({ map_id: 1, map_name: "Map A", count: 5 }),
    line({ map_id: 2, map_name: "Map B", count: 2, target_id: "map_grant:2" }),
    line({ map_id: 3, map_name: "Map C", count: 1, target_id: "map_grant:3" }),
    line({ map_id: 3, map_name: "Map C", count: 2, target_id: "node_dept:4", source: "node_dept" }),
  ]);
  it("3개 이상이면 1위 + 나머지 합 한 줄(isMore)", () => {
    const rows = summarizeMapRows(three);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ key: "map:1", label: "Map A", count: 5, isGroup: false, isMore: false });
    expect(rows[1]).toMatchObject({ isMore: true, count: 5, label: "+2" });
  });
  it("외 N 라벨은 호출부가 정한다", () => {
    expect(summarizeMapRows(three, (rest) => `외 ${rest}개`)[1].label).toBe("외 2개");
  });
  it("2개 이하면 곳 수 내림차순 그대로, 그룹·카테고리는 isGroup", () => {
    const rows = summarizeMapRows(card("Old Team", [
      line({ map_id: 1, map_name: "Map A", count: 1 }),
      line({ source: "group_member", target_id: "group_member:9", map_id: null, map_name: null, group_id: 9, group_name: "Auditors", count: 3 }),
    ]));
    expect(rows).toEqual([
      { key: "group:9", label: "Auditors", count: 3, isGroup: true, isMore: false },
      { key: "map:1", label: "Map A", count: 1, isGroup: false, isMore: false },
    ]);
    const cat = summarizeMapRows(card("Old Team", [
      line({ source: "category_perm", target_id: "category_perm:2", map_id: null, map_name: null, category_id: 2, category_name: "Finance" }),
    ]));
    expect(cat[0]).toMatchObject({ key: "category:2", label: "Finance", isGroup: true });
  });
});

describe("buildRingGradient", () => {
  it("0인 구간은 생략하고 마지막 구간은 100%로 끝난다", () => {
    expect(buildRingGradient({ fix: 6, notify: 2, lock: 0, pend: 0 })).toBe(
      "conic-gradient(var(--color-added) 0% 75%, var(--color-warn) 75% 100%)",
    );
  });
  it("네 구간이 모두 있으면 순서는 고침·알림·잠김·게시 대기", () => {
    expect(buildRingGradient({ fix: 1, notify: 1, lock: 1, pend: 1 })).toBe(
      "conic-gradient(var(--color-added) 0% 25%, var(--color-warn) 25% 50%, "
      + "var(--color-border-strong) 50% 75%, var(--color-accent) 75% 100%)",
    );
  });
  it("전부 0이면 중립 한 색", () => {
    expect(buildRingGradient({ fix: 0, notify: 0, lock: 0, pend: 0 })).toBe(
      "conic-gradient(var(--color-border-strong) 0% 100%)",
    );
  });
  it("나누어떨어지지 않아도 마지막은 정확히 100%", () => {
    const g = buildRingGradient({ fix: 1, notify: 1, lock: 1, pend: 0 });
    expect(g.endsWith("100%)")).toBe(true);
    expect(g).toContain("33.33%");
  });
});

describe("forecastOutcomes / isLineCheckable", () => {
  it("체크된 줄의 결과별 곳 수 합 — 결과 순서는 고정", () => {
    const m = forecastOutcomes([
      { outcome: "notify", count: 2 },
      { outcome: "direct", count: 1 },
      { outcome: "direct", count: 3 },
      { outcome: "new_draft", count: 1 },
    ]);
    expect([...m.entries()]).toEqual([["direct", 4], ["new_draft", 1], ["notify", 2]]);
  });
  it("빈 입력이면 빈 Map", () => {
    expect(forecastOutcomes([]).size).toBe(0);
  });
  it("고침·알림만 체크할 수 있다", () => {
    for (const o of ["direct", "checkout", "new_draft", "approval", "notify"] as RefOutcome[]) {
      expect(isLineCheckable(o)).toBe(true);
    }
    expect(isLineCheckable("locked")).toBe(false);
    expect(isLineCheckable("pending")).toBe(false);
  });
});

describe("상수 표", () => {
  it("제거 금지 소스 3종", () => {
    expect([...REMOVE_BLOCKED].sort()).toEqual(["map_owner", "owning_dept", "sp_dept"]);
  });
  it("결과 7종 모두 메타가 있고 소스 12종 모두 아이콘이 있다", () => {
    expect(Object.keys(OUTCOME_META).sort()).toEqual(
      ["approval", "checkout", "direct", "locked", "new_draft", "notify", "pending"],
    );
    expect(Object.keys(SOURCE_ICON)).toHaveLength(12);
  });
});
