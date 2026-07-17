// 인라인 펼침 footprint-shift 좌표 변환 — 표시(펼침 오프셋 적용) ↔ 저장(스코프 상대) x.
// 펼침 앵커마다 그 오른쪽(저장 x 기준) 노드가 footprint만큼 밀린다(계단함수).

export interface ShiftStep {
  x: number; // 앵커의 저장 x
  footprint: number; // 이 앵커 펼침이 오른쪽 노드를 미는 폭
}

/** 저장 x에서의 표시 오프셋 = 저장 x보다 왼쪽(strict)에 있는 펼침 앵커들의 footprint 합. */
export function offsetAtSavedX(savedX: number, steps: ShiftStep[]): number {
  let sum = 0;
  for (const s of steps) {
    if (s.x < savedX) {
      sum += s.footprint;
    }
  }
  return sum;
}

/**
 * 표시 x → 저장 x. savedX + offsetAtSavedX(savedX) = displayX 의 해를 구간별로 직접 푼다.
 * 표시 공간엔 앵커마다 도달 불가 갭(저장 x가 앵커를 넘는 순간 footprint만큼 점프)이 있는데,
 * displayX가 갭 안이면 앵커의 저장 x로 클램프한다 — 반복 고정점 풀이(진동 발산)를 대체하는 결정적 규칙.
 */
export function displayToSavedX(displayX: number, steps: ShiftStep[]): number {
  const sorted = [...steps].sort((a, b) => a.x - b.x);
  // 구간 i: 저장 x ∈ (앵커_{i-1}.x, 앵커_i.x] 에서 오프셋 = 앞선 footprint 누적(C). 마지막 구간은 (앵커_k.x, ∞).
  let cum = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const anchor = sorted[i];
    const candidate = displayX - cum; // 이 구간 오프셋으로 환산한 저장 x 후보
    if (candidate <= anchor.x) {
      // 후보가 구간 안(앵커 이하) → 정확해. (이전 구간에서 안 잡혔으니 하한은 자동 만족)
      return candidate;
    }
    const gapRight = anchor.x + cum + anchor.footprint; // 갭 우측 한계(도달 불가 상한, 저장 앵커⁺의 표시)
    if (displayX <= gapRight) {
      return anchor.x; // 갭 안 — 앵커 저장 x로 클램프
    }
    cum += anchor.footprint;
  }
  return displayX - cum; // 모든 앵커 오른쪽
}
