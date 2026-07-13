// 회당 단가 파라미터 6종 메타 — 필드·순서·라벨·노드 타입별 편집 가능 집합의 단일 소스
// (design 2026-07-13 §2.1, §3.1)
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
