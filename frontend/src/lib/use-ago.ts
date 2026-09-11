// 상대 시각 렌더 훅 — 마운트 시점 now 고정(렌더 중 Date.now 금지) + i18n "N min ago". 홈 대시보드 카드들이 공유.
"use client";

import { useCallback, useState } from "react";

import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

export function useAgo(): (iso: string | null | undefined) => string {
  const { t } = useI18n();
  const [now] = useState(() => Date.now());
  return useCallback(
    (iso) => {
      if (!iso) return "";
      const ms = now - Date.parse(iso);
      if (Number.isNaN(ms)) return "";
      const min = Math.floor(ms / 60000);
      if (min < 1) return t("home.timeAgo.now");
      if (min < 60) return t("home.timeAgo.minutes", { n: min });
      const hr = Math.floor(min / 60);
      if (hr < 24) return t("home.timeAgo.hours", { n: hr });
      const day = Math.floor(hr / 24);
      // 30일↑은 절대 날짜 — 맵 카드 relativeTime과 같은 규칙
      if (day < 30) return t("home.timeAgo.days", { n: day });
      return formatKst(iso).slice(0, 10);
    },
    [now, t],
  );
}
