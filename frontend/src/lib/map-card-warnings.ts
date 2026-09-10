// 홈 맵 카드 경고 집계 — 카드에는 ⚠+건수만, 내용은 클릭 모달(map-card-warnings-modal)에서.
// 종류는 기존 카드가 필로 늘어놓던 2종 그대로: 오우닝 부서 미지정 / 낡은 참조(건수). (사용자 결정 2026-09-10)

import type { MapSummary } from "@/lib/api";

export type MapCardWarning =
  | { kind: "owning_missing" }
  | { kind: "stale_refs"; count: number };

export function collectMapWarnings(map: Pick<MapSummary, "owning_department" | "stale_ref_count">): MapCardWarning[] {
  const out: MapCardWarning[] = [];
  if (!map.owning_department) out.push({ kind: "owning_missing" });
  const stale = map.stale_ref_count ?? 0;
  if (stale > 0) out.push({ kind: "stale_refs", count: stale });
  return out;
}
