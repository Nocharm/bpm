// 홈 대시보드 최상단 — 최근 열람 맵. top 변경 시 위에서 내려오며 밀리는 스태거 진입.
"use client";

import { useMemo } from "react";

import type { MapSummary } from "@/lib/api";
import { getRecentMaps } from "@/lib/recent-maps";
import { readTopChanged } from "@/lib/recent-order";
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
  // top 변화 시 1회 애니메이션(파생 — render 중 sessionStorage 비교, effect 아님)
  const animate = useMemo(() => readTopChanged(recent[0]?.id ?? null), [recent]);
  if (recent.length === 0) return null;
  return (
    <section data-id="home-recent" className="flex flex-col gap-2">
      <div className="px-1 text-fine text-ink-tertiary">{t("home.recentTitle")}</div>
      <ul className="flex flex-col gap-2">
        {recent.slice(0, 6).map((m, i) => (
          <li
            key={m.id}
            className={animate ? "motion-safe:animate-[slideDown_350ms_ease-out_both]" : ""}
            style={animate ? { animationDelay: `${i * 45}ms` } : undefined}
          >
            <DashboardMapRow map={m} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}
