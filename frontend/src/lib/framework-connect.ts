// 플레이스홀더 후차 연결 — 후보 맵 유사도 랭킹 (design 2026-08-28 §10.1).
// 기준: 정확 일치(정규화 후) > 한쪽이 다른 쪽을 포함 > 토큰 겹침 비율 > 이름순.
import type { MapSummary, SubprocessRef } from "./api";

// 낙관 참조 — 드롭·연결 직후 서버 refs 도착 전에도 외부 L6 색·출처 배지를 즉시 그리기 위한
// 표시 전용 스텁. 실제 refs(rootGraph)가 도착하면 병합 순서상 덮인다 (2026-08-30 #4)
export interface OptimisticRefMeta {
  name: string;
  categoryId: number;
  categoryPath: string | null;
  designated: boolean;
}

export function makeOptimisticRef(meta: OptimisticRefMeta): SubprocessRef {
  return {
    designated: meta.designated,
    name: meta.name,
    category_id: meta.categoryId,
    category_path: meta.categoryPath,
    department: null,
    assignee: null,
    system: null,
    duration: null,
    cost_krw: null,
    cost_usd: null,
    headcount: null,
    touch_time: null,
    input: null,
    output: null,
    input_forms: null,
    output_forms: null,
    input_ids: null,
    output_ids: null,
    start_condition: null,
    end_condition: null,
    frequency_fallback: null,
    gmp: null,
    url: null,
    url_label: null,
    sp_description: null,
  };
}

export interface RankedCandidate {
  map: MapSummary;
  score: number;
  exact: boolean;
}

// 공백 연쇄·대소문자 차이는 동일 취급 — 임포트 표기 흔들림 흡수
function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreCandidate(title: string, candidate: string): { score: number; exact: boolean } {
  if (!title || !candidate) {
    return { score: 0, exact: false };
  }
  if (title === candidate) {
    return { score: 100, exact: true };
  }
  if (candidate.includes(title) || title.includes(candidate)) {
    // 포함 — 길이가 비슷할수록(잉여 텍스트가 적을수록) 높게
    const ratio = Math.min(title.length, candidate.length) / Math.max(title.length, candidate.length);
    return { score: 60 + 20 * ratio, exact: false };
  }
  const titleTokens = new Set(title.split(" "));
  const candidateTokens = candidate.split(" ");
  const overlap = candidateTokens.filter((token) => titleTokens.has(token)).length;
  if (overlap > 0) {
    const ratio = overlap / Math.max(titleTokens.size, candidateTokens.length);
    return { score: 40 * ratio, exact: false };
  }
  return { score: 0, exact: false };
}

export function rankConnectCandidates(title: string, maps: MapSummary[]): RankedCandidate[] {
  const normalizedTitle = normalizeTitle(title);
  return maps
    .map((map) => ({ map, ...scoreCandidate(normalizedTitle, normalizeTitle(map.name)) }))
    .sort((a, b) => b.score - a.score || a.map.name.localeCompare(b.map.name, "ko"));
}
