// 홈 개인 대시보드 순수 집계 — 맵 목록(MapSummary[])에서 상태 분포·부서 지표를 뽑는다. 렌더 무관·테스트 대상.

import type { MapSummary, VersionStatus } from "@/lib/api";

// 분포 바·범례의 고정 순서 — 워크플로 진행 순 (VERSION_STATUS_TONE 키와 동일 집합)
export const STATUS_ORDER: VersionStatus[] = ["draft", "pending", "approved", "published", "confirmed", "rejected", "expired"];

export interface StatusCount {
  status: VersionStatus;
  count: number;
}

// 최신 버전 상태별 건수 — 상태 없는 맵은 draft로 본다(버전 0개 맵). 0건 상태는 제외, STATUS_ORDER 순.
export function countByStatus(maps: MapSummary[]): StatusCount[] {
  const counts = new Map<VersionStatus, number>();
  for (const m of maps) {
    const s = m.latest_version_status ?? "draft";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return STATUS_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({ status: s, count: counts.get(s) ?? 0 }));
}

// 목록 상단에 보일 순서 — 선택 상태 우선, 그 안에서는 최근 갱신순.
export function sortForStatus(maps: MapSummary[], status: VersionStatus | null): MapSummary[] {
  const byUpdated = (a: MapSummary, b: MapSummary) => b.updated_at.localeCompare(a.updated_at);
  if (status === null) return [...maps].sort(byUpdated);
  const hit = maps.filter((m) => (m.latest_version_status ?? "draft") === status).sort(byUpdated);
  const rest = maps.filter((m) => (m.latest_version_status ?? "draft") !== status).sort(byUpdated);
  return [...hit, ...rest];
}

export interface DeptStats {
  total: number;
  staleRefs: number; // 고아 참조가 1건 이상인 맵 수
  spMissing: number; // SP 미지정 맵 수
}

export function summarizeDept(maps: MapSummary[]): DeptStats {
  return {
    total: maps.length,
    staleRefs: maps.filter((m) => (m.stale_ref_count ?? 0) > 0).length,
    spMissing: maps.filter((m) => !m.sp_designated_at).length,
  };
}
