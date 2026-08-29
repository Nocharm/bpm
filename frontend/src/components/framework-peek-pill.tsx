"use client";

// SP 노드 업무체계 필 — 일반 맵에서 링크맵이 프레임워크 소속이면 이름 옆 아이콘 필을 달고,
// 3초 호버 시 우상단 칩(FrameworkChip)과 같은 디자인의 팝오버를 드릴인(체인 펼침) 상태로
// 띄운다 (사용자 요청 2026-08-30). 포털 고정 좌표라 캔버스 줌 스케일의 영향을 받지 않는다.
import { FolderTree } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FrameworkChip } from "@/components/framework-chip";

const HOVER_DELAY_MS = 3000; // 사용자 요구 — 3초 호버 후 표시(스침 오픈 방지)

export function FrameworkPeekPill({
  categoryId,
  linkedMapId,
  path,
}: {
  categoryId: number;
  linkedMapId: number;
  path: string;
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

  return (
    <span
      ref={rootRef}
      data-id="node-framework-pill"
      title={path}
      onMouseEnter={() => {
        clearTimer();
        timerRef.current = window.setTimeout(() => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) setPeek({ x: rect.right + 8, y: Math.max(8, rect.top - 4) });
        }, HOVER_DELAY_MS);
      }}
      onMouseLeave={clearTimer}
      className="nodrag nopan shrink-0 rounded-xs border border-hairline bg-surface-alt p-0.5 text-ink-tertiary transition-colors duration-150 hover:border-accent hover:text-accent"
    >
      <FolderTree size={11} strokeWidth={1.5} />
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
