// 홈 좌측 상단 — 나의 부서 맵 즐겨찾기(핀). 아코디언과 별개로 빠른 접근.
// 부서 하나 + 그 맵이라는 같은 모양이라 조직도와 동일한 태그·박스 규칙을 쓴다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md R6
"use client";

import { ChevronDown, ChevronRight, Star } from "lucide-react";
import type { ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { CountTag } from "@/components/maps/count-tag";
import { DeptGroupBox } from "@/components/maps/dept-group-box";
import { MapCard } from "@/components/maps/map-card";

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
  if (maps.length === 0) return null;

  const header = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="group flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-surface-alt"
    >
      {open
        ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
        : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
      <Star size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span
        data-id="org-node-name"
        className={`truncate text-fine ${open ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
      >
        {t("home.myDepartment")} — {deptLabel}
      </span>
      {!open && <CountTag count={maps.length} />}
    </button>
  );

  return (
    <section data-id="home-my-dept" className="flex flex-col gap-2">
      {open ? (
        <DeptGroupBox>
          {header}
          <ul className="flex flex-col gap-2">
            {maps.map((m) => (
              <li key={m.id}>
                {renderCard ? renderCard(m) : <MapCard map={m} selected={selectedId === m.id} onSelect={onSelect} />}
              </li>
            ))}
          </ul>
        </DeptGroupBox>
      ) : (
        header
      )}
    </section>
  );
}
