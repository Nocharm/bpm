// 홈 좌측 상단 — 나의 부서 맵 즐겨찾기(핀). 아코디언과 별개로 빠른 접근.
"use client";

import { ChevronDown, ChevronRight, Star } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { MapCard } from "@/components/maps/map-card";

interface MyDeptFavoritesProps {
  maps: MapSummary[];
  deptLabel: string;
  open: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function MyDeptFavorites({ maps, deptLabel, open, onToggle, selectedId, onSelect }: MyDeptFavoritesProps) {
  const { t } = useI18n();
  if (maps.length === 0) return null;
  return (
    <section data-id="home-my-dept" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="group flex items-center gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-surface-alt"
      >
        {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        <Star size={14} strokeWidth={1.5} className="text-accent" />
        <span className="text-fine text-ink-secondary">{t("home.myDepartment")} — {deptLabel}</span>
        <span className="ml-auto text-fine text-ink-tertiary">({maps.length})</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 pl-1">
          {maps.map((m) => (
            <li key={m.id}>
              <MapCard map={m} selected={selectedId === m.id} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
