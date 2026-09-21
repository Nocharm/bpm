// 홈 검색 결과의 L5 연계 캔버스 카드 — 일반 MapCard의 오너·SP·역할 필은 캔버스(mode=framework)에 의미가 없어
// 별도 카드로 그린다: 캔버스 타일 + 이름 + 확정/초안 상태, 2줄엔 결착 L5의 상위 경로. 클릭 = 결착 카테고리 선택
// (우측은 업무 체계 뷰와 같은 CategorySummaryCard). 부서 뷰·업무 체계 뷰 검색 결과가 공유한다(사용자 지시 2026-09-21).
"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronRight, Workflow } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MatchRange } from "@/lib/search";
import {
  VERSION_STATUS_LABEL_EN,
  VERSION_STATUS_TONE,
} from "@/lib/version-status";
import { Highlight } from "@/components/highlight";
import { LevelPill } from "@/components/level-pill";

interface FrameworkMapCardProps {
  // mode=framework + linkage_category_id가 있는 목록 행(없으면 호출부가 일반 카드로 폴백)
  map: MapSummary;
  selected: boolean;
  onSelect: (categoryId: number) => void;
  nameRanges?: MatchRange[];
}

export function FrameworkMapCard({
  map,
  selected,
  onSelect,
  nameRanges,
}: FrameworkMapCardProps) {
  const { t } = useI18n();
  const categoryId = map.linkage_category_id ?? null;
  // 경로 "L1/L2/L3/L4/L5" — 마지막(L5)은 캔버스 이름과 같아 상위만 적는다
  const ancestors = (map.linkage_category_path ?? "")
    .split("/")
    .filter(Boolean)
    .slice(0, -1);
  const status = map.latest_version_status;
  const tone = status ? VERSION_STATUS_TONE[status] : null;
  return (
    <div
      role="button"
      tabIndex={0}
      data-id={`framework-map-card-${map.id}`}
      data-selected={selected ? "" : undefined}
      aria-pressed={selected}
      className={`group flex w-full cursor-pointer flex-col gap-1.5 rounded-sm border bg-surface py-2 pl-2.5 pr-2 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
        selected
          ? "border-accent ring-1 ring-accent"
          : "border-hairline hover:border-accent-tint-border hover:shadow-md"
      }`}
      onClick={(e) => {
        e.stopPropagation(); // 배경(선택 해제)으로 버블링 방지 — MapCard와 동일
        if (categoryId !== null) onSelect(categoryId);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && categoryId !== null) {
          e.preventDefault();
          onSelect(categoryId);
        }
      }}
    >
      {/* 1줄 — 캔버스 타일 · 이름 · 확정/초안 | 우측 "L5 canvas" 라벨 */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm ${
            selected ? "bg-accent text-on-accent" : "bg-accent-tint text-accent"
          }`}
        >
          <Workflow size={13} strokeWidth={1.5} />
        </span>
        <span
          data-id="map-card-name"
          className="min-w-0 truncate text-body-strong text-ink"
        >
          <Highlight text={map.name} ranges={nameRanges ?? []} />
        </span>
        {status && tone && (
          <span
            data-id="framework-map-card-status"
            data-status={status}
            className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${tone.pill}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
            {VERSION_STATUS_LABEL_EN[status]}
          </span>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center rounded-full border border-hairline px-2 py-[3px] text-[11px] leading-none text-ink-tertiary">
          {t("home.l5Canvas")}
        </span>
      </div>

      {/* 2줄 — L5 필 + 상위 경로(말줄임) | 우측 캔버스 열기(호버) */}
      <div className="flex min-h-[22px] min-w-0 items-center gap-1.5 text-fine text-ink-tertiary">
        <LevelPill level={5} size="sm" />
        <span
          data-id="framework-map-card-path"
          className="flex min-w-0 flex-1 items-center gap-0.5 truncate"
          title={map.linkage_category_path ?? undefined}
        >
          {ancestors.length === 0 ? (
            <span className="text-ink-muted">{t("home.l5CanvasUnlinked")}</span>
          ) : (
            ancestors.map((name, i) => (
              <span
                key={`${i}-${name}`}
                className="inline-flex min-w-0 items-center gap-0.5"
              >
                {i > 0 && (
                  <ChevronRight
                    size={11}
                    strokeWidth={1.5}
                    className="shrink-0 text-ink-muted"
                  />
                )}
                <span className="truncate">{name}</span>
              </span>
            ))
          )}
        </span>
        <Link
          href={`/maps/${map.id}`}
          data-id={`framework-map-card-open-${map.id}`}
          title={t("category.summary.openCanvas")}
          aria-label={t("category.summary.openCanvas")}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent text-on-accent opacity-0 transition-opacity duration-150 hover:bg-accent-focus group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowUpRight size={13} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
