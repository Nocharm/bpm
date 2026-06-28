"use client";

// React Flow MiniMap의 현재 뷰포트 영역을 반투명 악센트로 '채우는' 오버레이.
// MiniMap은 전달된 children을 svg에 렌더하지 않으므로, 동일 좌표계(viewBox)를 가진
// 별도 Panel을 같은 위치에 겹쳐 그린다 — 좌표 계산이 MiniMap과 동일해 정렬된다.
import {
  getNodesBounds,
  Panel,
  useNodes,
  useStore,
  useViewport,
} from "@xyflow/react";

const MM_W = 200; // MiniMap defaultWidth
const MM_H = 150; // MiniMap defaultHeight
const OFFSET_SCALE = 5; // MiniMap offsetScale 기본값

export function MiniMapViewportFill() {
  const nodes = useNodes();
  const { x: tx, y: ty, zoom } = useViewport();
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);

  if (nodes.length === 0 || zoom <= 0) return null;

  // MiniMap과 동일한 viewBox 계산(boundingRect → viewScale → offset).
  const b = getNodesBounds(nodes);
  if (b.width <= 0 || b.height <= 0) return null;
  const viewScale = Math.max(b.width / MM_W, b.height / MM_H);
  const viewWidth = viewScale * MM_W;
  const viewHeight = viewScale * MM_H;
  const offset = OFFSET_SCALE * viewScale;
  const vbX = b.x - (viewWidth - b.width) / 2 - offset;
  const vbY = b.y - (viewHeight - b.height) / 2 - offset;
  const vbW = viewWidth + offset * 2;
  const vbH = viewHeight + offset * 2;

  // 현재 보이는 영역(viewport)을 flow 좌표로.
  const vp = { x: -tx / zoom, y: -ty / zoom, w: paneW / zoom, h: paneH / zoom };

  return (
    <Panel position="bottom-left" className="pointer-events-none">
      <svg width={MM_W} height={MM_H} viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}>
        <rect
          x={vp.x}
          y={vp.y}
          width={vp.w}
          height={vp.h}
          rx={offset}
          fill="color-mix(in srgb, var(--color-accent) 20%, transparent)"
          stroke="var(--color-accent)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Panel>
  );
}
