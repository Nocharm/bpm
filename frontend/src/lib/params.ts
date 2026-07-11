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
