// 대시보드 버튼 행(결재·점유·최근 변경) — 맵 호버 연동이 붙은 <button>. 같은 맵을 가리키는 다른 행이 호버되면 함께 강조.
// 클릭(카드 선택)은 0.6초 지연 실행 — 행 틴트 + 바깥 섹션이 레이어로 덮이며 pendingLabel을 띄운다(레이어 클릭 = 취소).
"use client";

import type { ReactNode } from "react";

import { useDelayedNav } from "@/lib/use-delayed-nav";
import { HOVER_LINKED_CLASS, useHoverMap } from "@/components/maps/dashboard-hover";

interface HoverLinkedRowProps {
  mapId: number;
  onClick: () => void;
  pendingLabel: string; // 대기 중 섹션 레이어 문구("Selecting {map}" 등)
  className: string; // 레이아웃 클래스 — 호버·연동 배경은 여기서 덧붙인다
  dataId?: string;
  extraData?: Record<string, string | undefined>; // data-* 부가 속성(이벤트 유형 등)
  leading?: ReactNode; // 선두 아이콘(14px)
  children: ReactNode;
}

export function HoverLinkedRow({ mapId, onClick, pendingLabel, className, dataId, extraData, leading, children }: HoverLinkedRowProps) {
  const { linked, handlers } = useHoverMap(mapId);
  const { pending, toggleAction } = useDelayedNav();
  // 같은 맵을 가리키는 행이 섹션마다 있어 키에 행 식별자를 섞는다 — 클릭한 행만 틴트
  const key = `select:${dataId ?? "row"}:${mapId}`;
  const selecting = pending === key;
  return (
    <button
      type="button"
      data-id={dataId}
      data-map-id={mapId}
      data-linked={linked || undefined}
      data-selecting={selecting || undefined}
      {...extraData}
      onClick={(e) => { e.stopPropagation(); toggleAction(key, onClick, pendingLabel); }}
      {...handlers}
      className={`${className} transition-colors duration-150 hover:bg-surface-pearl ${
        selecting ? "bg-accent-tint/40" : linked ? HOVER_LINKED_CLASS : ""
      }`}
    >
      {leading}
      {children}
    </button>
  );
}
