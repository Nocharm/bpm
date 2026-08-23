"use client";

// AI 컨설턴트 인터뷰 모드 — 풀스크린(TopNav 아래): 좌 프리뷰(메인) + 우 대화(폭 조절) (design 2026-07-23 §6)

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Headset, RotateCcw } from "lucide-react";

import {
  ApiError,
  abandonInterview,
  applyInterviewParams,
  createOrResumeInterview,
  deleteInterviewAttachment,
  drawProposals,
  fastForwardInterview,
  getApiErrorDetail,
  getInterview,
  getMe,
  getMap,
  postInterviewTurn,
  uploadInterviewAttachment,
  type InterviewState,
  type WorkingGraph,
} from "@/lib/api";
import {
  FAST_TRACK_CONFIRM_LABELS,
  FAST_TRACK_NORMAL_LABELS,
  FAST_TRACK_SCOPE_MESSAGE,
  FAST_TRACK_START_LABELS,
  buildDrawSummary,
  choiceOptionsOf,
  deriveOutline,
  deriveParamsEditorRows,
  stageIndex,
  stagesForMode,
} from "@/lib/interview";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ATTACH_EVENT, InterviewPanel } from "@/components/interview/interview-panel";
import { DrawConfirmDialog } from "@/components/interview/draw-confirm-dialog";
import { InterviewPreview } from "@/components/interview/interview-preview";
import { ParamsTableDialog } from "@/components/interview/params-table-dialog";

// 우측 채팅 폭 — 드래그 조절, localStorage 유지 (min/max는 요구사항 2026-07-23)
const CHAT_WIDTH_KEY = "bpm.consultChatWidth";
const CHAT_MIN = 320;
const CHAT_MAX = 640;

function readChatWidth(): number {
  if (typeof window === "undefined") return 420;
  const stored = Number(window.localStorage.getItem(CHAT_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= CHAT_MIN && stored <= CHAT_MAX ? stored : 420;
}

export default function ConsultPage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);
  const router = useRouter();
  const { lang } = useI18n();

  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [mapName, setMapName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 낙관적 사용자 메시지 — 서버 응답 전에 먼저 표시(실패 시 유지 → Retry로 재전송)
  const [pending, setPending] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null); // 403/503 등 진입 불가
  const [chatWidth, setChatWidth] = useState(readChatWidth);
  const lastTurnRef = useRef<{ type: "answer" | "choice" | "skip"; content?: string; choice_id?: string } | null>(null);
  // 그리기 이벤트(동기) — 진행 중엔 캔버스 오버레이 + 채팅 잠금 (speed redesign §4)
  const [drawBusy, setDrawBusy] = useState<false | "multi" | "single">(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const lastDrawRef = useRef<"multi" | "single">("single");
  // draw 취소 토큰 — 증가하면 진행 중 draw의 응답을 무시(행 걸림 탈출구, hardening T13)
  const drawSeqRef = useRef(0);
  // 첨부 실패는 턴 에러와 분리 — 턴 Retry가 무관한 옛 턴을 재전송하지 않게 (hardening T15)
  const [attachError, setAttachError] = useState<string | null>(null);
  // 낙관적 수락 — 선택한 안을 즉시 캔버스에 반영·모달 닫기. 서버(그래프 반영+다음 질문 1콜)는
  // 백그라운드로 기다린다 — 실패하면 해제돼 모달이 복귀(choices 메시지가 여전히 마지막이라서).
  const [optimisticChoice, setOptimisticChoice] = useState<{ graph: WorkingGraph } | null>(null);
  // params 표 확정 모달 — 수집된 파라미터를 표로 확인 후 결정적 반영(AI 0콜)
  const [paramsOpen, setParamsOpen] = useState(false);
  const [paramsBusy, setParamsBusy] = useState(false);
  // 세션 초기화 — 현재 세션 abandon 후 새 세션으로 처음부터 (실사용 피드백 2026-07-28)
  const [restartOpen, setRestartOpen] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  // 패스트트랙 — 인사 보기 클릭(armed) → 첨부 성공 시 범위 제안 자동 턴(awaiting) →
  // "이대로 그리기" 인터셉트. 새로고침 시 소실 → 일반 인터뷰 폴백(무해, design 2026-07-29 §2)
  const [fastTrack, setFastTrack] = useState<"idle" | "armed" | "awaiting">("idle");
  // 에러 배너 Retry 노출 여부 — 유효한 턴 실패에만 true(패스트포워드/params 실패는 재생 불가)
  const [canRetry, setCanRetry] = useState(false);
  // Draw map 확인 — 서머리 승인 대기 중 백그라운드 선그리기(prefetch). 승인 시 완성돼 있으면
  // 즉시 모달, 아니면 기존 그리기 오버레이로 대기 (실사용 피드백 2026-07-30)
  const [drawConfirmOpen, setDrawConfirmOpen] = useState(false);
  const drawPrefetchRef = useRef<{
    seq: number;
    promise: Promise<{ state?: InterviewState; error?: string }>;
    isDone: () => boolean;
  } | null>(null);
  // 추출 중(Reading…) 표시 — 업로드 후 백그라운드 추출 9~22초가 invisible하던 것 가시화 (P0 #3).
  // 해제: 추출 노티스(파일명 매칭) 도착 또는 25초 타임아웃(추출 실패는 노티스가 없다 — 로그만)
  const [readingIds, setReadingIds] = useState<Set<number>>(new Set());

  function persistChatWidth(width: number) {
    window.localStorage.setItem(CHAT_WIDTH_KEY, String(width));
  }

  function handleDividerDown(e: React.PointerEvent) {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, window.innerWidth - ev.clientX));
      setChatWidth(next);
    };
    const finish = (ev: PointerEvent) => {
      const finalWidth = Math.min(CHAT_MAX, Math.max(CHAT_MIN, window.innerWidth - ev.clientX));
      persistChatWidth(finalWidth);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    // pointercancel(드래그 중단)에도 정리 — 리스너 누수 방지 (P2 #14)
    window.addEventListener("pointercancel", finish);
  }

  // 키보드 리사이즈(16px 단위)·더블클릭 기본폭 복원 — 디바이더 접근성 (P2 #14)
  function resizeChatBy(delta: number) {
    const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, chatWidth + delta));
    setChatWidth(next);
    persistChatWidth(next);
  }

  function resetChatWidth() {
    setChatWidth(420);
    persistChatWidth(420);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (!me.ai_enabled) {
          if (!cancelled) setFatal("AI is disabled on this server.");
          return;
        }
        const detail = await getMap(mapId);
        if (cancelled) return;
        setMapName(detail.name);
        const query = new URLSearchParams(window.location.search);
        const fromQuery = Number(query.get("version"));
        const draft = detail.versions.find((v) => v.id === fromQuery)
          ?? detail.versions.find((v) => v.status === "draft");
        if (!draft) {
          setFatal("No editable draft version.");
          return;
        }
        const state = await createOrResumeInterview(mapId, draft.id, lang);
        if (!cancelled) setInterview(state);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setFatal("You don't have permission to consult on this map.");
        } else if (err instanceof ApiError && err.status === 503) {
          setFatal("AI is disabled on this server.");
        } else {
          setFatal(getApiErrorDetail(err) || "Failed to start the interview.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // lang 변경 시 재부트스트랩은 무해 — 서버는 기존 active 세션을 그대로 반환한다
  }, [mapId, lang]);

  // 응답 유실 대조 — 서버는 턴을 커밋했는데 응답만 죽은 경우(nginx 504 이력) 재조회로 확인해
  // 반영된 상태를 채택한다. true면 Retry 불필요(이중 제출 방지, hardening T5).
  async function adoptDeliveredTurn(
    turn: { type: "answer" | "choice" | "skip"; content?: string; choice_id?: string },
    interviewId: number,
    priorSeq: number,
  ): Promise<boolean> {
    try {
      const latest = await getInterview(interviewId);
      const lastUser = [...latest.messages]
        .reverse()
        .find((m) => !m.superseded && m.role === "user");
      if (!lastUser || lastUser.seq <= priorSeq) return false;
      const matches =
        turn.type === "choice"
          ? lastUser.kind === "choice" &&
            (lastUser.payload as { choice_id?: string } | null)?.choice_id === turn.choice_id
          : turn.type === "skip"
            ? lastUser.kind === "skip"
            : lastUser.kind === "answer" && lastUser.content === (turn.content ?? "");
      if (!matches) return false;
      setInterview(latest);
      setPending(null);
      lastTurnRef.current = null;
      return true;
    } catch {
      return false; // 재조회도 실패 — 기존 Retry 경로 유지
    }
  }

  async function runTurn(turn: { type: "answer" | "choice" | "skip"; content?: string; choice_id?: string }) {
    if (!interview || busy) return;
    lastTurnRef.current = turn;
    setBusy(true);
    setError(null);
    const priorSeq = interview.messages.reduce((max, m) => Math.max(max, m.seq), 0);
    if (turn.type === "choice") {
      const picked = choices?.find((o) => o.id === turn.choice_id) ?? null;
      if (picked) setOptimisticChoice({ graph: picked.graph });
    }
    setPending(
      turn.type === "choice"
        ? (choices?.find((o) => o.id === turn.choice_id)?.title ?? "Selected an option")
        : turn.type === "skip"
          // 백엔드 _SKIP_USER_TEXT와 동일 문구 — 서버 반영 시 낙관적 표시가 그대로 치환되도록
          ? (interview.lang === "en"
              ? "Let's move on to the next stage."
              : "이 단계는 여기까지 하고 다음 단계로 넘어갈게요.")
          : (turn.content ?? ""),
    );
    try {
      const state = await postInterviewTurn(interview.id, turn);
      setInterview(state);
      setPending(null); // 서버 상태에 실제 메시지가 포함됨 — 낙관적 표시 제거
      lastTurnRef.current = null; // 성공한 턴은 Retry 재생 대상에서 제외 — 첨부 업로드 실패 시 중복 제출 방지
      // 그리기/표 신호 — params는 표 확정 모달(AI 0콜), 나머지는 draw 이벤트
      if (state.draw_due === "params") setParamsOpen(true);
      else if (state.draw_due) void startDraw(state.draw_due);
    } catch (err) {
      const adopted = await adoptDeliveredTurn(turn, interview.id, priorSeq);
      if (!adopted) {
        setError(getApiErrorDetail(err) || "AI request failed.");
        setCanRetry(true);
      }
    } finally {
      setBusy(false);
      setOptimisticChoice(null); // 성공=서버 상태가 동일 그래프 보유, 실패=모달 복귀
    }
  }

  async function handleRestart() {
    if (!interview || restartBusy) return;
    setRestartBusy(true);
    try {
      await abandonInterview(interview.id);
      const fresh = await createOrResumeInterview(mapId, interview.version_id, lang);
      setInterview(fresh);
      setPending(null);
      setError(null);
      setDrawError(null);
      setOptimisticChoice(null);
      setParamsOpen(false);
      // 이전 세션 흔적 전체 리셋 — fast-track 칩·읽는 중 배지·첨부 에러 잔존 방지 (final review)
      setFastTrack("idle");
      setReadingIds(new Set());
      setAttachError(null);
      setCanRetry(false);
      lastTurnRef.current = null;
    } catch (err) {
      setError(getApiErrorDetail(err) || "Failed to restart the interview.");
    } finally {
      setRestartBusy(false);
      setRestartOpen(false);
    }
  }

  async function handleFastForward() {
    if (!interview || busy || drawBusy) return;
    setBusy(true);
    setError(null);
    // 낙관 표시는 서버 기록(_FAST_FORWARD_USER_TEXT)과 동일 문구 — 도착 시 치환 티 안 나게
    setPending(interview.lang === "en" ? "Draw it as proposed." : "이대로 그려주세요.");
    try {
      const state = await fastForwardInterview(interview.id);
      setInterview(state);
      setPending(null);
      setFastTrack("idle");
      if (state.draw_due === "multi" || state.draw_due === "single") void startDraw(state.draw_due);
    } catch (err) {
      setError(getApiErrorDetail(err) || "Failed to fast-forward.");
      setCanRetry(false); // lastTurnRef 재생 대상이 아님 — Retry 무의미
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  function handleSend(content: string) {
    if (FAST_TRACK_START_LABELS.includes(content)) {
      // 턴을 소비하지 않고 첨부 플로우만 연다 — 첨부 성공이 범위 제안 턴을 발화
      setFastTrack("armed");
      window.dispatchEvent(new CustomEvent(ATTACH_EVENT));
      return;
    }
    if (fastTrack === "awaiting" && FAST_TRACK_CONFIRM_LABELS.includes(content)) {
      // review 도달 후엔 fast-forward가 무의미(백엔드 400) — 상태를 접고 일반 턴으로 (final review)
      if (interview?.current_stage !== "review") {
        void handleFastForward();
        return;
      }
      setFastTrack("idle");
    }
    if (fastTrack !== "idle" && FAST_TRACK_NORMAL_LABELS.includes(content)) {
      setFastTrack("idle");
      void runTurn({ type: "answer", content });
      return;
    }
    if (fastTrack === "armed") setFastTrack("idle"); // 첨부 대신 자유 발화 — 일반 흐름 복귀
    void runTurn({ type: "answer", content });
  }

  async function handleApplyParams(paramsTable?: Record<string, Record<string, string>>) {
    if (!interview || paramsBusy) return;
    setParamsBusy(true);
    try {
      setInterview(await applyInterviewParams(interview.id, paramsTable));
      setParamsOpen(false);
    } catch (err) {
      setError(getApiErrorDetail(err) || "Failed to apply parameters.");
      setCanRetry(false); // params 실패도 턴 재생 대상 아님
      setParamsOpen(false);
    } finally {
      setParamsBusy(false);
    }
  }

  async function startDraw(variants: "multi" | "single") {
    if (!interview || drawBusy) return;
    const seq = ++drawSeqRef.current;
    lastDrawRef.current = variants;
    setDrawBusy(variants);
    setDrawError(null);
    try {
      const state = await drawProposals(interview.id, variants);
      if (drawSeqRef.current !== seq) return; // 취소됨 — 늦게 온 응답 무시
      setInterview(state);
    } catch (err) {
      if (drawSeqRef.current !== seq) return;
      setDrawError(getApiErrorDetail(err) || "Failed to draw proposals.");
    } finally {
      if (drawSeqRef.current === seq) setDrawBusy(false);
    }
  }

  // 서버 작업은 계속된다(중단 API 없음) — 결과는 다음 상태 동기화 때 choices로 나타날 수 있다
  function cancelDraw() {
    drawSeqRef.current += 1;
    setDrawBusy(false);
    setDrawError(null);
  }

  // 수동 Draw map — 서머리 확인을 띄우면서 동시에 백그라운드 선그리기 시작
  function requestManualDraw() {
    if (!interview || busy || drawBusy || drawConfirmOpen) return;
    const seq = ++drawSeqRef.current;
    lastDrawRef.current = "single";
    let done = false;
    const promise = drawProposals(interview.id, "single")
      .then((state) => ({ state }))
      .catch((err: unknown) => ({ error: getApiErrorDetail(err) || "Failed to draw proposals." }))
      .finally(() => {
        done = true;
      });
    drawPrefetchRef.current = { seq, promise, isDone: () => done };
    setDrawConfirmOpen(true);
  }

  async function confirmManualDraw() {
    setDrawConfirmOpen(false);
    const prefetch = drawPrefetchRef.current;
    drawPrefetchRef.current = null;
    if (!prefetch || drawSeqRef.current !== prefetch.seq) return;
    if (!prefetch.isDone()) {
      setDrawBusy("single"); // 아직 그리는 중 — 기존 오버레이로 시간 벌기
      setDrawError(null);
    }
    const result = await prefetch.promise;
    if (drawSeqRef.current !== prefetch.seq) return; // 그 사이 취소됨
    if (result.state) setInterview(result.state);
    else if (result.error) setDrawError(result.error);
    setDrawBusy(false);
  }

  function cancelManualDraw() {
    setDrawConfirmOpen(false);
    drawSeqRef.current += 1; // 선그리기 응답 무시 — draw Cancel 버튼과 동일 시맨틱
    drawPrefetchRef.current = null;
  }

  // BE _EXTRACT_NOTICE 문구와 동기 — 추출 완료 노티스 판별(업로드 '읽었습니다' 노티스와 구분)
  const EXTRACT_NOTICE_MARKERS = ["정보를 추출해", "Extracted details"];

  function clearFinishedReadings(latest: InterviewState) {
    setReadingIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const att of latest.attachments) {
        if (!next.has(att.id)) continue;
        const done = latest.messages.some(
          (m) =>
            !m.superseded && m.kind === "notice" &&
            m.content.includes(att.filename) &&
            EXTRACT_NOTICE_MARKERS.some((marker) => m.content.includes(marker)),
        );
        if (done) next.delete(att.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }

  // 첨부 추출(백그라운드 AI 1콜) 결과 픽업 — 오래된 상태로 덮지 않게 seq 가드
  function scheduleExtractionRefresh(interviewId: number) {
    for (const delay of [9000, 22000]) {
      window.setTimeout(() => {
        void getInterview(interviewId)
          .then((latest) => {
            setInterview((prev) => {
              if (!prev || prev.id !== latest.id) return prev;
              const seqOf = (s: InterviewState) =>
                s.messages.reduce((max, m) => Math.max(max, m.seq), 0);
              return seqOf(latest) >= seqOf(prev) ? latest : prev;
            });
            clearFinishedReadings(latest);
          })
          .catch(() => undefined); // 실패해도 다음 턴에서 어차피 동기화
      }, delay);
    }
  }

  // 성공 여부 반환 — 패널의 복수 업로드 진행/실패 표시용
  async function handleAttach(file: File): Promise<boolean> {
    if (!interview) return false;
    setAttachError(null);
    try {
      const uploaded = await uploadInterviewAttachment(interview.id, file);
      setInterview((prev) =>
        prev ? { ...prev, attachments: [...prev.attachments, uploaded] } : prev,
      );
      if (uploaded.status === "parsed") {
        setReadingIds((prev) => new Set(prev).add(uploaded.id));
        window.setTimeout(() => {
          setReadingIds((prev) => {
            if (!prev.has(uploaded.id)) return prev;
            const next = new Set(prev);
            next.delete(uploaded.id);
            return next;
          });
        }, 25000);
      }
      scheduleExtractionRefresh(interview.id);
      if (fastTrack === "armed") {
        // 패스트트랙 — 첨부 도착 즉시 범위 제안 턴(첨부 본문은 턴 컨텍스트에 이미 포함)
        setFastTrack("awaiting");
        void runTurn({
          type: "answer",
          content: FAST_TRACK_SCOPE_MESSAGE[interview.lang] ?? FAST_TRACK_SCOPE_MESSAGE.ko,
        });
      }
      return true;
    } catch (err) {
      setAttachError(getApiErrorDetail(err) || "Failed to upload the file.");
      return false;
    }
  }

  async function handleDeleteAttachment(attachmentId: number) {
    if (!interview) return;
    try {
      await deleteInterviewAttachment(interview.id, attachmentId);
      setInterview((prev) =>
        prev
          ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== attachmentId) }
          : prev,
      );
    } catch (err) {
      setAttachError(getApiErrorDetail(err) || "Failed to delete the file.");
    }
  }

  if (fatal) {
    return (
      <ConfirmDialog
        title="Cannot open consultant"
        message={fatal}
        confirmLabel="Back to map"
        onConfirm={() => router.replace(`/maps/${mapId}`)}
        onClose={() => router.replace(`/maps/${mapId}`)}
      />
    );
  }

  const stageIdx = interview ? stageIndex(interview.current_stage, interview.mode) : 0;
  const live = interview ? interview.messages.filter((m) => !m.superseded) : [];
  const choices = interview?.status === "active" ? choiceOptionsOf(live) : null;
  const paramsRows = deriveParamsEditorRows(interview?.working_graph, interview?.facts);

  return (
    <div className="flex h-full flex-col" data-id="consult-page">
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        <Link
          href={`/maps/${mapId}`}
          className="flex items-center gap-1 text-caption text-ink-tertiary hover:text-ink"
          data-id="consult-exit"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          Back
        </Link>
        <Headset size={16} strokeWidth={1.5} className="text-accent" />
        <span className="text-body-strong">{mapName || "…"}</span>
        <span className="text-caption text-ink-muted">- Consultant</span>
        {/* 진행바 옆 현재 스테이지 라벨 — 무명 인디케이터 해소 (P1 #6) */}
        <span className="ml-auto text-caption text-ink-secondary" data-id="consult-stage-label">
          {stagesForMode(interview?.mode)[stageIdx]?.label ?? ""}
        </span>
        <ol className="flex items-center gap-1" data-id="consult-progress">
          {stagesForMode(interview?.mode).map((stage, i) => (
            <li
              key={stage.key}
              title={stage.label}
              className={
                "h-1.5 w-6 rounded-xs " +
                (i < stageIdx ? "bg-accent" : i === stageIdx ? "bg-accent/60" : "bg-surface-alt")
              }
            />
          ))}
        </ol>
        <button
          className="ml-2 flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
          disabled={!interview || interview.status !== "active" || busy || !!drawBusy || restartBusy}
          onClick={() => setRestartOpen(true)}
          title="Discard this session and start the interview over"
          data-id="iv-restart"
        >
          <RotateCcw size={16} strokeWidth={1.5} />
          Start over
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <InterviewPreview
          interview={interview}
          onUpdated={setInterview}
          mapId={mapId}
          choices={optimisticChoice ? null : choices}
          optimisticGraph={optimisticChoice?.graph ?? null}
          busy={busy}
          onChoose={(choiceId) => runTurn({ type: "choice", choice_id: choiceId })}
          drawBusy={drawBusy}
          drawError={drawError}
          onDraw={(variants) =>
            variants === "single" ? requestManualDraw() : void startDraw(variants)
          }
          onDrawRetry={() => void startDraw(lastDrawRef.current)}
          onDrawClearError={() => setDrawError(null)}
          onDrawCancel={cancelDraw}
          paramsAvailable={paramsRows.length > 0}
          onOpenParams={() => setParamsOpen(true)}
        />
        <div
          className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-hairline outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:bg-accent/40"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={handleDividerDown}
          onDoubleClick={resetChatWidth}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              resizeChatBy(16);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              resizeChatBy(-16);
            }
          }}
          data-id="consult-divider"
        >
          {/* 그립 도트 — 드래그 가능 어포던스 */}
          <span className="pointer-events-none flex flex-col gap-0.5" aria-hidden>
            <span className="h-0.5 w-0.5 rounded-full bg-ink-tertiary/70" />
            <span className="h-0.5 w-0.5 rounded-full bg-ink-tertiary/70" />
            <span className="h-0.5 w-0.5 rounded-full bg-ink-tertiary/70" />
          </span>
        </div>
        <aside
          className="flex shrink-0 flex-col bg-surface"
          style={{ width: chatWidth }}
          data-id="consult-chat"
        >
          {interview ? (
            <InterviewPanel
              interview={interview}
              busy={busy || !!drawBusy}
              error={error}
              attachError={attachError}
              pending={pending}
              hasChoices={choices !== null}
              onSend={handleSend}
              onSkip={() => runTurn({ type: "skip" })}
              canRetry={canRetry}
              onRetry={() => lastTurnRef.current && runTurn(lastTurnRef.current)}
              onAttach={handleAttach}
              onDeleteAttachment={handleDeleteAttachment}
              readingIds={readingIds}
              fastTrackArmed={fastTrack === "armed"}
              onFastTrackCancel={() => setFastTrack("idle")}
              onStartOver={() => setRestartOpen(true)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-caption text-ink-muted">
              Starting interview…
            </div>
          )}
        </aside>
      </div>
      {paramsOpen && paramsRows.length > 0 ? (
        <ParamsTableDialog
          rows={paramsRows}
          busy={paramsBusy}
          onApply={(table) => void handleApplyParams(table)}
          onClose={() => setParamsOpen(false)}
        />
      ) : null}
      {drawConfirmOpen && interview ? (
        <DrawConfirmDialog
          summary={buildDrawSummary(deriveOutline(interview.facts, interview.mode))}
          onConfirm={() => void confirmManualDraw()}
          onClose={cancelManualDraw}
        />
      ) : null}
      {restartOpen ? (
        <ConfirmDialog
          title="Start the interview over?"
          message="This discards the current session - conversation, collected facts, attachments, and the working map. The draft version itself is not affected."
          confirmLabel={restartBusy ? "Restarting…" : "Start over"}
          cancelLabel="Cancel"
          danger
          confirmDisabled={restartBusy}
          onConfirm={() => {
            void handleRestart();
          }}
          onClose={() => setRestartOpen(false)}
        />
      ) : null}
    </div>
  );
}
