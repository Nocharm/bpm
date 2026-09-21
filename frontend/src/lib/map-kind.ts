// 홈 Type 필(SP·L5 캔버스·업무 체계 등록) 값과 배타 관계 — 그룹 안 OR 필터이지만 교집합이 빈 조합은 골라도
// 의미가 없어, 하나를 고르면 그와 배타인 옵션을 비활성화한다(사용자 지시 2026-09-21). page.tsx 술어(kindOk)와
// 세션 저장 가드, home-filter-pills.tsx 옵션 비활성화가 같은 정의를 본다.

export const MAP_KIND_VALUES = ["sp", "non_sp", "canvas", "registered", "unregistered"] as const;
export type MapKind = (typeof MAP_KIND_VALUES)[number];

export function isMapKind(value: unknown): value is MapKind {
  return typeof value === "string" && (MAP_KIND_VALUES as readonly string[]).includes(value);
}

// 교집합이 빈 쌍 — 캔버스는 SP 지정이 없고 항상 업무 체계에 등록돼 있다
const EXCLUSIVE: ReadonlyArray<readonly [MapKind, MapKind]> = [
  ["sp", "non_sp"],
  ["sp", "canvas"],
  ["registered", "unregistered"],
  ["canvas", "unregistered"],
];

export function isKindExclusive(a: MapKind, b: MapKind): boolean {
  return EXCLUSIVE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// 현재 선택과 배타인(고를 수 없는) 옵션 집합 — 이미 선택된 것은 해제할 수 있어야 하므로 제외
export function getDisabledKinds(selected: ReadonlySet<string>): Set<MapKind> {
  const out = new Set<MapKind>();
  for (const k of MAP_KIND_VALUES) {
    if (selected.has(k)) continue;
    for (const s of selected) if (isMapKind(s) && isKindExclusive(k, s)) out.add(k);
  }
  return out;
}
