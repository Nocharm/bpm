"use client";

// 캠페인 L6 카드 패널 — 보드의 어느 행을 눌러도 그 카드를 상태별로 연다: 준비 중 링 · 설문 폼 · 제출 답+드로잉 링 ·
// 완성 행(답+흐름 미리보기+피드백 채팅) · 실패 재시도/건너뛰기. [닫기]는 자동 흐름으로 돌아간다 (spec 2026-09-23 §4.3 B9).

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, SkipForward, X } from "lucide-react";

import {
  getApiErrorDetail, getFrameworkInterviewTask,
  type FwAnswerValue, type FwInterviewSession, type FwInterviewTask, type FwInterviewTaskDetail,
} from "@/lib/api";
import { buildSubmitPayload, fillSuggested, validateAnswers } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import { AiButton } from "@/components/ai-button";
import { ImportMapPreview } from "@/components/admin/import-report/map-preview";
import { AnswerReview } from "@/components/framework-interview/answer-review";
import { FeedbackChat } from "@/components/framework-interview/feedback-chat";
import { QuestionnaireForm } from "@/components/framework-interview/questionnaire-form";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface TaskPanelProps {
  session: FwInterviewSession;
  task: FwInterviewTask;
  busy: boolean;
  onSubmit: (taskPk: number, answers: Record<string, FwAnswerValue>) => void;
  onFeedback: (taskPk: number, message: string) => void;
  onRetry: (taskPk: number) => void;
  onSkip: (taskPk: number) => void;
  // 보드에서 고른 카드일 때만 온다 — 선택 해제 → 자동 흐름(deriveStep)으로 복귀.
  // 자동 흐름이 띄운 패널엔 풀 선택이 없어(닫아도 그 자리) 닫기 버튼 자체를 내지 않는다.
  onClose?: () => void;
}

export function TaskPanel({ session, task, busy, onSubmit, onFeedback, onRetry, onSkip, onClose }: TaskPanelProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<FwInterviewTaskDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, FwAnswerValue>>({});
  const [reviewing, setReviewing] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 카드 피드백은 제자리 수정이라 상태가 drawn에 머문다 — 이 카드에 쌓인 피드백 수를 재조회 트리거로 쓴다
  const feedbackCount = session.feedback_log.filter((entry) => entry.scope === "task" && entry.task_pk === task.id).length;

  // 상세(설문지·제출 답·행)는 세션 페이로드에 없어 따로 받는다. deps는 스칼라만 —
  // 2초 폴링이 같은 id·상태의 새 task 객체를 계속 만들므로, 객체로 걸면 입력 중인 답이 매 폴링마다 지워진다.
  useEffect(() => {
    let alive = true;
    getFrameworkInterviewTask(session.id, task.id)
      .then((next) => {
        if (!alive) return;
        setLoadError(null);
        setDetail(next);
        if (next.status === "ready" && next.questionnaire) setAnswers(fillSuggested(next.questionnaire));
      })
      .catch((err) => { if (alive) setLoadError(getApiErrorDetail(err)); });
    return () => { alive = false; };
  }, [session.id, task.id, task.status, feedbackCount]);

  const questionnaire = detail?.questionnaire ?? null;
  // 제출된 답은 {value, auto} 래핑 — 확인 화면은 값만 본다
  const submittedAnswers: Record<string, FwAnswerValue> = detail?.answers
    ? Object.fromEntries(Object.entries(detail.answers).map(([qid, entry]) => [qid, entry.value]))
    : {};
  // 미리보기 source는 참조 동일성을 지켜야 한다 — ImportMapPreview가 source로 메모하고 그래프가 바뀔 때
  // Start 노드로 스크롤을 되돌리므로, 매 렌더 새 객체면 2초 폴링마다 사용자가 잡은 화면이 튄다.
  const previewSource = useMemo(
    () => (detail?.row ? { taskId: task.task_id, ...detail.row } : null),
    [detail, task.task_id],
  );
  const answering = task.status === "ready" && questionnaire !== null;

  function handleReview() {
    if (!questionnaire) return;
    const miss = validateAnswers(questionnaire, answers);
    setMissing(miss);
    if (miss.length === 0) setReviewing(true);
  }

  function handleAnswerChange(qid: string, value: FwAnswerValue) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
    // 답을 고치면 그 문항의 누락 표시를 즉시 지운다 — 제출 실패 상태가 다음 입력까지 남아있지 않게.
    setMissing((prev) => (prev.includes(qid) ? prev.filter((id) => id !== qid) : prev));
  }

  function handleFeedback(message: string) {
    onFeedback(task.id, message);
    setDraft("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" data-id="fw-consult-task-panel" data-status={task.status}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-body-strong text-ink">{task.seq}. {task.name}</span>
        {answering && !reviewing && (
          <AiButton variant="inline" data-id="fw-consult-fill-all" onClick={() => setAnswers(fillSuggested(questionnaire))}>
            {t("fwConsult.fillAll")}
          </AiButton>
        )}
        {onClose && (
          <button
            type="button"
            data-id="fw-consult-task-close"
            title={t("fwConsult.panelClose")}
            aria-label={t("fwConsult.panelClose")}
            className="shrink-0 rounded-sm p-1 text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {(task.status === "pending" || task.status === "generating") && (
        <div className="flex min-h-44 flex-1 flex-col items-center justify-center gap-2" data-id="fw-consult-task-waiting">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-accent" />
          <span className="text-caption text-ink-secondary">{loadError ?? t("fwConsult.panelPreparing")}</span>
        </div>
      )}

      {task.status === "ready" && !answering && (
        <div className="flex min-h-44 flex-1 flex-col items-center justify-center gap-2" data-id="fw-consult-task-waiting">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-accent" />
          <span className="text-caption text-ink-secondary">{loadError ?? t("fwConsult.waitingQuestionnaire", { name: task.name })}</span>
        </div>
      )}

      {answering && (
        <div className="flex flex-col gap-3" data-id="fw-consult-answer">
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
      )}

      {(task.status === "submitted" || task.status === "drawing") && (
        <div className="flex flex-col gap-3" data-id="fw-consult-task-submitted">
          {/* 답은 상세가 도착한 뒤에만 — 빈 answers로 그리면 제출 직후 한 틱 동안 "제안 적용" 배지만 번쩍인다 */}
          {questionnaire && detail?.answers && <AnswerReview questionnaire={questionnaire} answers={submittedAnswers} />}
          <div className="flex items-center justify-center gap-2 rounded-md border border-hairline bg-surface-pearl px-3 py-3" data-id="fw-consult-task-drawing">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-accent" />
            <span className="text-caption text-ink-secondary">{t("fwConsult.panelDrawing")}</span>
          </div>
        </div>
      )}

      {task.status === "drawn" && (
        <div className="flex flex-col gap-3" data-id="fw-consult-task-drawn">
          {/* 임베드라 항상 펼쳐져 있다 — hideClose라 onClose는 호출되지 않는다(필수 prop이라 no-op) */}
          {previewSource && (
            <ImportMapPreview source={previewSource} scope="map" dataId="fw-consult-task-panel-canvas" onClose={() => undefined} hideClose />
          )}
          {questionnaire && <AnswerReview questionnaire={questionnaire} answers={submittedAnswers} />}
          <FeedbackChat
            log={session.feedback_log}
            scope="task"
            taskPk={task.id}
            busy={busy}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleFeedback}
            placeholder={t("fwConsult.feedbackTaskPlaceholder")}
            // 등록(apply)이 끝난 세션은 서버가 카드 수정을 409로 막는다 — 작성창을 걷어 이유를 먼저 말한다
            locked={session.status === "applied"}
            lockedNote={t("fwConsult.feedbackLocked")}
          />
        </div>
      )}

      {task.status === "failed" && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-error bg-surface-pearl p-3" data-id="fw-consult-task-failed">
          <span className="text-caption text-error">{task.error ?? t("fwConsult.statusFailed")}</span>
          <div className="flex items-center gap-2">
            <button type="button" className={SECONDARY} data-id="fw-consult-task-panel-retry" disabled={busy} onClick={() => onRetry(task.id)}>
              <RotateCcw size={14} strokeWidth={1.5} />
              {t("fwConsult.retry")}
            </button>
            <button type="button" className={SECONDARY} data-id="fw-consult-task-panel-skip" disabled={busy} title={t("fwConsult.skipHint")} onClick={() => onSkip(task.id)}>
              <SkipForward size={14} strokeWidth={1.5} />
              {t("fwConsult.skip")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
