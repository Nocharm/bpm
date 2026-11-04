// 실행 체크(Run) 화면 주소 — 맵 화면에 `?version=&run=`을 붙여 실행 모드로 연다(같은 경로라 실행을 바꿔도 다시 마운트되지 않는다).

export function buildRunHref(mapId: number, versionId: number, runId: number): string {
  return `/maps/${mapId}?version=${versionId}&run=${runId}`;
}

/** `?run=` 값 — 양의 정수만 받고 없거나 잘못되면 null(실행 모드 아님). */
export function readRunIdParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("run");
  if (raw === null) return null;
  const runId = Number(raw);
  return Number.isInteger(runId) && runId > 0 ? runId : null;
}
