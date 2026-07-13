// Σ 합산 — 게시본 그래프의 파라미터. subprocess 노드는 링크 맵의 sp값(subprocess_refs).
// duration은 분 환산 캐리, 비용은 통화별 독립 합, 인원은 "값 있는 일반 노드의 평균"(SP 제외).
// design 2026-07-13 §4.
import type { Graph } from "./api";
import { DURATION_PATTERN, NUMERIC_PATTERN, normalizeDuration } from "./duration";
import type { SpParamField } from "./params";

/**
 * 합산 기여값 — SP 노드는 링크 맵 지정값. includeSubprocess=false면 SP 노드를 건너뛴다
 * (headcount 평균은 SP를 분자·분모 어디에도 넣지 않는다 — 하위 맵 값의 이중 반영 방지).
 */
function collectValues(graph: Graph, field: SpParamField, includeSubprocess: boolean): string[] {
  const values: string[] = [];
  for (const node of graph.nodes) {
    if (node.node_type === "subprocess" && node.linked_map_id !== null) {
      if (!includeSubprocess) continue;
      const raw = graph.subprocess_refs?.[node.linked_map_id]?.[field] ?? "";
      if (raw !== "") values.push(raw);
      continue;
    }
    const raw = node[field] ?? "";
    if (raw !== "") values.push(raw);
  }
  return values;
}

/** 십진 문자열 합 — 스케일 정수 합산으로 부동소수 오차 차단. */
function sumDecimal(values: string[]): string {
  const valid = values.filter((v) => NUMERIC_PATTERN.test(v));
  if (valid.length === 0) return "";
  const maxDecimals = valid.reduce((max, v) => Math.max(max, v.split(".")[1]?.length ?? 0), 0);
  const scale = 10 ** maxDecimals;
  const total = valid.reduce((sum, v) => sum + Math.round(Number(v) * scale), 0);
  return String(total / scale);
}

/**
 * 파라미터 4종 Σ. duration·cost_krw·cost_usd는 합, headcount는 값 있는 일반 노드의 평균(소수점 2자리).
 * 기여값 0개면 "" — 입력을 비워두는 것과 0을 구분한다.
 */
export function sumParamField(graph: Graph, field: SpParamField): string {
  if (field === "duration") {
    let totalMinutes = 0;
    let contributed = 0;
    for (const raw of collectValues(graph, field, true)) {
      const normalized = normalizeDuration(raw);
      if (normalized === null || normalized === "" || !DURATION_PATTERN.test(normalized)) continue;
      const [h, mm = ""] = normalized.split(".");
      totalMinutes += Number.parseInt(h, 10) * 60 + (mm === "" ? 0 : Number.parseInt(mm, 10));
      contributed += 1;
    }
    if (contributed === 0) return "";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? String(hours) : `${hours}.${String(minutes).padStart(2, "0")}`;
  }
  if (field === "headcount") {
    // 평균 — SP 노드는 하위 맵의 대표값이라 이중 반영을 피해 제외 (design 2026-07-13 §4)
    const valid = collectValues(graph, field, false).filter((v) => NUMERIC_PATTERN.test(v));
    if (valid.length === 0) return "";
    const total = valid.reduce((sum, v) => sum + Number(v), 0);
    return (total / valid.length).toFixed(2);
  }
  return sumDecimal(collectValues(graph, field, true));
}
