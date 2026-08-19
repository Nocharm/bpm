"use client";

// 내용 높이에 맞춰 늘어나고, 바뀔 때 부드럽게 전환되는 컨테이너.
// 인박스 우측 상세처럼 "카드를 바꾸면 높이가 달라지는" 영역용 — 늘 화면 높이를 채우는 대신
// 실제 내용만큼만 차지하고, 전환은 height 트랜지션으로 잇는다. 첫 측정은 애니메이션 없이 즉시 반영.
// 내용이 가용 높이를 넘으면 maxHeight(호출부 클래스)에 걸려 내부 스크롤로 넘어간다.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function AutoHeight({
  children,
  className,
  dataId,
  /** height 트랜지션 시간(ms) — 토큰 duration-350과 맞춤 */
  durationMs = 350,
}: {
  children: ReactNode;
  className?: string;
  /** 래퍼 식별자 — 높이 애니메이션 대상을 테스트·디버깅에서 특정 */
  dataId?: string;
  durationMs?: number;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // 첫 측정에는 트랜지션을 걸지 않는다 — 마운트 시 0에서 자라 보이는 것 방지
  const measuredRef = useRef(false);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const sync = () => {
      setHeight(el.getBoundingClientRect().height);
      if (!measuredRef.current) {
        measuredRef.current = true;
        // 다음 프레임부터 트랜지션 — 초기 높이는 즉시 적용
        requestAnimationFrame(() => setAnimated(true));
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={className}
      data-id={dataId}
      style={{
        height: height === null ? undefined : height,
        transition: animated ? `height ${durationMs}ms var(--ease-smooth)` : undefined,
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
