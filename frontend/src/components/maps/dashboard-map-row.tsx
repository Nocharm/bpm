// 대시보드 컴팩트 맵 행 — hover 시 Open 버튼(에디터 이동), 그 외 클릭은 선택(좌측 포커스 + 우측 상세).
"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

interface DashboardMapRowProps {
  map: MapSummary;
  meta?: React.ReactNode; // 우측 부가 표기(시각·부서·단계 등)
  onSelect: (id: number) => void;
}

export function DashboardMapRow({ map, meta, onSelect }: DashboardMapRowProps) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div
      data-id="dashboard-map-row"
      onClick={(e) => { e.stopPropagation(); onSelect(map.id); }}
      className="group flex cursor-pointer items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2 hover:bg-surface-alt"
    >
      <span className="min-w-0 flex-1 truncate text-caption text-ink">{map.name}</span>
      {map.sp_designated_at && (
        <span className="shrink-0 rounded-sm border border-hairline bg-accent-tint px-1 text-fine text-accent">{t("home.spBadge")}</span>
      )}
      {map.latest_version_status && (
        <span className={`shrink-0 rounded-sm border px-1 py-0.5 text-fine ${VERSION_STATUS_STYLE[map.latest_version_status]}`}>
          {t(VERSION_STATUS_LABEL[map.latest_version_status])}
        </span>
      )}
      {meta && <span className="shrink-0 text-fine text-ink-tertiary">{meta}</span>}
      <button
        type="button"
        data-id="dashboard-map-open"
        onClick={(e) => { e.stopPropagation(); router.push(`/maps/${map.id}`); }}
        className="hidden shrink-0 items-center gap-1 rounded-sm bg-accent px-2 py-1 text-fine text-on-accent group-hover:inline-flex"
      >
        {t("home.openMap")} <ArrowRight size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}
