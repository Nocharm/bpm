"use client";

// 캠페인 ② L6 설문 폼 — 섹션(판단·예외·분기·활동·기본·입출력)별 문항 렌더(2열 그리드·객관식 위주·제안 선택됨·주관식은
// 빈칸에서 [AI 제안]이 타이핑으로 채우고 blur로 확정). 오래 머무는 화면이라 hover 응답을 종류별로 둔다(문항 카드·알약·체크 행·화살표·확정 뷰·textarea). 상태별 카드 패널(task-panel)이 ready 카드에서 쓴다
// (spec 2026-09-21 §2·§4, 2026-09-23 §3 B10·§4.3 B12).

import { type ReactNode, useState } from "react";
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
                <li key={q.id} data-id={`fw-consult-question-${q.id}`} className={`flex flex-col gap-1.5 rounded-md border p-3 transition-[background-color,border-color,box-shadow] duration-150 hover:bg-surface hover:shadow-sm ${isMissing ? "border-error" : "border-hairline hover:border-border-strong"} bg-surface-pearl${span}`}>
                  {q.kind === "text" ? (
                    // 주관식은 제목 줄 우측에 글자형 [AI 제안]/연필을 얹고 편집 박스가 전폭을 쓴다
                    <TextAnswer
                      qid={q.id}
                      title={<><span className="text-ink-tertiary tabular-nums">{numbers.get(q.id)}. </span>{q.text}</>}
                      why={q.why}
                      value={textValue}
                      suggested={typeof q.suggested === "string" ? q.suggested : ""}
                      onChange={(v) => onChange(q.id, v)}
                    />
                  ) : (
                    <>
                      <p className="text-caption text-ink"><span className="text-ink-tertiary tabular-nums">{numbers.get(q.id)}. </span>{q.text}</p>
                      {q.why && <QuestionWhy qid={q.id} why={q.why} />}
                    </>
                  )}
                  {q.kind === "single" && (
                    <div className="flex flex-wrap gap-2">
                      {q.options.map((o) => (
                        // 라디오는 label 안쪽(sr-only)이라 형제 peer가 아니라 has()로 키보드 포커스만 링 표시(check-input.tsx의 peer 패턴 동치).
                        <label key={o.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-caption has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-1 transition-colors duration-150 ${value === o.id ? "border-accent bg-accent-tint text-accent hover:bg-accent-tint-border/60" : "border-hairline bg-surface text-ink hover:border-border-strong hover:bg-surface-alt"}`}>
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
                          // 행 전체가 hover 대상이고 글자를 눌러도 토글된다 — 체크박스만 겨냥하지 않아도 되게(설문 체류 편의)
                          <li key={o.id} className="-mx-1.5 flex items-center gap-2 rounded-sm px-1.5 py-0.5 transition-colors duration-150 hover:bg-surface-alt">
                            <CheckInput
                              checked={checked}
                              data-id={`fw-consult-answer-${q.id}-${o.id}`}
                              aria-label={o.label}
                              onChange={() => onChange(q.id, checked ? list.filter((v) => v !== o.id) : [...list, o.id])}
                            />
                            <span
                              className={`min-w-0 flex-1 cursor-pointer text-caption ${checked ? "text-ink" : "text-ink-secondary"}`}
                              data-id={`fw-consult-answer-label-${q.id}-${o.id}`}
                              onClick={() => onChange(q.id, checked ? list.filter((v) => v !== o.id) : [...list, o.id])}
                            >
                              {o.label}
                            </span>
                            {q.kind === "ordered" && checked && (
                              <span className="ml-auto flex items-center gap-0.5">
                                <span className="text-fine text-ink-tertiary tabular-nums">{pos + 1}</span>
                                <button type="button" className="rounded-sm p-0.5 text-ink-tertiary transition-colors duration-150 hover:bg-accent-tint hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-tertiary" title={t("fwConsult.moveUp")} data-id={`fw-consult-answer-up-${q.id}-${o.id}`} disabled={pos === 0}
                                  onClick={() => { const next = [...list]; [next[pos - 1], next[pos]] = [next[pos], next[pos - 1]]; onChange(q.id, next); }}>
                                  <ArrowUp size={14} strokeWidth={1.5} />
                                </button>
                                <button type="button" className="rounded-sm p-0.5 text-ink-tertiary transition-colors duration-150 hover:bg-accent-tint hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-tertiary" title={t("fwConsult.moveDown")} data-id={`fw-consult-answer-down-${q.id}-${o.id}`} disabled={pos === list.length - 1}
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

// 질문 근거 한 줄 — AI가 왜 이걸 묻는지(자료에서 빠진 것). 현업이 "왜 이걸 묻지"를 바로 알게 문항 바로 아래 작게.
function QuestionWhy({ qid, why }: { qid: string; why: string }) {
  return <p className="text-fine text-ink-tertiary" data-id={`fw-consult-question-why-${qid}`}>{why}</p>;
}

// 주관식 한 칸 — 제목 줄 우측에 글자형 [AI 제안](편집 중)/연필(확정 후, hover에 노출), 그 아래 전폭 textarea.
// 빈 textarea에서 시작, [AI 제안]이 제안값을 타이핑으로 채우고, blur로 확정(텍스트 뷰), 연필로 재편집.
// 빈칸 제출은 여전히 허용(서버가 제안값 적용) — 여기서는 보여주지 않을 뿐이다.
function TextAnswer({ qid, title, why, value, suggested, onChange }: { qid: string; title: ReactNode; why?: string; value: string; suggested: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const { typeInto } = useTypewriter();
  const [editing, setEditing] = useState(() => value === "");
  const [typing, setTyping] = useState(false);
  const committed = !editing && value !== "";
  return (
    <div className="group flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-caption text-ink">{title}</p>
          {why && <QuestionWhy qid={qid} why={why} />}
        </div>
        {committed ? (
          <button
            type="button"
            data-id={`fw-consult-edit-answer-${qid}`}
            title={t("fwConsult.editAnswer")}
            aria-label={t("fwConsult.editAnswer")}
            className="shrink-0 rounded-sm p-0.5 text-ink-secondary opacity-0 transition-opacity duration-150 hover:bg-surface-alt focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => setEditing(true)}
          >
            <PenLine size={14} strokeWidth={1.5} />
          </button>
        ) : (
          <AiButton
            variant="text"
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
      {committed ? (
        // 확정 뷰도 눌러서 다시 열 수 있다(연필과 같은 동작) — hover 배경으로 눌릴 수 있음을 보인다
        <p
          className="-mx-1.5 cursor-text whitespace-pre-wrap rounded-sm px-1.5 py-1 text-caption text-ink transition-colors duration-150 hover:bg-surface-alt"
          data-id={`fw-consult-answer-view-${qid}`}
          title={t("fwConsult.editAnswer")}
          onClick={() => setEditing(true)}
        >
          {value}
        </p>
      ) : (
        <textarea
          data-id={`fw-consult-answer-${qid}`}
          autoFocus={editing && value !== ""}
          readOnly={typing}
          className="min-h-16 w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink outline-none transition-[border-color,box-shadow] duration-150 hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (value.trim() !== "") setEditing(false); }}
        />
      )}
    </div>
  );
}
