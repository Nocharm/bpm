"use client";

// 캠페인 L6 카드 보드 — 상태 칩·진행률·ETA·일시정지/재개·재시도·완료 카드 미리보기. 페이지 좌측 전용.

import { Loader2, Pause, Play, RotateCcw, Eye } from "lucide-react";

import type { FwInterviewSession, FwTaskStatus } from "@/lib/api";
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
  onPreview?: (taskPk: number) => void;
  stalled?: boolean;  // 할 일이 남았는데 러너가 멎은 것으로 보인다 — 재시작 버튼 노출
  onNudge?: () => void;
}

export function TaskBoard({ session, currentTaskId, drawDurationsMs, onPause, onResume, onRetry, onPreview, stalled, onNudge }: TaskBoardProps) {
  const { t } = useI18n();
  const progress = deriveProgress(session, drawDurationsMs);
  const locked = session.status !== "planning";
  const tasks = [...session.tasks].sort((a, b) => a.seq - b.seq);
  const workingTask = tasks.find((x) => x.status === "generating" || x.status === "drawing");
  return (
    <div className="flex flex-col gap-3 p-3">
      {locked && (
        <div className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface p-2.5" data-id="fw-consult-progress">
          <div className="flex items-center gap-2 text-caption text-ink">
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
          return (
            <li
              key={task.id}
              data-id={`fw-consult-task-${task.id}`}
              data-status={task.status}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${isCurrent ? "border-accent bg-surface" : "border-hairline bg-surface"}`}
            >
              <span className="w-5 text-fine text-ink-tertiary tabular-nums">{task.seq}</span>
              <span className="min-w-0 flex-1 truncate text-caption text-ink">{task.name}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${tone.pill}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                {t(tone.key)}
              </span>
              {task.status === "failed" && (
                <button type="button" data-id={`fw-consult-task-retry-${task.id}`} className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.retry")} onClick={() => onRetry(task.id)}>
                  <RotateCcw size={14} strokeWidth={1.5} />
                </button>
              )}
              {task.status === "drawn" && onPreview && (
                <button type="button" data-id={`fw-consult-task-preview-${task.id}`} className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.preview")} onClick={() => onPreview(task.id)}>
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
