"use client";

// 업무체계 드릴인 피크 — 우상단 칩(FrameworkChip) 디자인을 노드 안 트리거에서 재활용하는 팝오버.
// 트리거는 범용(FrameworkPeekTrigger): 클릭 즉시 오픈 + (옵션) 지연 호버 오픈. 포털 고정
// 좌표라 캔버스 줌 스케일의 영향을 받지 않는다 (2026-08-30, 출처 배지 재사용을 위해 분리).
import { FolderTree } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { FrameworkChip } from "@/components/framework-chip";

const HOVER_DELAY_MS = 3000; // 스침 오픈 방지 — 클릭은 즉시 오픈

export function FrameworkPeekTrigger({
  categoryId,
  linkedMapId,
  title,
  dataId,
  className,
  style,
  hoverDelayMs = null,
  children,
}: {
  categoryId: number;
  linkedMapId: number;
  title: string;
  dataId: string;
  className: string;
  style?: CSSProperties;
  // null=클릭 전용, 숫자면 해당 ms 호버로도 오픈
  hoverDelayMs?: number | null;
  children: ReactNode;
}) {
  const [peek, setPeek] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }
  useEffect(() => clearTimer, []);

  // 바깥 클릭 닫기 — FrameworkChip 플라이아웃과 동일 캡처 패턴
  useEffect(() => {
    if (peek === null) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        !panelRef.current?.contains(event.target) &&
        !rootRef.current?.contains(event.target)
      ) {
        setPeek(null);
      }
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => window.removeEventListener("mousedown", handleMouseDown, true);
  }, [peek]);

  function openPeek() {
    clearTimer();
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setPeek({ x: rect.right + 8, y: Math.max(8, rect.top - 4) });
  }

  return (
    <span
      ref={rootRef}
      data-id={dataId}
      title={title}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        if (peek !== null) setPeek(null);
        else openPeek();
      }}
      onMouseEnter={() => {
        if (hoverDelayMs === null) return;
        clearTimer();
        timerRef.current = window.setTimeout(openPeek, hoverDelayMs);
      }}
      onMouseLeave={clearTimer}
      className={className}
    >
      {children}
      {peek !== null &&
        createPortal(
          <div
            ref={panelRef}
            data-id="node-framework-peek"
            style={{ left: peek.x, top: peek.y }}
            className="fixed z-[1250]"
            onMouseLeave={() => setPeek(null)}
          >
            {/* 링크맵 기준 체인 — mapId=링크맵이라 플라이아웃에서 해당 맵이 현재로 하이라이트된다 */}
            <FrameworkChip mapId={linkedMapId} categoryId={categoryId} defaultOpen floating={false} />
          </div>,
          document.body,
        )}
    </span>
  );
}

// SP 노드 업무체계 필 — 일반 맵에서 링크맵이 프레임워크 소속이면 이름 첫 줄 옆 아이콘.
// 배경 없는 아이콘, 호버 시에만 배경·3초 호버 또는 클릭으로 피크 (사용자 요청 2026-08-30)
export function FrameworkPeekPill({
  categoryId,
  linkedMapId,
  path,
}: {
  categoryId: number;
  linkedMapId: number;
  path: string;
}) {
  return (
    <FrameworkPeekTrigger
      dataId="node-framework-pill"
      categoryId={categoryId}
      linkedMapId={linkedMapId}
      title={path}
      hoverDelayMs={HOVER_DELAY_MS}
      className="nodrag nopan mt-0.5 shrink-0 cursor-pointer self-start rounded-xs p-0.5 text-ink-tertiary transition-colors duration-150 hover:bg-surface-alt hover:text-accent"
    >
      <FolderTree size={12} strokeWidth={1.5} />
    </FrameworkPeekTrigger>
  );
}
