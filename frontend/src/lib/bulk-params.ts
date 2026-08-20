// 그룹 일괄 편집의 필드 규칙 — 모드별 대상 노드 판정·비용 배타 패치·IO 폼 정렬 무효화 (group-bulk-modal 전용)
import { hasBpmAttributes } from "./canvas";
import { getEditableParamFields, PARAM_FIELDS, type ParamField } from "./params";

// 입출력·조건 일괄 모드 — IO는 개행 복수(append=줄 추가), 조건은 자유 텍스트 (2026-08-20)
export type BulkDetailField = "input" | "output" | "start_condition" | "end_condition";
export const BULK_DETAIL_FIELDS: readonly BulkDetailField[] = [
  "input", "output", "start_condition", "end_condition",
];

export function isBulkParamField(field: string): field is ParamField {
  return (PARAM_FIELDS as readonly string[]).includes(field);
}

export function isBulkDetailField(field: string): field is BulkDetailField {
  return (BULK_DETAIL_FIELDS as readonly string[]).includes(field);
}

/** 모드별 일괄 편집 대상 — people/system/IO·조건은 BPM 속성 노드만(SP는 링크 맵 상속이라 제외),
 *  파라미터는 노드 타입별 편집 가능 집합(SP는 annual_count·fte). */
export function canBulkEditField(
  nodeType: string,
  field: "people" | "system" | ParamField | BulkDetailField,
): boolean {
  if (field === "people" || field === "system" || isBulkDetailField(field)) {
    return hasBpmAttributes(nodeType);
  }
  return (getEditableParamFields(nodeType) as readonly string[]).includes(field);
}

/** 비용 배타 — 설정 시 반대 통화 명시적 소거, 비우기는 양쪽 소거(노드의 비용은 하나라는 불변식 유지).
 *  input/output은 항목별 폼 정렬(줄 1:1)을 지킨다 — 기존 항목이 줄 경계 접두로 보존되는 변경(동일/append)만
 *  폼을 유지하고, 그 외(교체·비우기)는 함께 소거한다(백엔드 재임포트 승계와 동일 규칙, 2026-08-20). */
export function buildBulkAttrPatch(
  field: "system" | ParamField | BulkDetailField,
  value: string,
  existing?: { input?: string; output?: string },
): Record<string, string> {
  if (field === "cost_krw" || field === "cost_usd") {
    if (value === "") return { cost_krw: "", cost_usd: "" };
    return field === "cost_krw"
      ? { cost_krw: value, cost_usd: "" }
      : { cost_usd: value, cost_krw: "" };
  }
  if (field === "input" || field === "output") {
    const prev = existing?.[field] ?? "";
    const keepsAlignment = prev !== "" && (value === prev || value.startsWith(`${prev}\n`));
    return keepsAlignment ? { [field]: value } : { [field]: value, [`${field}_forms`]: "" };
  }
  return { [field]: value };
}
