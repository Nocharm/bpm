"use client";

// 캔버스 좌측 줌 인디케이터 — 현재 확대/축소 레벨을 세로 눈금 바로 표시(읽기 전용).
// xyflow 줌 스텝이 곱셈(~1.2배)이라 로그 스케일로 위치를 잡아야 체감과 맞는다.
import { useViewport } from "@xyflow/react";

const MIN_ZOOM = 0.2; // ReactFlow minZoom prop과 일치
const MAX_ZOOM = 2; // ReactFlow 기본 maxZoom
const TICKS = [2, 1.5, 1, 0.5, 0.2]; // 눈금 위치(줌 배율)

function ratioOf(zoom: number): number {
  const r = (Math.log(zoom) - Math.log(MIN_ZOOM)) / (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM));
  return Math.min(1, Math.max(0, r));
}

export function CanvasZoomScale() {
  const { zoom } = useViewport();
  const ratio = ratioOf(zoom);
  return (
    <div className="pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 select-none flex-col items-center gap-1.5">
      <span className="rounded-xs bg-surface/90 px-1.5 py-0.5 text-fine text-ink-secondary shadow-sm">
        {Math.round(zoom * 100)}%
      </span>
      <div className="relative h-[clamp(120px,38vh,240px)] w-1 rounded-full bg-surface-alt shadow-sm">
        {/* 현재 줌까지 채움 — 아래=축소, 위=확대 */}
        <div
          className="absolute inset-x-0 bottom-0 rounded-full bg-accent"
          style={{ height: `${ratio * 100}%` }}
        />
        {/* 눈금 — 바 우측 짧은 선 */}
        {TICKS.map((z) => (
          <span
            key={z}
            className="absolute left-full ml-1 h-px w-1.5 -translate-y-1/2 bg-divider"
            style={{ bottom: `${ratioOf(z) * 100}%` }}
          />
        ))}
        {/* 현재 위치 마커 */}
        <div
          className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-sm"
          style={{ bottom: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
