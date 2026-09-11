// 홈 대시보드 — 최근 열람 맵 섹션(6행 상한). top 변경 시 위에서 내려오며 밀리는 스태거 진입. 비면 빈 상태 한 줄.
"use client";

import { Eye } from "lucide-react";
import { useEffect, useMemo } from "react";

import type { MapSummary } from "@/lib/api";
import { getRecentMaps } from "@/lib/recent-maps";
import { commitTop, peekTopChanged } from "@/lib/recent-order";
import { useI18n } from "@/lib/i18n";
import { useAgo } from "@/lib/use-ago";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";
import { DashboardEmpty, DashboardSection } from "@/components/maps/dashboard-section";

const ROW_CAP = 6;

interface RecentOpenedListProps {
  maps: MapSummary[]; // 접근 가능한 전체(필터 전) — 최근 id와 교차
  onSelect: (id: number) => void;
  onEmptyAction?: () => void; // 빈 상태의 다음 행동(내 부서 맵 보기)
}

export function RecentOpenedList({ maps, onSelect, onEmptyAction }: RecentOpenedListProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const recent = useMemo(() => {
    const byId = new Map(maps.map((m) => [m.id, m]));
    return getRecentMaps()
      .map((e) => ({ map: byId.get(e.id), at: e.at }))
      .filter((x): x is { map: MapSummary; at: number } => Boolean(x.map));
  }, [maps]);
  // top 변화 시 1회 애니메이션 — 읽기는 render 중(순수), 기록은 effect에서(StrictMode 안전)
  const topId = recent[0]?.map.id ?? null;
  const animate = useMemo(() => peekTopChanged(topId), [topId]);
  useEffect(() => { commitTop(topId); }, [topId]);
  return (
    <DashboardSection dataId="home-recent" icon={<Eye size={16} strokeWidth={1.5} />} title={t("home.recentTitle")}>
      {recent.length === 0 ? (
        <DashboardEmpty
          icon={<Eye size={14} strokeWidth={1.5} />}
          text={t("home.dash.recentEmpty")}
          action={onEmptyAction ? { label: t("home.dash.recentEmptyAction"), onClick: onEmptyAction } : undefined}
        />
      ) : (
        recent.slice(0, ROW_CAP).map(({ map, at }, i) => (
          // top 변경 시 새 최상단(i===0)은 강조 진입, 나머지 기존 행은 한 슬롯 아래로 밀려 내려온다 → "하나가 위에 추가되며 전부 밀림".
          <div
            key={map.id}
            className={
              !animate
                ? ""
                : i === 0
                  ? "motion-safe:animate-[recent-insert_750ms_var(--ease-smooth)_both]"
                  : "motion-safe:animate-[recent-shift_600ms_var(--ease-smooth)_both]"
            }
          >
            <DashboardMapRow map={map} meta={ago(new Date(at).toISOString())} onSelect={onSelect} />
          </div>
        ))
      )}
    </DashboardSection>
  );
}
