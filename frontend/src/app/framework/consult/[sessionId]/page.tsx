"use client";

// AI 컨설턴트 L5 캠페인 — 풀스크린(TopNav 아래): 좌 L6 카드 보드+진행률 / 우 현재 단계 (spec 2026-09-21 §2·§9).
// 폴링 2초: 백그라운드 작업(설문 생성·드로잉)이 있는 동안만. 세션은 DB에 있어 이탈 후 복귀 가능.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Headset, Loader2 } from "lucide-react";

import {
  abandonFrameworkInterview, confirmFrameworkRelations, generateFrameworkPlan, generateFrameworkRelations,
  getApiErrorDetail, getFrameworkInterview, markFrameworkInterviewApplied, pauseFrameworkInterview,
  deleteFrameworkAttachment, reopenFrameworkRelations, reopenFrameworkTask, resumeFrameworkInterview, retryFrameworkTask,
  reviseFrameworkTask, saveFrameworkCanvas, saveFrameworkPlan, sendFrameworkFeedback, skipFrameworkTask,
  submitFrameworkAnswers, uploadFrameworkInterviewAttachment,
  type FwAnswerValue, type FwInterviewSession, type FwPlanCard,
} from "@/lib/api";
import { deriveStep, findCurrentTask, hasBackgroundWork, type FwStep } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InterviewJsonPromptButton } from "@/components/framework-interview/interview-json-prompt-button";
import { PlanBriefPanel } from "@/components/framework-interview/plan-brief-panel";
import { PlanEditor } from "@/components/framework-interview/plan-editor";
import { RegisterStep } from "@/components/framework-interview/register-step";
import { RelationsStep } from "@/components/framework-interview/relations-step";
import { TaskBoard } from "@/components/framework-interview/task-board";
import { TaskPanel } from "@/components/framework-interview/task-panel";

const BOARD_WIDTH_KEY = "bpm.fwConsultBoardWidth";
const BOARD_MIN = 380;  // 진행 헤더(진행률·ETA·일시정지)가 한/영 모두 한 줄에 들어가는 하한
const BOARD_MAX = 640;
const POLL_MS = 2000;
const STALLED_TICKS = 5;  // 폴링 5틱(≈10초) 동안 할 일은 있는데 아무도 안 움직이면 러너가 멎은 것으로 본다

function buildStatusSignature(session: FwInterviewSession): string {
  return session.tasks.map((task) => `${task.id}:${task.status}`).join(",");
}

function readBoardWidth(): number {
  if (typeof window === "undefined") return 360;
  const stored = Number(window.localStorage.getItem(BOARD_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= BOARD_MIN && stored <= BOARD_MAX ? stored : 420;
}

export default function FrameworkConsultPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const router = useRouter();
  const { t } = useI18n();
  const [session, setSession] = useState<FwInterviewSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardWidth, setBoardWidth] = useState(readBoardWidth);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [previewTaskId, setPreviewTaskId] = useState<number | null>(null);
  // 보드에서 고른 카드 — 상태와 무관하게 그 카드 패널을 우측에 띄운다(ready면 순서와 무관하게 먼저 답한다,
  // 사용자 요청 2026-09-21 · 2026-09-23 §4.3 B9). 닫으면 자동 흐름(deriveStep)으로 돌아간다.
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  // 단계 전환 감지용 미러 — 연결/등록 단계로 넘어가는 순간 선택을 풀어 사용자가 새 단계에 착지하게 한다.
  // 렌더에서 읽지 않고 applySession(이벤트 콜백) 안에서만 읽고 쓴다.
  const flowStepRef = useRef<FwStep | null>(null);
  // 드로잉 소요 실측(ms) — ETA 추정. submitted를 처음 본 시각 → drawn을 처음 본 시각
  const submittedAtRef = useRef<Map<number, number>>(new Map());
  const [drawDurations, setDrawDurations] = useState<number[]>([]);
  // 러너 정지 감지 — 상태가 안 변한 채 흐른 폴링 틱 수 (I3)
  const statusSigRef = useRef("");
  const [stalledTicks, setStalledTicks] = useState(0);
  // planning 단계 — brief는 좌측 패널, 카드는 우측 편집기에 있어 둘을 페이지가 잇는다.
  // brief는 사용자가 건드리기 전까지 서버값(null=미편집), 카드는 편집기가 미러해 주는 ref(렌더에서 읽지 않는다).
  const [briefDraft, setBriefDraft] = useState<string | null>(null);
  const planCardsRef = useRef<FwPlanCard[]>([]);
  const handleCardsChange = useCallback((cards: FwPlanCard[]) => { planCardsRef.current = cards; }, []);

  const applySession = useCallback((next: FwInterviewSession) => {
    statusSigRef.current = buildStatusSignature(next);
    const now = Date.now();
    const durations: number[] = [];
    for (const task of next.tasks) {
      if (task.status === "submitted" || task.status === "drawing") {
        if (!submittedAtRef.current.has(task.id)) submittedAtRef.current.set(task.id, now);
      } else if (task.status === "drawn" && submittedAtRef.current.has(task.id)) {
        durations.push(now - (submittedAtRef.current.get(task.id) ?? now));
        submittedAtRef.current.delete(task.id);
      } else if ((task.status === "failed" || task.status === "pending") && submittedAtRef.current.has(task.id)) {
        // 실패했거나(재시도 대기) 초기화된 카드는 소요 측정을 리셋 — 재시도로 다시 submitted가 찍힐 때부터 새로 잰다.
        submittedAtRef.current.delete(task.id);
      }
    }
    if (durations.length) setDrawDurations((prev) => [...prev, ...durations]);
    // 연결·등록 단계로 넘어가는 전환에서만 선택을 푼다 — 그 단계에 머무는 동안의 보드 클릭은 살려둔다
    const nextStep = deriveStep(next);
    const prevStep = flowStepRef.current;
    flowStepRef.current = nextStep;
    if (prevStep !== null && prevStep !== nextStep && (nextStep === "relations" || nextStep === "register")) {
      setSelectedTaskId(null);
    }
    setSession(next);
  }, []);

  const run = useCallback(async (action: () => Promise<FwInterviewSession>) => {
    setBusy(true);
    setError(null);
    try {
      applySession(await action());
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setBusy(false);
    }
  }, [applySession]);

  useEffect(() => {
    if (!Number.isFinite(sessionId)) return;
    getFrameworkInterview(sessionId).then(applySession).catch((err) => setError(getApiErrorDetail(err)));
  }, [sessionId, applySession]);

  useEffect(() => {
    if (!session || !hasBackgroundWork(session)) return;
    let alive = true;
    const timer = window.setInterval(() => {
      getFrameworkInterview(sessionId)
        .then((next) => {
          if (!alive) return; // 응답이 늦게 와 더 최신 상태를 덮어쓰지 않게
          setError(null);
          const changed = buildStatusSignature(next) !== statusSigRef.current;
          setStalledTicks((n) => (changed || next.progress.working || !hasBackgroundWork(next) ? 0 : n + 1));
          applySession(next);
        })
        .catch((err) => { if (alive) setError(getApiErrorDetail(err)); });
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [session, sessionId, applySession]);

  function handleDividerDown(e: React.PointerEvent) {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => setBoardWidth(Math.min(BOARD_MAX, Math.max(BOARD_MIN, ev.clientX)));
    const finish = (ev: PointerEvent) => {
      window.localStorage.setItem(BOARD_WIDTH_KEY, String(Math.min(BOARD_MAX, Math.max(BOARD_MIN, ev.clientX))));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-caption text-ink-tertiary" data-id="fw-consult-loading">
        {error ?? "…"}
      </div>
    );
  }

  // 고른 카드는 상태와 무관하게 우측 패널이 된다. 선택이 없으면 자동 흐름 — 답할 카드가 있으면 그 카드.
  const selectedTask = selectedTaskId === null ? null : session.tasks.find((x) => x.id === selectedTaskId) ?? null;
  const flowStep = deriveStep(session);
  const current = selectedTask ?? findCurrentTask(session);
  // 라벨은 흐름 기준 — ready 카드를 먼저 골랐을 때만 설문 단계로 바꿔 부른다
  const step = selectedTask?.status === "ready" ? "answer" : flowStep;
  const panelTask = selectedTask ?? (step === "answer" || step === "waiting" ? current : null);
  const stepLabel = {
    plan: t("fwConsult.stepPlan"), answer: t("fwConsult.stepAnswer"), waiting: t("fwConsult.stepWaiting"),
    relations: t("fwConsult.stepRelations"), register: t("fwConsult.stepRegister"), done: t("fwConsult.stepDone"),
  }[step];

  return (
    <div className="flex h-full flex-col" data-id="fw-consult-page">
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        <Link href="/settings?tab=framework" className="flex items-center gap-1 text-caption text-ink-tertiary hover:text-ink" data-id="fw-consult-exit">
          <ArrowLeft size={16} strokeWidth={1.5} />
          {t("fwConsult.back")}
        </Link>
        <Headset size={16} strokeWidth={1.5} className="text-accent" />
        <span className="text-body-strong">{session.category_name}</span>
        <span className="text-caption text-ink-muted">· {t("fwConsult.title")}</span>
        <span className="ml-auto text-caption text-ink-secondary" data-id="fw-consult-step-label">{stepLabel}</span>
        <InterviewJsonPromptButton target={{ code: session.category_code, name: session.category_name, path: [], existingL6: session.existing.filter((e) => !e.frozen) }} />
        <button type="button" data-id="fw-consult-abandon" className="rounded-sm px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt" onClick={() => setConfirmAbandon(true)}>
          {t("fwConsult.abandon")}
        </button>
      </header>
      {error && <div className="border-b border-hairline bg-surface-pearl px-3 py-1.5 text-caption text-error" data-id="fw-consult-error">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col overflow-y-auto bg-surface-pearl" style={{ width: boardWidth }} data-id="fw-consult-board">
          {step === "plan" ? (
            <PlanBriefPanel
              brief={briefDraft ?? session.brief}
              onBriefChange={setBriefDraft}
              attachments={session.attachments}
              busy={busy}
              hasCards={(session.plan?.length ?? 0) > 0}
              onAttach={(file) => void run(() => uploadFrameworkInterviewAttachment(session.id, file))}
              onRemoveAttachment={(index) => void run(() => deleteFrameworkAttachment(session.id, index))}
              onGenerate={() => void run(async () => {
                await saveFrameworkPlan(session.id, planCardsRef.current, false, briefDraft ?? session.brief);  // 화면의 brief·카드로 제안받는다
                return generateFrameworkPlan(session.id);
              })}
            />
          ) : (
          <TaskBoard
            session={session}
            currentTaskId={current?.id ?? null}
            drawDurationsMs={drawDurations}
            onPause={() => void run(() => pauseFrameworkInterview(session.id))}
            onResume={() => void run(() => resumeFrameworkInterview(session.id))}
            onRetry={(taskPk) => void run(() => retryFrameworkTask(session.id, taskPk))}
            onSkip={(taskPk) => void run(() => skipFrameworkTask(session.id, taskPk))}
            onRevise={(task) => void run(() => reviseFrameworkTask(session.id, task.id))}
            onPreview={setPreviewTaskId}
            onSelect={setSelectedTaskId}
            stalled={stalledTicks >= STALLED_TICKS && !session.paused}
            onNudge={() => {
              setStalledTicks(0);
              void run(() => resumeFrameworkInterview(session.id));  // resume이 러너를 다시 깨운다
            }}
          />
          )}
        </aside>
        <div
          className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-hairline transition-colors duration-150 hover:bg-accent/40"
          role="separator" aria-orientation="vertical" aria-label={t("fwConsult.resizeBoard")} tabIndex={0}
          onPointerDown={handleDividerDown} data-id="fw-consult-divider"
        />
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-surface" data-id="fw-consult-step">
          {step === "plan" && (
            <PlanEditor
              // 첨부·brief는 좌측 패널(props로 그대로 표시)이라 plan 내용만 key로 삼는다 —
              // 첨부 업로드/삭제가 편집 중인 카드를 지우지 않는다.
              key={JSON.stringify(session.plan ?? [])}
              session={session}
              busy={busy}
              onCardsChange={handleCardsChange}
              onSave={(cards: FwPlanCard[]) => void run(() => saveFrameworkPlan(session.id, cards, false, briefDraft ?? session.brief))}
              onLock={(cards: FwPlanCard[]) => void run(() => saveFrameworkPlan(session.id, cards, true, briefDraft ?? session.brief))}
            />
          )}
          {panelTask && (
            <TaskPanel
              key={panelTask.id}
              session={session}
              task={panelTask}
              busy={busy}
              onSubmit={(taskPk: number, answers: Record<string, FwAnswerValue>) =>
                void run(() => submitFrameworkAnswers(session.id, taskPk, answers))}
              onFeedback={(taskPk: number, message: string) =>
                void run(() => sendFrameworkFeedback(session.id, { scope: "task", task_pk: taskPk, message }))}
              onRetry={(taskPk: number) => void run(() => retryFrameworkTask(session.id, taskPk))}
              onSkip={(taskPk: number) => void run(() => skipFrameworkTask(session.id, taskPk))}
              // 보드에서 고른 카드에만 닫기 — 자동 흐름이 띄운 패널은 풀 선택이 없어 닫아도 그 자리다
              onClose={selectedTask ? () => setSelectedTaskId(null) : undefined}
            />
          )}
          {!panelTask && (step === "answer" || step === "waiting") && (
            <div className="flex min-h-44 flex-1 flex-col items-center justify-center gap-2" data-id="fw-consult-task-waiting">
              <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-accent" />
              <span className="text-caption text-ink-secondary">{t("fwConsult.waitingDrawing")}</span>
            </div>
          )}
          {/* 보드 카드를 고르면 숨기기만 한다 — 언마운트하면 편집 중인 캔버스(디바운스 저장 대기분)와
              등록 단계의 드라이런 결과·거버넌스 선택이 버려지고, 닫을 때 낡은 session으로 되감긴다. */}
          {step === "relations" && (
          <div className={selectedTask ? "hidden" : "flex min-h-0 flex-1 flex-col"} data-id="fw-consult-relations-host">
            <RelationsStep
              // 캔버스 내용이 바뀔 때만 리마운트 — 자동 제안·피드백 결과를 편집 상태에 반영한다.
              // 디바운스 저장(onSaveCanvas)은 session을 갱신하지 않아 편집 중엔 리마운트가 없다.
              key={JSON.stringify(session.canvas ?? session.relations ?? null)}
              session={session}
              busy={busy}
              onPropose={(comment) => void run(() => generateFrameworkRelations(session.id, comment))}
              onSaveCanvas={(canvas) => void saveFrameworkCanvas(session.id, canvas).catch((err) => setError(getApiErrorDetail(err)))}
              onConfirm={(canvas) => void run(() => confirmFrameworkRelations(session.id, { canvas }))}
              onFeedback={(message) => void run(() => sendFrameworkFeedback(session.id, { scope: "relations", message }))}
              onPreviewTask={setPreviewTaskId}
              onReopenTask={(taskPk) => {
                setSelectedTaskId(taskPk);  // 다시 연 카드로 바로 이동
                void run(() => reopenFrameworkTask(session.id, taskPk));
              }}
            />
          </div>
          )}
          {(step === "register" || step === "done") && (
          <div className={selectedTask ? "hidden" : "flex flex-col"} data-id="fw-consult-register-host">
            <RegisterStep
              session={session}
              busy={busy}
              onApplied={() => void run(() => markFrameworkInterviewApplied(session.id))}
              onBack={() => void run(() => reopenFrameworkRelations(session.id))}
            />
          </div>
          )}
        </section>
      </div>
      {previewTaskId !== null && (
        <RegisterStep.TaskPreviewModal sessionId={session.id} taskPk={previewTaskId} onClose={() => setPreviewTaskId(null)} />
      )}
      {confirmAbandon && (
        <ConfirmDialog
          title={t("fwConsult.abandon")}
          message={t("fwConsult.abandonConfirm")}
          confirmLabel={t("fwConsult.abandon")}
          cancelLabel={t("fwConsult.cancel")}
          danger
          onClose={() => setConfirmAbandon(false)}
          onConfirm={() => {
            setConfirmAbandon(false);
            abandonFrameworkInterview(session.id).then(() => router.push("/settings?tab=framework")).catch((err) => setError(getApiErrorDetail(err)));
          }}
        />
      )}
    </div>
  );
}
