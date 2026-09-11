// 홈 우측 — 미선택 시 개인 대시보드. 프로필 마스트헤드 → 활동 타일 → (결재|내 문서) → (내 부서|업무 체계) → (최근 변경|최근 열람).
// GET /me/dashboard 1회 fetch로 타일·체계·변경 피드를 채우고, 결재 목록은 ApprovalsCard가 따로 가져온다.
// 2열 분기는 aside 폭 기준(@container) — split 하한(24rem)에서는 1열.
"use client";

import { useEffect, useState } from "react";

import { getMeDashboard, type MapSummary, type Me, type MeDashboard, type VersionStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ApprovalsCard } from "@/components/maps/approvals-card";
import { DashboardActivityTiles } from "@/components/maps/dashboard-activity-tiles";
import { DashboardProfile } from "@/components/maps/dashboard-profile";
import { DeptMapsCard } from "@/components/maps/dept-maps-card";
import { FrameworkCard } from "@/components/maps/framework-card";
import { MyDocumentsCard } from "@/components/maps/my-documents-card";
import { RecentEventsCard } from "@/components/maps/recent-events-card";
import { RecentOpenedList } from "@/components/maps/recent-opened-list";

interface HomeDashboardProps {
  maps: MapSummary[]; // 접근 가능한 프로세스 맵 전체(필터 전)
  me: Me | null;
  myDeptMaps: MapSummary[];
  myDeptLabel: string;
  onSelect: (id: number) => void;
  onFilterMine: () => void; // 좌측 목록 권한 필터 = owner
  onFilterStatus: (status: VersionStatus) => void; // 권한 owner + 상태 필터
  onCreate: () => void;
  onShowInTree: () => void; // 부서 뷰 + 내 부서 섹션 펼침
  onBrowseFramework: () => void; // 업무 체계 뷰
  onOpenLinkage: (cat: { id: number; linkage_map_id: number | null }) => void;
}

export function HomeDashboard({
  maps, me, myDeptMaps, myDeptLabel, onSelect, onFilterMine, onFilterStatus, onCreate, onShowInTree, onBrowseFramework, onOpenLinkage,
}: HomeDashboardProps) {
  const { t } = useI18n();
  const [data, setData] = useState<MeDashboard | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let active = true;
    void getMeDashboard()
      .then((r) => { if (active) { setData(r); setLoadError(false); } })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);
  // 비권한자용 체계 경로 — 내 부서 맵 중 카테고리 연결된 첫 맵의 경로
  const crumb = myDeptMaps.find((m) => m.category_path)?.category_path ?? null;
  return (
    <div data-id="home-dashboard" className="scrollbar-hidden @container flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
      {me && <DashboardProfile me={me} activity={data?.activity ?? null} onFilterMine={onFilterMine} />}
      {loadError && (
        <p data-id="home-dashboard-error" className="rounded-sm border border-notice-border bg-notice px-3 py-1.5 text-fine text-ink-secondary">
          {t("home.dash.loadError")}
        </p>
      )}
      {!loadError && <DashboardActivityTiles data={data} onSelect={onSelect} />}
      <div className="grid grid-cols-1 items-start gap-2.5 @[42rem]:grid-cols-2">
        <ApprovalsCard onSelect={onSelect} />
        <MyDocumentsCard maps={maps} onSelect={onSelect} onFilterStatus={onFilterStatus} onCreate={onCreate} />
      </div>
      <div className="grid grid-cols-1 items-start gap-2.5 @[42rem]:grid-cols-2">
        <DeptMapsCard maps={maps} orgPath={me?.org_path ?? ""} deptLabel={myDeptLabel} onSelect={onSelect} onShowInTree={onShowInTree} />
        <FrameworkCard categories={loadError ? [] : (data?.framework ?? null)} crumb={crumb} onOpenLinkage={onOpenLinkage} onBrowse={onBrowseFramework} />
      </div>
      <div className="grid grid-cols-1 items-start gap-2.5 @[42rem]:grid-cols-2">
        <RecentEventsCard events={loadError ? [] : (data?.recent_events ?? null)} onSelect={onSelect} />
        <RecentOpenedList maps={maps} onSelect={onSelect} onEmptyAction={myDeptMaps.length > 0 ? onShowInTree : undefined} />
      </div>
    </div>
  );
}
