"use client";

// 캠페인 ② L6 설문 단계 — 문항 렌더(객관식 위주·제안 선택됨·주관식 플레이스홀더=제안)·제안 일괄 채우기·
// 확인 화면 전환·제출. 제출 후 카드는 잠기고 백그라운드 드로잉으로 넘어간다 (spec 2026-09-21 §2·§4).

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Sparkles } from "lucide-react";

import { getApiErrorDetail, getFrameworkInterviewTask, type FwAnswerValue, type FwInterviewSession, type FwInterviewTask, type FwQuestionnaire } from "@/lib/api";
import { buildSubmitPayload, fillSuggested, validateAnswers } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import { CheckInput } from "@/components/check-input";
import { AnswerReview } from "@/components/framework-interview/answer-review";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface QuestionnaireFormProps {
  questionnaire: FwQuestionnaire;
  answers: Record<string, FwAnswerValue>;
  missing: string[];
  onChange: (qid: string, value: FwAnswerValue) => void;
}

export function QuestionnaireForm({ questionnaire, answers, missing, onChange }: QuestionnaireFormProps) {
  const { t } = useI18n();
  return (
    <ol className="flex flex-col gap-3" data-id="fw-consult-questions">
      {questionnaire.questions.map((q, idx) => {
        const value = answers[q.id];
        const isMissing = missing.includes(q.id);
        const list = Array.isArray(value) ? value : [];
        return (
          <li key={q.id} data-id={`fw-consult-question-${q.id}`} className={`flex flex-col gap-1.5 rounded-md border p-3 ${isMissing ? "border-error" : "border-hairline"} bg-surface-pearl`}>
            <p className="text-caption text-ink"><span className="text-ink-tertiary tabular-nums">{idx + 1}. </span>{q.text}</p>
            {q.kind === "text" && (
              <textarea
                data-id={`fw-consult-answer-${q.id}`}
                className="min-h-16 w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
                value={typeof value === "string" ? value : ""}
                placeholder={t("fwConsult.textPlaceholder", { suggested: typeof q.suggested === "string" ? q.suggested : "" })}
                onChange={(e) => onChange(q.id, e.target.value)}
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
  );
}

interface AnswerStepProps {
  session: FwInterviewSession;
  task: FwInterviewTask | null;
  busy: boolean;
  onSubmit: (taskPk: number, answers: Record<string, FwAnswerValue>) => void;
}

export function AnswerStep({ session, task, busy, onSubmit }: AnswerStepProps) {
  const { t } = useI18n();
  const [questionnaire, setQuestionnaire] = useState<FwQuestionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, FwAnswerValue>>({});
  const [reviewing, setReviewing] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 카드가 바뀌면(id 또는 상태) 설문지를 다시 받고 제안값으로 초기화 — 제출된 카드는 돌아오지 않으므로 캐시 불필요.
  // 페이지가 <AnswerStep key={task.id}>로 리마운트하지만, 2초 폴링이 매번 새 task 객체(같은 id·상태)를 만들어
  // 넘기므로 deps는 스칼라(id·status)만 본다 — 객체 참조로 걸면 폴링마다 재요청해 입력 중인 answers를 지운다.
  useEffect(() => {
    if (!task || task.status !== "ready") return;
    let alive = true;
    getFrameworkInterviewTask(session.id, task.id)
      .then((detail) => {
        if (!alive || !detail.questionnaire) return;
        setQuestionnaire(detail.questionnaire);
        setAnswers(fillSuggested(detail.questionnaire));
      })
      .catch((err) => { if (alive) setLoadError(getApiErrorDetail(err)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scalars only: an object dep would refetch on every 2s poll (same id/status, new reference) and wipe in-progress answers
  }, [session.id, task?.id, task?.status]);

  if (!task) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center gap-2" data-id="fw-consult-waiting">
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-accent" />
        <span className="text-caption text-ink-secondary">{t("fwConsult.waitingDrawing")}</span>
      </div>
    );
  }
  if (task.status !== "ready" || !questionnaire) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center gap-2" data-id="fw-consult-waiting">
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-accent" />
        <span className="text-caption text-ink-secondary">{loadError ?? t("fwConsult.waitingQuestionnaire", { name: task.name })}</span>
      </div>
    );
  }
  const handleReview = () => {
    const miss = validateAnswers(questionnaire, answers);
    setMissing(miss);
    if (miss.length === 0) setReviewing(true);
  };
  const handleAnswerChange = (qid: string, value: FwAnswerValue) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
    // 답을 고치면 그 문항의 누락 표시를 즉시 지운다 — 제출 실패 상태가 다음 입력까지 남아있지 않게.
    setMissing((prev) => (prev.includes(qid) ? prev.filter((id) => id !== qid) : prev));
  };
  return (
    <div className="flex flex-col gap-3 p-4" data-id="fw-consult-answer">
      <div className="flex items-center gap-2">
        <span className="text-body-strong text-ink">{task.seq}. {task.name}</span>
        {!reviewing && (
          <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-fill-all" onClick={() => setAnswers(fillSuggested(questionnaire))}>
            <Sparkles size={14} strokeWidth={1.5} />{t("fwConsult.fillAll")}
          </button>
        )}
      </div>
      {reviewing ? (
        <AnswerReview questionnaire={questionnaire} answers={answers} />
      ) : (
        <QuestionnaireForm questionnaire={questionnaire} answers={answers} missing={missing} onChange={handleAnswerChange} />
      )}
      {missing.length > 0 && <p className="text-caption text-error" data-id="fw-consult-missing">{t("fwConsult.missing")}</p>}
      <div className="flex items-center gap-2">
        <span className="text-fine text-ink-tertiary">{t("fwConsult.submitHint")}</span>
        {reviewing ? (
          <>
            <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-back-edit" onClick={() => setReviewing(false)}>{t("fwConsult.backToEdit")}</button>
            <button type="button" className={PRIMARY} data-id="fw-consult-submit" disabled={busy} onClick={() => onSubmit(task.id, buildSubmitPayload(questionnaire, answers))}>{t("fwConsult.submit")}</button>
          </>
        ) : (
          <button type="button" className={`${PRIMARY} ml-auto`} data-id="fw-consult-review" onClick={handleReview}>{t("fwConsult.review")}</button>
        )}
      </div>
    </div>
  );
}
