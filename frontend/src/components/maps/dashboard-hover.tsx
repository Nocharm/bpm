// 홈 대시보드 맵 호버 연동 — 한 섹션의 맵 행에 마우스를 올리면 다른 섹션에 있는 같은 맵의 행도 함께 강조된다
// (사용자 지시 2026-09-11). HomeDashboard가 Provider, 맵 행·이벤트 행·결재 행·점유 목록이 훅으로 읽고 쓴다.
"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface HoverMapValue {
  hovered: number | null; // 마우스가 올라간 맵 id
  setHovered: (id: number | null) => void;
}

const HoverMapContext = createContext<HoverMapValue>({ hovered: null, setHovered: () => {} });

export function HoverMapProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return <HoverMapContext.Provider value={{ hovered, setHovered }}>{children}</HoverMapContext.Provider>;
}

// 행이 붙일 핸들러·강조 여부 — 강조는 다른 행이 같은 맵을 가리킬 때도 켜진다(자기 행은 :hover가 이미 담당)
export function useHoverMap(mapId: number): {
  linked: boolean;
  handlers: { onMouseEnter: () => void; onMouseLeave: () => void };
} {
  const { hovered, setHovered } = useContext(HoverMapContext);
  return {
    linked: hovered === mapId,
    handlers: {
      onMouseEnter: () => setHovered(mapId),
      onMouseLeave: () => setHovered(null),
    },
  };
}

// 연동 강조 클래스 — 행의 :hover(pearl)보다 한 단계 진한 톤(실측: pearl은 흰 바탕에서 거의 안 보였다)
export const HOVER_LINKED_CLASS = "bg-surface-alt";
