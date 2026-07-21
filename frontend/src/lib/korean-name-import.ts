// 한글이름 JSON 임포트 파서·분류 — 어드민 일괄 등록 모달용(순수 함수, DOM/fetch 없음).
// 두 포맷 자동 판별: 루트가 배열이면 사내 조회 도구 응답([{userId, status, name, dept, ...}],
// status!=="found" 무시), 객체면 수동 맵({"login_id": "이름"}).
// 설계: docs/design/2026-07-09-user-korean-name-import-design.md

import type { EmployeeRow } from "./api";

export interface KoreanNameEntryValue {
  name: string;
  dept: string;
}

export interface KoreanNameConflict {
  loginId: string;
  current: string;
  next: string;
}

export interface KoreanNameClassification {
  /** 기존 값 없는 유저 — 확인 없이 적용 가능 */
  fresh: Record<string, KoreanNameEntryValue>;
  /** 기존 값 보유 유저 — skip/overwrite 선택 대상 */
  conflicts: KoreanNameConflict[];
  /** employees에 없는 login_id — 서버도 unknown으로 재보고 */
  unknownIds: string[];
  /** trim·빈 이름 제거 후 전체 항목 — PUT payload 그대로 */
  entries: Record<string, KoreanNameEntryValue>;
}

type ParseResult = { entries: Record<string, KoreanNameEntryValue> } | { error: string };

function parseMapFormat(data: Record<string, unknown>): ParseResult {
  const entries: Record<string, KoreanNameEntryValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") {
      return { error: `Value for "${key}" must be a string.` };
    }
    const name = value.trim();
    if (!name) continue; // 빈 값은 이름 삭제가 아니라 미기입 — 무시
    entries[key.trim()] = { name, dept: "" };
  }
  return { entries };
}

function parseLookupArrayFormat(items: unknown[]): ParseResult {
  const entries: Record<string, KoreanNameEntryValue> = {};
  for (const [index, item] of items.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { error: `Item at index ${index} must be an object.` };
    }
    const record = item as Record<string, unknown>;
    if (record.status !== "found") continue; // not_found·error 등은 무시 — 사용자 합의
    if (typeof record.userId !== "string" || !record.userId.trim()) {
      return { error: `Item at index ${index} is missing a "userId" string.` };
    }
    const userId = record.userId.trim();
    if (typeof record.name !== "string") {
      return { error: `"name" for "${userId}" must be a string.` };
    }
    const name = record.name.trim();
    if (!name) continue; // found인데 이름이 빈 항목 — 무시
    const dept = typeof record.dept === "string" ? record.dept.trim() : "";
    entries[userId] = { name, dept };
  }
  return { entries };
}

export function parseKoreanNamesJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Invalid JSON file." };
  }
  if (Array.isArray(data)) {
    return parseLookupArrayFormat(data);
  }
  if (typeof data !== "object" || data === null) {
    return {
      error:
        'Expected a lookup response array or an object map: { "login_id": "korean name" }.',
    };
  }
  return parseMapFormat(data as Record<string, unknown>);
}

export function classifyKoreanNames(
  entries: Record<string, KoreanNameEntryValue>,
  rows: EmployeeRow[],
): KoreanNameClassification {
  const byId = new Map(rows.map((r) => [r.login_id, r]));
  const fresh: Record<string, KoreanNameEntryValue> = {};
  const conflicts: KoreanNameConflict[] = [];
  const unknownIds: string[] = [];
  for (const [loginId, entry] of Object.entries(entries)) {
    const match = byId.get(loginId);
    if (!match) {
      unknownIds.push(loginId);
    } else if (match.korean_name) {
      conflicts.push({ loginId, current: match.korean_name, next: entry.name });
    } else {
      fresh[loginId] = entry;
    }
  }
  return { fresh, conflicts, unknownIds, entries };
}

export function buildMissingIdsJson(rows: EmployeeRow[]): string {
  const ids = rows.filter((r) => !r.korean_name).map((r) => r.login_id);
  return JSON.stringify(ids, null, 2);
}
