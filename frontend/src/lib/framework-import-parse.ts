// 프레임워크 대량 임포트 클라이언트 파서 — 파일 내용을 raw JSON 객체 배열로 판독만 한다.
// 스키마 검증(카테고리 레벨/부모 참조, 맵 필드)은 서버 dry-run(POST /categories/import apply=false)이
// 진실 — 여기는 서버에 보내기 전 파일이 최소한 파싱 가능한지만 클라이언트에서 빠르게 알려준다.

export interface ParsedDelivery {
  categories: unknown[];
  maps: unknown[];
  clientErrors: string[];
}

/** categories.json — `{ "categories": [...] }` 형태 필수(CLI/API와 동일 구조, consultant_canonical.parse_categories 미러). */
export function parseCategoriesFile(text: string): { categories: unknown[]; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { categories: [], error: "Empty file" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { categories: [], error: `Invalid JSON: ${(err as Error).message}` };
  }
  const categories =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).categories
      : undefined;
  if (!Array.isArray(categories)) {
    return { categories: [], error: 'Expected { "categories": [...] } shape' };
  }
  return { categories };
}

/** maps.jsonl — 줄 단위(JSONL) 또는 통 JSON 배열 텍스트 둘 다 허용. 깨진 줄은 수집만 하고 계속 진행
 * (CLI load_maps와 동일 관용 — 한 줄 오류가 전달분 전체를 죽이지 않는다). */
export function parseMapsFile(text: string): { maps: unknown[]; lineErrors: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return { maps: [], lineErrors: [] };

  try {
    const whole = JSON.parse(trimmed);
    if (Array.isArray(whole)) return { maps: whole, lineErrors: [] };
  } catch {
    // 통짜 JSON이 아니면 아래 줄 단위(JSONL) 파싱으로 폴백
  }

  const maps: unknown[] = [];
  const lineErrors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const lineText = line.trim();
    if (!lineText) return;
    try {
      maps.push(JSON.parse(lineText));
    } catch (err) {
      lineErrors.push(`Line ${i + 1}: ${(err as Error).message}`);
    }
  });
  return { maps, lineErrors };
}
