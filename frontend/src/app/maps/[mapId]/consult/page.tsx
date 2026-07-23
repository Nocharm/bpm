"use client";

// AI 컨설턴트 인터뷰 모드 — 풀스크린(TopNav 아래): 좌 프리뷰(메인) + 우 대화(폭 조절) (design 2026-07-23 §6)

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Headset } from "lucide-react";

import {
  ApiError,
  createOrResumeInterview,
  deleteInterviewAttachment,
  getApiErrorDetail,
  getMe,
  getMap,
  postInterviewTurn,
  uploadInterviewAttachment,
  type InterviewState,
} from "@/lib/api";
import { INTERVIEW_STAGES, choiceOptionsOf, stageIndex } from "@/lib/interview";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InterviewPanel } from "@/components/interview/interview-panel";
import { InterviewPreview } from "@/components/interview/interview-preview";

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
  const [fatal, setFatal] = useState<string | null>(null); // 403/503 등 진입 불가
  const [chatWidth, setChatWidth] = useState(readChatWidth);
  const lastTurnRef = useRef<{ type: "answer" | "choice"; content?: string; choice_id?: string } | null>(null);

  function handleDividerDown(e: React.PointerEvent) {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, window.innerWidth - ev.clientX));
      setChatWidth(next);
    };
    const onUp = (ev: PointerEvent) => {
      const finalWidth = Math.min(CHAT_MAX, Math.max(CHAT_MIN, window.innerWidth - ev.clientX));
      window.localStorage.setItem(CHAT_WIDTH_KEY, String(finalWidth));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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

  async function runTurn(turn: { type: "answer" | "choice"; content?: string; choice_id?: string }) {
    if (!interview || busy) return;
    lastTurnRef.current = turn;
    setBusy(true);
    setError(null);
    try {
      setInterview(await postInterviewTurn(interview.id, turn));
      lastTurnRef.current = null; // 성공한 턴은 Retry 재생 대상에서 제외 — 첨부 업로드 실패 시 중복 제출 방지
    } catch (err) {
      setError(getApiErrorDetail(err) || "AI request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAttach(file: File) {
    if (!interview) return;
    try {
      const uploaded = await uploadInterviewAttachment(interview.id, file);
      setInterview((prev) =>
        prev ? { ...prev, attachments: [...prev.attachments, uploaded] } : prev,
      );
    } catch (err) {
      setError(getApiErrorDetail(err) || "Failed to upload the file.");
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
      setError(getApiErrorDetail(err) || "Failed to delete the file.");
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

  const stageIdx = interview ? stageIndex(interview.current_stage) : 0;
  const live = interview ? interview.messages.filter((m) => !m.superseded) : [];
  const choices = interview?.status === "active" ? choiceOptionsOf(live) : null;

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
        <span className="text-caption text-ink-muted">— Consultant</span>
        <ol className="ml-auto flex items-center gap-1" data-id="consult-progress">
          {INTERVIEW_STAGES.map((stage, i) => (
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
      </header>
      <div className="flex min-h-0 flex-1">
        <InterviewPreview
          interview={interview}
          onUpdated={setInterview}
          mapId={mapId}
          choices={choices}
          busy={busy}
          onChoose={(choiceId) => runTurn({ type: "choice", choice_id: choiceId })}
        />
        <div
          className="w-1 shrink-0 cursor-col-resize bg-hairline transition-colors duration-150 hover:bg-accent/40"
          onPointerDown={handleDividerDown}
          data-id="consult-divider"
        />
        <aside
          className="flex shrink-0 flex-col bg-surface"
          style={{ width: chatWidth }}
          data-id="consult-chat"
        >
          {interview ? (
            <InterviewPanel
              interview={interview}
              busy={busy}
              error={error}
              hasChoices={choices !== null}
              onSend={(content) => runTurn({ type: "answer", content })}
              onRetry={() => lastTurnRef.current && runTurn(lastTurnRef.current)}
              onAttach={handleAttach}
              onDeleteAttachment={handleDeleteAttachment}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-caption text-ink-muted">
              Starting interview…
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
