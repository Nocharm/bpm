// 피드백 유형·상태의 표시 메타(필 스타일·라벨 키) — 목록과 상세 모달이 공유.

import type { FeedbackKind, FeedbackStatus } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";

// 채운 파스텔 필 — 토큰 색 + 저채도 배경(bg-*/15)
export const FEEDBACK_KIND_STYLE: Record<FeedbackKind, string> = {
  bug: "bg-error/15 text-error",
  suggestion: "bg-accent/15 text-accent",
  question: "bg-changed/15 text-changed",
  etc: "bg-surface-alt text-ink-secondary",
};

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, MessageKey> = {
  bug: "feedback.kind.bug",
  suggestion: "feedback.kind.suggestion",
  question: "feedback.kind.question",
  etc: "feedback.kind.etc",
};

export const FEEDBACK_STATUS_STYLE: Record<FeedbackStatus, string> = {
  draft: "bg-surface-alt text-ink-secondary",
  in_progress: "bg-changed/15 text-changed",
  done: "bg-added/15 text-added",
};

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, MessageKey> = {
  draft: "feedback.status.draft",
  in_progress: "feedback.status.in_progress",
  done: "feedback.status.done",
};

export const FEEDBACK_STATUSES: FeedbackStatus[] = ["draft", "in_progress", "done"];
