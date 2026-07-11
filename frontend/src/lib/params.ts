// 숫자 파라미터 5종 메타 — 라벨은 추후 교체 예정이라 키를 1곳에 모음 (design 2026-07-11 §2.1)
import type { MessageKey } from "./i18n-messages";

export const PARAM_FIELDS = ["duration", "headcount", "etf", "cost", "extra"] as const;
export type ParamField = (typeof PARAM_FIELDS)[number];

export const PARAM_LABEL_KEY: Record<ParamField, MessageKey> = {
  duration: "field.duration",
  headcount: "field.headcount",
  etf: "field.etf",
  cost: "field.cost",
  extra: "field.extra",
};

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
