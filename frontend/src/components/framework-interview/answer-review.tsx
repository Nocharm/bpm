"use client";

// 캠페인 설문 확인 화면 — 섹션별로 묶은 문항별 최종값 읽기 전용. 빈 주관식은 "미답변"(제안값을 대신 넣지 않는다, 2026-09-28),
// 문항 코멘트와 제출 코멘트(NOTE_KEY)는 답 아래 작게. 제출 전 확인과 제출 뒤 카드 패널(task-panel)이 공유한다.

import type { FwAnswerValue, FwQuestionnaire } from "@/lib/api";
import { groupQuestionsBySection, SECTION_LABEL_KEYS } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";

// 서버 answers 예약 키(app/framework_interview/answers.py NOTE_KEY) — 제출 코멘트
export const ANSWER_NOTE_KEY = "_note";

export function AnswerReview({ questionnaire, answers, comments = {}, note = "" }: {
  questionnaire: FwQuestionnaire;
  answers: Record<string, FwAnswerValue>;
  comments?: Record<string, string>;
  note?: string;
}) {
  const { t } = useI18n();
  // 번호는 설문 폼과 같은 전체 순서
  const numbers = new Map(questionnaire.questions.map((q, idx) => [q.id, idx + 1]));
  return (
    <div className="flex flex-col gap-3" data-id="fw-consult-review-list">
      {groupQuestionsBySection(questionnaire.questions).map(({ section, questions }) => (
        <section key={section} className="flex flex-col gap-1.5" data-id={`fw-consult-review-section-${section}`}>
          <span className="text-caption text-ink-tertiary">{t(SECTION_LABEL_KEYS[section])}</span>
          <ol className="flex flex-col gap-2">
            {questions.map((q) => {
              const value = answers[q.id];
              const labels = new Map(q.options.map((o) => [o.id, o.label]));
              const shown = q.kind === "text"
                ? (typeof value === "string" ? value.trim() : "")
                : Array.isArray(value) ? value.map((v) => labels.get(v) ?? v).join(q.kind === "ordered" ? " → " : ", ") : (labels.get(String(value)) ?? "");
              const unanswered = shown === "";
              const comment = (comments[q.id] ?? "").trim();
              return (
                <li key={q.id} data-id={`fw-consult-review-${q.id}`} className="flex flex-col gap-0.5 rounded-md border border-hairline bg-surface-pearl px-3 py-2">
                  <span className="text-fine text-ink-tertiary">{numbers.get(q.id)}. {q.text}</span>
                  <span className={`text-caption ${unanswered ? "text-ink-muted italic" : "text-ink"}`} data-id={unanswered ? `fw-consult-unanswered-${q.id}` : undefined}>
                    {unanswered ? t("fwConsult.unanswered") : shown}
                  </span>
                  {comment && <span className="text-fine text-ink-secondary" data-id={`fw-consult-review-comment-${q.id}`}>{t("fwConsult.commentLabel")}: {comment}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {note.trim() !== "" && (
        <div className="flex flex-col gap-0.5 rounded-md border border-hairline bg-surface px-3 py-2" data-id="fw-consult-review-note">
          <span className="text-fine text-ink-tertiary">{t("fwConsult.submitNote")}</span>
          <span className="whitespace-pre-wrap text-caption text-ink">{note.trim()}</span>
        </div>
      )}
    </div>
  );
}
