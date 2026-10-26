// 고아 참조 카드 섹션 — 머리(아이콘·제목·개수·검색)와 카드 그리드를 최대 3줄씩 쪽으로 나눠 보인다. 고아 참조 페이지의 부서·사용자 두 섹션이 쓴다.
// 그리드는 items-stretch가 필요하다 - 비율(aspect-ratio) 카드는 기본 정렬이 start라 한 행에서 긴 카드만 자란다.
"use client";

import { Building2, Search, UserX, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Pagination } from "@/components/pagination";
import { RefDeptCard } from "@/components/ref-audit/ref-dept-card";
import { RefUserCard } from "@/components/ref-audit/ref-user-card";
import type { RefCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { REF_GRID_ROWS, filterRefCards, getGridColumns, getPageSlice } from "@/lib/ref-audit-view";

// 그리드 칸 간격(gap-3) — 열 수 계산이 CSS와 같은 값을 써야 한 쪽이 정확히 3줄로 찬다
const GRID_GAP = 12;

interface SectionMeta {
  dataId: string;
  icon: LucideIcon;
  round: boolean;
  titleKey: MessageKey;
  subKey: MessageKey;
  searchKey: MessageKey;
  minCardWidth: number; // 카드 최소 폭 — 그리드 minmax와 열 수 계산이 같이 쓴다
  gridClass: string;
}

const SECTION_META: Record<RefCard["kind"], SectionMeta> = {
  dept: {
    dataId: "ref-audit-depts",
    icon: Building2,
    round: false,
    titleKey: "refAudit.section.depts.title",
    subKey: "refAudit.section.depts.sub",
    searchKey: "refAudit.search.depts",
    minCardWidth: 196,
    gridClass: "grid-cols-[repeat(auto-fill,minmax(196px,1fr))]",
  },
  user: {
    dataId: "ref-audit-users",
    icon: UserX,
    round: true,
    titleKey: "refAudit.section.users.title",
    subKey: "refAudit.section.users.sub",
    searchKey: "refAudit.search.users",
    minCardWidth: 128,
    gridClass: "grid-cols-[repeat(auto-fill,minmax(128px,1fr))]",
  },
};

interface RefCardSectionProps {
  kind: RefCard["kind"];
  cards: RefCard[]; // 정렬된 전체 카드 — 검색·쪽 나눔은 이 섹션이 한다
  onOpen: (card: RefCard) => void;
}

export function RefCardSection({ kind, cards, onOpen }: RefCardSectionProps) {
  const { t } = useI18n();
  const meta = SECTION_META[kind];
  const Icon = meta.icon;
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [bodyWidth, setBodyWidth] = useState(0);
  // 항상 그려지는 본문 래퍼를 잰다 - 그리드는 카드·검색 결과가 없으면 사라진다
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(([entry]) => setBodyWidth(entry.contentRect.width));
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const matches = filterRefCards(cards, query);
  const pageSize = getGridColumns(bodyWidth, meta.minCardWidth, GRID_GAP) * REF_GRID_ROWS;
  const slice = getPageSlice(matches, page, pageSize);
  const isSearching = query.trim() !== "";

  function handleQueryChange(next: string) {
    setQuery(next);
    setPage(1);
  }

  let grid;
  if (cards.length === 0) {
    grid = (
      <p data-id={`${meta.dataId}-none`} className="py-4 text-center text-caption text-ink-tertiary">
        {t("refAudit.section.none")}
      </p>
    );
  } else if (matches.length === 0) {
    grid = (
      <p data-id={`${meta.dataId}-no-match`} className="py-4 text-center text-caption text-ink-tertiary">
        {t("refAudit.search.none")}
      </p>
    );
  } else {
    grid = (
      <div className={`grid ${meta.gridClass} items-stretch gap-3`}>
        {slice.items.map((card) =>
          kind === "dept" ? (
            <RefDeptCard key={card.key} card={card} onOpen={onOpen} />
          ) : (
            <RefUserCard key={card.key} card={card} onOpen={onOpen} />
          ),
        )}
      </div>
    );
  }

  return (
    <section
      data-id={meta.dataId}
      className="@container/section flex min-w-0 flex-col gap-3.5 rounded-lg border border-hairline bg-surface-pearl px-[18px] pb-[18px] pt-4"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={`grid size-9 shrink-0 place-items-center border border-warn/40 bg-warn/10 text-warn ${meta.round ? "rounded-full" : "rounded-sm"}`}
        >
          <Icon size={18} strokeWidth={1.5} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-body-strong text-ink">
            {t(meta.titleKey)}
            <span
              data-id={`${meta.dataId}-count`}
              className="rounded-full border border-hairline bg-surface px-2 text-fine font-normal leading-5 tabular-nums text-ink-tertiary"
            >
              {isSearching ? `${matches.length} / ${cards.length}` : cards.length}
            </span>
          </span>
          <span className="text-fine text-ink-tertiary">{t(meta.subKey)}</span>
        </span>
        {cards.length > 0 ? (
          <label className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 text-caption text-ink focus-within:border-accent-tint-border @[400px]/section:w-44 @[600px]/section:w-52">
            <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" aria-hidden />
            <input
              data-id={`${meta.dataId}-search`}
              type="search"
              value={query}
              aria-label={t(meta.searchKey)}
              placeholder={t(meta.searchKey)}
              onChange={(event) => handleQueryChange(event.target.value)}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                data-id={`${meta.dataId}-search-clear`}
                aria-label={t("refAudit.search.clear")}
                onClick={() => handleQueryChange("")}
                className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
              >
                <X size={12} strokeWidth={1.5} aria-hidden />
              </button>
            ) : null}
          </label>
        ) : null}
      </header>
      <div ref={bodyRef} className="flex min-w-0 flex-col gap-3">
        {grid}
        <Pagination
          dataId={`${meta.dataId}-pager`}
          total={matches.length}
          pageSize={pageSize}
          page={slice.page}
          onPage={setPage}
        />
      </div>
    </section>
  );
}
