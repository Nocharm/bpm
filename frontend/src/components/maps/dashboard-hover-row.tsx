// 대시보드 버튼 행(결재·점유·최근 변경) — 맵 호버 연동이 붙은 <button>. 같은 맵을 가리키는 다른 행이 호버되면 함께 강조.
// 클릭(카드 선택)은 0.6초 지연 실행 — 좌측 가장자리에 링, 행 틴트, 다시 클릭하면 취소(맵 행과 같은 규칙).
"use client";

import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { HOVER_LINKED_CLASS, useHoverMap } from "@/components/maps/dashboard-hover";
import { NavRing } from "@/components/nav-ring";

interface HoverLinkedRowProps {
  mapId: number;
  onClick: () => void;
  className: string; // 레이아웃 클래스 — 호버·연동 배경은 여기서 덧붙인다
  dataId?: string;
  extraData?: Record<string, string | undefined>; // data-* 부가 속성(이벤트 유형 등)
  children: ReactNode;
}

export function HoverLinkedRow({ mapId, onClick, className, dataId, extraData, children }: HoverLinkedRowProps) {
  const { t } = useI18n();
  const { linked, handlers } = useHoverMap(mapId);
  const { pending, toggleAction } = useDelayedNav();
  // 같은 맵을 가리키는 행이 섹션마다 있어 키에 행 식별자를 섞는다 — 클릭한 행만 링
  const key = `select:${dataId ?? "row"}:${mapId}`;
  const selecting = pending === key;
  return (
    <button
      type="button"
      data-id={dataId}
      data-map-id={mapId}
      data-linked={linked || undefined}
      data-selecting={selecting || undefined}
      title={selecting ? t("home.dash.navCancel") : undefined}
      {...extraData}
      onClick={(e) => { e.stopPropagation(); toggleAction(key, onClick); }}
      {...handlers}
      className={`${className} relative transition-colors duration-150 hover:bg-surface-pearl ${
        selecting ? "bg-accent-tint/40" : linked ? HOVER_LINKED_CLASS : ""
      }`}
    >
      {selecting && (
        <span className="pointer-events-none absolute top-1/2 left-[2px] -translate-y-1/2">
          <NavRing size={8} />
        </span>
      )}
      {children}
    </button>
  );
}
