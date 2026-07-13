// 회당 단가 파라미터 6종 메타 — 필드·순서·라벨·노드 타입별 편집 가능 집합의 단일 소스
// (design 2026-07-13 §2.1, §3.1)
import { formatDurationHm, formatThousands } from "./duration";
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

/** 비용 배타 — 한쪽 비용에 값이 있으면 반대쪽 입력은 비활성 (design 2026-07-13 §3.2) */
export function isCostFieldDisabled(field: ParamField, costKrw: string, costUsd: string): boolean {
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
