import { describe, expect, it } from "vitest";

import type { FwInterviewSession, FwQuestionnaire, FwSessionStatus } from "./api";
import {
  buildSubmitPayload, deriveProgress, deriveStep, fillSuggested, findCurrentTask, hasBackgroundWork, validateAnswers,
} from "./framework-interview";

const Q: FwQuestionnaire = {
  questions: [
    { id: "q1", kind: "ordered", maps_to: "activities", text: "활동", options: [{ id: "a", label: "접수" }, { id: "b", label: "검토" }], suggested: ["a", "b"] },
    { id: "q2", kind: "single", maps_to: "roles", text: "역할", options: [{ id: "r1", label: "담당자" }, { id: "r2", label: "관리자" }], suggested: ["r1"] },
    { id: "q3", kind: "text", maps_to: "conditions", text: "시작", options: [], suggested: "요청서 도착" },
  ],
};

function session(statuses: string[], status: FwSessionStatus = "plan_locked", paused = false): FwInterviewSession {
  return {
    id: 1, category_id: 9, category_code: "c", category_name: "L5", status, paused, lang: "ko", brief: "",
    plan: null, relations: null, label: "", created_at: "", updated_at: "",
    tasks: statuses.map((s, i) => ({ id: i + 1, task_id: `c-0${i + 1}`, seq: i + 1, name: `T${i + 1}`, status: s as never, issues: [], error: null, drawn_at: null })),
    progress: { total: statuses.length, drawn: statuses.filter((s) => s === "drawn").length, failed: 0, working: statuses.some((s) => s === "drawing" || s === "generating") },
  };
}

describe("framework-interview view model", () => {
  it("validateAnswers reports missing choices only, blank text is fine", () => {
    expect(validateAnswers(Q, { q1: ["a", "b"], q3: "" })).toEqual(["q2"]);
    expect(validateAnswers(Q, { q1: ["a"], q2: "r1" })).toEqual([]);
    expect(validateAnswers(Q, { q1: [], q2: "zzz" })).toEqual(["q1", "q2"]);
  });

  it("fillSuggested pre-selects every suggestion and leaves text blank", () => {
    expect(fillSuggested(Q)).toEqual({ q1: ["a", "b"], q2: "r1", q3: "" });
  });

  it("buildSubmitPayload sends blank text so the server applies the suggestion", () => {
    expect(buildSubmitPayload(Q, { q1: ["b"], q2: "r2" })).toEqual({ q1: ["b"], q2: "r2", q3: "" });
  });

  it("findCurrentTask picks the lowest seq that is not yet submitted", () => {
    expect(findCurrentTask(session(["drawn", "submitted", "ready", "pending"]))?.seq).toBe(3);
    expect(findCurrentTask(session(["drawn", "drawn"]))).toBeNull();
  });

  it("deriveStep follows the session status and task states", () => {
    expect(deriveStep(session([], "planning"))).toBe("plan");
    expect(deriveStep(session(["ready", "pending"]))).toBe("answer");
    expect(deriveStep(session(["generating", "pending"]))).toBe("waiting");
    expect(deriveStep(session(["drawn", "drawing"]))).toBe("waiting");
    expect(deriveStep(session(["drawn", "drawn"]))).toBe("relations");
    expect(deriveStep(session(["drawn", "failed"]))).toBe("waiting");
    expect(deriveStep(session(["drawn"], "ready"))).toBe("register");
    expect(deriveStep(session(["drawn"], "applied"))).toBe("done");
  });

  it("deriveProgress estimates eta from the mean drawing duration", () => {
    const p = deriveProgress(session(["drawn", "drawn", "submitted", "pending"]), [4000, 6000]);
    expect(p).toEqual({ done: 2, total: 4, working: false, etaMs: 10000 });
    expect(deriveProgress(session(["pending"]), []).etaMs).toBeNull();
  });

  it("hasBackgroundWork is true while a task is generating or drawing, or something is queued", () => {
    expect(hasBackgroundWork(session(["submitted"]))).toBe(true);
    expect(hasBackgroundWork(session(["ready", "ready", "pending"]))).toBe(false);
    expect(hasBackgroundWork(session(["ready", "pending"]))).toBe(true);
    expect(hasBackgroundWork(session(["pending"], "plan_locked", true))).toBe(false);
  });
});
