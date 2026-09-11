// 홈 대시보드 — 내가 오너인 문서. 상태|버전 탭(헤더 우측, 영속) + 분포 바 + 범례 필터(상태 기본 draft·버전 기본 업데이트 진행 중)
// + 5행 상한. 상태 탭은 좌측 목록 상태 필터로 링크아웃, 버전 탭 행은 게시본/진행 상태 칩을 메타에 단다.
"use client";

import { FileText, FilePlus2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { MapSummary, VersionStatus } from "@/lib/api";
import { countByBucket, countByStatus, sortForBucket, sortForStatus, type VersionBucket } from "@/lib/dashboard-stats";
import { useI18n } from "@/lib/i18n";
import { useAgo } from "@/lib/use-ago";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";
import { DashboardEmpty, DashboardFoot, DashboardSection } from "@/components/maps/dashboard-section";
import { Distribution, DistributionTabs, VersionChip, toStatusItems, useBucketItems, useDistTab } from "@/components/maps/status-distribution";

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
  const [tab, setTab] = useDistTab("mine");
  const toBucketItems = useBucketItems();
  // 상태 탭 — 기본 선택은 draft(작업 중인 문서), 없으면 첫 상태
  const counts = useMemo(() => countByStatus(owned), [owned]);
  const [picked, setPicked] = useState<VersionStatus | null>(null);
  const selected = picked ?? (counts.some((c) => c.status === "draft") ? "draft" : (counts[0]?.status ?? null));
  // 버전 탭 — 기본 선택은 업데이트 진행 중(손볼 문서), 없으면 첫 버킷
  const buckets = useMemo(() => countByBucket(owned), [owned]);
  const [pickedBucket, setPickedBucket] = useState<VersionBucket | null>(null);
  const bucket = pickedBucket ?? (buckets.some((b) => b.bucket === "updating") ? "updating" : (buckets[0]?.bucket ?? null));
  const rows = useMemo(
    () => (tab === "status" ? sortForStatus(owned, selected) : sortForBucket(owned, bucket)).slice(0, ROW_CAP),
    [owned, selected, bucket, tab],
  );
  const selectedCount = tab === "status"
    ? (counts.find((c) => c.status === selected)?.count ?? 0)
    : (buckets.find((b) => b.bucket === bucket)?.count ?? 0);
  return (
    <DashboardSection
      dataId="home-my-documents"
      icon={<FileText size={16} strokeWidth={1.5} />}
      title={t("home.myDocuments")}
      count={owned.length > 0 ? owned.length : null}
      aside={owned.length > 0 ? <DistributionTabs card="home-my-documents" value={tab} onChange={setTab} /> : null}
      more={
        owned.length === 0
          ? { label: t("home.dash.createMap"), onClick: onCreate }
          : tab === "status" && owned.length > ROW_CAP && selected
            ? { label: t("home.dash.filterInList"), onClick: () => onFilterStatus(selected) }
            : undefined
      }
      empty={owned.length === 0 ? <DashboardEmpty icon={<FilePlus2 size={14} strokeWidth={1.5} />} text={t("home.dash.myDocumentsEmpty")} /> : undefined}
    >
      {owned.length === 0 ? null : (
        <>
          {tab === "status" ? (
            <Distribution items={toStatusItems(counts)} selected={selected} onSelect={(k) => setPicked(k as VersionStatus)} />
          ) : (
            <Distribution items={toBucketItems(buckets)} selected={bucket} onSelect={(k) => setPickedBucket(k as VersionBucket)} />
          )}
          {rows.map((m) => (
            <DashboardMapRow
              key={m.id}
              map={m}
              meta={tab === "version" ? <span className="inline-flex items-center gap-1.5"><VersionChip map={m} />{ago(m.updated_at)}</span> : ago(m.updated_at)}
              onSelect={onSelect}
            />
          ))}
          {tab === "status" && selected && selectedCount > ROW_CAP && (
            <DashboardFoot label={t("home.dash.myDocumentsMore", { n: selectedCount - ROW_CAP })} onClick={() => onFilterStatus(selected)} />
          )}
        </>
      )}
    </DashboardSection>
  );
}
