// 고아 참조 화면 순수 로직 테스트 — 히어로(숫자·범위 칩·경우 8종·범례)·카드·상세 창(줄 판정·미리보기·적용 묶음·토스트) (design 2026-10-23 §9)
import { describe, expect, it } from "vitest";

import type { RefApplyResult, RefAuditData, RefCard, RefCardLine, RefOutcome, RefSkipReason } from "@/lib/api";
import { messages, type MessageKey } from "@/lib/i18n-messages";
import { OUTCOME_META, REMOVE_BLOCKED, SOURCE_ICON } from "@/lib/ref-audit";
import {
  HERO_VIEWBOX,
  OUTCOME_TIP_KEY,
  REF_AUDIT_CASES,
  REF_AUDIT_LEGEND,
  REF_BATCH_SIZE,
  SETTINGS_CHIPS,
  SKIP_REASON_KEY,
  buildApplyBatches,
  buildPreviewBatches,
  canApplySelection,
  canRemoveCard,
  formatAppliedToast,
  getApplyButton,
  getCheckedKeys,
  getDeptCardView,
  getDialogMeta,
  getForecast,
  getLineKey,
  getLineView,
  groupDialogLines,
  mergePreview,
  shouldWarnOpenEditor,
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

// ── 상세 창 ──────────────────────────────────────────────────────────────────

// 실제 t와 같은 치환 — en 문구로 토스트 문장을 확인한다
const translate = (lang: "en" | "ko", key: MessageKey, vars?: Record<string, string | number>): string => {
  let text = messages[lang][key];
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};
const tEn = (key: MessageKey, vars?: Record<string, string | number>): string => translate("en", key, vars);
const tKo = (key: MessageKey, vars?: Record<string, string | number>): string => translate("ko", key, vars);

const applyResult = (over: Partial<RefApplyResult>): RefApplyResult => ({
  places: {}, drafts: [], approval_requests: 0, notified: 0, skipped: [], ...over,
});

describe("getLineKey / mergePreview", () => {
  it("keys a line by target id and from value, since a merged card can hold one target twice", () => {
    expect(getLineKey({ target_id: "node_dept:4", from_value: "HQ/Team B" })).toBe("node_dept:4|HQ/Team B");
  });

  it("matches preview lines by target id and from value and replaces the decision fields", () => {
    const lines = [
      line({ source: "node_dept", target_id: "node_dept:4", from_value: "HQ/Team B", outcome: "direct" }),
      line({ source: "node_dept", target_id: "node_dept:4", from_value: "Team B", outcome: "locked", reason: "in_approval" }),
    ];
    const merged = mergePreview(lines, [
      { target_id: "node_dept:4", from_value: "Team B", outcome: "notify", notify_to: { id: "o1", name: "Owner One", role: "owner" } },
      { target_id: "node_dept:4", from_value: "HQ/Team B", outcome: "checkout", warning: "no_access" },
    ]);
    expect(merged[0]).toMatchObject({ outcome: "checkout", warning: "no_access", reason: null, notify_to: null });
    expect(merged[1]).toMatchObject({ outcome: "notify", reason: null, notify_to: { name: "Owner One" } });
    expect(merged[1].map_name).toBe("Map A"); // 판정 밖 필드는 그대로
  });

  it("keeps the scan decision for lines the preview left out (already changed or out of scope)", () => {
    const lines = [line({ target_id: "map_grant:1", outcome: "approval" }), line({ target_id: "map_grant:2", outcome: "direct" })];
    const merged = mergePreview(lines, [{ target_id: "map_grant:2", from_value: "Old Team", outcome: "locked", reason: "request_pending" }]);
    expect(merged.map((ln) => ln.outcome)).toEqual(["approval", "locked"]);
  });
});

describe("getLineView", () => {
  it("disables the checkbox of a locked line and explains why", () => {
    const view = getLineView(line({ outcome: "locked", reason: "in_approval" }), "replace");
    expect(view).toMatchObject({ checkable: false, outcome: "locked", reasonKey: "refAudit.reason.in_approval" });
  });

  it("disables pending lines and keeps fix and notify lines checkable", () => {
    expect(getLineView(line({ outcome: "pending" }), "replace").checkable).toBe(false);
    expect(getLineView(line({ outcome: "new_draft" }), "replace").checkable).toBe(true);
    expect(getLineView(line({ outcome: "notify", notify_to: { id: "h", name: "Holder", role: "holder" } }), "replace").checkable).toBe(true);
  });

  it("shows who receives a notify line and in which role", () => {
    const view = getLineView(
      line({ source: "node_assignee", outcome: "notify", notify_to: { id: "kim", name: "Kim Owner", role: "owner" } }),
      "replace",
    );
    expect(view).toMatchObject({ recipient: "Kim Owner", role: "owner" });
    expect(getLineView(line({ outcome: "direct" }), "replace").recipient).toBeUndefined();
  });

  it("turns remove-blocked sources into a locked, unchecked line in remove mode only", () => {
    for (const source of REMOVE_BLOCKED) {
      const ln = line({ source, outcome: "direct" });
      expect(getLineView(ln, "remove")).toMatchObject({ checkable: false, outcome: "locked", reasonKey: "refAudit.cannotRemove" });
      expect(getLineView(ln, "replace")).toMatchObject({ checkable: true, outcome: "direct" });
    }
  });

  it("translates warnings and describes node lines by node count, settings lines by where they live", () => {
    const node = getLineView(line({ source: "node_dept", count: 3, outcome: "checkout", warning: "no_access" }), "replace");
    expect(node).toMatchObject({ detailKey: "refAudit.line.nodes", detailCount: 3, warningKey: "refAudit.warning.no_access" });
    const owner = getLineView(line({ source: "map_owner" }), "replace");
    expect(owner.detailKey).toBe("refAudit.case.map_owner.where");
    expect(owner.detailCount).toBeUndefined();
    expect(getLineView(line({ source: "sp_assignee" }), "replace").detailKey).toBe("refAudit.case.sp_dept.where");
    expect(getLineView(line({ source: "group_user" }), "replace").detailKey).toBe("refAudit.case.group_member.where");
  });

  it("asks to reload an open editor only for node lines written straight into your own Draft", () => {
    expect(getLineView(line({ source: "node_dept", outcome: "direct", version_status: "draft" }), "replace").reloadNote).toBe(true);
    expect(getLineView(line({ source: "node_assignee", outcome: "checkout" }), "replace").reloadNote).toBe(false);
    expect(getLineView(line({ source: "map_grant", outcome: "direct" }), "replace").reloadNote).toBe(false);
  });
});

describe("getCheckedKeys / getForecast", () => {
  const lines = [
    line({ target_id: "map_owner:1", source: "map_owner", count: 1, outcome: "direct" }),
    line({ target_id: "node_dept:1", source: "node_dept", count: 3, outcome: "new_draft" }),
    line({ target_id: "node_dept:2", source: "node_dept", count: 2, outcome: "notify" }),
    line({ target_id: "node_dept:3", source: "node_dept", count: 4, outcome: "locked", reason: "in_approval" }),
  ];

  it("checks every checkable line except the ones the user unchecked", () => {
    const checked = getCheckedKeys(lines, "replace", new Set(["node_dept:2|Old Team"]));
    expect([...checked]).toEqual(["map_owner:1|Old Team", "node_dept:1|Old Team"]);
  });

  it("drops remove-blocked lines from the checked set in remove mode", () => {
    expect([...getCheckedKeys(lines, "remove", new Set())]).toEqual(["node_dept:1|Old Team", "node_dept:2|Old Team"]);
  });

  it("forecasts places per outcome for the checked lines only", () => {
    const checked = getCheckedKeys(lines, "replace", new Set());
    const forecast = getForecast(lines, "replace", checked);
    expect([...forecast.outcomes]).toEqual([["direct", 1], ["new_draft", 3], ["notify", 2]]);
    expect(forecast.total).toBe(6);
    expect(getForecast(lines, "replace", new Set()).total).toBe(0);
  });
});

describe("buildPreviewBatches / buildApplyBatches", () => {
  const lines = [
    line({ target_id: "map_owner:1", source: "map_owner", from_value: "u1", outcome: "direct" }),
    line({ target_id: "map_collab:2", source: "map_collab", from_value: "u1", outcome: "approval" }),
    line({ target_id: "node_assignee:3", source: "node_assignee", from_value: "User One", outcome: "pending" }),
  ];

  it("asks for no preview until a replacement is chosen", () => {
    expect(buildPreviewBatches("user", lines, "replace", "")).toEqual([]);
  });

  it("previews every line of the card, locked and pending included, with the chosen value", () => {
    expect(buildPreviewBatches("user", lines, "replace", "kim")).toEqual([
      {
        kind: "user", mode: "replace", to_value: "kim",
        targets: [
          { target_id: "map_owner:1", from_value: "u1" },
          { target_id: "map_collab:2", from_value: "u1" },
          { target_id: "node_assignee:3", from_value: "User One" },
        ],
      },
    ]);
  });

  it("leaves remove-blocked sources out of a remove preview, which the server would reject", () => {
    const [body] = buildPreviewBatches("user", lines, "remove", "kim");
    expect(body.mode).toBe("remove");
    expect(body.to_value).toBeUndefined();
    expect(body.targets.map((tg) => tg.target_id)).toEqual(["map_collab:2", "node_assignee:3"]);
  });

  it("sends only checked, checkable lines and splits them into batches of the server limit", () => {
    expect(REF_BATCH_SIZE).toBe(500);
    const many = Array.from({ length: 1001 }, (_, i) => line({ target_id: `map_grant:${i}`, outcome: "direct" }));
    const checked = getCheckedKeys(many, "replace", new Set());
    const batches = buildApplyBatches("dept", many, checked, "replace", "HQ/Team A");
    expect(batches.map((b) => b.targets.length)).toEqual([500, 500, 1]);
    expect(batches.every((b) => b.kind === "dept" && b.mode === "replace" && b.to_value === "HQ/Team A")).toBe(true);
  });

  it("skips unchecked and no-longer-checkable lines even if their key is still in the set", () => {
    const keys = new Set(lines.map(getLineKey));
    const [body] = buildApplyBatches("user", lines, keys, "remove", "");
    expect(body.targets).toEqual([{ target_id: "map_collab:2", from_value: "u1" }]);
    expect(body.to_value).toBeUndefined();
    expect(buildApplyBatches("user", lines, new Set(), "replace", "kim")).toEqual([]);
  });
});

describe("shouldWarnOpenEditor", () => {
  const own = line({ target_id: "node_dept:1", source: "node_dept", outcome: "direct", version_status: "draft" });
  const fresh = line({ target_id: "node_dept:2", source: "node_dept", outcome: "new_draft" });

  it("warns when a checked node line goes straight into your own checked-out Draft", () => {
    expect(shouldWarnOpenEditor([own, fresh], new Set([getLineKey(own)]))).toBe(true);
  });

  it("stays quiet when that line is unchecked or no node line is direct", () => {
    expect(shouldWarnOpenEditor([own, fresh], new Set([getLineKey(fresh)]))).toBe(false);
    const grant = line({ target_id: "map_grant:9", outcome: "direct" });
    expect(shouldWarnOpenEditor([grant], new Set([getLineKey(grant)]))).toBe(false);
  });
});

describe("groupDialogLines / getDialogMeta", () => {
  const lines = [
    line({ target_id: "owning_dept:7", source: "owning_dept", map_id: 7, map_name: "Onboarding", map_role: "owner" }),
    line({ target_id: "group_member:3", source: "group_member", map_id: null, map_name: null, group_id: 3, group_name: "Reviewers" }),
    line({
      target_id: "node_dept:7", source: "node_dept", map_id: 7, map_name: "Onboarding", map_role: "owner", count: 3,
      version_label: "v2", version_status: "draft",
    }),
    line({ target_id: "category_perm:5", source: "category_perm", map_id: null, map_name: null, category_id: 5, category_name: "L3 Sales" }),
  ];

  it("groups lines by map, group and category in first-seen order, keeping each line's index in the card", () => {
    const groups = groupDialogLines(lines);
    expect(groups.map((g) => [g.kind, g.label, g.lines.map((l) => l.index)])).toEqual([
      ["map", "Onboarding", [0, 2]],
      ["group", "Reviewers", [1]],
      ["category", "L3 Sales", [3]],
    ]);
  });

  it("links a map to its editor and a group to its page; categories stay plain text", () => {
    const [map, group, category] = groupDialogLines(lines);
    expect(map).toMatchObject({ id: 7, href: "/maps/7", role: "owner", versionLabel: "v2", versionStatus: "draft" });
    expect(group.href).toBe("/groups/3");
    expect(category.href).toBeNull();
  });

  it("counts distinct maps and all places for the header", () => {
    expect(getDialogMeta(card("dept", "Team B", lines))).toEqual({ maps: 1, places: 6 });
  });
});

describe("dialog controls", () => {
  it("allows the remove mode for person cards only", () => {
    expect(canRemoveCard(card("dept", "Team B", [line({})]))).toBe(false);
    expect(canRemoveCard(card("user", "User A", [line({})]))).toBe(true);
  });

  it("labels the apply button by mode, red for remove", () => {
    expect(getApplyButton("replace")).toEqual({ labelKey: "refAudit.dlg.applyReplace", tone: "accent" });
    expect(getApplyButton("remove")).toEqual({ labelKey: "refAudit.dlg.applyRemove", tone: "error" });
    expect(tEn(getApplyButton("remove").labelKey, { n: 4 })).toBe("Remove 4");
  });
});

describe("canApplySelection", () => {
  const ready = { total: 3, mode: "replace" as const, toValue: "Team B", isPreviewCurrent: true, isPreviewing: false, isApplying: false };

  it("opens only with a target, a current preview and checked places", () => {
    expect(canApplySelection(ready)).toBe(true);
    expect(canApplySelection({ ...ready, mode: "remove", toValue: "" })).toBe(true);
  });

  it("stays closed without a target, without places, while previewing or applying", () => {
    expect(canApplySelection({ ...ready, toValue: "" })).toBe(false);
    expect(canApplySelection({ ...ready, total: 0 })).toBe(false);
    expect(canApplySelection({ ...ready, isPreviewing: true })).toBe(false);
    expect(canApplySelection({ ...ready, isApplying: true })).toBe(false);
  });

  it("stays closed when the preview for this combination is missing, stale or failed", () => {
    expect(canApplySelection({ ...ready, isPreviewCurrent: false })).toBe(false);
    expect(canApplySelection({ ...ready, mode: "remove", toValue: "", isPreviewCurrent: false })).toBe(false);
  });
});

describe("formatAppliedToast", () => {
  it("sums several batch results and leaves out zero parts", () => {
    const text = formatAppliedToast(
      [
        applyResult({ places: { direct: 2, checkout: 1, new_draft: 3 }, notified: 1 }),
        applyResult({ places: { direct: 1 }, approval_requests: 2, notified: 1 }),
      ],
      tEn,
    );
    expect(text).toBe("Applied 4 · To publish 3 · Notified 2 · Approval requests 2");
  });

  it("adds the skipped lines with their reasons", () => {
    const text = formatAppliedToast(
      [applyResult({
        places: { direct: 1 },
        skipped: [
          { target_id: "a", reason: "already_changed" },
          { target_id: "b", reason: "in_approval" },
          { target_id: "c", reason: "already_changed" },
        ],
      })],
      tEn,
    );
    expect(text).toBe("Applied 1 · Skipped 3 (Already changed 2, In approval 1)");
  });

  it("counts skipped lines as cases in ko, not places", () => {
    const text = formatAppliedToast(
      [applyResult({ places: { direct: 1 }, skipped: [{ target_id: "a", reason: "already_changed" }] })],
      tKo,
    );
    expect(text).toBe("1곳 반영 · 1건 건너뜀 (이미 바뀜 1)");
  });

  it("says nothing changed when every part is zero", () => {
    expect(formatAppliedToast([applyResult({})], tEn)).toBe(messages.en["refAudit.toast.nothing"]);
  });

  it("has a label for every skip reason", () => {
    const reasons: RefSkipReason[] = [
      "in_workflow", "request_pending", "owner_left", "in_approval", "framework", "not_eligible", "group_inactive",
      "pending", "out_of_scope", "already_changed",
    ];
    for (const reason of reasons) {
      expect(messages.en[SKIP_REASON_KEY[reason]], reason).toBeTruthy();
      expect(messages.ko[SKIP_REASON_KEY[reason]], reason).toBeTruthy();
    }
  });
});

describe("dialog copy", () => {
  it("has en and ko text without an em dash", () => {
    const keys = [
      "refAudit.dlg.label", "refAudit.dlg.maps", "refAudit.dlg.places", "refAudit.dlg.pickDept", "refAudit.dlg.pickUser",
      "refAudit.dlg.clearTarget", "refAudit.dlg.erase", "refAudit.dlg.forecast", "refAudit.dlg.noneChecked",
      "refAudit.dlg.applyReplace", "refAudit.dlg.applyRemove", "refAudit.dlg.previewing", "refAudit.dlg.retry",
      "refAudit.deptReplaceOnly",
      "refAudit.cannotRemove", "refAudit.line.nodes", "refAudit.note.reloadEditor", "refAudit.confirm.replaceTitle",
      "refAudit.confirm.replaceMsg", "refAudit.confirm.removeTitle", "refAudit.confirm.removeMsg",
      "refAudit.confirm.reloadEditor",
      "refAudit.toast.applied", "refAudit.toast.publish", "refAudit.toast.notified", "refAudit.toast.approvals",
      "refAudit.toast.skipped", "refAudit.toast.nothing", "refAudit.skip.out_of_scope", "refAudit.skip.already_changed",
      "refAudit.skip.pending",
    ] as const;
    for (const key of keys) {
      for (const lang of ["en", "ko"] as const) {
        expect(messages[lang][key], `${lang} ${key}`).toBeTruthy();
        expect(messages[lang][key], `${lang} ${key}`).not.toContain("—");
      }
    }
  });
});
