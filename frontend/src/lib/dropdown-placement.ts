// 뷰포트 고정(fixed) 드롭다운 배치 계산 — 앵커 아래 우선, 공간이 없으면 옆으로. 순수 함수(DOM 접근 없음).
// 위로 flip하지 않는다: 피커 바로 위에 방금 고른 항목(pills/목록)이 붙어 있어 가리면 안 된다.

/** 드롭다운 기본 높이 — 약 5줄. 사용자 합의(피커 아래선 기준 5줄). */
export const DROPDOWN_MAX_HEIGHT = 160;
/** 앵커와 드롭다운 사이 간격(px). */
const GAP = 4;
/** 뷰포트 가장자리 최소 여백(px). */
const MARGIN = 8;
/** 옆으로 열 때 요구하는 최소 폭 — 이보다 좁으면 읽을 수 없어 아래 축소로 되돌아간다. */
const MIN_SIDE_WIDTH = 200;
/** 삼면 모두 부족할 때의 최소 높이 — 최소 두어 줄은 보이게. */
const MIN_FALLBACK_HEIGHT = 80;

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface DropdownPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  side: "below" | "right" | "left";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeDropdownPlacement(anchor: AnchorRect, viewport: Viewport): DropdownPlacement {
  const spaceBelow = viewport.height - anchor.bottom - GAP - MARGIN;
  if (spaceBelow >= DROPDOWN_MAX_HEIGHT) {
    return {
      top: anchor.bottom + GAP,
      left: anchor.left,
      width: anchor.width,
      maxHeight: DROPDOWN_MAX_HEIGHT,
      side: "below",
    };
  }

  // 옆으로 열 때 — 높이는 뷰포트에 갇히고, top은 앵커 높이에 맞추되 화면 안으로 clamp.
  const sideHeight = Math.min(DROPDOWN_MAX_HEIGHT, viewport.height - 2 * MARGIN);
  const sideTop = clamp(anchor.top, MARGIN, Math.max(MARGIN, viewport.height - MARGIN - sideHeight));

  const spaceRight = viewport.width - anchor.right - GAP - MARGIN;
  if (spaceRight >= MIN_SIDE_WIDTH) {
    return {
      top: sideTop,
      left: anchor.right + GAP,
      width: Math.min(anchor.width, spaceRight),
      maxHeight: sideHeight,
      side: "right",
    };
  }

  const spaceLeft = anchor.left - GAP - MARGIN;
  if (spaceLeft >= MIN_SIDE_WIDTH) {
    const width = Math.min(anchor.width, spaceLeft);
    return {
      top: sideTop,
      left: anchor.left - GAP - width,
      width,
      maxHeight: sideHeight,
      side: "left",
    };
  }

  // 삼면 모두 부족 — 아래로 열되 남은 공간만큼 축소.
  return {
    top: anchor.bottom + GAP,
    left: anchor.left,
    width: anchor.width,
    maxHeight: Math.max(spaceBelow, MIN_FALLBACK_HEIGHT),
    side: "below",
  };
}
