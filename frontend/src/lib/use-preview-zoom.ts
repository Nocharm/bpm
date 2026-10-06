// 경량 SVG 프리뷰(ScopePreview) 줌 — 라이브러리 피크·임포트 리포트·캠페인 태스크 패널이 공유한다.
// 첫 배율은 "process 노드가 PREVIEW_TARGET_NODE_PX로 보이는 크기"(창 맞춤 1배 하한) — 30노드 L6도 창 맞춤이면
// 글자가 안 읽혀 이 배율에서 시작하고, 시작 노드가 왼쪽·세로 중앙에 오도록 스크롤한다(LR 흐름은 시작부터 읽는다).
// viewBox는 ScopePreview와 같은 출처(lib/preview-geometry)라 여백 차이로 배율이 어긋나지 않는다.

import { useLayoutEffect, useMemo, useState } from "react";

import type { VersionGraph } from "@/lib/api";
import { NODE_HEIGHT } from "@/lib/canvas";
import { buildPreviewScene, type PreviewViewBox } from "@/lib/preview-geometry";

export const PREVIEW_ZOOM_MIN = 1; // 1=창 맞춤 — 그보다 축소하면 더 안 읽힌다
export const PREVIEW_ZOOM_MAX = 6; // 분기가 여러 줄인 큰 흐름도 노드가 읽히는 배율까지
export const PREVIEW_ZOOM_STEP = 0.25;
export const PREVIEW_TARGET_NODE_PX = 44; // 첫 배율에서 process 노드가 보이는 높이(px, 사용자 결정 2026-09-08)
const START_LEFT_GAP = 16; // 시작 노드 왼쪽에 남기는 여백(px)

interface PaneSize {
  width: number;
  height: number;
}

function clampZoom(value: number): number {
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(value * 100) / 100));
}

/** process 노드가 targetPx 높이로 보이는 배율 — meet 정렬(가로·세로 중 작은 쪽) 기준, 0.25 단위로 반올림해 클램프 */
export function computePreviewFitZoom(viewBox: PreviewViewBox, pane: PaneSize, targetPx = PREVIEW_TARGET_NODE_PX): number {
  const scaleAtOne = Math.min(pane.width / viewBox.w, pane.height / viewBox.h);
  if (!(scaleAtOne > 0)) return PREVIEW_ZOOM_MIN;
  const target = targetPx / (NODE_HEIGHT * scaleAtOne);
  return clampZoom(Math.round(target / PREVIEW_ZOOM_STEP) * PREVIEW_ZOOM_STEP);
}

/** 시작 노드가 왼쪽(여백 16px)·세로 중앙에 오는 스크롤 위치 — SVG는 창의 zoom배, meet 정렬의 가운데 여백 포함 */
export function computePreviewStartScroll(
  viewBox: PreviewViewBox,
  pane: PaneSize,
  zoom: number,
  start: { x: number; cy: number },
): { left: number; top: number } {
  const svgW = pane.width * zoom;
  const svgH = pane.height * zoom;
  const scale = Math.min(svgW / viewBox.w, svgH / viewBox.h);
  const offsetX = (svgW - viewBox.w * scale) / 2;
  const offsetY = (svgH - viewBox.h * scale) / 2;
  return {
    left: Math.max(0, offsetX + (start.x - viewBox.x) * scale - START_LEFT_GAP),
    top: Math.max(0, offsetY + (start.cy - viewBox.y) * scale - pane.height / 2),
  };
}

/**
 * 프리뷰 줌 상태 — paneRef를 ScopePreview를 감싼 컨테이너에 단다(크기 측정·첫 스크롤 대상).
 * 사용자가 바꾼 배율은 그래프별로 기억하고, 그래프가 바뀌면 첫 배율로 돌아간다(이펙트 없이 identity로 파생).
 */
export function usePreviewZoom(graph: VersionGraph | null) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [paneSize, setPaneSize] = useState<PaneSize | null>(null);
  const [manual, setManual] = useState<{ graph: VersionGraph | null; zoom: number } | null>(null);
  const scene = useMemo(() => buildPreviewScene(graph, null), [graph]);

  // 컨테이너 크기 — 피크 폭·캠페인 패널 높이가 달라도 같은 노드 크기로 시작하게 실측한다
  useLayoutEffect(() => {
    if (container === null) return;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      setPaneSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const fitZoom = scene && paneSize ? computePreviewFitZoom(scene.viewBox, paneSize) : PREVIEW_ZOOM_MIN;
  const isFit = manual === null || manual.graph !== graph;
  const zoom = isFit ? fitZoom : manual.zoom;

  // 첫 배율(또는 맞춤 버튼)일 때 시작 노드로 — ScopePreview의 배율 기준점 보정(자식 레이아웃 이펙트) 뒤에 덮어쓴다
  useLayoutEffect(() => {
    if (!isFit || container === null || scene === null || paneSize === null) return;
    const pane = container.querySelector<HTMLElement>('[data-id="scope-preview-pane"]');
    if (!pane) return;
    const start = scene.boxes.find((box) => box.type === "start") ?? scene.boxes[0];
    const { left, top } = computePreviewStartScroll(scene.viewBox, paneSize, zoom, start);
    pane.scrollLeft = left;
    pane.scrollTop = top;
  }, [isFit, container, scene, paneSize, zoom]);

  const applyZoom = (next: number): number => {
    const clamped = clampZoom(next);
    setManual({ graph, zoom: clamped });
    return clamped;
  };
  return {
    paneRef: setContainer,
    zoom,
    canZoomIn: zoom < PREVIEW_ZOOM_MAX,
    canZoomOut: zoom > PREVIEW_ZOOM_MIN,
    // 줌 스텝 단일 경로 — 버튼과 휠(ScopePreview onZoom)이 같은 클램프를 쓰고, 휠 앵커용으로 적용 배율을 돌려준다
    stepZoom: (direction: 1 | -1): number => applyZoom(zoom + direction * PREVIEW_ZOOM_STEP),
    resetZoom: () => setManual(null),
  };
}
