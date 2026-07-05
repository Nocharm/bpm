"use client";

// 공지사항 열람 — 목록·마크다운 상세는 S4에서 구현. 현재는 라우트 확인용 placeholder.

import { useI18n } from "@/lib/i18n";

export default function NoticesPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center text-caption text-ink-tertiary">
      {t("nav.tab.notices")}
    </div>
  );
}
