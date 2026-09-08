// 2열 임포트 리포트의 포커스 계약 — 우측(맵/L5)을 고르면 좌측 항목이 "관련 있음" 여부로 재정렬·강조·흐림된다.
// 항목은 자기가 가리키는 맵 코드와 파일 index를 태그로 들고, 맵 포커스는 맵 태그로, L5 포커스는 파일 태그로 맞춘다.

export interface ReportFocus {
  kind: "map" | "file";
  code: string; // map: 맵 코드 · file: 홈 L5 코드(없으면 파일명)
  fileIndex: number | null;
  name: string;
}

export interface RelatedTags {
  maps: string[];
  files: number[];
}

export function isRelated(tags: RelatedTags, focus: ReportFocus): boolean {
  if (focus.kind === "map" && tags.maps.includes(focus.code)) return true;
  return focus.fileIndex !== null && tags.files.includes(focus.fileIndex);
}

/** 관련 항목을 앞으로 — 원래 순서는 그대로 유지(안정 정렬). 포커스가 없으면 입력 그대로. */
export function orderByRelation<T>(
  items: T[],
  tagsOf: (item: T) => RelatedTags,
  focus: ReportFocus | null,
): T[] {
  if (!focus) return items;
  const hits = items.filter((item) => isRelated(tagsOf(item), focus));
  if (hits.length === 0) return items;
  const set = new Set(hits);
  return [...hits, ...items.filter((item) => !set.has(item))];
}

/** 행 표시 상태 — dim(포커스 있는데 무관) / hit(관련 + 강조 모드) / 기본. */
export function relationClass(
  tags: RelatedTags,
  focus: ReportFocus | null,
  highlightOnMapFocus: boolean,
): "" | "dim" | "hit" {
  if (!focus) return "";
  if (!isRelated(tags, focus)) return "dim";
  return focus.kind === "file" || highlightOnMapFocus ? "hit" : "";
}
