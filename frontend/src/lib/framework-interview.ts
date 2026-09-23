// AI L5 캠페인 뷰 모델 — 설문 검증·제안 채우기·진행률/ETA·현재 단계 파생. 페이지와 보드가 공유 (spec 2026-09-21 §9).

import type {
  FwAnswerValue, FwInterviewSession, FwInterviewTask, FwPlanCard, FwQuestion, FwQuestionnaire, FwQuestionSection,
} from "./api";
import type { MessageKey } from "./i18n-messages";

export type FwStep = "plan" | "answer" | "waiting" | "relations" | "register" | "done";

// 설문 섹션 표시 순서 — 서버 문항 생성(framework_interview/contracts.py)과 같은 읽는 순서
const SECTION_ORDER: FwQuestionSection[] = ["basic", "activities", "exceptions", "io"];

/** 섹션 헤더 문구 — 설문 폼과 확인 화면이 같은 라벨을 쓴다. */
export const SECTION_LABEL_KEYS: Record<FwQuestionSection, MessageKey> = {
  basic: "fwConsult.sectionBasic",
  activities: "fwConsult.sectionActivities",
  exceptions: "fwConsult.sectionExceptions",
  io: "fwConsult.sectionIo",
};

/** 문항을 섹션별로 묶는다 — 순서는 SECTION_ORDER, 문항이 없는 섹션은 생략. */
export function groupQuestionsBySection(
  questions: FwQuestion[],
): { section: FwQuestionSection; questions: FwQuestion[] }[] {
  return SECTION_ORDER
    .map((section) => ({ section, questions: questions.filter((q) => q.section === section) }))
    .filter((group) => group.questions.length > 0);
}

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

/**
 * 잠금을 막는 이름 중복인지 — 서버 `save_plan` 규칙과 동치.
 * 기존 맵끼리는 이름이 같아도 코드로 구분되므로, 충돌에 `existing_code` 없는 카드가 껴야 막는다.
 */
export function hasBlockingDuplicate(cards: Pick<FwPlanCard, "name" | "existing_code">[]): boolean {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const name = card.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return cards.some((card) => (counts.get(card.name.trim()) ?? 0) > 1 && !card.existing_code);
}

export function findCurrentTask(session: FwInterviewSession): FwInterviewTask | null {
  const sorted = [...session.tasks].sort((a, b) => a.seq - b.seq);
  return sorted.find((t) => t.status === "pending" || t.status === "generating" || t.status === "ready") ?? null;
}

export function hasBackgroundWork(session: FwInterviewSession): boolean {
  if (session.paused) return false;
  if (session.status !== "plan_locked" && session.status !== "linking") return false;
  // 러너가 실행 가능한 잡을 전부 병렬로 집으므로 대기 중인 카드가 하나라도 있으면 진행 중이다
  return session.tasks.some(
    (t) => t.status === "pending" || t.status === "generating" || t.status === "submitted" || t.status === "drawing",
  );
}

export function deriveStep(session: FwInterviewSession): FwStep {
  if (session.status === "applied") return "done";
  if (session.status === "ready") return "register";
  if (session.status === "planning") return "plan";
  const current = findCurrentTask(session);
  if (current) return current.status === "ready" ? "answer" : "waiting";
  if (session.tasks.some((t) => t.status === "submitted" || t.status === "drawing")) return "waiting";
  // 실패한 카드가 있으면 연결로 넘어가지 않는다 — 보드가 재시도를 제안하는 동안은 "준비 중"에 머문다.
  if (session.tasks.some((t) => t.status === "failed")) return "waiting";
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
