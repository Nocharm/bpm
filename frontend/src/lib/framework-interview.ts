// AI L5 캠페인 뷰 모델 — 설문 검증·제안 채우기·진행률/ETA·현재 단계 파생. 페이지와 보드가 공유 (spec 2026-09-21 §9).

import type { FwAnswerValue, FwInterviewSession, FwInterviewTask, FwQuestionnaire } from "./api";

export type FwStep = "plan" | "answer" | "waiting" | "relations" | "register" | "done";

const PREFETCH_READY = 2; // 서버 runner.PREFETCH_READY와 동기

function isChoice(kind: string): boolean {
  return kind === "single" || kind === "multi" || kind === "ordered";
}

/** 누락 문항 id — 객관식은 값 필수·옵션 id만, 주관식 빈칸은 허용(서버가 제안값 적용). */
export function validateAnswers(q: FwQuestionnaire, answers: Record<string, FwAnswerValue | undefined>): string[] {
  const missing: string[] = [];
  for (const question of q.questions) {
    if (!isChoice(question.kind)) continue;
    const allowed = new Set(question.options.map((o) => o.id));
    const value = answers[question.id];
    if (question.kind === "single") {
      if (typeof value !== "string" || !allowed.has(value)) missing.push(question.id);
    } else if (!Array.isArray(value) || value.length === 0 || value.some((v) => !allowed.has(v))) {
      missing.push(question.id);
    }
  }
  return missing;
}

/** 초기값 = 제안 답. 주관식은 빈칸(플레이스홀더가 제안을 보여준다). */
export function fillSuggested(q: FwQuestionnaire): Record<string, FwAnswerValue> {
  const out: Record<string, FwAnswerValue> = {};
  for (const question of q.questions) {
    if (question.kind === "text") out[question.id] = "";
    else if (question.kind === "single") out[question.id] = Array.isArray(question.suggested) ? (question.suggested[0] ?? "") : "";
    else out[question.id] = Array.isArray(question.suggested) ? [...question.suggested] : [];
  }
  return out;
}

export function buildSubmitPayload(q: FwQuestionnaire, answers: Record<string, FwAnswerValue | undefined>): Record<string, FwAnswerValue> {
  const out: Record<string, FwAnswerValue> = {};
  for (const question of q.questions) {
    const value = answers[question.id];
    out[question.id] = value ?? (question.kind === "text" ? "" : question.kind === "single" ? "" : []);
  }
  return out;
}

export function findCurrentTask(session: FwInterviewSession): FwInterviewTask | null {
  const sorted = [...session.tasks].sort((a, b) => a.seq - b.seq);
  return sorted.find((t) => t.status === "pending" || t.status === "generating" || t.status === "ready") ?? null;
}

export function hasBackgroundWork(session: FwInterviewSession): boolean {
  if (session.paused) return false;
  if (session.status !== "plan_locked" && session.status !== "linking") return false;
  const statuses = session.tasks.map((t) => t.status);
  if (statuses.some((s) => s === "generating" || s === "drawing" || s === "submitted")) return true;
  const ready = statuses.filter((s) => s === "ready").length;
  return statuses.includes("pending") && ready < PREFETCH_READY;
}

export function deriveStep(session: FwInterviewSession): FwStep {
  if (session.status === "applied") return "done";
  if (session.status === "ready") return "register";
  if (session.status === "planning") return "plan";
  const current = findCurrentTask(session);
  if (current) return current.status === "ready" ? "answer" : "waiting";
  if (session.tasks.some((t) => t.status === "submitted" || t.status === "drawing")) return "waiting";
  return "relations";
}

export function deriveProgress(
  session: FwInterviewSession,
  drawDurationsMs: number[],
): { done: number; total: number; working: boolean; etaMs: number | null } {
  const total = session.tasks.length;
  const done = session.tasks.filter((t) => t.status === "drawn").length;
  const remaining = total - done;
  const mean = drawDurationsMs.length
    ? drawDurationsMs.reduce((a, b) => a + b, 0) / drawDurationsMs.length
    : null;
  return { done, total, working: session.progress.working, etaMs: mean === null ? null : Math.round(mean * remaining) };
}
