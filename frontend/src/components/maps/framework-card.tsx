// 홈 대시보드 — 업무 체계. 권한자면 카테고리별 L5 수·미확정·슬롯 승인 대기 + 연계 캔버스, 아니면 내 부서 맵의 체계 경로만.
"use client";

import { ChevronRight, Layers } from "lucide-react";

import type { MeDashboardCategory } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { DashboardEmpty, DashboardFoot, DashboardSection } from "@/components/maps/dashboard-section";
import { SkeletonLine } from "@/components/skeleton";

const ROW_CAP = 3;

interface FrameworkCardProps {
  categories: MeDashboardCategory[] | null; // 도착 전 null
  crumb: string | null; // 비권한자용 — 내 부서 맵 하나의 category_path("A / B / C"), 없으면 null
  onOpenLinkage: (cat: { id: number; linkage_map_id: number | null }) => void;
  onBrowse: () => void; // 좌측 컬럼을 업무 체계 뷰로
}

export function FrameworkCard({ categories, crumb, onOpenLinkage, onBrowse }: FrameworkCardProps) {
  const { t } = useI18n();
  const list = categories ?? [];
  // 빈 상태 — 문구 + (비권한자면) 내 부서 맵의 체계 경로. 체계 탐색 링크는 헤더 우측(more)
  const emptyNode = categories !== null && list.length === 0 ? (
    <div className="flex flex-col items-center gap-3">
      <DashboardEmpty icon={<Layers size={14} strokeWidth={1.5} />} text={t("home.dash.frameworkEmpty")} />
      {crumb && (
        <div className="flex flex-wrap items-center justify-center gap-1 text-fine text-ink-tertiary">
          <span>{t("home.dash.frameworkCrumb")}</span>
          {crumb.split("/").map((seg, i, arr) => (
            <span key={`${i}-${seg}`} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} strokeWidth={1.5} />}
              <span className={i === arr.length - 1 ? "font-semibold text-ink-secondary" : ""}>{seg.trim()}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  ) : undefined;
  return (
    <DashboardSection
      dataId="home-framework"
      icon={<Layers size={16} strokeWidth={1.5} />}
      title={t("home.dash.frameworkTitle")}
      count={list.length > 0 ? list.length : null}
      more={categories !== null ? { label: t("home.dash.browseFramework"), onClick: onBrowse } : undefined}
      empty={emptyNode}
    >
      {categories === null ? (
        <div className="flex flex-col gap-2 border-t border-divider px-3 py-3">
          <SkeletonLine className="w-3/5" />
          <SkeletonLine className="w-2/5" />
        </div>
      ) : list.length === 0 ? null : (
        <>
          {list.slice(0, ROW_CAP).map((c) => (
            <div key={c.category_id} data-id={`home-framework-cat-${c.category_id}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-t border-divider px-3 py-2 transition-colors duration-150 hover:bg-surface-pearl">
              <span className="grid h-[26px] w-[26px] place-items-center rounded-[6px] bg-accent-tint text-[11px] font-semibold text-accent-elevated">L{c.level}</span>
              <div className="min-w-0">
                <div className="truncate text-caption-strong text-ink">{c.name}</div>
                <div className="mt-0.5 flex gap-2.5 text-fine text-ink-tertiary">
                  <span>
                    L5 <b className="font-semibold text-ink tabular-nums">{c.l5_count}</b>
                  </span>
                  <span className={c.unconfirmed_count > 0 ? "text-warn" : ""}>{t("home.dash.fwUnconfirmed", { n: c.unconfirmed_count })}</span>
                  <span className={c.slot_pending_count > 0 ? "text-warn" : ""}>{t("home.dash.fwSlotPending", { n: c.slot_pending_count })}</span>
                </div>
              </div>
              {/* 연계 캔버스 — 행 호버(또는 키보드 포커스) 시에만 grid 0fr→1fr로 열리며 등장, 진입 300ms 지연·이탈 즉시(맵 행 열기 버튼과 같은 규칙, 사용자 지시 2026-09-11) */}
              {/* 페이드는 <button>이 아니라 감싼 span에 — 전역 버튼 base(globals.css)가 transition: transform을 덮어써 버튼 자체의 opacity 전환·지연이 무시된다 */}
              <span className="grid -ml-2.5 grid-cols-[0fr] transition-[grid-template-columns,margin] duration-200 ease-smooth delay-0 group-hover:ml-0 group-hover:grid-cols-[1fr] group-hover:delay-300 group-focus-within:ml-0 group-focus-within:grid-cols-[1fr]">
                <span className="pointer-events-none min-w-0 overflow-hidden opacity-0 transition-opacity duration-150 ease-smooth delay-0 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-300 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                  <button
                    type="button"
                    data-id={`home-framework-open-${c.category_id}`}
                    onClick={(e) => { e.stopPropagation(); onOpenLinkage({ id: c.category_id, linkage_map_id: c.linkage_map_id }); }}
                    className="whitespace-nowrap rounded-xs border border-hairline bg-surface px-2 py-1 text-fine text-ink-secondary hover:border-accent-tint-border hover:text-accent-elevated"
                  >
                    {t("home.dash.openLinkage")}
                  </button>
                </span>
              </span>
            </div>
          ))}
          {list.length > ROW_CAP && <DashboardFoot label={t("home.dash.frameworkMore", { n: list.length - ROW_CAP })} onClick={onBrowse} />}
        </>
      )}
    </DashboardSection>
  );
}
