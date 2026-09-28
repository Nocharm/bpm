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

// 행이 붙일 핸들러·표식 여부 — 표식은 다른 행이 같은 맵을 가리킬 때만 켜진다. 마우스가 올라간 행 자신은 :hover 배경이
// 담당하므로 제외한다(자기 행에도 표식이 붙으면 포인터 위치와 헷갈린다, 사용자 지시 2026-09-28).
export function useHoverMap(mapId: number): {
  linked: boolean;
  handlers: { onMouseEnter: () => void; onMouseLeave: () => void };
} {
  const { hovered, setHovered } = useContext(HoverMapContext);
  const [self, setSelf] = useState(false);
  return {
    linked: hovered === mapId && !self,
    handlers: {
      onMouseEnter: () => { setSelf(true); setHovered(mapId); },
      onMouseLeave: () => { setSelf(false); setHovered(null); },
    },
  };
}

// 연동 표식 클래스 — 배경 대신 좌측 2px 액센트 바(inset box-shadow, 레이아웃 무변화). 배경 톤(alt)은 호버 배경(pearl)과
// 같은 계열이라 어느 행에 마우스가 있는지 구분되지 않았다(사용자 지시 2026-09-28).
// 켜질 때만 500ms 지연 — 스쳐 가는 호버에는 안 떠서 시선을 끌지 않고, 다른 섹션에서 찾으려고 머무를 때만 뜬다. 지연 클래스는
// linked일 때만 붙으므로 꺼질 땐 즉시 사라진다. 열기 버튼의 의도 판정(300ms)보다 한 단계 뒤(사용자 지시 2026-09-28).
export const HOVER_LINKED_CLASS = "shadow-[inset_2px_0_0_var(--color-accent)] delay-500";
