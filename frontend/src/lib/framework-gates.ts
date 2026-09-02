// 확정 게이트 6종 고정 체크리스트 — readiness.failures(위반만)를 6행 전체로 합성 (Track B Task 6).
import type { ConfirmReadiness } from "./api";

export const GATE_CODES = [
  "missing_l6",
  "placeholder",
  "stale_link",
  "l6_unpublished",
  "noexit_cycle",
  "plain_fanout",
] as const;

export type GateCode = (typeof GATE_CODES)[number];

export interface GateChecklistRow {
  code: GateCode;
  passed: boolean;
  count: number;
  nodeIds: string[];
}

export function buildGateChecklist(readiness: ConfirmReadiness | null): GateChecklistRow[] {
  const failureByCode = new Map((readiness?.failures ?? []).map((f) => [f.code, f]));
  return GATE_CODES.map((code) => {
    const failure = failureByCode.get(code);
    return {
      code,
      passed: failure === undefined,
      count: failure?.count ?? 0,
      nodeIds: failure?.node_ids ?? [],
    };
  });
}
