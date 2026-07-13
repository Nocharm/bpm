// 회당 단가 파라미터 6종 메타 — 필드·순서·라벨·노드 타입별 편집 가능 집합의 단일 소스
// (design 2026-07-13 §2.1, §3.1)
import { formatDurationHm, formatThousands, normalizeDuration, normalizeNumericParam, stripThousands } from "./duration";
import type { MessageKey } from "./i18n-messages";

export const PARAM_FIELDS = [
  "duration",
  "cost_krw",
  "cost_usd",
  "headcount",
  "annual_count",
  "fte",
] as const;
export type ParamField = (typeof PARAM_FIELDS)[number];

/** SP 지정값(하위 맵이 대표로 노출)은 4종 — 연간 건수·FTE는 부모 맥락 값이라 제외 */
export const SP_PARAM_FIELDS = ["duration", "cost_krw", "cost_usd", "headcount"] as const;
export type SpParamField = (typeof SP_PARAM_FIELDS)[number];

/** 서브프로세스 노드에서 사람이 직접 입력하는 필드 — 나머지 4개는 링크 맵 지정값(읽기전용) */
export const SUBPROCESS_OWN_FIELDS = ["annual_count", "fte"] as const;

export const COST_FIELDS = ["cost_krw", "cost_usd"] as const;

export const PARAM_LABEL_KEY: Record<ParamField, MessageKey> = {
  duration: "field.duration",
  cost_krw: "field.costKrw",
  cost_usd: "field.costUsd",
  headcount: "field.headcount",
  annual_count: "field.annualCount",
  fte: "field.fte",
};

/** 노드 타입 → 편집 가능한 파라미터. start/end는 없음, subprocess는 2개 (design §3.1) */
export function getEditableParamFields(nodeType: string): readonly ParamField[] {
  if (nodeType === "start" || nodeType === "end") return [];
  if (nodeType === "subprocess") return SUBPROCESS_OWN_FIELDS;
  return PARAM_FIELDS;
}

/**
 * 비용 배타 — 한쪽 비용에 값이 있으면 반대쪽 입력은 비활성 (design 2026-07-13 §3.2).
 * 단, 둘 다 값이 있는 상태(레거시 행·CSV/AI 병합 이전 데이터 등)는 잠그지 않는다 — 잠그면
 * 어느 쪽도 지울 수 없는 막다른 상태가 된다(finding: 병합 경로가 반대쪽을 못 지우면 도달 가능).
 */
export function isCostFieldDisabled(field: ParamField, costKrw: string, costUsd: string): boolean {
  if (costKrw.trim() !== "" && costUsd.trim() !== "") return false;
  if (field === "cost_krw") return costUsd.trim() !== "";
  if (field === "cost_usd") return costKrw.trim() !== "";
  return false;
}

/**
 * 파라미터 표시형(편집 중 아닌 모든 화면) — duration은 1h30m, 비용은 통화기호+천단위 콤마, 나머지는 원문 숫자.
 * 무효(레거시 자유텍스트)·빈값은 "" — 비용에서 통화기호만 남는 것을 막는다. 캔버스 칩·인스펙터·요약 모달 공용.
 */
export function formatParamValue(field: ParamField, raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (field === "duration") return formatDurationHm(value);
  if (field === "cost_krw") {
    const amount = formatThousands(value);
    return amount ? `₩${amount}` : "";
  }
  if (field === "cost_usd") {
    const amount = formatThousands(value);
    return amount ? `$${amount}` : "";
  }
  return value;
}

/** 링크 맵에서 상속되는(=부모 맵에서 편집 불가) 파라미터인지 — 읽기전용 행 렌더 분기용 */
export function isSpParamField(field: ParamField): field is SpParamField {
  return (SP_PARAM_FIELDS as readonly string[]).includes(field);
}

/**
 * 노드 타입이 편집할 수 없는 파라미터 필드를 후보값에서 드롭 — CSV(Task 8)·AI(Task 10) 병합 공용.
 * subprocess는 annual_count·fte만 통과(나머지 4개는 링크 맵 지정값이라 부모가 못 건드림). 실제 값이
 * 있던 드롭 필드만 droppedFields에 담아, caller(임포트/제안 병합)가 사용자에게 경고할 수 있게 한다.
 */
export function dropUneditableParams(
  nodeType: string,
  candidate: Partial<Record<ParamField, string>>,
): { allowed: Partial<Record<ParamField, string>>; droppedFields: ParamField[] } {
  const editable = new Set<ParamField>(getEditableParamFields(nodeType));
  const allowed: Partial<Record<ParamField, string>> = {};
  const droppedFields: ParamField[] = [];
  for (const field of PARAM_FIELDS) {
    const value = candidate[field];
    if (value === undefined) continue;
    if (editable.has(field)) {
      allowed[field] = value;
    } else if (value !== "") {
      droppedFields.push(field);
    }
  }
  return { allowed, droppedFields };
}

/**
 * 통화 배타 — cost_krw·cost_usd가 후보값에 동시에 있으면 위반. 백엔드 NodeIn 검증기가 둘 다
 * 채워지면 저장 전체를 422시키므로, AI 변환단(graph 병합·ops set_attr 공용)에서 먼저 둘 다 드롭한다.
 * 위반 시 두 키를 결과에서 아예 뺀다("" 명시가 아님) — ops set_attr(resolveAiParamPatch)는 이 값을
 * 그대로 patch에 스프레드하므로, ""를 채우면 "명시적 지움"으로 해석돼 기존 값을 지워버린다. 부재만이
 * "건드리지 않음"이며, graph 병합 경로(mergeNode의 pick)는 부재를 `?? ""`로 받아 기존과 동일하게 동작.
 */
export function dropConflictingCurrency(
  candidate: Partial<Record<ParamField, string>>,
): { values: Partial<Record<ParamField, string>>; conflict: boolean } {
  if ((candidate.cost_krw ?? "") !== "" && (candidate.cost_usd ?? "") !== "") {
    const values = { ...candidate };
    delete values.cost_krw;
    delete values.cost_usd;
    return { values, conflict: true };
  }
  return { values: candidate, conflict: false };
}

/**
 * 통화 병합 — 후보(next)가 한쪽에 값을 채우면 통화 전환으로 보고 반대쪽을 명시적으로 비운다.
 * 후보가 둘 다 비어있으면(건드리지 않음) 기존 값을 그대로 지킨다. csv-import.ts mergeNode 전용
 * (finding: 필드별 독립 pick은 KRW→USD 전환 시 기존 USD가 안 지워져 두 통화가 동시에 남는다 —
 * 백엔드 422 또는 SP set_attr 자동저장 루프로 이어진다). next는 이미 dropUneditableParams를
 * 거친 값이라 둘 다 non-empty로 들어오지 않는다(CSV 행 검증·dropConflictingCurrency가 상류에서 보장).
 */
export function resolveCostFields(
  nextKrw: string,
  nextUsd: string,
  existingKrw: string,
  existingUsd: string,
): { cost_krw: string; cost_usd: string } {
  if (nextKrw !== "") return { cost_krw: nextKrw, cost_usd: "" };
  if (nextUsd !== "") return { cost_krw: "", cost_usd: nextUsd };
  return { cost_krw: existingKrw, cost_usd: existingUsd };
}

/**
 * 패치에 한쪽 통화가 값으로 설정되면 반대쪽을 ""로 추가 — 스프레드 대상(node.data)에 반대쪽
 * 값이 남지 않게 한다. 둘 다 손대지 않았으면(키 부재) 그대로 둔다. resolveAiParamPatch 전용
 * (mergeNode와 달리 여기는 기존값을 모르는 "패치"라 반대쪽을 지우려면 ""를 명시해야 한다).
 */
function clearCounterpartCurrency(
  patch: Partial<Record<ParamField, string>>,
): Partial<Record<ParamField, string>> {
  if (patch.cost_krw !== undefined && patch.cost_krw !== "") return { ...patch, cost_usd: "" };
  if (patch.cost_usd !== undefined && patch.cost_usd !== "") return { ...patch, cost_krw: "" };
  return patch;
}

/** AI ops set_attr가 보내는 부분 갱신 후보(파라미터 6종만) — 나머지 AiNodeAttributes 필드는 무관. */
export interface AiParamPatchInput {
  duration?: string | null;
  cost_krw?: string | null;
  cost_usd?: string | null;
  headcount?: string | null;
  annual_count?: string | null;
  fte?: string | null;
}

/**
 * AI ops set_attr의 파라미터 부분 갱신 → 실제 반영할 패치. 정규화(무효 에코는 키 생략) → 통화 배타
 * 드롭 → 통화 전환 시 반대쪽 소거(clearCounterpartCurrency) → 노드 타입별 편집 가능 필드 게이트
 * 순으로 처리(순서를 바꾸면 SP 노드의 통화 위반이 SP 드롭 경고에 묻힌다).
 * buildGraphFromAiProposal(csv-import.ts)과 같은 두 규칙(dropConflictingCurrency·dropUneditableParams)을
 * 그대로 재사용 — 새 규칙을 만들지 않는다.
 * 결과에 없는 필드는 "AI가 이 필드를 건드리지 않음"(undefined 유지). 무효 에코(정규화 실패)도 같은
 * 이유로 키를 생략한다 — page.tsx가 이 패치를 node.data에 그대로 스프레드하므로, ""를 넣으면
 * "명시적 지움"과 구분이 안 돼 기존 값을 지워버린다. 빈 문자열 에코("지움" 의도)는 정규화가 그대로
 * ""를 돌려주므로 patch에 "" 그대로 남는다 — 무효(키 생략) vs 명시적 지움("")을 구분하는 지점.
 * 단, 한쪽 통화가 유효값으로 설정되면 반대쪽은 명시적 ""가 patch에 추가된다(통화 전환 완결 —
 * finding: 편도만 반영하면 두 통화가 동시에 채워진 상태로 남아 다음 autosave가 422 루프에 빠진다).
 */
export function resolveAiParamPatch(
  nodeType: string,
  attr: AiParamPatchInput,
): Partial<Record<ParamField, string>> {
  const touched: Partial<Record<ParamField, string>> = {};
  if (attr.duration != null) {
    const normalized = normalizeDuration(attr.duration);
    if (normalized !== null) touched.duration = normalized;
  }
  const applyNumeric = (field: Exclude<ParamField, "duration">, raw: string | null | undefined) => {
    if (raw == null) return;
    const normalized = normalizeNumericParam(stripThousands(raw));
    if (normalized !== null) touched[field] = normalized;
  };
  applyNumeric("cost_krw", attr.cost_krw);
  applyNumeric("cost_usd", attr.cost_usd);
  applyNumeric("headcount", attr.headcount);
  applyNumeric("annual_count", attr.annual_count);
  applyNumeric("fte", attr.fte);
  const { values: guarded } = dropConflictingCurrency(touched);
  return dropUneditableParams(nodeType, clearCounterpartCurrency(guarded)).allowed;
}

/**
 * AI가 신규 노드에 링크 없이 보낸 subprocess 타입은 process로 강등 — Call Activity는
 * linked_map_id가 있어야 렌더/조회되므로, 링크 없는 subprocess는 칩·인스펙터 어디에도 값이
 * 나오지 않는 죽은 상태이면서 CSV export·비교 diff엔 값이 샌다 (finding: AiNode.node_type은
 * 자유 문자열). 신규 노드 변환 경로 전용(page.tsx aiNodeToGraphNode·buildGraphFromAiProposal의
 * 신규 노드 분기) — 두 경로가 이 함수 하나로 대칭을 유지한다. 이미 링크된 매칭 노드는
 * mergeNode가 node_type을 별도로 보존하므로 이 함수를 거치지 않는다.
 */
export function coerceAiNewNodeType(nodeType: string): string {
  return nodeType === "subprocess" ? "process" : nodeType;
}

/** 서브프로세스 노드가 링크 맵에서 상속하는 회당 4필드의 원천(subprocess_refs 행의 부분집합). */
export interface InheritedParamSource {
  designated: boolean;
  duration: string | null;
  cost_krw: string | null;
  cost_usd: string | null;
  headcount: string | null;
}

/**
 * 링크 맵 지정값 → 서브프로세스 노드의 읽기전용 파라미터 4종. 미지정·참조 미수신이면 전부 "".
 * 노드 행에 저장하지 않는 라이브 참조라, 부모 맵은 이 값을 편집·저장할 수 없다 (design 2026-07-13 §3.1).
 */
export function getInheritedParams(
  ref: InheritedParamSource | null | undefined,
): Record<SpParamField, string> {
  const pick = (value: string | null): string => (ref?.designated ? value ?? "" : "");
  return {
    duration: pick(ref?.duration ?? null),
    cost_krw: pick(ref?.cost_krw ?? null),
    cost_usd: pick(ref?.cost_usd ?? null),
    headcount: pick(ref?.headcount ?? null),
  };
}

export const PARAMS_COLLAPSED_KEY = "bpm.paramsCollapsed";

/** 저장값 없으면 기본 접힘(true). 직전 토글 상태는 세션 간 유지 (design 2026-07-11 SP §5). */
export function readParamsCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  const saved = window.localStorage.getItem(PARAMS_COLLAPSED_KEY);
  return saved === null ? true : saved === "1";
}

export function writeParamsCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PARAMS_COLLAPSED_KEY, collapsed ? "1" : "0");
}
