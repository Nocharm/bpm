// 부서 정보(한글 부서명·부서장) JSON 임포트 파서 — 어드민 부서 탭 모달용(순수 함수, DOM/fetch 없음).
// 포맷: 조직도 export의 { flat, tree } — tree만 재귀 순회하고 flat은 무시한다(같은 부서의 중복 표현).
// 매칭키는 enDeptNm(영문 부서명). 본부·실·팀·파트 전 레벨을 담으므로 백엔드도 전 org 레벨을 수용한다.

const FIELD_DEPT = "enDeptNm";
const FIELD_KOREAN = "deptNm";
const FIELD_MANAGER = "dheadUserId"; // 부서장 login_id — 이름(dheadFnm)은 디렉터리가 해석하므로 저장 안 함
const FIELD_CHILDREN = "children";

export const DEPT_INFO_EXAMPLE = `{
  "tree": [
    {
      "${FIELD_DEPT}": "Management Division",
      "${FIELD_KOREAN}": "경영지원본부",
      "${FIELD_MANAGER}": "hong.gildong",
      "${FIELD_CHILDREN}": [
        { "${FIELD_DEPT}": "HR Team 1", "${FIELD_KOREAN}": "인사1팀", "${FIELD_MANAGER}": "kim.cs" }
      ]
    }
  ]
}`;

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

/** 노드 하나를 entries에 반영하고 children으로 내려간다. 에러 메시지를 반환하면 파싱 중단. */
function collectNode(
  node: unknown,
  path: string,
  entries: Record<string, DeptInfoEntryValue>,
): string | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return `Node at ${path} must be an object.`;
  }
  const record = node as Record<string, unknown>;

  const dept = readStringField(record, FIELD_DEPT);
  if (typeof dept !== "string") return dept.error;
  const koreanName = readStringField(record, FIELD_KOREAN);
  if (typeof koreanName !== "string") return koreanName.error;
  const manager = readStringField(record, FIELD_MANAGER);
  if (typeof manager !== "string") return manager.error;

  // 매칭키 없는 래퍼 노드, 채울 값이 없는 노드는 건너뛴다 — 삭제 기능이 아니다. 자식 순회는 계속.
  if (dept && (koreanName || manager)) {
    entries[dept] = { korean_name: koreanName, manager };
  }

  const children = record[FIELD_CHILDREN];
  if (children === undefined || children === null) return null;
  if (!Array.isArray(children)) return `"${FIELD_CHILDREN}" at ${path} must be an array.`;
  for (const [index, child] of children.entries()) {
    const error = collectNode(child, `${path}.${FIELD_CHILDREN}[${index}]`, entries);
    if (error) return error;
  }
  return null;
}

export function parseDeptInfoJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Invalid JSON." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { error: `Expected an object with a "tree" array.` };
  }
  const tree = (data as Record<string, unknown>).tree;
  if (!Array.isArray(tree)) {
    return { error: `"tree" must be an array of department nodes.` };
  }
  const entries: Record<string, DeptInfoEntryValue> = {};
  for (const [index, node] of tree.entries()) {
    const error = collectNode(node, `tree[${index}]`, entries);
    if (error) return { error };
  }
  return { entries };
}
