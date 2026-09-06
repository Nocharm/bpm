import { describe, expect, it } from "vitest";

import type { SubprocessRef } from "./api";
import {
  deriveSlotState,
  hasSlotHistory,
  isRecentHandover,
  isSlotAction,
  RECENT_HANDOVER_DAYS,
  SLOT_ACTION_KEY,
} from "./framework-slot-state";

const base = (over: Partial<SubprocessRef>): SubprocessRef =>
  ({
    designated: true, name: "m", department: null, assignee: null, system: null, duration: null,
    cost_krw: null, cost_usd: null, headcount: null, touch_time: null, input: null, output: null,
    input_forms: null, output_forms: null, input_ids: null, output_ids: null, start_condition: null,
    end_condition: null, frequency_fallback: null, gmp: null, url: null, url_label: null,
    ...over,
  }) as SubprocessRef;

describe("deriveSlotState", () => {
  it("placeholder when no linked map", () => {
    expect(deriveSlotState(undefined, null, 5)).toBe("placeholder");
  });
  it("unknown while refs are not loaded", () => {
    expect(deriveSlotState(undefined, 7, 5)).toBe("unknown");
  });
  it("deleted beats superseded, superseded beats category", () => {
    expect(deriveSlotState(base({ deleted: true, superseded: true, category_id: 5 }), 7, 5)).toBe("deleted");
    expect(deriveSlotState(base({ superseded: true, category_id: null }), 7, 5)).toBe("superseded");
  });
  it("unassigned when the linked map has no category", () => {
    expect(deriveSlotState(base({ category_id: null }), 7, 5)).toBe("unassigned");
  });
  it("contained vs external by canvas category", () => {
    expect(deriveSlotState(base({ category_id: 5 }), 7, 5)).toBe("contained");
    expect(deriveSlotState(base({ category_id: 9 }), 7, 5)).toBe("external");
  });
});

const SLOT_ACTIONS = ["assign", "unassign", "move", "replace", "delete"] as const;

describe("isSlotAction", () => {
  it("accepts all 5 known actions and rejects everything else", () => {
    for (const action of SLOT_ACTIONS) expect(isSlotAction(action)).toBe(true);
    expect(isSlotAction("bogus")).toBe(false);
    expect(isSlotAction(undefined)).toBe(false);
  });
  it("SLOT_ACTION_KEY maps every action to its i18n key", () => {
    for (const action of SLOT_ACTIONS) expect(SLOT_ACTION_KEY[action]).toBe(`slot.action.${action}`);
  });
});

describe("isRecentHandover", () => {
  const now = Date.parse("2026-09-06T00:00:00+09:00");
  it("true within the window, false after or without a date", () => {
    expect(isRecentHandover("2026-09-01T10:00:00+09:00", now)).toBe(true);
    expect(isRecentHandover(`2026-08-${String(23 - 1).padStart(2, "0")}T00:00:00+09:00`, now)).toBe(false);
    expect(isRecentHandover(null, now)).toBe(false);
    expect(RECENT_HANDOVER_DAYS).toBe(14);
  });
});

describe("hasSlotHistory", () => {
  it("false when there is no info at all", () => {
    expect(hasSlotHistory(null)).toBe(false);
  });
  it("false when neither succeededAt nor changedAt is set (e.g. only updatedAt)", () => {
    expect(hasSlotHistory({ succeededAt: null, changedAt: null })).toBe(false);
  });
  it("true when succeededAt or changedAt is set", () => {
    expect(hasSlotHistory({ succeededAt: "2026-09-01T10:00:00+09:00", changedAt: null })).toBe(true);
    expect(hasSlotHistory({ succeededAt: null, changedAt: "2026-09-01T10:00:00+09:00" })).toBe(true);
  });
});
