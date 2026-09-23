"use client";

// 캠페인 ② L6 설문 폼 — 섹션(기본·활동·예외·입출력)별 문항 렌더(2열 그리드·객관식 위주·제안 선택됨·주관식은
// 빈칸에서 [AI 제안]이 타이핑으로 채우고 blur로 확정). 상태별 카드 패널(task-panel)이 ready 카드에서 쓴다
// (spec 2026-09-21 §2·§4, 2026-09-23 §3 B10·§4.3 B12).

import { useState } from "react";
import { ArrowDown, ArrowUp, PenLine } from "lucide-react";

import type { FwAnswerValue, FwQuestionnaire } from "@/lib/api";
import { groupQuestionsBySection, SECTION_LABEL_KEYS } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import { useTypewriter } from "@/lib/typewriter";
import { AiButton } from "@/components/ai-button";
import { CheckInput } from "@/components/check-input";

interface QuestionnaireFormProps {
  questionnaire: FwQuestionnaire;
  answers: Record<string, FwAnswerValue>;
  missing: string[];
  onChange: (qid: string, value: FwAnswerValue) => void;
}

export function QuestionnaireForm({ questionnaire, answers, missing, onChange }: QuestionnaireFormProps) {
  const { t } = useI18n();
  // 번호는 설문지 전체 순서 — 섹션으로 묶여도 1..n이 이어진다
  const numbers = new Map(questionnaire.questions.map((q, idx) => [q.id, idx + 1]));
  return (
    <div className="flex flex-col gap-4" data-id="fw-consult-questions">
      {groupQuestionsBySection(questionnaire.questions).map(({ section, questions }) => (
        <section key={section} className="flex flex-col gap-1.5" data-id={`fw-consult-section-${section}`}>
          <span className="text-caption text-ink-tertiary">{t(SECTION_LABEL_KEYS[section])}</span>
          {/* 활동 섹션은 문항이 길어(순서·다중 선택) 전폭 1열, 나머지는 2열 */}
          <ol className={`grid gap-3 ${section === "activities" ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2"}`}>
            {questions.map((q) => {
              const value = answers[q.id];
              const isMissing = missing.includes(q.id);
              const list = Array.isArray(value) ? value : [];
              const textValue = typeof value === "string" ? value : "";
              // 활동 순서 문항은 2열 섹션에서만 전폭 — 1열 섹션에 col-span을 주면 암시적 열이 생겨 레이아웃이 깨진다
              const span = q.kind === "ordered" && section !== "activities" ? " xl:col-span-2" : "";
              return (
                <li key={q.id} data-id={`fw-consult-question-${q.id}`} className={`flex flex-col gap-1.5 rounded-md border p-3 ${isMissing ? "border-error" : "border-hairline"} bg-surface-pearl${span}`}>
                  <p className="text-caption text-ink"><span className="text-ink-tertiary tabular-nums">{numbers.get(q.id)}. </span>{q.text}</p>
                  {q.kind === "text" && (
                    <TextAnswer
                      qid={q.id}
                      value={textValue}
                      suggested={typeof q.suggested === "string" ? q.suggested : ""}
                      onChange={(v) => onChange(q.id, v)}
                    />
                  )}
                  {q.kind === "single" && (
                    <div className="flex flex-wrap gap-2">
                      {q.options.map((o) => (
                        // 라디오는 label 안쪽(sr-only)이라 형제 peer가 아니라 has()로 키보드 포커스만 링 표시(check-input.tsx의 peer 패턴 동치).
                        <label key={o.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-caption has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-1 ${value === o.id ? "border-accent bg-accent-tint text-accent" : "border-hairline bg-surface text-ink"}`}>
                          <input type="radio" name={q.id} className="sr-only" checked={value === o.id} data-id={`fw-consult-answer-${q.id}-${o.id}`} onChange={() => onChange(q.id, o.id)} />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  )}
                  {(q.kind === "multi" || q.kind === "ordered") && (
                    <ul className="flex flex-col gap-1">
                      {(q.kind === "ordered" ? [...list.map((id) => q.options.find((o) => o.id === id)).filter(Boolean), ...q.options.filter((o) => !list.includes(o.id))] : q.options).map((o) => {
                        if (!o) return null;
                        const checked = list.includes(o.id);
                        const pos = list.indexOf(o.id);
                        return (
                          <li key={o.id} className="flex items-center gap-2">
                            <CheckInput
                              checked={checked}
                              data-id={`fw-consult-answer-${q.id}-${o.id}`}
                              aria-label={o.label}
                              onChange={() => onChange(q.id, checked ? list.filter((v) => v !== o.id) : [...list, o.id])}
                            />
                            <span className={`text-caption ${checked ? "text-ink" : "text-ink-secondary"}`}>{o.label}</span>
                            {q.kind === "ordered" && checked && (
                              <span className="ml-auto flex items-center gap-0.5">
                                <span className="text-fine text-ink-tertiary tabular-nums">{pos + 1}</span>
                                <button type="button" className="rounded-sm p-0.5 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveUp")} data-id={`fw-consult-answer-up-${q.id}-${o.id}`} disabled={pos === 0}
                                  onClick={() => { const next = [...list]; [next[pos - 1], next[pos]] = [next[pos], next[pos - 1]]; onChange(q.id, next); }}>
                                  <ArrowUp size={14} strokeWidth={1.5} />
                                </button>
                                <button type="button" className="rounded-sm p-0.5 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveDown")} data-id={`fw-consult-answer-down-${q.id}-${o.id}`} disabled={pos === list.length - 1}
                                  onClick={() => { const next = [...list]; [next[pos + 1], next[pos]] = [next[pos], next[pos + 1]]; onChange(q.id, next); }}>
                                  <ArrowDown size={14} strokeWidth={1.5} />
                                </button>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

// 주관식 한 칸 — 빈 textarea에서 시작, [AI 제안]이 제안값을 타이핑으로 채우고, blur로 확정(텍스트 뷰), hover 연필로 재편집.
// 빈칸 제출은 여전히 허용(서버가 제안값 적용) — 여기서는 보여주지 않을 뿐이다.
function TextAnswer({ qid, value, suggested, onChange }: { qid: string; value: string; suggested: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const { typeInto } = useTypewriter();
  const [editing, setEditing] = useState(() => value === "");
  const [typing, setTyping] = useState(false);
  const committed = !editing && value !== "";
  return (
    <div className="group flex items-start gap-2">
      {committed ? (
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-caption text-ink" data-id={`fw-consult-answer-view-${qid}`}>{value}</p>
      ) : (
        <textarea
          data-id={`fw-consult-answer-${qid}`}
          autoFocus={editing && value !== ""}
          readOnly={typing}
          className="min-h-16 w-full min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (value.trim() !== "") setEditing(false); }}
        />
      )}
      {committed ? (
        <button
          type="button"
          data-id={`fw-consult-edit-answer-${qid}`}
          title={t("fwConsult.editAnswer")}
          aria-label={t("fwConsult.editAnswer")}
          className="shrink-0 rounded-sm p-1 text-ink-secondary opacity-0 transition-opacity duration-150 hover:bg-surface-alt focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => setEditing(true)}
        >
          <PenLine size={14} strokeWidth={1.5} />
        </button>
      ) : (
        <AiButton
          variant="inline"
          data-id={`fw-consult-ai-suggest-${qid}`}
          disabled={typing || suggested === ""}
          className="shrink-0"
          onClick={() => {
            setTyping(true);
            typeInto(suggested, onChange, () => {
              setTyping(false);
              setEditing(false);
            });
          }}
        >
          {t("fwConsult.aiSuggest")}
        </AiButton>
      )}
    </div>
  );
}
