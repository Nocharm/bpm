// 대시보드 컴팩트 맵 행 — 섹션 안의 평면 행(구분선). 상태 점이 맨 앞, 제목 톤다운, SP 아이콘(맵 카드와 동일)은 제목 바로 뒤,
// 우측 메타. hover 시 열기 버튼이 지연 후 폭을 벌리며 등장(우측 항목이 밀림, 맵 카드 열기 필과 같은 디자인). 클릭은 선택.
"use client";

import { ArrowUpRight, Workflow } from "lucide-react";
import Link from "next/link";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_TONE } from "@/lib/version-status";
import { Tooltip } from "@/components/tooltip";

interface DashboardMapRowProps {
  map: MapSummary;
  meta?: React.ReactNode; // 우측 부가 표기(시각·부서·단계 등)
  onSelect: (id: number) => void;
}

export function DashboardMapRow({ map, meta, onSelect }: DashboardMapRowProps) {
  const { t } = useI18n();
  return (
    <div
      data-id="dashboard-map-row"
      onClick={(e) => { e.stopPropagation(); onSelect(map.id); }}
      className="group flex cursor-pointer items-center gap-2 border-t border-divider px-3 py-1.5 hover:bg-surface-pearl"
    >
      {/* 상태 점은 맨 앞 — 스캔할 때 상태→이름 순으로 읽힌다 (사용자 지시 2026-09-11) */}
      {map.latest_version_status ? (
        <Tooltip label={VERSION_STATUS_LABEL_EN[map.latest_version_status]}>
          <span
            data-id="dashboard-map-status"
            data-status={map.latest_version_status}
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${VERSION_STATUS_TONE[map.latest_version_status].dot}`}
          />
        </Tooltip>
      ) : (
        <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-hairline" aria-hidden="true" />
      )}
      <span className="min-w-0 truncate text-caption text-ink-secondary">{map.name}</span>
      {map.sp_designated_at && (
        <span
          data-id="dashboard-map-sp"
          title={t("home.spBadgeTip")}
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-accent-tint text-accent"
        >
          <Workflow size={11} strokeWidth={2.2} />
        </span>
      )}
      <span className="min-w-0 flex-1" aria-hidden="true" />
      {meta && <span className="shrink-0 text-fine text-ink-tertiary">{meta}</span>}
      {/* 열기 — grid 0fr→1fr로 폭이 열리며 우측 항목을 밀어낸다. 진입은 300ms 지연(스치는 호버에 산만하지 않게), 이탈은 즉시 */}
      <span className="-ml-2 grid grid-cols-[0fr] transition-[grid-template-columns,margin] duration-200 ease-smooth delay-0 group-hover:ml-0 group-hover:grid-cols-[1fr] group-hover:delay-300">
        <Link
          data-id="dashboard-map-open"
          href={`/maps/${map.id}`}
          title={t("home.openMap")}
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-none inline-flex min-w-0 items-center gap-0.5 overflow-hidden rounded-[6px] border border-hairline bg-surface px-2 py-[3px] text-fine font-medium text-ink-secondary opacity-0 transition-[opacity,border-color,color] duration-150 ease-smooth delay-0 hover:border-accent hover:text-accent group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-300"
        >
          <ArrowUpRight size={12} strokeWidth={1.5} className="shrink-0" />
          <span className="whitespace-nowrap">{t("home.openMap")}</span>
        </Link>
      </span>
    </div>
  );
}
