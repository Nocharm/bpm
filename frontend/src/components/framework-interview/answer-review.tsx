"use client";

// 캠페인 설문 확인 화면 — 섹션별로 묶은 문항별 최종값 읽기 전용, 빈 주관식은 제안값 + "Suggestion applied" 배지.
// 제출 전 확인과 제출 뒤 카드 패널(task-panel)이 공유한다.

import type { FwAnswerValue, FwQuestionnaire } from "@/lib/api";
import { groupQuestionsBySection, SECTION_LABEL_KEYS } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";

export function AnswerReview({ questionnaire, answers }: { questionnaire: FwQuestionnaire; answers: Record<string, FwAnswerValue> }) {
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
              const auto = q.kind === "text" && (typeof value !== "string" || value.trim() === "");
              const shown = q.kind === "text"
                ? (auto ? (typeof q.suggested === "string" ? q.suggested : "") : String(value))
                : Array.isArray(value) ? value.map((v) => labels.get(v) ?? v).join(q.kind === "ordered" ? " → " : ", ") : (labels.get(String(value)) ?? "");
              return (
                <li key={q.id} data-id={`fw-consult-review-${q.id}`} className="flex flex-col gap-0.5 rounded-md border border-hairline bg-surface-pearl px-3 py-2">
                  <span className="text-fine text-ink-tertiary">{numbers.get(q.id)}. {q.text}</span>
                  <span className="flex items-center gap-2 text-caption text-ink">
                    {shown}
                    {auto && <span className="rounded-full border border-hairline px-2 py-[2px] text-[11px] leading-none text-ink-tertiary" data-id={`fw-consult-auto-${q.id}`}>{t("fwConsult.autoApplied")}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
