"use client";

// AI 컨설턴트 L5 캠페인 — 풀스크린(TopNav 아래): 좌 L6 카드 보드+진행률 / 우 현재 단계 (spec 2026-09-21 §2·§9).
// 폴링 2초: 백그라운드 작업(설문 생성·드로잉)이 있는 동안만. 세션은 DB에 있어 이탈 후 복귀 가능.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Headset } from "lucide-react";

import {
  abandonFrameworkInterview, confirmFrameworkRelations, generateFrameworkPlan, generateFrameworkRelations,
  getApiErrorDetail, getFrameworkInterview, markFrameworkInterviewApplied, pauseFrameworkInterview,
  deleteFrameworkAttachment, resumeFrameworkInterview, retryFrameworkTask, saveFrameworkPlan, skipFrameworkTask,
  submitFrameworkAnswers, uploadFrameworkInterviewAttachment,
  type FwAnswerValue, type FwInterviewSession, type FwPlanCard,
} from "@/lib/api";
import { deriveStep, findCurrentTask, hasBackgroundWork } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AnswerStep } from "@/components/framework-interview/questionnaire-form";
import { InterviewJsonPromptButton } from "@/components/framework-interview/interview-json-prompt-button";
import { PlanEditor } from "@/components/framework-interview/plan-editor";
import { RegisterStep } from "@/components/framework-interview/register-step";
import { RelationsStep } from "@/components/framework-interview/relations-step";
import { TaskBoard } from "@/components/framework-interview/task-board";

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
  // 드로잉 소요 실측(ms) — ETA 추정. submitted를 처음 본 시각 → drawn을 처음 본 시각
  const submittedAtRef = useRef<Map<number, number>>(new Map());
  const [drawDurations, setDrawDurations] = useState<number[]>([]);
  // 러너 정지 감지 — 상태가 안 변한 채 흐른 폴링 틱 수 (I3)
  const statusSigRef = useRef("");
  const [stalledTicks, setStalledTicks] = useState(0);

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

  const step = deriveStep(session);
  const current = findCurrentTask(session);
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
        <InterviewJsonPromptButton target={{ code: session.category_code, name: session.category_name, path: [] }} />
        <button type="button" data-id="fw-consult-abandon" className="rounded-sm px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt" onClick={() => setConfirmAbandon(true)}>
          {t("fwConsult.abandon")}
        </button>
      </header>
      {error && <div className="border-b border-hairline bg-surface-pearl px-3 py-1.5 text-caption text-error" data-id="fw-consult-error">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col overflow-y-auto bg-surface-pearl" style={{ width: boardWidth }} data-id="fw-consult-board">
          <TaskBoard
            session={session}
            currentTaskId={current?.id ?? null}
            drawDurationsMs={drawDurations}
            onPause={() => void run(() => pauseFrameworkInterview(session.id))}
            onResume={() => void run(() => resumeFrameworkInterview(session.id))}
            onRetry={(taskPk) => void run(() => retryFrameworkTask(session.id, taskPk))}
            onSkip={(taskPk) => void run(() => skipFrameworkTask(session.id, taskPk))}
            onPreview={setPreviewTaskId}
            stalled={stalledTicks >= STALLED_TICKS && !session.paused}
            onNudge={() => {
              setStalledTicks(0);
              void run(() => resumeFrameworkInterview(session.id));  // resume이 러너를 다시 깨운다
            }}
          />
        </aside>
        <div
          className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-hairline transition-colors duration-150 hover:bg-accent/40"
          role="separator" aria-orientation="vertical" aria-label={t("fwConsult.resizeBoard")} tabIndex={0}
          onPointerDown={handleDividerDown} data-id="fw-consult-divider"
        />
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-surface" data-id="fw-consult-step">
          {step === "plan" && (
            <PlanEditor
              // 첨부는 이제 brief와 분리된 목록(props로 그대로 표시)이라 plan 내용만 key로 삼는다 —
              // 첨부 업로드/삭제가 편집 중인 brief·카드를 지우지 않는다.
              key={JSON.stringify(session.plan ?? [])}
              session={session}
              busy={busy}
              onAttach={(file) => void run(() => uploadFrameworkInterviewAttachment(session.id, file))}
              onRemoveAttachment={(index) => void run(() => deleteFrameworkAttachment(session.id, index))}
              onGenerate={(cards: FwPlanCard[], brief: string) => void run(async () => {
                await saveFrameworkPlan(session.id, cards, false, brief);  // 화면의 brief로 제안받는다
                return generateFrameworkPlan(session.id);
              })}
              onSave={(cards: FwPlanCard[], brief: string) => void run(() => saveFrameworkPlan(session.id, cards, false, brief))}
              onLock={(cards: FwPlanCard[], brief: string) => void run(() => saveFrameworkPlan(session.id, cards, true, brief))}
            />
          )}
          {(step === "answer" || step === "waiting") && (
            <AnswerStep
              key={current?.id ?? "none"}
              session={session}
              task={current}
              busy={busy}
              onSubmit={(taskPk: number, answers: Record<string, FwAnswerValue>) =>
                void run(() => submitFrameworkAnswers(session.id, taskPk, answers))}
            />
          )}
          {step === "relations" && (
            <RelationsStep
              key={JSON.stringify(session.relations ?? null)}
              session={session}
              busy={busy}
              onPropose={() => void run(() => generateFrameworkRelations(session.id))}
              onConfirm={(relations) => void run(() => confirmFrameworkRelations(session.id, relations))}
            />
          )}
          {(step === "register" || step === "done") && (
            <RegisterStep
              session={session}
              busy={busy}
              onApplied={() => void run(() => markFrameworkInterviewApplied(session.id))}
            />
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
