// 재사용 검색 — 부분일치 + 한글초성 + 로마자초성, 콤마 AND, 원문 인덱스 range(하이라이트용). deps 없음.

import { extractChosung, isChosungQuery } from "@/lib/hangul";

export interface MatchRange {
  start: number;
  end: number;
}
export interface FieldSpec {
  field: string;
  text: string;
}
export interface FieldMatch {
  field: string;
  ranges: MatchRange[];
}
export interface SearchHit<T> {
  item: T;
  matches: FieldMatch[];
}

// 초성(가나다 순) → 개정로마자 자음. ㅇ은 묵음(빈자). hangul.ts CHOSUNG 순서와 동일.
const CHOSUNG_ROMAN = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const PER_CHOSUNG = 588;

function isLatinQuery(term: string): boolean {
  const t = term.replace(/\s/g, "");
  return t.length > 0 && /^[a-z]+$/i.test(t);
}

// 텍스트의 로마자초성 문자열 + 각 로마자 char가 유래한 원문 char 인덱스 배열.
function toRomanInitials(text: string): { roman: string; src: number[] } {
  let roman = "";
  const src: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const r = CHOSUNG_ROMAN[Math.floor((code - HANGUL_BASE) / PER_CHOSUNG)];
      for (const ch of r) {
        roman += ch;
        src.push(i);
      }
    } else {
      roman += text[i].toLowerCase();
      src.push(i);
    }
  }
  return { roman, src };
}

function allOccurrences(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    starts.push(idx);
    from = idx + 1;
  }
  return starts;
}

// 부분 시퀀스 — query 글자들이 text에 "순서대로"(연속 아님) 등장하면 각 글자 range, 아니면 null.
function subsequenceMatch(text: string, term: string): MatchRange[] | null {
  const t = term.trim().toLowerCase();
  if (!t) return null;
  const lower = text.toLowerCase();
  const ranges: MatchRange[] = [];
  let pos = 0;
  for (const ch of t) {
    const idx = lower.indexOf(ch, pos);
    if (idx === -1) return null;
    ranges.push({ start: idx, end: idx + 1 });
    pos = idx + 1;
  }
  return ranges;
}

/** 한 term이 text에 매치하면 원문 기준 range 배열, 아니면 null. 우선순위 부분일치→초성→로마자→subsequence. */
export function matchTerm(text: string, term: string): MatchRange[] | null {
  const trimmed = term.trim();
  if (!trimmed) return null;

  // 1) 부분일치 (대소문자 무시)
  const subStarts = allOccurrences(text.toLowerCase(), trimmed.toLowerCase());
  if (subStarts.length) {
    return subStarts.map((s) => ({ start: s, end: s + trimmed.length }));
  }

  // 2) 한글 초성 (extractChosung는 1:1 인덱스 정렬)
  if (isChosungQuery(trimmed)) {
    const chosung = extractChosung(text);
    const starts = allOccurrences(chosung, trimmed);
    if (starts.length) {
      return starts.map((s) => ({ start: s, end: s + trimmed.length }));
    }
  }

  // 3) 로마자 초성
  if (isLatinQuery(trimmed)) {
    const lower = trimmed.toLowerCase();
    const { roman, src } = toRomanInitials(text);
    const starts = allOccurrences(roman, lower);
    if (starts.length) {
      return starts.map((s) => {
        const last = src[s + lower.length - 1];
        return { start: src[s], end: last + 1 };
      });
    }
  }

  // 4) 부분 시퀀스 (순서만 맞으면) — 최후순위 (SR-3)
  return subsequenceMatch(text, trimmed);
}

// 매치 품질 순위 (낮을수록 우선): 0 정확 · 1 접두 · 2 부분 · 3 초성/로마자 · 4 subsequence · ∞ 불일치.
function termFieldRank(text: string, term: string): number {
  const t = term.trim().toLowerCase();
  if (!t) return Infinity;
  const lower = text.toLowerCase();
  if (lower === t) return 0;
  if (lower.startsWith(t)) return 1;
  if (lower.includes(t)) return 2;
  if (isChosungQuery(term) && allOccurrences(extractChosung(text), term.trim()).length) return 3;
  if (isLatinQuery(term) && allOccurrences(toRomanInitials(text).roman, t).length) return 3;
  if (subsequenceMatch(text, term)) return 4;
  return Infinity;
}

function splitTerms(query: string): string[] {
  return query.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MatchRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** 콤마=AND(각 term이 어떤 필드에든 매치), 필드/모드=OR. query 비면 전체 통과(matches=[]). */
export function filterByQuery<T>(
  items: T[],
  query: string,
  getFields: (item: T) => FieldSpec[],
): SearchHit<T>[] {
  const terms = splitTerms(query);
  if (terms.length === 0) {
    return items.map((item) => ({ item, matches: [] }));
  }
  const ranked: { hit: SearchHit<T>; rank: number }[] = [];
  for (const item of items) {
    const fields = getFields(item);
    const perField = new Map<string, MatchRange[]>();
    let allTermsMatched = true;
    let worstTermRank = 0; // 모든 term이 매치해야 하므로 가장 약한 term이 품질을 좌우 (SR-3 정렬)
    for (const term of terms) {
      let termMatched = false;
      let bestFieldRank = Infinity;
      for (const f of fields) {
        const ranges = matchTerm(f.text, term);
        if (ranges) {
          termMatched = true;
          perField.set(f.field, [...(perField.get(f.field) ?? []), ...ranges]);
        }
        bestFieldRank = Math.min(bestFieldRank, termFieldRank(f.text, term));
      }
      if (!termMatched) {
        allTermsMatched = false;
        break;
      }
      worstTermRank = Math.max(worstTermRank, bestFieldRank);
    }
    if (allTermsMatched) {
      const matches: FieldMatch[] = [...perField.entries()].map(([field, ranges]) => ({
        field,
        ranges: mergeRanges(ranges),
      }));
      ranked.push({ hit: { item, matches }, rank: worstTermRank });
    }
  }
  // 품질 순위 오름차순(정확>접두>부분>초성/로마자>subsequence). 동순위는 입력 순서 유지(안정).
  return ranked
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((r) => r.hit);
}
