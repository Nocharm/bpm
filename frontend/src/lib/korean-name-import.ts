// 한글이름 JSON 임포트 파서·분류 — 어드민 일괄 등록 모달용(순수 함수, DOM/fetch 없음).
// 설계: docs/superpowers/specs/2026-07-09-user-korean-name-import-design.md

import type { EmployeeRow } from "./api";

export interface KoreanNameConflict {
  loginId: string;
  current: string;
  next: string;
}

export interface KoreanNameClassification {
  /** 기존 값 없는 유저 — 확인 없이 적용 가능 */
  fresh: Record<string, string>;
  /** 기존 값 보유 유저 — skip/overwrite 선택 대상 */
  conflicts: KoreanNameConflict[];
  /** employees에 없는 login_id — 서버도 unknown으로 재보고 */
  unknownIds: string[];
  /** trim·빈값 제거 후 전체 항목 — PUT payload 그대로 */
  entries: Record<string, string>;
}

export function parseKoreanNamesJson(
  text: string,
): { entries: Record<string, string> } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Invalid JSON file." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { error: 'Expected an object map: { "login_id": "korean name" }.' };
  }
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") {
      return { error: `Value for "${key}" must be a string.` };
    }
    const name = value.trim();
    if (!name) continue; // 빈 값은 이름 삭제가 아니라 미기입 — 무시
    entries[key.trim()] = name;
  }
  return { entries };
}

export function classifyKoreanNames(
  entries: Record<string, string>,
  rows: EmployeeRow[],
): KoreanNameClassification {
  const byId = new Map(rows.map((r) => [r.login_id, r]));
  const fresh: Record<string, string> = {};
  const conflicts: KoreanNameConflict[] = [];
  const unknownIds: string[] = [];
  for (const [loginId, next] of Object.entries(entries)) {
    const match = byId.get(loginId);
    if (!match) {
      unknownIds.push(loginId);
    } else if (match.korean_name) {
      conflicts.push({ loginId, current: match.korean_name, next });
    } else {
      fresh[loginId] = next;
    }
  }
  return { fresh, conflicts, unknownIds, entries };
}

export function buildMissingIdsJson(rows: EmployeeRow[]): string {
  const ids = rows.filter((r) => !r.korean_name).map((r) => r.login_id);
  return JSON.stringify(ids, null, 2);
}
