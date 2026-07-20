// Shift 드래그 축 고정 — 시작점 대비 이동량이 큰 축만 남기고 작은 축은 시작값으로 고정.

export interface Point {
  x: number;
  y: number;
}

/** shiftHeld면 dominant 축만 이동(수평 또는 수직 잠금), 아니면 current 그대로. 동률은 수평 잠금. */
export function constrainToAxis(start: Point, current: Point, shiftHeld: boolean): Point {
  if (!shiftHeld) {
    return current;
  }
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: current.x, y: start.y }; // 수평 이동 → 세로 고정
  }
  return { x: start.x, y: current.y }; // 수직 이동 → 가로 고정
}
