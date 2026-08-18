// 인터뷰 임포트 클라이언트 파서 — 파일 내용이 최소한 JSON 객체인지만 판독한다.
// 키/스키마 검증은 서버 어댑터 dry-run(POST /categories/import-interview apply=false)이 진실.
// (canonical categories.json/maps.jsonl 파서는 인터뷰 JSON 단일화로 제거 — 2026-08-18)

/** 인터뷰 결과 JSON 1파일 — 루트가 객체인지만 확인(키 검증은 서버 어댑터 dry-run이 진실, design 2026-08-18 §6). */
export function parseInterviewFile(text: string): { content: unknown; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { content: null, error: "Empty file" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { content: null, error: `Invalid JSON: ${(err as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { content: null, error: "Expected a JSON object at the root" };
  }
  return { content: parsed };
}
