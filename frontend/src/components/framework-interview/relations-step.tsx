"use client";

// 캠페인 ③ L6 연결 — 진입하면 AI가 흐름을 먼저 제안하고(오버레이 링), 편집 캔버스가 화면을 다 쓴다.
// 피드백 채팅은 에디터 AI 채팅과 같은 ScopeWindow(끌기·크기 조절·최소화→우하단 칩)로 캔버스 위에 뜬다(사용자 요청 2026-09-24).
// L6 카드 목록은 좌측 보드가 이미 보여주므로 여기서는 반복하지 않는다. 캔버스 편집은 300ms 디바운스로 PUT /canvas.

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";

import type { FwCanvas, FwInterviewSession, FwPlanCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { WindowGeom } from "@/lib/window-store";
import { AiButton } from "@/components/ai-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FeedbackChat } from "@/components/framework-interview/feedback-chat";
import { RelationsCanvas } from "@/components/framework-interview/relations-canvas";
import { ScopeWindow } from "@/components/scope-window";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SAVE_DEBOUNCE_MS = 300;
// 제안 오버레이 최소 노출 — 캔버스가 도착하면 부모가 key로 이 컴포넌트를 리마운트해 링이 바로 걷히므로,
// 이 하한이 실제로 묶는 건 캔버스가 끝내 오지 않는 경우(실패·무변경 응답)의 해제 판정 시점이다.
const OVERLAY_MIN_MS = 1500;
const EMPTY_CANVAS: FwCanvas = { nodes: [], edges: [] };
const CHAT_GEOM_KEY = "bpm.fwRelationsChatGeom";  // 창 기하 영속(세션 무관) — 에디터의 bpm.windows.<mapId>와 같은 형태
const CHAT_WINDOW_Z = 6;  // 노드 z-2 · 제안 오버레이 z-3 · 엣지 라벨 입력 z-5 위, 컨텍스트 메뉴(1200) 아래

// 처음 열 때 우측에 도킹된 좁은 창 — 에디터 aiDefaultGeom과 같은 비율
function buildDefaultChatGeom(bounds: { w: number; h: number }): WindowGeom {
  const w = 340;
  const h = Math.min(440, Math.max(280, Math.round(bounds.h * 0.7)));
  return { x: Math.max(0, bounds.w - w - 16), y: 16, w, h, minimized: false, maximized: false };
}

function readChatGeom(): WindowGeom | null {
  try {
    const raw = window.localStorage.getItem(CHAT_GEOM_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const g = parsed as Partial<WindowGeom>;
    if (typeof g.x !== "number" || typeof g.y !== "number" || typeof g.w !== "number" || typeof g.h !== "number") return null;
    return { x: g.x, y: g.y, w: g.w, h: g.h, minimized: Boolean(g.minimized), maximized: false };
  } catch {
    return null;  // 손상된 저장값은 기본 기하로
  }
}

interface RelationsStepProps {
  session: FwInterviewSession;
  busy: boolean;
  onPropose: (comment: string) => void;
  onSaveCanvas: (canvas: FwCanvas) => void;
  onConfirm: (canvas: FwCanvas) => void;
  onFeedback: (message: string) => void;
}

export function RelationsStep({
  session, busy, onPropose, onSaveCanvas, onConfirm, onFeedback,
}: RelationsStepProps) {
  const { t } = useI18n();
  const tasks = [...session.tasks].sort((a, b) => a.seq - b.seq);
  const taskNames = new Map(tasks.map((task) => [task.task_id, task.name]));
  const taskCards = new Map<string, FwPlanCard>((session.plan ?? []).flatMap((card) => (card.task_id ? [[card.task_id, card]] : [])));
  // 부모가 session.canvas 내용으로 key를 리마운트하므로(page.tsx) 마운트 시 1회 초기화만 한다 —
  // 디바운스 저장은 session을 갱신하지 않아 편집 중 캔버스가 스스로 되감기지 않는다.
  const [canvas, setCanvas] = useState<FwCanvas>(() => session.canvas ?? EMPTY_CANVAS);
  const [confirmRepropose, setConfirmRepropose] = useState(false);
  const [draft, setDraft] = useState("");
  const [overlay, setOverlay] = useState(false);
  // 채팅 창 기하 — 저장값이 없으면 캔버스 크기를 잰 뒤(bounds) 기본 기하로 시작한다
  const [chatGeom, setChatGeom] = useState<WindowGeom | null>(() => (typeof window === "undefined" ? null : readChatGeom()));
  const [bounds, setBounds] = useState({ w: 960, h: 640 });
  const canvasHostRef = useRef<HTMLDivElement>(null);
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

  // 캔버스 영역 실측 — 창 드래그/리사이즈 한계(bounds). ResizeObserver 콜백에서만 setState(lint 규칙)
  useEffect(() => {
    const el = canvasHostRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBounds({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
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

  // 다시 제안 = 리셋(손편집 포함 캔버스를 버리고 카드 기준으로 처음부터). 캔버스가 이미 있으면 확인을 한 번 묻는다.
  // 부분 수정은 채팅 한 게이트로(사용자 결정 2026-09-24).
  function handleProposeClick() {
    if (session.canvas !== null) setConfirmRepropose(true);
    else propose();
  }
  function propose() {
    setConfirmRepropose(false);
    onPropose("");
    beginOverlay();
  }

  function handleFeedback(message: string) {
    onFeedback(message);
    setDraft("");
    beginOverlay();
  }

  function handleMention(_taskId: string, name: string) {
    setDraft((prev) => (prev.length > 0 && !prev.endsWith(" ") ? `${prev} ` : prev) + `@${name} `);
    // 언급을 끼워 넣었는데 창이 접혀 있으면 펴서 보여준다
    updateChatGeom({ ...(chatGeom ?? buildDefaultChatGeom(bounds)), minimized: false });
  }

  function updateChatGeom(next: WindowGeom) {
    setChatGeom(next);
    try {
      window.localStorage.setItem(CHAT_GEOM_KEY, JSON.stringify(next));
    } catch {
      // 영속은 best-effort
    }
  }

  const geom = chatGeom ?? buildDefaultChatGeom(bounds);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4" data-id="fw-consult-relations">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-strong text-ink">{t("fwConsult.stepRelations")}</span>
        <span className="text-fine text-ink-tertiary">{t("fwConsult.relationsHint")}</span>
        <AiButton data-id="fw-consult-propose-relations" className="ml-auto" disabled={busy} onClick={handleProposeClick}>
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

      {/* 캔버스가 전폭 — 채팅 창은 이 영역 안에서만 움직인다(bounds) */}
      <div ref={canvasHostRef} className="relative flex min-h-0 flex-1" data-id="fw-consult-relations-canvas-host">
        <RelationsCanvas
          canvas={canvas}
          taskNames={taskNames}
          taskCards={taskCards}
          busy={busy}
          onChange={handleCanvasChange}
          onMention={handleMention}
        />
        {geom.minimized ? (
          <button
            type="button"
            data-id="fw-consult-chat-restore"
            title={t("fwConsult.feedbackTitle")}
            aria-label={t("fwConsult.feedbackTitle")}
            className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-md border border-accent-tint-border bg-gradient-to-br from-surface to-accent-tint text-accent opacity-80 shadow-md transition hover:opacity-100 hover:shadow-lg"
            style={{ zIndex: CHAT_WINDOW_Z }}
            onClick={() => updateChatGeom({ ...geom, minimized: false })}
          >
            <MessageSquare size={20} strokeWidth={1.5} />
          </button>
        ) : (
          <ScopeWindow
            title={t("fwConsult.feedbackTitle")}
            geom={geom}
            active
            zIndex={CHAT_WINDOW_Z}
            canClose={false}
            canMaximize={false}
            bounds={bounds}
            onFocus={() => {}}
            onGeomChange={updateChatGeom}
            onClose={() => {}}
            onMinimize={() => updateChatGeom({ ...geom, minimized: true })}
          >
            <FeedbackChat
              fill
              log={session.feedback_log}
              scope="relations"
              busy={busy}
              draft={draft}
              onDraftChange={setDraft}
              onSend={handleFeedback}
              placeholder={t("fwConsult.feedbackRelationsPlaceholder")}
            />
          </ScopeWindow>
        )}
      </div>

      {confirmRepropose && (
        <ConfirmDialog
          dialogId="fw-consult-repropose-confirm"
          title={t("fwConsult.reproposeTitle")}
          message={t("fwConsult.reproposeMessage")}
          confirmLabel={t("fwConsult.proposeRelations")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={propose}
          onClose={() => setConfirmRepropose(false)}
        />
      )}
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
