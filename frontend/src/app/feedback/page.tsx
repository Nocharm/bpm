"use client";

// 전체 피드백 페이지 — 집계·목록·관리자 상태변경은 S3에서 구현. 현재는 라우트 확인용 placeholder.

import { useI18n } from "@/lib/i18n";

export default function FeedbackPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center text-caption text-ink-tertiary">
      {t("feedback.button")}
    </div>
  );
}
