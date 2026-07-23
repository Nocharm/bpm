"use client";

// AI 컨설턴트 인터뷰 모드 — 풀스크린(TopNav 아래): 좌 대화 + 우 읽기전용 프리뷰 (design 2026-07-23 §6)

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Headset } from "lucide-react";

import {
  ApiError,
  createOrResumeInterview,
  getApiErrorDetail,
  getMe,
  getMap,
  postInterviewTurn,
  uploadInterviewAttachment,
  type InterviewState,
} from "@/lib/api";
import { INTERVIEW_STAGES, stageIndex } from "@/lib/interview";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InterviewPanel } from "@/components/interview/interview-panel";
import { InterviewPreview } from "@/components/interview/interview-preview";

export default function ConsultPage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);
  const router = useRouter();

  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [mapName, setMapName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null); // 403/503 등 진입 불가
  const lastTurnRef = useRef<{ type: "answer" | "choice"; content?: string; choice_id?: string } | null>(null);

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
        const state = await createOrResumeInterview(mapId, draft.id, "ko");
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
  }, [mapId]);

  async function runTurn(turn: { type: "answer" | "choice"; content?: string; choice_id?: string }) {
    if (!interview || busy) return;
    lastTurnRef.current = turn;
    setBusy(true);
    setError(null);
    try {
      setInterview(await postInterviewTurn(interview.id, turn));
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
      setInterview({ ...interview, attachments: [...interview.attachments, uploaded] });
    } catch (err) {
      setError(getApiErrorDetail(err) || "Failed to upload the file.");
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
        <aside className="flex w-[440px] shrink-0 flex-col border-r border-hairline bg-surface">
          {interview ? (
            <InterviewPanel
              interview={interview}
              busy={busy}
              error={error}
              onSend={(content) => runTurn({ type: "answer", content })}
              onChoose={(choiceId) => runTurn({ type: "choice", choice_id: choiceId })}
              onRetry={() => lastTurnRef.current && runTurn(lastTurnRef.current)}
              onAttach={handleAttach}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-caption text-ink-muted">
              Starting interview…
            </div>
          )}
        </aside>
        <InterviewPreview interview={interview} onUpdated={setInterview} mapId={mapId} />
      </div>
    </div>
  );
}
