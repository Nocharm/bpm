// 그룹 일괄 편집의 파라미터 규칙 — 모드별 대상 노드 판정·비용 배타 패치 (group-bulk-modal 전용)
import { hasBpmAttributes } from "./canvas";
import { getEditableParamFields, PARAM_FIELDS, type ParamField } from "./params";

export function isBulkParamField(field: "system" | ParamField): field is ParamField {
  return (PARAM_FIELDS as readonly string[]).includes(field);
}

/** 모드별 일괄 편집 대상 — people/system은 BPM 속성 노드만, 파라미터는 노드 타입별 편집 가능 집합(SP는 annual_count·fte). */
export function canBulkEditField(
  nodeType: string,
  field: "people" | "system" | ParamField,
): boolean {
  if (field === "people" || field === "system") return hasBpmAttributes(nodeType);
  return (getEditableParamFields(nodeType) as readonly string[]).includes(field);
}

/** 비용 배타 — 설정 시 반대 통화 명시적 소거, 비우기는 양쪽 소거(노드의 비용은 하나라는 불변식 유지). */
export function buildBulkAttrPatch(
  field: "system" | ParamField,
  value: string,
): Record<string, string> {
  if (field === "cost_krw" || field === "cost_usd") {
    if (value === "") return { cost_krw: "", cost_usd: "" };
    return field === "cost_krw"
      ? { cost_krw: value, cost_usd: "" }
      : { cost_usd: value, cost_krw: "" };
  }
  return { [field]: value };
}
