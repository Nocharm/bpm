"use client";

// 캠페인 설문 확인 화면 — 문항별 최종값 읽기 전용, 빈 주관식은 제안값 + "Suggestion applied" 배지. AnswerStep 전용.

import type { FwAnswerValue, FwQuestionnaire } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function AnswerReview({ questionnaire, answers }: { questionnaire: FwQuestionnaire; answers: Record<string, FwAnswerValue> }) {
  const { t } = useI18n();
  return (
    <ol className="flex flex-col gap-2" data-id="fw-consult-review-list">
      {questionnaire.questions.map((q, idx) => {
        const value = answers[q.id];
        const labels = new Map(q.options.map((o) => [o.id, o.label]));
        const auto = q.kind === "text" && (typeof value !== "string" || value.trim() === "");
        const shown = q.kind === "text"
          ? (auto ? (typeof q.suggested === "string" ? q.suggested : "") : String(value))
          : Array.isArray(value) ? value.map((v) => labels.get(v) ?? v).join(q.kind === "ordered" ? " → " : ", ") : (labels.get(String(value)) ?? "");
        return (
          <li key={q.id} data-id={`fw-consult-review-${q.id}`} className="flex flex-col gap-0.5 rounded-md border border-hairline bg-surface-pearl px-3 py-2">
            <span className="text-fine text-ink-tertiary">{idx + 1}. {q.text}</span>
            <span className="flex items-center gap-2 text-caption text-ink">
              {shown}
              {auto && <span className="rounded-full border border-hairline px-2 py-[2px] text-[11px] leading-none text-ink-tertiary" data-id={`fw-consult-auto-${q.id}`}>{t("fwConsult.autoApplied")}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
