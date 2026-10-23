// 고아 참조 히어로 순수 로직 — 숫자 3개·범위 칩·결과 칩 라벨·경우 8종 표·범례 (design 2026-10-23 §9)
import { describe, expect, it } from "vitest";

import type { RefAuditData, RefCard, RefCardLine, RefOutcome } from "@/lib/api";
import { messages } from "@/lib/i18n-messages";
import { OUTCOME_META, REMOVE_BLOCKED, SOURCE_ICON } from "@/lib/ref-audit";
import {
  HERO_VIEWBOX,
  OUTCOME_TIP_KEY,
  REF_AUDIT_CASES,
  REF_AUDIT_LEGEND,
  SETTINGS_CHIPS,
  getDeptCardView,
  getHeroStats,
  getMapRowKind,
  getOutcomeLabelKey,
  getScopeChips,
  getUserCardView,
  splitCaption,
} from "@/lib/ref-audit-view";

const line = (over: Partial<RefCardLine>): RefCardLine => ({
  source: "map_grant", target_id: "map_grant:1", from_value: "Old Team", count: 1, outcome: "direct",
  map_id: 1, map_name: "Map A", ...over,
});

const card = (kind: RefCard["kind"], label: string, lines: RefCardLine[]): RefCard => ({
  kind, key: label, label, sub: "", lines,
});

const data = (over: Partial<RefAuditData>): RefAuditData => ({
  departments: [], users: [], scope: { maps: 0, groups: 0, categories: 0 }, generated_at: "2026-10-23T09:00:00+09:00",
  ...over,
});

describe("getHeroStats", () => {
  it("returns zeros before the first scan", () => {
    expect(getHeroStats(null)).toEqual({ departments: 0, users: 0, fixPlaces: 0 });
  });

  it("counts cards per section and sums only fix-bucket places across both sections", () => {
    const page = data({
      departments: [
        card("dept", "Team B", [
          line({ count: 3, outcome: "direct" }),
          line({ count: 2, outcome: "notify" }),
          line({ count: 5, outcome: "locked" }),
        ]),
      ],
      users: [
        card("user", "User A", [
          line({ count: 2, outcome: "checkout" }),
          line({ count: 1, outcome: "new_draft" }),
          line({ count: 4, outcome: "pending" }),
        ]),
        card("user", "User B", [line({ count: 1, outcome: "approval" })]),
      ],
    });
    expect(getHeroStats(page)).toEqual({ departments: 1, users: 2, fixPlaces: 3 + 2 + 1 + 1 });
  });
});

describe("getScopeChips", () => {
  it("omits zero counts and keeps maps, groups, categories order", () => {
    expect(getScopeChips({ maps: 5, groups: 0, categories: 2 })).toEqual([
      { kind: "maps", count: 5 },
      { kind: "categories", count: 2 },
    ]);
  });

  it("returns nothing for an empty or missing scope", () => {
    expect(getScopeChips({ maps: 0, groups: 0, categories: 0 })).toEqual([]);
    expect(getScopeChips(null)).toEqual([]);
    expect(getScopeChips(undefined)).toEqual([]);
  });
});

describe("splitCaption", () => {
  it("splits at the space nearest the middle", () => {
    expect(splitCaption("Name only remains")).toEqual(["Name only", "remains"]);
    expect(splitCaption("이름만 남음")).toEqual(["이름만", "남음"]);
  });

  it("keeps a single word on one line", () => {
    expect(splitCaption("Removed")).toEqual(["Removed", ""]);
  });
});

describe("getOutcomeLabelKey", () => {
  it("names the recipient role for notify", () => {
    expect(getOutcomeLabelKey("notify", "owner")).toBe("refAudit.notify.owner");
    expect(getOutcomeLabelKey("notify", "holder")).toBe("refAudit.notify.holder");
  });

  it("falls back to the plain outcome label without a role and for other outcomes", () => {
    expect(getOutcomeLabelKey("notify")).toBe(OUTCOME_META.notify.labelKey);
    expect(getOutcomeLabelKey("direct", "owner")).toBe(OUTCOME_META.direct.labelKey);
  });
});

describe("REF_AUDIT_CASES", () => {
  it("has exactly 8 cases with unique ids and positions inside the figure", () => {
    expect(REF_AUDIT_CASES).toHaveLength(8);
    expect(new Set(REF_AUDIT_CASES.map((c) => c.id)).size).toBe(8);
    for (const c of REF_AUDIT_CASES) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(100);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(100);
      expect(SOURCE_ICON[c.id]).toBeDefined();
    }
  });

  it("never offers remove where the server blocks it", () => {
    for (const c of REF_AUDIT_CASES) {
      if (REMOVE_BLOCKED.has(c.id) && c.id !== "sp_dept") expect(c.remove).toBe(false);
    }
    // 하위프로세스 지정은 부서(대체만)와 담당자(제거 가능)가 한 칸이다
    expect(REF_AUDIT_CASES.find((c) => c.id === "sp_dept")?.remove).toBe("assignee");
  });

  it("pins the first four buttons to the right edge of their settings chips", () => {
    const fromChips = SETTINGS_CHIPS.map((chip) => Math.round(((chip.x + chip.w) / HERO_VIEWBOX.width) * 10000) / 100);
    expect(REF_AUDIT_CASES.slice(0, 4).map((c) => c.x)).toEqual(fromChips);
  });

  it("has en and ko copy for every case key without an em dash", () => {
    for (const c of REF_AUDIT_CASES) {
      const keys = [c.labelKey, c.whereKey, c.whoKey, ...(c.note ? [c.note.key] : [])];
      for (const key of keys) {
        for (const lang of ["en", "ko"] as const) {
          const text = messages[lang][key];
          expect(text, `${lang} ${key}`).toBeTruthy();
          expect(text, `${lang} ${key}`).not.toContain("—");
        }
      }
    }
  });
});

describe("REF_AUDIT_LEGEND", () => {
  it("lists every outcome once with a hover tip in both languages", () => {
    const outcomes: RefOutcome[] = ["direct", "checkout", "new_draft", "approval", "notify", "locked", "pending"];
    expect([...REF_AUDIT_LEGEND].sort()).toEqual([...outcomes].sort());
    for (const outcome of REF_AUDIT_LEGEND) {
      for (const lang of ["en", "ko"] as const) {
        const text = messages[lang][OUTCOME_TIP_KEY[outcome]];
        expect(text, `${lang} ${outcome}`).toBeTruthy();
        expect(text).not.toContain("—");
      }
    }
  });
});

describe("refAudit copy", () => {
  it("has no em dash in any refAudit string", () => {
    for (const lang of ["en", "ko"] as const) {
      for (const [key, text] of Object.entries(messages[lang])) {
        if (key.startsWith("refAudit.")) expect(text, `${lang} ${key}`).not.toContain("—");
      }
    }
  });
});

describe("getDeptCardView", () => {
  const moreLabel = (rest: number) => `외 ${rest}개 맵`;

  it("keeps up to two map rows as they are", () => {
    const view = getDeptCardView(
      card("dept", "Team B", [
        line({ map_id: 1, map_name: "Map A", count: 3 }),
        line({ map_id: 2, map_name: "Map B", count: 1 }),
      ]),
      moreLabel,
    );
    expect(view.mapRows.map((r) => [r.label, r.count, r.isMore])).toEqual([["Map A", 3, false], ["Map B", 1, false]]);
  });

  it("folds three or more maps into the top row plus an 'N more' row", () => {
    const view = getDeptCardView(
      card("dept", "Team B", [
        line({ map_id: 1, map_name: "Map A", count: 5 }),
        line({ map_id: 2, map_name: "Map B", count: 2 }),
        line({ map_id: 3, map_name: "Map C", count: 1 }),
        line({ map_id: 4, map_name: "Map D", count: 1 }),
      ]),
      moreLabel,
    );
    expect(view.mapRows).toHaveLength(2);
    expect(view.mapRows[1]).toMatchObject({ label: "외 3개 맵", count: 4, isMore: true });
  });

  it("shows the plain place count with no unit text", () => {
    const view = getDeptCardView(card("dept", "Team B", [line({ count: 3 }), line({ map_id: 2, count: 4, outcome: "notify" })]));
    expect(view.places).toBe(7);
    expect(view.countText).toBe("7");
    expect(view.countText).toMatch(/^\d+$/);
  });

  it("marks a card whose places are all awaiting publish and swaps the number for the marker", () => {
    const view = getDeptCardView(card("dept", "Team B", [line({ count: 2, outcome: "pending" }), line({ map_id: 2, count: 1, outcome: "pending" })]));
    expect(view.isPendingOnly).toBe(true);
    expect(view.countText).toBeNull();
    const mixed = getDeptCardView(card("dept", "Team B", [line({ count: 2, outcome: "pending" }), line({ map_id: 2, count: 1 })]));
    expect(mixed.isPendingOnly).toBe(false);
    expect(mixed.countText).toBe("3");
  });

  it("builds bar segments and foot items from the non-empty buckets in fix, notify, lock, pend order", () => {
    const view = getDeptCardView(
      card("dept", "Team B", [
        line({ count: 1, outcome: "pending" }),
        line({ map_id: 2, count: 3, outcome: "direct" }),
        line({ map_id: 3, count: 2, outcome: "locked" }),
      ]),
    );
    expect(view.bar).toEqual([
      { bucket: "fix", weight: 3 },
      { bucket: "lock", weight: 2 },
      { bucket: "pend", weight: 1 },
    ]);
    expect(view.foot.map((f) => [f.bucket, f.count, f.labelKey])).toEqual([
      ["fix", 3, "refAudit.foot.fix"],
      ["lock", 2, "refAudit.foot.lock"],
      ["pend", 1, "refAudit.foot.pend"],
    ]);
  });

  it("carries the parent path from the card sub", () => {
    expect(getDeptCardView({ ...card("dept", "Team B", [line({})]), sub: "HQ › Division 1" }).parentPath).toBe("HQ › Division 1");
  });
});

describe("getMapRowKind", () => {
  it("tells map, group, category and the folded row apart for the icon", () => {
    const view = getDeptCardView(
      card("dept", "Team B", [
        line({ map_id: 1, map_name: "Map A", count: 9 }),
        line({ map_id: null, map_name: null, group_id: 4, group_name: "Reviewers", count: 1 }),
      ]),
    );
    expect(view.mapRows.map(getMapRowKind)).toEqual(["map", "group"]);
    const cat = getDeptCardView(
      card("dept", "Team B", [line({ map_id: null, map_name: null, category_id: 7, category_name: "L3 Sales", count: 1 })]),
    );
    expect(cat.mapRows.map(getMapRowKind)).toEqual(["category"]);
    const many = getDeptCardView(
      card("dept", "Team B", [
        line({ map_id: 1, count: 3 }),
        line({ map_id: 2, count: 2 }),
        line({ map_id: 3, count: 1 }),
      ]),
    );
    expect(many.mapRows.map(getMapRowKind)).toEqual(["map", "more"]);
  });
});

describe("getUserCardView", () => {
  it("uses the first character of the name as the avatar initial, uppercase for Latin", () => {
    expect(getUserCardView(card("user", "홍길동", [line({})])).initial).toBe("홍");
    expect(getUserCardView(card("user", "alice kim", [line({})])).initial).toBe("A");
    expect(getUserCardView(card("user", "", [line({})])).initial).toBe("?");
  });

  it("builds a conic-gradient ring from the outcome ratio", () => {
    const view = getUserCardView(
      card("user", "User A", [line({ count: 1, outcome: "direct" }), line({ map_id: 2, count: 1, outcome: "notify" })]),
    );
    expect(view.ringGradient).toContain("conic-gradient");
    expect(view.ringGradient).toContain("var(--color-added) 0% 50%");
    expect(view.ringGradient).toContain("var(--color-warn) 50% 100%");
  });

  it("shows the login, or the 'name only' key when there is none", () => {
    expect(getUserCardView({ ...card("user", "User A", [line({})]), sub: "usera" })).toMatchObject({ sub: "usera", subKey: null });
    expect(getUserCardView({ ...card("user", "User A", [line({})]), sub: "" })).toMatchObject({ sub: "", subKey: "refAudit.nameOnly" });
  });

  it("shows the plain place count and the pending-only marker like the department card", () => {
    const view = getUserCardView(card("user", "User A", [line({ count: 2 }), line({ map_id: 2, count: 3, outcome: "locked" })]));
    expect(view.countText).toBe("5");
    expect(view.isPendingOnly).toBe(false);
    expect(view.foot.map((f) => f.bucket)).toEqual(["fix", "lock"]);
    const pend = getUserCardView(card("user", "User A", [line({ count: 2, outcome: "pending" })]));
    expect(pend.isPendingOnly).toBe(true);
    expect(pend.countText).toBeNull();
  });
});

describe("card copy", () => {
  it("has en and ko text for the card and section keys without an em dash", () => {
    const keys = [
      "refAudit.moreMaps", "refAudit.nameOnly", "refAudit.foot.fix", "refAudit.foot.notify", "refAudit.foot.lock",
      "refAudit.foot.pend", "refAudit.card.open", "refAudit.section.depts.title", "refAudit.section.depts.sub",
      "refAudit.section.users.title", "refAudit.section.users.sub", "refAudit.section.none", "refAudit.empty",
    ] as const;
    for (const key of keys) {
      for (const lang of ["en", "ko"] as const) {
        expect(messages[lang][key], `${lang} ${key}`).toBeTruthy();
      }
    }
    expect(messages.en["refAudit.moreMaps"]).toBe("+{n} more maps");
    expect(messages.ko["refAudit.moreMaps"]).toBe("외 {n}개 맵");
  });
});
