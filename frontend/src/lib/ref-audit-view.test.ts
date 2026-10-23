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
  getHeroStats,
  getOutcomeLabelKey,
  getScopeChips,
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
