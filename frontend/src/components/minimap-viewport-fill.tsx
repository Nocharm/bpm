"use client";

// React Flow MiniMap + 현재 뷰포트 영역을 반투명 악센트로 '채우는' 오버레이(MiniMapViewportFill).
// MinimapFade가 둘 다 렌더하며, 줌아웃으로 미니맵이 무의미해지면(뷰포트가 콘텐츠를 통째로 덮음) 페이드.
// opacity를 래핑 div가 아니라 각 Panel(이미 position:absolute + 패널 z-index)에 직접 줘서
// 스태킹 컨텍스트를 새로 만들지 않는다 → 미니맵이 노드/캔버스 위에 유지되고 클릭(시점 이동)도 유효.
import {
  MiniMap,
  Panel,
  useNodes,
  useReactFlow,
  useStore,
  useViewport,
} from "@xyflow/react";

import { type AppNode } from "@/lib/canvas";

const MM_W = 200; // MiniMap defaultWidth
const MM_H = 150; // MiniMap defaultHeight
const OFFSET_SCALE = 5; // MiniMap offsetScale 기본값

// 페이드 임계값 — 채움비 r = min(vp.w/vbW, vp.h/vbH).
// r=1 이면 뷰포트 rect가 미니맵을 정확히 꽉 채움. 가득 차자마자 사라지지 않게
// FADE_START까지 마진을 두고 최대 불투명도(MAX_OPACITY) 유지, FADE_END에서 완전히 사라진다(클릭 비활성).
const MAX_OPACITY = 0.65; // 미니맵 최대 불투명도 — 켜져 있어도 뒤쪽 노드가 비치도록 반투명 상한
const FADE_START = 1.2; // 이 채움비까지는 최대 불투명도 유지(마진)
const FADE_END = 2.0; // 이 채움비 이상이면 완전 투명
const HIDDEN_EPS = 0.02; // opacity가 이 값 이하면 pointer-events 차단

// 현재 채움비를 기반으로 미니맵 opacity(1→0)를 계산. nodes/viewport 훅을 쓰므로
// 반드시 ReactFlow 컨텍스트 안에서 호출해야 한다.
function useMinimapFadeOpacity(): number {
  const nodes = useNodes();
  const { getNodesBounds } = useReactFlow();
  const { zoom } = useViewport();
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);

  if (nodes.length === 0 || zoom <= 0) return MAX_OPACITY;

  const b = getNodesBounds(nodes);
  if (b.width <= 0 || b.height <= 0) return MAX_OPACITY;

  const viewScale = Math.max(b.width / MM_W, b.height / MM_H);
  const offset = OFFSET_SCALE * viewScale;
  const vbW = viewScale * MM_W + offset * 2;
  const vbH = viewScale * MM_H + offset * 2;

  const r = Math.min(paneW / zoom / vbW, paneH / zoom / vbH);
  if (r <= FADE_START) return MAX_OPACITY;
  if (r >= FADE_END) return 0;
  return MAX_OPACITY * (1 - (r - FADE_START) / (FADE_END - FADE_START));
}

// MiniMap + 뷰포트 채움 오버레이를 함께 렌더하며 채움비에 따라 페이드.
// opacity/z-index를 각 Panel에 직접 적용(래핑 div 없음) → 미니맵이 노드/캔버스 위 패널 레이어를 유지하고
// 클릭(시점 이동)도 유효. 완전 페이드 시에만 pointer-events 차단.
export function MinimapFade({ nodeColor }: { nodeColor: (node: AppNode) => string }) {
  const opacity = useMinimapFadeOpacity();
  const hidden = opacity <= HIDDEN_EPS;
  return (
    <>
      <MiniMap<AppNode>
        position="bottom-left"
        pannable
        zoomable
        bgColor="var(--color-surface)"
        nodeColor={nodeColor}
        maskColor="transparent"
        className="rounded-sm border border-hairline shadow-md transition-opacity duration-350 ease-smooth"
        style={{ opacity, zIndex: 20, pointerEvents: hidden ? "none" : undefined }}
      />
      {/* 뷰포트 영역 채움 — MiniMap과 동일 좌표계 오버레이(같은 z, DOM 뒤라 미니맵 위에 얹힘) */}
      <MiniMapViewportFill opacity={opacity} />
    </>
  );
}

export function MiniMapViewportFill({ opacity = 1 }: { opacity?: number }) {
  const nodes = useNodes();
  const { getNodesBounds } = useReactFlow();
  const { x: tx, y: ty, zoom } = useViewport();
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);

  if (nodes.length === 0 || zoom <= 0) return null;

  // MiniMap과 동일한 viewBox 계산(boundingRect → viewScale → offset).
  // getNodesBounds는 훅 버전 — 서브플로우 nodeLookup 반영(standalone 경고 회피).
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
    <Panel
      position="bottom-left"
      className="pointer-events-none transition-opacity duration-350 ease-smooth"
      style={{ opacity, zIndex: 20 }}
    >
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
