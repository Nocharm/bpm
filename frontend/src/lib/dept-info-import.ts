// 부서 정보(한글 부서명·부서장) JSON 임포트 파서 — 어드민 부서 탭 모달용(순수 함수, DOM/fetch 없음).
// 포맷: 배열 [{dept, koreanName, manager}] — 매칭키는 dept(영문 리프 부서명).

// ⚠️ 임시 필드명 — 실제 소스 포맷(키) 확정 시 아래 세 상수만 변경 (2026-07-09 사용자 합의)
const FIELD_DEPT = "dept";
const FIELD_KOREAN = "koreanName";
const FIELD_MANAGER = "manager";

export const DEPT_INFO_EXAMPLE = `[
  { "${FIELD_DEPT}": "Sourcing Team 1", "${FIELD_KOREAN}": "구매1팀", "${FIELD_MANAGER}": "hong.gildong" }
]`;

export interface DeptInfoEntryValue {
  korean_name: string;
  manager: string;
}

type ParseResult = { entries: Record<string, DeptInfoEntryValue> } | { error: string };

function readStringField(
  record: Record<string, unknown>,
  field: string,
): string | { error: string } {
  const value = record[field];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return { error: `"${field}" must be a string.` };
  return value.trim();
}

export function parseDeptInfoJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Invalid JSON." };
  }
  if (!Array.isArray(data)) {
    return { error: `Expected an array: [{ "${FIELD_DEPT}": ..., "${FIELD_KOREAN}": ..., "${FIELD_MANAGER}": ... }].` };
  }
  const entries: Record<string, DeptInfoEntryValue> = {};
  for (const [index, item] of data.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { error: `Item at index ${index} must be an object.` };
    }
    const record = item as Record<string, unknown>;
    const dept = readStringField(record, FIELD_DEPT);
    if (typeof dept !== "string") return dept;
    const koreanName = readStringField(record, FIELD_KOREAN);
    if (typeof koreanName !== "string") return koreanName;
    const manager = readStringField(record, FIELD_MANAGER);
    if (typeof manager !== "string") return manager;
    if (!dept) continue; // 매칭키 없는 항목 — 무시
    if (!koreanName && !manager) continue; // 둘 다 빈 항목 — 삭제 기능 아님, 무시
    entries[dept] = { korean_name: koreanName, manager };
  }
  return { entries };
}
