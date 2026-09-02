// 표시 높이(실측)로 커진 노드 아래를 저장 Y 계단함수로 밀어내는 스텝 생성 — 저장 좌표 불변.
// 오프셋 조회·역변환은 lib/inline-shift(offsetAtSavedX/displayToSavedX)를 Y축으로 재사용.
// 설계: 2026-08-23-node-spacing-design.md §4
import {
  estimateNodeHeight,
  estimateNodeWidth,
  nodeSizeOf,
  type AppNode,
  type ProcessNodeType,
} from "@/lib/canvas";
import { offsetAtSavedX, type ShiftStep } from "@/lib/inline-shift";

// 4px 미만 성장은 무시 — 폰트 렌더 편차로 인한 미세 지터 방지
const EPSILON = 4;

// 콘텐츠로 높이가 자라는 타입만 앵커 — section(Word 맵 영역 박스)은 의도된 대형이라 제외
const ANCHOR_TYPES = new Set<ProcessNodeType>(["process", "decision", "start", "end", "subprocess"]);

/** 표시 높이 — React Flow 실측 우선, 미측정(첫 페인트)은 라벨 기반 추정 폴백. */
export function getDisplayHeight(node: AppNode): number {
  const measured = node.measured?.height;
  if (measured !== undefined && measured > 0) return measured;
  const type = node.data.nodeType;
  return estimateNodeHeight(node.data.label, type, estimateNodeWidth(node.data.label, type));
}

/**
 * 커진 노드들로 Y 계단함수 스텝 생성. 앵커 구간 [savedY, savedY+기준높이]가 겹치는(같은 행)
 * 앵커는 한 밴드로 병합해 bottom=max·extra=max — 나란한 성장이 아래를 이중으로 밀지 않게.
 * 반환 ShiftStep은 x 필드에 Y값을 실음(inline-shift 1D 재사용).
 */
export function buildHeightSteps(nodes: AppNode[]): ShiftStep[] {
  const anchors = nodes
    .filter((node) => ANCHOR_TYPES.has(node.data.nodeType))
    .map((node) => {
      const base = nodeSizeOf(node.data.nodeType).h;
      return {
        top: node.position.y,
        bottom: node.position.y + base,
        extra: getDisplayHeight(node) - base,
      };
    })
    .filter((anchor) => anchor.extra >= EPSILON)
    .sort((a, b) => a.top - b.top);
  const steps: ShiftStep[] = [];
  let band: { top: number; bottom: number; extra: number } | null = null;
  for (const anchor of anchors) {
    if (band && anchor.top <= band.bottom) {
      band.bottom = Math.max(band.bottom, anchor.bottom);
      band.extra = Math.max(band.extra, anchor.extra);
    } else {
      if (band) steps.push({ x: band.bottom, footprint: band.extra });
      band = { ...anchor };
    }
  }
  if (band) steps.push({ x: band.bottom, footprint: band.extra });
  return steps;
}

/** 노드별 표시 Y 오프셋 — section은 피밀림도 제외(0). 오프셋 0인 노드는 맵에서 생략. */
export function buildYOffsets(nodes: AppNode[], steps: ShiftStep[]): Map<string, number> {
  const offsets = new Map<string, number>();
  if (steps.length === 0) return offsets;
  for (const node of nodes) {
    if (node.data.nodeType === "section") continue;
    const offset = offsetAtSavedX(node.position.y, steps);
    if (offset > 0) offsets.set(node.id, offset);
  }
  return offsets;
}
