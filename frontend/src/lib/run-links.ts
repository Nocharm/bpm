// 실행 체크(Run) 화면 주소 — 맵 화면에 `?version=&run=`을 붙여 실행 모드로 연다(같은 경로라 실행을 바꿔도 다시 마운트되지 않는다).

export function buildRunHref(mapId: number, versionId: number, runId: number): string {
  return `/maps/${mapId}?version=${versionId}&run=${runId}`;
}

// 주소 값 하나 — 양의 정수만 받고 없거나 잘못되면 null
function readPositiveIntParam(search: string, name: string): number | null {
  const raw = new URLSearchParams(search).get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** `?run=` 값 — 양의 정수만 받고 없거나 잘못되면 null(실행 모드 아님). */
export function readRunIdParam(search: string): number | null {
  return readPositiveIntParam(search, "run");
}

/** `?version=` 값 — 뒤로 가기로 실행을 나올 때 화면을 맞출 버전. 양의 정수만, 아니면 null. */
export function readVersionIdParam(search: string): number | null {
  return readPositiveIntParam(search, "version");
}

/** 실행을 닫을 때의 맵 주소 — `?run=` 없이 같은 버전으로(실행 모드를 나온다). */
export function buildMapVersionHref(mapId: number, versionId: number): string {
  return `/maps/${mapId}?version=${versionId}`;
}
