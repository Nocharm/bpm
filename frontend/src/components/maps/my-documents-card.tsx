// 홈 대시보드 — 내가 오너인 문서. 상태 분포 바 + 범례 필터(기본 draft) + 5행 상한, 나머지는 좌측 목록 상태 필터로 링크아웃.
"use client";

import { FileText, FilePlus2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { MapSummary, VersionStatus } from "@/lib/api";
import { countByStatus, sortForStatus } from "@/lib/dashboard-stats";
import { useI18n } from "@/lib/i18n";
import { useAgo } from "@/lib/use-ago";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";
import { DashboardEmpty, DashboardFoot, DashboardSection } from "@/components/maps/dashboard-section";
import { StatusBar, StatusLegend } from "@/components/maps/status-distribution";

const ROW_CAP = 5;

interface MyDocumentsCardProps {
  maps: MapSummary[];
  onSelect: (id: number) => void;
  onFilterStatus: (status: VersionStatus) => void; // 좌측 목록 상태 필터 + 내 맵만
  onCreate: () => void;
}

export function MyDocumentsCard({ maps, onSelect, onFilterStatus, onCreate }: MyDocumentsCardProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const owned = useMemo(() => maps.filter((m) => m.my_role === "owner"), [maps]);
  const counts = useMemo(() => countByStatus(owned), [owned]);
  // 기본 선택은 draft(작업 중인 문서) — 없으면 첫 상태
  const [picked, setPicked] = useState<VersionStatus | null>(null);
  const selected = picked ?? (counts.some((c) => c.status === "draft") ? "draft" : (counts[0]?.status ?? null));
  const rows = useMemo(() => sortForStatus(owned, selected).slice(0, ROW_CAP), [owned, selected]);
  const selectedCount = counts.find((c) => c.status === selected)?.count ?? 0;
  return (
    <DashboardSection
      dataId="home-my-documents"
      icon={<FileText size={16} strokeWidth={1.5} />}
      title={t("home.myDocuments")}
      count={owned.length > 0 ? owned.length : null}
      more={owned.length > ROW_CAP && selected ? { label: t("home.dash.filterInList"), onClick: () => onFilterStatus(selected) } : undefined}
    >
      {owned.length === 0 ? (
        <DashboardEmpty
          icon={<FilePlus2 size={14} strokeWidth={1.5} />}
          text={t("home.dash.myDocumentsEmpty")}
          action={{ label: t("home.dash.createMap"), onClick: onCreate }}
        />
      ) : (
        <>
          <StatusBar counts={counts} />
          <StatusLegend counts={counts} selected={selected} onSelect={setPicked} />
          {rows.map((m) => <DashboardMapRow key={m.id} map={m} meta={ago(m.updated_at)} onSelect={onSelect} />)}
          {selected && selectedCount > ROW_CAP && (
            <DashboardFoot label={t("home.dash.myDocumentsMore", { n: selectedCount - ROW_CAP })} onClick={() => onFilterStatus(selected)} />
          )}
        </>
      )}
    </DashboardSection>
  );
}
