// 홈 대시보드 — 내 부서 맵 현황. 맵 수·고아 참조·SP 미지정 지표 + 상태 분포 + 최근 갱신 3행. 부서 없는 유저는 빈 상태.
"use client";

import { Building2 } from "lucide-react";
import { useMemo } from "react";

import type { MapSummary } from "@/lib/api";
import { countByStatus, sortForStatus, summarizeDept } from "@/lib/dashboard-stats";
import { useI18n } from "@/lib/i18n";
import { useAgo } from "@/lib/use-ago";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";
import { DashboardEmpty, DashboardSection } from "@/components/maps/dashboard-section";
import { StatusBar, StatusLegend } from "@/components/maps/status-distribution";

const ROW_CAP = 3;

interface DeptMapsCardProps {
  maps: MapSummary[]; // 내 org_path 하위 맵(필터 전) — page.tsx myDeptMaps와 같은 규칙
  deptLabel: string; // 리프 부서명("" = 부서 없음)
  onSelect: (id: number) => void;
  onShowInTree: () => void; // 좌측 트리 내 부서 섹션으로
}

export function DeptMapsCard({ maps, deptLabel, onSelect, onShowInTree }: DeptMapsCardProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const stats = useMemo(() => summarizeDept(maps), [maps]);
  const counts = useMemo(() => countByStatus(maps), [maps]);
  const recent = useMemo(() => sortForStatus(maps, null).slice(0, ROW_CAP), [maps]);
  const title = deptLabel ? t("home.dash.deptTitle", { dept: deptLabel }) : t("home.dash.deptTitleNone");
  return (
    <DashboardSection
      dataId="home-dept-maps"
      icon={<Building2 size={16} strokeWidth={1.5} />}
      title={title}
      count={maps.length > 0 ? maps.length : null}
      more={maps.length > 0 ? { label: t("home.dash.showInTree"), onClick: onShowInTree } : undefined}
    >
      {maps.length === 0 ? (
        <DashboardEmpty
          icon={<Building2 size={14} strokeWidth={1.5} />}
          text={deptLabel ? t("home.dash.deptEmpty") : t("home.dash.deptNone")}
        />
      ) : (
        <>
          <div className="flex gap-3.5 px-3 pb-2.5 text-fine text-ink-tertiary">
            <span>
              {t("home.dash.deptMaps")} <b className="font-semibold text-ink tabular-nums">{stats.total}</b>
            </span>
            <span data-id="home-dept-stale">
              {t("home.dash.deptStaleRefs")}{" "}
              <b className={`font-semibold tabular-nums ${stats.staleRefs > 0 ? "text-warn" : "text-ink"}`}>{stats.staleRefs}</b>
            </span>
            <span data-id="home-dept-sp-missing">
              {t("home.dash.deptSpMissing")}{" "}
              <b className={`font-semibold tabular-nums ${stats.spMissing > 0 ? "text-warn" : "text-ink"}`}>{stats.spMissing}</b>
            </span>
          </div>
          <StatusBar counts={counts} />
          <StatusLegend counts={counts} selected={null} />
          <div className="px-3 pb-1.5 text-fine text-ink-tertiary">{t("home.dash.deptRecent")}</div>
          {recent.map((m) => <DashboardMapRow key={m.id} map={m} meta={ago(m.updated_at)} onSelect={onSelect} />)}
        </>
      )}
    </DashboardSection>
  );
}
