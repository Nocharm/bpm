// 홈 대시보드 최상단 — 최근 열람 맵. top 변경 시 위에서 내려오며 밀리는 스태거 진입.
"use client";

import { useEffect, useMemo } from "react";

import type { MapSummary } from "@/lib/api";
import { getRecentMaps } from "@/lib/recent-maps";
import { commitTop, peekTopChanged } from "@/lib/recent-order";
import { useI18n } from "@/lib/i18n";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";

interface RecentOpenedListProps {
  maps: MapSummary[]; // 접근 가능한 전체(필터 전) — 최근 id와 교차
  onSelect: (id: number) => void;
}

export function RecentOpenedList({ maps, onSelect }: RecentOpenedListProps) {
  const { t } = useI18n();
  const recent = useMemo(() => {
    const ids = getRecentMaps().map((e) => e.id);
    const byId = new Map(maps.map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id)).filter((m): m is MapSummary => Boolean(m));
  }, [maps]);
  // top 변화 시 1회 애니메이션 — 읽기는 render 중(순수), 기록은 effect에서(StrictMode 안전)
  const topId = recent[0]?.id ?? null;
  const animate = useMemo(() => peekTopChanged(topId), [topId]);
  useEffect(() => { commitTop(topId); }, [topId]);
  if (recent.length === 0) return null;
  return (
    <section data-id="home-recent" className="flex flex-col gap-2">
      <div className="px-1 text-fine text-ink-tertiary">{t("home.recentTitle")}</div>
      <ul className="flex flex-col gap-2">
        {recent.slice(0, 6).map((m, i) => (
          // top 변경 시 새 최상단(i===0)은 강조 진입, 나머지 기존 행은 한 슬롯 아래로 밀려 내려온다 → "하나가 위에 추가되며 전부 밀림".
          <li
            key={m.id}
            className={
              !animate
                ? ""
                : i === 0
                  ? "rounded-sm motion-safe:animate-[recent-insert_750ms_var(--ease-smooth)_both]"
                  : "motion-safe:animate-[recent-shift_600ms_var(--ease-smooth)_both]"
            }
          >
            <DashboardMapRow map={m} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}
