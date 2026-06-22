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
const CHOSUNG_CHARS = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
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

/** 한 term이 text에 매치하면 원문 기준 range 배열, 아니면 null. 우선순위 부분일치→초성→로마자. */
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

  return null;
}

function splitTerms(query: string): string[] {
  return query.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MatchRange[] = [sorted[0]];
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
  const hits: SearchHit<T>[] = [];
  for (const item of items) {
    const fields = getFields(item);
    const perField = new Map<string, MatchRange[]>();
    let allTermsMatched = true;
    for (const term of terms) {
      let termMatched = false;
      for (const f of fields) {
        const ranges = matchTerm(f.text, term);
        if (ranges) {
          termMatched = true;
          perField.set(f.field, [...(perField.get(f.field) ?? []), ...ranges]);
        }
      }
      if (!termMatched) {
        allTermsMatched = false;
        break;
      }
    }
    if (allTermsMatched) {
      const matches: FieldMatch[] = [...perField.entries()].map(([field, ranges]) => ({
        field,
        ranges: mergeRanges(ranges),
      }));
      hits.push({ item, matches });
    }
  }
  return hits;
}
