// 홈 좌측 상단 — 나의 부서 맵 즐겨찾기(핀). 아코디언과 별개로 빠른 접근.
// 부서 하나 + 그 맵이라는 같은 모양이라 조직도와 동일한 태그·박스·클램프·스티키 헤더 규칙을 쓴다.
// 설계: 2026-08-04-home-dept-list-revision-design.md R6
"use client";

import { ChevronDown, ChevronRight, Star } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useClosingKeys } from "@/lib/use-closing-keys";
import { CLAMP_VISIBLE, ClampedList } from "@/components/maps/clamped-list";
import { CountTag } from "@/components/maps/count-tag";
import { DeptGroupBox } from "@/components/maps/dept-group-box";
import { MapCard } from "@/components/maps/map-card";
import { StickyBoxHeader } from "@/components/maps/sticky-box-header";

// 리스트 "전체 펼치기" 영속 키 — 단일 리스트라 boolean 블롭(부서 목록의 bpm.home.deptListExpand와 동형 규칙).
const FAV_LIST_EXPAND_KEY = "bpm.home.favListExpand";
// 섹션이 하나뿐이라 접힘/애니메이션 키도 하나 — 조직도의 부서 path 자리.
const FAV_SECTION_KEY = "fav";

interface MyDeptFavoritesProps {
  maps: MapSummary[];
  deptLabel: string;
  open: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  // 좁은 화면(<split)에서도 상세를 볼 수 있도록 카드 렌더를 페이지에 위임 — 미지정 시 bare MapCard로 폴백.
  // Delegates card render to the page so narrow screens keep an inline detail accordion — falls back to bare MapCard.
  renderCard?: (map: MapSummary) => ReactNode;
}

export function MyDeptFavorites({ maps, deptLabel, open, onToggle, selectedId, onSelect, renderCard }: MyDeptFavoritesProps) {
  const { t } = useI18n();

  // 리스트 "전체 펼치기" 상태 — localStorage 복원으로 뒤로가기/새로고침에도 유지.
  const [listExpanded, setListExpanded] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAV_LIST_EXPAND_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { expanded?: unknown };
      if (s.expanded === true) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setListExpanded(true); // one-time hydration
      }
    } catch {
      /* 손상된 저장값 무시 */
    }
  }, []);
  const toggleListExpand = () => {
    const next = !listExpanded;
    setListExpanded(next);
    window.localStorage.setItem(FAV_LIST_EXPAND_KEY, JSON.stringify({ expanded: next }));
  };

  // 섹션 접힘 애니메이션 — 상태는 즉시 커밋, 고스트 렌더로 accordion-close만 재생 후 언마운트.
  const { closingKeys, beginClose, cancelClose, getSectionClass } = useClosingKeys<string>();

  if (maps.length === 0) return null;

  const isClosing = closingKeys.has(FAV_SECTION_KEY);
  const header = (
    <button
      type="button"
      data-id="my-dept-toggle"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        if (open) beginClose(FAV_SECTION_KEY);
        else cancelClose(FAV_SECTION_KEY);
        onToggle();
      }}
      className="group flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-divider"
    >
      {open
        ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
        : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
      <Star size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span
        data-id="org-node-name"
        className={`truncate text-fine ${open ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
      >
        {t("home.myDepartment")} - {deptLabel}
      </span>
      {!open && <CountTag count={maps.length} />}
    </button>
  );

  return (
    <section data-id="home-my-dept" className="flex flex-col gap-2">
      {(open || isClosing) ? (
        <DeptGroupBox>
          <StickyBoxHeader
            showCollapse={maps.length > CLAMP_VISIBLE && listExpanded}
            onCollapse={toggleListExpand}
            dataId="my-dept-list-collapse"
          >
            {header}
          </StickyBoxHeader>
          {/* accordion-open/close — 펼침·접힘 높이 애니메이션(globals.css). 인셋은 pl-5 pr-2
              고정값(depth 파생 아님) — 조직도 카드 리스트와 동일 상수라야 폭이 일치한다 */}
          <div className={getSectionClass(FAV_SECTION_KEY)}>
            <ClampedList
              count={maps.length}
              expanded={listExpanded}
              onToggle={toggleListExpand}
              dataId="my-dept-list-expand"
            >
              <ul className="flex flex-col gap-2 pl-5 pr-2">
                {maps.map((m) => (
                  <li key={m.id}>
                    {renderCard ? renderCard(m) : <MapCard map={m} selected={selectedId === m.id} onSelect={onSelect} />}
                  </li>
                ))}
              </ul>
            </ClampedList>
          </div>
        </DeptGroupBox>
      ) : (
        header
      )}
    </section>
  );
}
