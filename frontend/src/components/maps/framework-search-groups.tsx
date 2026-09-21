// 업무 체계 뷰의 검색 결과 — 부서 뷰의 플랫 카드 목록 대신 L5 카테고리별 그룹(사용자 지시 2026-09-21).
// 그룹 헤더 = 상위 경로(톤다운) › L5 이름(강조) + 캔버스 칩(히트된 연계 캔버스의 확정/초안) + 행 수. 헤더 클릭 = 그 L5로
// 드릴다운 이동(검색 해제). 행은 페이지의 renderRow(일반 MapCard + 좁은 폭 인라인 상세) 그대로. 미등록 맵은 점선 그룹.
"use client";

import { ChevronRight, CornerDownRight, Network, Workflow } from "lucide-react";
import type { ReactNode } from "react";

import type { CategoryLite, MapSummary } from "@/lib/api";
import { groupHitsByCategory } from "@/lib/framework-search-groups";
import { Highlight } from "@/components/highlight";
import { useI18n } from "@/lib/i18n";
import type { MatchRange } from "@/lib/search";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_TONE } from "@/lib/version-status";
import { LevelPill } from "@/components/level-pill";

interface Hit {
  item: MapSummary;
  matches: { field: string; ranges: MatchRange[] }[];
}

interface CategoryHit {
  item: CategoryLite;
  matches: { field: string; ranges: MatchRange[] }[];
}

interface FrameworkSearchGroupsProps {
  hits: Hit[];
  // 카테고리 이름 히트(L1~L5) — 맵 그룹 위 "Categories" 섹션, 클릭=그 카테고리로 드릴다운 이동 (2026-09-21)
  categoryHits?: CategoryHit[];
  categoriesById?: CategoryLite[] | null;
  renderRow: (map: MapSummary, nameRanges: MatchRange[], recentAt: number | undefined) => ReactNode;
  recentAtById: Map<number, number>;
  // 그룹 헤더·캔버스 칩·카테고리 행 클릭 — 그 카테고리를 선택하고 드릴다운을 거기로 옮긴다(page.tsx revealCategory)
  onOpenCategory: (categoryId: number) => void;
  // 증분 렌더 센티널(page.tsx useInfiniteSlice) — 마지막 그룹 아래
  sentinel?: ReactNode;
}

export function FrameworkSearchGroups({
  hits,
  categoryHits = [],
  categoriesById = null,
  renderRow,
  recentAtById,
  onOpenCategory,
  sentinel,
}: FrameworkSearchGroupsProps) {
  const { t } = useI18n();
  const groups = groupHitsByCategory(hits);
  // 조상 이름 경로(루트→부모) — 카테고리 행의 2단
  const liteById = new Map((categoriesById ?? []).map((c) => [c.id, c]));
  const ancestorNames = (c: CategoryLite): string[] => {
    const out: string[] = [];
    let cur = c.parent_id === null ? undefined : liteById.get(c.parent_id);
    while (cur) {
      out.unshift(cur.name);
      cur = cur.parent_id === null ? undefined : liteById.get(cur.parent_id);
    }
    return out;
  };
  return (
    <ul data-id="framework-search-groups" className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
      {categoryHits.length > 0 && (
        <li data-id="framework-search-categories" className="flex flex-col gap-1">
          <span className="px-0.5 text-[10px] font-semibold tracking-wide text-ink-muted">{t("framework.search.categories")}</span>
          <ul className="flex flex-col divide-y divide-divider rounded-sm border border-hairline bg-surface">
            {categoryHits.map(({ item: c, matches }) => {
              const ancestors = ancestorNames(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    data-id={`framework-search-category-${c.id}`}
                    className="group flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-surface-pearl"
                    onClick={() => onOpenCategory(c.id)}
                  >
                    <LevelPill level={c.level} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-caption text-ink">
                        <Highlight text={c.name} ranges={matches.find((m) => m.field === "name")?.ranges ?? []} />
                      </span>
                      {ancestors.length > 0 && (
                        <span className="truncate text-fine text-ink-tertiary" title={ancestors.join(" › ")}>
                          {ancestors.join(" › ")}
                        </span>
                      )}
                    </span>
                    {c.level < 5 && <span className="shrink-0 text-fine text-ink-muted">{t("category.summary.l5Count", { n: c.l5_count })}</span>}
                    <CornerDownRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      )}
      {groups.map((g) => {
        const canvasStatus = g.canvas?.latest_version_status ?? null;
        const tone = canvasStatus ? VERSION_STATUS_TONE[canvasStatus] : null;
        const last = g.path[g.path.length - 1];
        const ancestors = g.path.slice(0, -1);
        return (
          <li key={g.key} data-id={`framework-search-group-${g.key}`} className="flex flex-col gap-1.5">
            {g.categoryId === null ? (
              <div className="flex items-center gap-1.5 rounded-sm border border-dashed border-hairline px-2.5 py-1.5 text-fine text-ink-tertiary">
                <Network size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                {/* Type 필과 같은 영어 고정 표기 */}
                <span className="font-semibold">Not in the framework</span>
                <span className="ml-auto text-ink-muted">{g.rows.length}</span>
              </div>
            ) : (
              <button
                type="button"
                data-id={`framework-search-group-open-${g.categoryId}`}
                title={g.path.join(" › ")}
                className="group flex w-full flex-col gap-0.5 rounded-sm border border-hairline bg-surface-alt px-2.5 py-1.5 text-left transition-colors duration-150 hover:border-accent-tint-border hover:bg-accent-tint/40"
                onClick={() => onOpenCategory(g.categoryId!)}
              >
                {/* 1단 — L5 이름(검색 대상)을 먼저, 한 줄 말줄임에 밀리지 않게 (사용자 지시 2026-09-21) */}
                <span className="flex min-w-0 items-center gap-1.5">
                  <LevelPill level={Math.min(g.path.length, 5)} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-caption-strong text-ink">{last}</span>
                  {g.canvas && (
                    <span
                      data-id={`framework-search-canvas-${g.canvas.id}`}
                      title={g.canvas.name}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${tone?.pill ?? "bg-ink/5 text-ink-tertiary"}`}
                    >
                      <Workflow size={11} strokeWidth={1.7} />
                      {canvasStatus ? VERSION_STATUS_LABEL_EN[canvasStatus] : t("home.l5Canvas")}
                    </span>
                  )}
                  {g.rows.length > 0 && <span className="shrink-0 text-fine text-ink-muted">{g.rows.length}</span>}
                  <CornerDownRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                {/* 2단 — 상위 경로 브레드크럼, 말줄임 대신 최대 2줄 줄바꿈 */}
                {ancestors.length > 0 && (
                  <span
                    data-id="framework-search-group-path"
                    className="line-clamp-2 break-words pl-0.5 text-fine leading-snug text-ink-tertiary"
                  >
                    {ancestors.map((name, i) => (
                      <span key={`${i}-${name}`}>
                        {i > 0 && <ChevronRight size={11} strokeWidth={1.5} className="mx-0.5 inline align-[-1px] text-ink-muted" />}
                        {name}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            )}
            {g.rows.length > 0 && (
              <ul className="flex flex-col gap-2 pl-3">
                {g.rows.map(({ item, matches }) => (
                  <li key={item.id} className="flex flex-col">
                    {renderRow(item, matches.find((m) => m.field === "name")?.ranges ?? [], recentAtById.get(item.id))}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      {sentinel}
    </ul>
  );
}
