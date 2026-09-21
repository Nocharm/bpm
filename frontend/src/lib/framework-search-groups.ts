// 업무 체계 뷰 검색 결과 그룹핑(순수) — 히트를 L5 카테고리별로 묶는다(사용자 지시 2026-09-21). 일반 맵은
// category_id/category_path, 연계 캔버스는 linkage_category_id/path로 같은 그룹에 합류하되 행이 아니라 그룹의
// `canvas`로 붙는다(헤더 칩). 미등록 맵은 맨 뒤 "unregistered" 그룹. 그룹 순서는 히트 랭킹의 첫 등장 순.

import type { MapSummary } from "@/lib/api";

export interface FrameworkSearchGroup<H> {
  key: string; // `cat:${id}` | "unregistered"
  categoryId: number | null;
  path: string[]; // 루트→L5 이름(미등록은 [])
  canvas: MapSummary | null; // 히트에 포함된 연계 캔버스
  rows: H[]; // 일반 맵 히트(랭킹 순)
}

export function groupHitsByCategory<H extends { item: MapSummary }>(hits: readonly H[]): FrameworkSearchGroup<H>[] {
  const byKey = new Map<string, FrameworkSearchGroup<H>>();
  const order: string[] = [];
  const ensure = (key: string, categoryId: number | null, pathStr: string | null | undefined) => {
    let g = byKey.get(key);
    if (!g) {
      g = { key, categoryId, path: (pathStr ?? "").split("/").filter(Boolean), canvas: null, rows: [] };
      byKey.set(key, g);
      order.push(key);
    }
    return g;
  };
  for (const h of hits) {
    const m = h.item;
    if (m.mode === "framework") {
      if (m.linkage_category_id == null) continue; // 결착 없는 캔버스는 표시 대상 아님
      ensure(`cat:${m.linkage_category_id}`, m.linkage_category_id, m.linkage_category_path).canvas = m;
      continue;
    }
    if (m.category_id != null) ensure(`cat:${m.category_id}`, m.category_id, m.category_path).rows.push(h);
    else ensure("unregistered", null, null).rows.push(h);
  }
  const groups = order.map((k) => byKey.get(k)!);
  // 미등록은 항상 맨 뒤
  return [...groups.filter((g) => g.key !== "unregistered"), ...groups.filter((g) => g.key === "unregistered")];
}
