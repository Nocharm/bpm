"use client";

// 등장·퇴장 쉬머 래퍼 — show가 켜지면 빛띠와 함께 나타나고(.shimmer-in), 꺼지면 빛띠와 함께 사라진 뒤 언마운트한다
// (.shimmer-out의 animationend). 첫 마운트는 정적으로 그려 창을 열자마자 우르르 재생되지 않게 한다.
// PNG 내보내기 옵션 창(png-export-modal) 미리보기·옵션 행이 쓴다. 키프레임은 globals.css shimmer-presence-*.

import { useState, type CSSProperties, type ReactNode } from "react";

interface ShimmerPresenceProps {
  show: boolean;
  // 위치·모양 클래스 — position(relative·absolute)이 있어야 빛띠가 제자리에 깔린다
  className?: string;
  style?: CSSProperties;
  dataId?: string;
  children: ReactNode;
}

export function ShimmerPresence({ show, className = "", style, dataId, children }: ShimmerPresenceProps) {
  const [rendered, setRendered] = useState(show);
  const [prevShow, setPrevShow] = useState(show);
  const [animated, setAnimated] = useState(false);
  // 렌더 중 상태 보정 — show가 바뀐 그 렌더에서 마운트·애니메이션 시작을 정한다(effect 대신)
  if (show !== prevShow) {
    setPrevShow(show);
    setAnimated(true);
    if (show) setRendered(true);
  }
  if (!rendered) return null;
  const motion = !show ? "shimmer-out" : animated ? "shimmer-in" : "";
  return (
    <div
      data-id={dataId}
      className={`${className} ${motion}`}
      style={style}
      onAnimationEnd={(event) => {
        // 빛띠(::after)의 sweep 종료는 무시 — 자기 퇴장 애니메이션이 끝났을 때만 걷는다
        if (event.target === event.currentTarget && event.animationName === "shimmer-presence-out") {
          setRendered(false);
        }
      }}
    >
      {children}
    </div>
  );
}
