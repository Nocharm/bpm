// 홈 맵 상세 서브프로세스 섹션의 순수 로직 — 타일 값/원문 해석, 부서 트리 레벨, 입출력 줄 파싱, 섹션 노출 판정.
// 렌더 없는 함수만 두어 단위 테스트한다(컴포넌트는 components/maps/map-detail-sp-section.tsx).

import type { MapSummary } from "@/lib/api";
import { buildOrgPathChain } from "@/lib/korean-dept";

export type ValueTone = "default" | "fallback";

/** 대표값 우선, 없으면 원문 메모를 임시값(fallback 톤)으로 — 둘 다 없으면 빈 값(타일이 "미입력"을 그린다) */
export function resolveValueOrNote(
  value: string | null | undefined,
  note: string | null | undefined,
): { value: string; tone: ValueTone } {
  const v = (value ?? "").trim();
  if (v !== "") return { value: v, tone: "default" };
  const n = (note ?? "").trim();
  if (n !== "") return { value: n, tone: "fallback" };
  return { value: "", tone: "default" };
}

export interface DeptTreeLevel {
  // 이 레벨까지의 org_path — 표시명 조회 키. ellipsis 행은 ""
  path: string;
  depth: number;
  leaf: boolean;
  ellipsis: boolean;
}

// 트리에 그리는 최대 레벨 수 — 세로 타일(3행 높이)에 말단 2줄까지 들어가는 한계
const DEPT_TREE_MAX_LEVELS = 4;

/** 부서 경로 → 트리 레벨(상위→말단). 5단 이상은 루트·…·부모·말단으로 접어 말단이 항상 보이게 */
export function buildDeptTreeLevels(orgPath: string): DeptTreeLevel[] {
  const chain = buildOrgPathChain(orgPath);
  if (chain.length === 0) return [];
  if (chain.length <= DEPT_TREE_MAX_LEVELS) {
    return chain.map((path, i) => ({ path, depth: i, leaf: i === chain.length - 1, ellipsis: false }));
  }
  return [
    { path: chain[0], depth: 0, leaf: false, ellipsis: false },
    { path: "", depth: 1, leaf: false, ellipsis: true },
    { path: chain[chain.length - 2], depth: 2, leaf: false, ellipsis: false },
    { path: chain[chain.length - 1], depth: 3, leaf: true, ellipsis: false },
  ];
}

/** 입력물/산출물 저장값(줄바꿈 구분) → 항목 목록. 빈 줄은 버린다 */
export function parseIoLines(joined: string | null | undefined): string[] {
  return (joined ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export type SpDetailFields = Pick<
  MapSummary,
  | "sp_designated_at"
  | "sp_department"
  | "sp_assignee"
  | "sp_system"
  | "sp_system_fallback"
  | "sp_url"
  | "sp_gmp"
  | "sp_gmp_fallback"
  | "sp_duration"
  | "sp_total_time_fallback"
  | "sp_touch_time"
  | "sp_touch_time_fallback"
  | "sp_cost_krw"
  | "sp_cost_usd"
  | "sp_headcount"
  | "sp_annual_count"
  | "sp_frequency_fallback"
  | "sp_fte"
  | "sp_input"
  | "sp_output"
  | "sp_start_condition"
  | "sp_end_condition"
>;

const has = (v: string | null | undefined): boolean => (v ?? "").trim() !== "";

/** 섹션 타일 15개 중 값 또는 원문 메모가 있는 개수 — 헤더 건수 */
export function countFilledSpTiles(d: SpDetailFields): number {
  const tiles: boolean[] = [
    has(d.sp_department),
    has(d.sp_assignee),
    has(d.sp_system) || has(d.sp_system_fallback),
    has(d.sp_url),
    has(d.sp_gmp) || has(d.sp_gmp_fallback),
    has(d.sp_duration) || has(d.sp_total_time_fallback),
    has(d.sp_touch_time) || has(d.sp_touch_time_fallback),
    has(d.sp_cost_krw) || has(d.sp_cost_usd),
    has(d.sp_headcount),
    has(d.sp_annual_count) || has(d.sp_frequency_fallback),
    has(d.sp_fte),
    has(d.sp_input),
    has(d.sp_output),
    has(d.sp_start_condition),
    has(d.sp_end_condition),
  ];
  return tiles.filter(Boolean).length;
}

/** 섹션을 그릴지 — 지정됐거나 값/메모가 하나라도 있으면. 비SP 맵(연계 캔버스 등)은 노이즈 없이 숨긴다 */
export function hasSpContent(d: SpDetailFields): boolean {
  return has(d.sp_designated_at) || countFilledSpTiles(d) > 0;
}
