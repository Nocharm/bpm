// 홈 우측 — 미선택 시 대시보드. 최상단 최근 열람 + (내 문서 도넛 | 승인 필요) 2단.
"use client";

import type { MapSummary } from "@/lib/api";
import { RecentOpenedList } from "@/components/maps/recent-opened-list";
import { StatusDonutCard } from "@/components/maps/status-donut-card";
import { ApprovalsCard } from "@/components/maps/approvals-card";

interface HomeDashboardProps { maps: MapSummary[]; onSelect: (id: number) => void }

export function HomeDashboard({ maps, onSelect }: HomeDashboardProps) {
  return (
    <div data-id="home-dashboard" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <RecentOpenedList maps={maps} onSelect={onSelect} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StatusDonutCard maps={maps} onSelect={onSelect} />
        <ApprovalsCard onSelect={onSelect} />
      </div>
    </div>
  );
}
