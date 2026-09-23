"use client";

// 캠페인 L6 카드 보드 — 상태 칩·진행률·ETA·일시정지/재개·재시도·건너뛰기, 어느 상태의 행이든 클릭=그 카드 패널 열기. 페이지 좌측 전용.
// 기존 L6에서 온 카드(mode=keep)는 러너가 건드리지 않는다 — [정정]으로 설문을 다시 받아야 다시 그린다.

import { Eye, Loader2, Pause, PencilLine, Play, RotateCcw, SkipForward } from "lucide-react";

import type { FwInterviewSession, FwInterviewTask, FwTaskStatus } from "@/lib/api";
import { deriveProgress } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const STATUS_TONE: Record<FwTaskStatus, { pill: string; dot: string; key: MessageKey }> = {
  pending: { pill: "bg-surface-alt text-ink-secondary", dot: "bg-ink-tertiary", key: "fwConsult.statusPending" },
  generating: { pill: "bg-accent-tint text-accent", dot: "bg-accent", key: "fwConsult.statusGenerating" },
  ready: { pill: "bg-accent-tint text-accent", dot: "bg-accent", key: "fwConsult.statusReady" },
  submitted: { pill: "bg-surface-alt text-ink-secondary", dot: "bg-ink-secondary", key: "fwConsult.statusSubmitted" },
  drawing: { pill: "bg-accent-tint text-accent", dot: "bg-accent", key: "fwConsult.statusDrawing" },
  drawn: { pill: "bg-surface-alt text-ink", dot: "bg-accent", key: "fwConsult.statusDrawn" },
  failed: { pill: "bg-surface-alt text-error", dot: "bg-error", key: "fwConsult.statusFailed" },
};

interface TaskBoardProps {
  session: FwInterviewSession;
  currentTaskId: number | null;
  drawDurationsMs: number[];
  onPause: () => void;
  onResume: () => void;
  onRetry: (taskPk: number) => void;
  onSkip?: (taskPk: number) => void;  // 실패 카드를 플레이스홀더 행으로 건너뛰기
  onRevise?: (task: FwInterviewTask) => void;  // 유지 중인 기존 L6를 정정으로 돌리기
  onPreview?: (taskPk: number) => void;
  onSelect: (taskPk: number) => void;  // 어느 상태의 행이든 눌러 그 카드 패널을 연다(ready면 먼저 답하기)
  stalled?: boolean;  // 할 일이 남았는데 러너가 멎은 것으로 보인다 — 재시작 버튼 노출
  onNudge?: () => void;
}

export function TaskBoard({ session, currentTaskId, drawDurationsMs, onPause, onResume, onRetry, onSkip, onRevise, onPreview, onSelect, stalled, onNudge }: TaskBoardProps) {
  const { t } = useI18n();
  const progress = deriveProgress(session, drawDurationsMs);
  const locked = session.status !== "planning";
  const tasks = [...session.tasks].sort((a, b) => a.seq - b.seq);
  const workingTask = tasks.find((x) => x.status === "generating" || x.status === "drawing");
  return (
    <div className="flex flex-col gap-3 p-3">
      {locked && (
        <div className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface p-2.5" data-id="fw-consult-progress">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink">
            {progress.working && <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />}
            <span>{t("fwConsult.progress", { done: progress.done, total: progress.total })}</span>
            {workingTask && (
              <span className="text-ink-tertiary" data-id="fw-consult-working-on">· {t("fwConsult.workingOn", { name: workingTask.name })}</span>
            )}
            {progress.etaMs !== null && progress.done < progress.total && (
              <span className="text-ink-tertiary">· {t("fwConsult.eta", { minutes: Math.max(1, Math.round(progress.etaMs / 60000)) })}</span>
            )}
            <button
              type="button"
              data-id="fw-consult-pause-toggle"
              className="ml-auto inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
              onClick={session.paused ? onResume : onPause}
              title={session.paused ? t("fwConsult.resumeRun") : t("fwConsult.pause")}
            >
              {session.paused ? <Play size={14} strokeWidth={1.5} /> : <Pause size={14} strokeWidth={1.5} />}
              {session.paused ? t("fwConsult.resumeRun") : t("fwConsult.pause")}
            </button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-xs bg-surface-alt">
            <div className="h-full bg-accent transition-[width] duration-350 ease-smooth" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          {session.paused && <span className="text-fine text-ink-tertiary">{t("fwConsult.paused")}</span>}
        </div>
      )}
      {stalled && onNudge && (
        <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface-alt px-2.5 py-2 text-fine text-ink-secondary" data-id="fw-consult-stalled">
          <span className="min-w-0 flex-1">{t("fwConsult.stalled")}</span>
          <button type="button" data-id="fw-consult-nudge" className="shrink-0 rounded-sm border border-hairline bg-surface px-2 py-0.5 text-fine text-ink hover:bg-surface-alt" onClick={onNudge}>
            {t("fwConsult.nudge")}
          </button>
        </div>
      )}
      <ol className="flex flex-col gap-1.5" data-id="fw-consult-task-list">
        {tasks.map((task) => {
          const tone = STATUS_TONE[task.status];
          const isCurrent = task.id === currentTaskId;
          // 모든 행이 카드 패널을 연다 — ready는 먼저 답하기, 그 외는 상태별 뷰(준비 중·제출 답·완성 행·실패)
          const activate = () => onSelect(task.id);
          const title = task.status === "ready" ? t("fwConsult.openCard")
            : task.status === "drawn" ? t("fwConsult.preview")
              : t("fwConsult.openCardHint");
          return (
            <li
              key={task.id}
              data-id={`fw-consult-task-${task.id}`}
              data-status={task.status}
              role="button"
              tabIndex={0}
              title={title}
              onClick={activate}
              // 행 안의 버튼(재시도·건너뛰기·정정·미리보기)에서 올라온 키는 무시 — 그 버튼의 Enter가 행 선택까지
              // 일으키거나 Space가 preventDefault로 삼켜지지 않게 한다(click은 버튼이 stopPropagation).
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 hover:bg-surface-alt ${isCurrent ? "border-accent bg-surface" : "border-hairline bg-surface"}`}
            >
              <span className="w-5 text-fine text-ink-tertiary tabular-nums">{task.seq}</span>
              <span className="min-w-0 flex-1 truncate text-caption text-ink">{task.name}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${tone.pill}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                {t(tone.key)}
              </span>
              {task.status === "failed" && (
                <button type="button" data-id={`fw-consult-task-retry-${task.id}`} className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.retry")} onClick={(e) => { e.stopPropagation(); onRetry(task.id); }}>
                  <RotateCcw size={14} strokeWidth={1.5} />
                </button>
              )}
              {task.status === "failed" && onSkip && (
                <button type="button" data-id={`fw-consult-task-skip-${task.id}`} className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={`${t("fwConsult.skip")} · ${t("fwConsult.skipHint")}`} onClick={(e) => { e.stopPropagation(); onSkip(task.id); }}>
                  <SkipForward size={14} strokeWidth={1.5} />
                </button>
              )}
              {task.mode !== "new" && (
                <span className="shrink-0 rounded-full border border-hairline px-1.5 py-[2px] text-[11px] leading-none text-ink-tertiary" data-id={`fw-consult-task-mode-${task.id}`}>
                  {t(task.mode === "keep" ? "fwConsult.existing" : "fwConsult.revise")}
                </span>
              )}
              {task.mode === "keep" && onRevise && (
                <button type="button" data-id={`fw-consult-revise-${task.id}`} className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.reviseHint")} onClick={(e) => { e.stopPropagation(); onRevise(task); }}>
                  <PencilLine size={14} strokeWidth={1.5} />
                  {t("fwConsult.revise")}
                </button>
              )}
              {task.status === "drawn" && task.placeholder && (
                <span className="shrink-0 rounded-full border border-hairline px-1.5 py-[2px] text-[11px] leading-none text-ink-tertiary" data-id={`fw-consult-task-placeholder-${task.id}`}>
                  {t("fwConsult.placeholder")}
                </span>
              )}
              {task.status === "drawn" && onPreview && (
                <button type="button" data-id={`fw-consult-task-preview-${task.id}`} className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.preview")} onClick={(e) => { e.stopPropagation(); onPreview(task.id); }}>
                  <Eye size={14} strokeWidth={1.5} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {tasks.some((x) => x.error) && (
        <ul className="flex flex-col gap-1 text-fine text-error" data-id="fw-consult-task-errors">
          {tasks.filter((x) => x.error).map((x) => <li key={x.id}>{x.seq}. {x.error}</li>)}
        </ul>
      )}
    </div>
  );
}
