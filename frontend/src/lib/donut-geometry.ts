// 도넛 세그먼트 → SVG stroke-dasharray 아크 변환(순수). circumference=2πr.
export interface DonutSegment { key: string; value: number; colorVar: string }
export interface DonutArc { key: string; value: number; colorVar: string; dashArray: string; dashOffset: number }

export function computeDonutArcs(segments: DonutSegment[], circumference: number): DonutArc[] {
  const nonZero = segments.filter((s) => s.value > 0);
  const total = nonZero.reduce((s, x) => s + x.value, 0);
  if (total === 0) return [];
  const arcs: DonutArc[] = [];
  let acc = 0;
  for (const s of nonZero) {
    const len = (s.value / total) * circumference;
    const round = (n: number) => Math.round(n * 100) / 100;
    arcs.push({
      key: s.key,
      value: s.value,
      colorVar: s.colorVar,
      dashArray: `${round(len)} ${round(circumference - len)}`,
      dashOffset: acc === 0 ? 0 : -round(acc), // avoid -0 (Object.is fails toBe(0) in tests)
    });
    acc += len;
  }
  return arcs;
}
