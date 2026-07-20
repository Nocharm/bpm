// 도넛 세그먼트 → SVG stroke-dasharray 아크 변환(순수). circumference=2πr.
export interface DonutSegment { key: string; value: number; colorVar: string }
export interface DonutArc { key: string; value: number; colorVar: string; dashArray: string; dashOffset: number }

// gap: 세그먼트 사이 간격(호 길이 단위). 각 세그먼트의 표시 길이를 gap만큼 줄여 분절된 링 모양을 만든다.
// 위치(offset)는 전체 비율 기준으로 누적하므로 비율 판독은 유지. gap=0이면 종전과 동일(단위 테스트 계약).
export function computeDonutArcs(
  segments: DonutSegment[],
  circumference: number,
  gap: number = 0,
): DonutArc[] {
  const nonZero = segments.filter((s) => s.value > 0);
  const total = nonZero.reduce((s, x) => s + x.value, 0);
  if (total === 0) return [];
  const arcs: DonutArc[] = [];
  let acc = 0;
  for (const s of nonZero) {
    const len = (s.value / total) * circumference;
    // 작은 세그먼트가 gap에 통째로 먹히지 않도록 최소 슬라이버(0.5) 확보
    const visible = gap > 0 ? Math.max(len - gap, 0.5) : len;
    const round = (n: number) => Math.round(n * 100) / 100;
    arcs.push({
      key: s.key,
      value: s.value,
      colorVar: s.colorVar,
      dashArray: `${round(visible)} ${round(circumference - visible)}`,
      dashOffset: acc === 0 ? 0 : -round(acc), // avoid -0 (Object.is fails toBe(0) in tests)
    });
    acc += len;
  }
  return arcs;
}
