"use client";

// 승인 모달 배너 — 요청자(제출자)의 제출 코멘트를 승인자에게 공개 (ConfirmDialog banner 슬롯용).

import { MessageSquare } from "lucide-react";

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

interface RequesterCommentBannerProps {
  submitterName?: string;
  comment: string;
}

export function RequesterCommentBanner({ submitterName, comment }: RequesterCommentBannerProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-fine text-ink-tertiary">
        <MessageSquare size={12} strokeWidth={1.5} />
        {t("wf.requesterComment")}
        {submitterName ? ` — ${submitterName}` : ""}
      </span>
      <p className="whitespace-pre-wrap break-keep text-caption text-ink">{comment}</p>
    </div>
  );
}
