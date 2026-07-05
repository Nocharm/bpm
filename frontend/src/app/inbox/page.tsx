"use client";

// 알림·승인 인박스 — 마스터-디테일·승인/알림 탭은 S6·S7에서 구현. 현재는 라우트 확인용 placeholder.

import { useI18n } from "@/lib/i18n";

export default function InboxPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center text-caption text-ink-tertiary">
      {t("nav.tab.inbox")}
    </div>
  );
}
