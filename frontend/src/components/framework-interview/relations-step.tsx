"use client";

// 캠페인 ③ L6 연결 — 진입하면 AI가 흐름을 먼저 제안하고(오버레이 링), 좌 편집 캔버스 / 우 L6 카드 목록 + 피드백 채팅.
// 캔버스 편집은 300ms 디바운스로 PUT /canvas, 확정하면 등록 단계로 간다.

import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, PenLine } from "lucide-react";

import type { FwCanvas, FwInterviewSession } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useResizableWidth } from "@/lib/use-resizable-width";
import { AiButton } from "@/components/ai-button";
import { FeedbackChat } from "@/components/framework-interview/feedback-chat";
import { RelationsCanvas } from "@/components/framework-interview/relations-canvas";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const ICON_BTN = "rounded-sm p-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40";
const SAVE_DEBOUNCE_MS = 300;
// 제안 오버레이 최소 노출 — 캔버스가 도착하면 부모가 key로 이 컴포넌트를 리마운트해 링이 바로 걷히므로,
// 이 하한이 실제로 묶는 건 캔버스가 끝내 오지 않는 경우(실패·무변경 응답)의 해제 판정 시점이다.
const OVERLAY_MIN_MS = 1500;
const EMPTY_CANVAS: FwCanvas = { nodes: [], edges: [] };

interface RelationsStepProps {
  session: FwInterviewSession;
  busy: boolean;
  onPropose: (comment: string) => void;
  onSaveCanvas: (canvas: FwCanvas) => void;
  onConfirm: (canvas: FwCanvas) => void;
  onFeedback: (message: string) => void;
  onPreviewTask: (taskPk: number) => void;
  onReopenTask: (taskPk: number) => void;  // 답 고쳐 다시 그리기 — 카드가 ready로 돌아가고 설문 단계로 복귀
}

export function RelationsStep({
  session, busy, onPropose, onSaveCanvas, onConfirm, onFeedback, onPreviewTask, onReopenTask,
}: RelationsStepProps) {
  const { t } = useI18n();
  const tasks = [...session.tasks].sort((a, b) => a.seq - b.seq);
  const taskNames = new Map(tasks.map((task) => [task.task_id, task.name]));
  // 부모가 session.canvas 내용으로 key를 리마운트하므로(page.tsx) 마운트 시 1회 초기화만 한다 —
  // 디바운스 저장은 session을 갱신하지 않아 편집 중 캔버스가 스스로 되감기지 않는다.
  const [canvas, setCanvas] = useState<FwCanvas>(() => session.canvas ?? EMPTY_CANVAS);
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState("");
  const [overlay, setOverlay] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const overlayTimerRef = useRef<number | null>(null);
  const proposedRef = useRef(false);
  // 오버레이 해제 판정용 미러 — 판정은 타이머 콜백에서만 한다(effect 안 setState 금지)
  const canvasArrivedRef = useRef(session.canvas !== null);
  const busyRef = useRef(busy);

  useEffect(() => {
    canvasArrivedRef.current = session.canvas !== null;
    busyRef.current = busy;
  }, [session.canvas, busy]);

  // 진입 즉시 자동 제안 — relations·canvas가 모두 비었을 때만 1회. StrictMode 이중 마운트는 ref로 막는다.
  // effect 본문에서 setState를 하지 않으려고 rAF 콜백으로 미룬다(react-hooks/set-state-in-effect).
  useEffect(() => {
    if (proposedRef.current || session.relations !== null || session.canvas !== null) return;
    proposedRef.current = true;
    window.requestAnimationFrame(() => {
      onPropose("");
      beginOverlay();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 1회 자동 제안(proposedRef 가드) — onPropose는 매 렌더 새 함수라 deps에 두면 의미가 없다
  }, [session.relations, session.canvas]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    if (overlayTimerRef.current !== null) window.clearTimeout(overlayTimerRef.current);
  }, []);

  // 오버레이는 최소 1.5초 유지하고, 그 뒤 session.canvas가 도착하면 걷는다(미도착이면 300ms마다 재확인).
  // 호출이 끝났는데도(busy 해제) 캔버스가 없으면 실패한 것이니 걷는다 — 아니면 에러를 덮은 채 영구히 남는다.
  function beginOverlay() {
    setOverlay(true);
    if (overlayTimerRef.current !== null) window.clearTimeout(overlayTimerRef.current);
    const tick = () => {
      if (canvasArrivedRef.current || !busyRef.current) {
        overlayTimerRef.current = null;
        setOverlay(false);
      } else {
        overlayTimerRef.current = window.setTimeout(tick, 300);
      }
    };
    overlayTimerRef.current = window.setTimeout(tick, OVERLAY_MIN_MS);
  }

  function handleCanvasChange(next: FwCanvas) {
    setCanvas(next);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      onSaveCanvas(next);
    }, SAVE_DEBOUNCE_MS);
  }

  function handlePropose() {
    onPropose(comment);
    beginOverlay();
  }

  function handleFeedback(message: string) {
    onFeedback(message);
    setDraft("");
    beginOverlay();
  }

  function handleMention(_taskId: string, name: string) {
    setDraft((prev) => (prev.length > 0 && !prev.endsWith(" ") ? `${prev} ` : prev) + `@${name} `);
  }

  const panel = useResizableWidth({
    storageKey: "bpm.fwRelationsPanelWidth", min: 320, max: 560, fallback: 400, edge: "right",
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4" data-id="fw-consult-relations">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-strong text-ink">{t("fwConsult.stepRelations")}</span>
        <span className="text-fine text-ink-tertiary">{t("fwConsult.relationsHint")}</span>
        <input
          className="ml-auto w-56 rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink outline-none focus:border-accent"
          data-id="fw-consult-propose-comment"
          value={comment}
          placeholder={t("fwConsult.proposeComment")}
          onChange={(event) => setComment(event.target.value)}
        />
        <AiButton data-id="fw-consult-propose-relations" disabled={busy} onClick={handlePropose}>
          {t("fwConsult.proposeRelations")}
        </AiButton>
        <button
          type="button"
          className={PRIMARY}
          data-id="fw-consult-confirm-relations"
          disabled={busy || canvas.nodes.length === 0}
          onClick={() => onConfirm(canvas)}
        >
          {t("fwConsult.confirmRelations")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <RelationsCanvas
          canvas={canvas}
          taskNames={taskNames}
          busy={busy}
          onChange={handleCanvasChange}
          onMention={handleMention}
        />
        <div
          className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-hairline transition-colors duration-150 hover:bg-accent/40"
          role="separator" aria-orientation="vertical" aria-label={t("fwConsult.resizeRelationsPanel")} tabIndex={0}
          onPointerDown={panel.onPointerDown} data-id="fw-consult-relations-divider"
        />
        <aside
          className="flex shrink-0 flex-col gap-3 overflow-y-auto rounded-md border border-hairline bg-surface-pearl p-3"
          style={{ width: panel.width }}
          data-id="fw-consult-relations-panel"
        >
          <section className="flex flex-col gap-1.5">
            <span className="text-caption text-ink">{t("fwConsult.l6Cards")}</span>
            <ol className="flex flex-col gap-1" data-id="fw-consult-relations-cards">
              {tasks.map((task) => (
                <li key={task.id} data-id={`fw-consult-relations-card-${task.id}`} className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink">
                  <span className="w-5 shrink-0 text-fine text-ink-tertiary tabular-nums">{task.seq}</span>
                  <span className="min-w-0 flex-1 truncate">{task.name}</span>
                  {task.placeholder && (
                    <span className="shrink-0 rounded-full border border-hairline px-1.5 py-[2px] text-[11px] leading-none text-ink-tertiary">{t("fwConsult.placeholder")}</span>
                  )}
                  <button type="button" className={ICON_BTN} data-id={`fw-consult-relations-preview-${task.id}`} title={t("fwConsult.preview")} onClick={() => onPreviewTask(task.id)}>
                    <Eye size={14} strokeWidth={1.5} />
                  </button>
                  {/* 유지 태스크의 reopen은 서버가 정정으로 바꾼다(routers reopen → revise) — 라벨도 그 결과를 말한다 */}
                  <button type="button" className={ICON_BTN} data-id={`fw-consult-relations-reopen-${task.id}`} aria-label={task.mode === "keep" ? t("fwConsult.revise") : t("fwConsult.editAnswers")} title={task.mode === "keep" ? `${t("fwConsult.revise")} · ${t("fwConsult.reviseHint")}` : `${t("fwConsult.editAnswers")} · ${t("fwConsult.editAnswersHint")}`} disabled={busy} onClick={() => onReopenTask(task.id)}>
                    <PenLine size={14} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <FeedbackChat
            log={session.feedback_log}
            scope="relations"
            busy={busy}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleFeedback}
            placeholder={t("fwConsult.feedbackRelationsPlaceholder")}
          />
        </aside>
      </div>

      {overlay && (
        <div
          className="absolute inset-0 z-[3] flex items-center justify-center gap-2 bg-surface/70 text-caption text-ink-secondary"
          data-id="fw-consult-relations-proposing"
        >
          <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-accent" />
          {t("fwConsult.proposing")}
        </div>
      )}
    </div>
  );
}
