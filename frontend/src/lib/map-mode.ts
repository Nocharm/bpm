// 맵 모드별 홈 목록 분리 — 일반 맵과 L5 연계 캔버스(framework)를 나눈다.

// 집계·대시보드는 processMaps만, 연계 캔버스(frameworkMaps)는 조직도·나의 부서 목록에서 일반 맵 아래
// 스페이서 뒤에 나열한다(관리 부서 파생 owning_department, 2026-09-21).
export function splitMapsByMode<T extends { mode?: string }>(
  maps: T[],
): { processMaps: T[]; frameworkMaps: T[] } {
  const processMaps: T[] = [];
  const frameworkMaps: T[] = [];
  for (const m of maps) {
    (m.mode === "framework" ? frameworkMaps : processMaps).push(m);
  }
  return { processMaps, frameworkMaps };
}
