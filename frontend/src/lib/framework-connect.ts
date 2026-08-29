// 플레이스홀더 후차 연결 — 후보 맵 유사도 랭킹 (design 2026-08-28 §10.1).
// 기준: 정확 일치(정규화 후) > 한쪽이 다른 쪽을 포함 > 토큰 겹침 비율 > 이름순.
import type { MapSummary } from "./api";

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
