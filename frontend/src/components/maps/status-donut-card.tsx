// 홈 대시보드 — 내가 오너인 문서 상태별 도넛. 세그먼트 클릭 → 목록 필터(기본 draft).
"use client";

import { useMemo, useState } from "react";

import type { MapSummary, VersionStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL } from "@/lib/version-status";
import { Donut } from "@/components/charts/donut";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";

// 상태 → 토큰 색변수(상태 배지 VERSION_STATUS_STYLE 색계열과 일치)
const STATUS_COLOR: Record<VersionStatus, string> = {
  draft: "--color-ink-tertiary",
  pending: "--color-changed",
  approved: "--color-accent",
  published: "--color-added",
  rejected: "--color-error",
  expired: "--color-ink-muted",
};
const ORDER: VersionStatus[] = ["draft", "pending", "approved", "published", "rejected", "expired"];

interface StatusDonutCardProps {
  maps: MapSummary[];
  onSelect: (id: number) => void;
}

export function StatusDonutCard({ maps, onSelect }: StatusDonutCardProps) {
  const { t } = useI18n();
  const owned = useMemo(() => maps.filter((m) => m.my_role === "owner"), [maps]);
  const byStatus = useMemo(() => {
    const g = new Map<VersionStatus, MapSummary[]>();
    for (const m of owned) {
      const s = (m.latest_version_status ?? "draft") as VersionStatus;
      const arr = g.get(s) ?? [];
      arr.push(m);
      g.set(s, arr);
    }
    return g;
  }, [owned]);
  const [selected, setSelected] = useState<VersionStatus>("draft");
  if (owned.length === 0) return null;
  const segments = ORDER
    .map((s) => ({ key: s, value: byStatus.get(s)?.length ?? 0, colorVar: STATUS_COLOR[s] }))
    .filter((s) => s.value > 0);
  const list = byStatus.get(selected) ?? [];
  return (
    <section data-id="home-my-documents" className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-alt p-3">
      <div className="text-caption-strong text-ink">{t("home.myDocuments")}</div>
      <div className="flex items-center gap-3">
        <Donut segments={segments} size={104} selectedKey={selected} onSelect={(k) => setSelected(k as VersionStatus)} label={t("home.myDocuments")} />
        <ul className="flex flex-col gap-1 text-fine">
          {segments.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setSelected(s.key); }}
                className={"flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 " + (selected === s.key ? "bg-accent-tint" : "hover:bg-surface")}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${s.colorVar})` }} />
                <span className="text-ink-secondary">{t(VERSION_STATUS_LABEL[s.key])}</span>
                <span className="ml-auto text-ink-tertiary">{s.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ul className="flex flex-col gap-1.5">
        {list.map((m) => <li key={m.id}><DashboardMapRow map={m} onSelect={onSelect} /></li>)}
      </ul>
    </section>
  );
}
