"use client";

// 승인/반려 모달 배너 — 요청자(제출자)의 제출 코멘트 또는 이전 반려 사유를 공개 (ConfirmDialog banner 슬롯용).

import { MessageSquare, XCircle } from "lucide-react";

import { type VersionEvent } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// 이번 승인 사이클의 제출 코멘트 — submit이 사이클마다 submitted 이벤트를 새로 쌓으므로 최신 것의 note.
export function findLatestSubmitComment(events: VersionEvent[] | undefined): string | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (evt && evt.event_type === "submitted") return evt.note;
  }
  return null;
}

// 최신 반려 이벤트 — 재요청(submit) 모달의 "이전 반려" 배너 소스(사유=note, 반려자=actor).
export function findLatestRejection(events: VersionEvent[] | undefined): VersionEvent | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (evt && evt.event_type === "rejected") return evt;
  }
  return null;
}

interface RequesterCommentBannerProps {
  // submit=요청자 제출 코멘트(중립 톤) · rejection=이전 반려 사유(에러 톤). 기본 submit.
  kind?: "submit" | "rejection";
  authorName?: string;
  comment: string;
}

export function RequesterCommentBanner({ kind = "submit", authorName, comment }: RequesterCommentBannerProps) {
  const { t } = useI18n();
  const isRejection = kind === "rejection";
  const Icon = isRejection ? XCircle : MessageSquare;
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`flex items-center gap-1 text-fine ${isRejection ? "text-error" : "text-ink-tertiary"}`}
      >
        <Icon size={12} strokeWidth={1.5} />
        {t(isRejection ? "wf.previousRejection" : "wf.requesterComment")}
        {authorName ? ` — ${authorName}` : ""}
      </span>
      <p className="whitespace-pre-wrap break-keep text-caption text-ink">{comment}</p>
    </div>
  );
}
