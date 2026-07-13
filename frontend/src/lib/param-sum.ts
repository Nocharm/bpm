// Σ 합산 — 게시본 그래프의 파라미터 직합. subprocess 노드는 링크 맵의 sp값(subprocess_refs).
// duration은 분 환산 캐리, 나머지는 스케일 정수 합산(부동소수 오차 차단). design 2026-07-11 SP §3.
import type { Graph } from "./api";
import { DURATION_PATTERN, NUMERIC_PATTERN, normalizeDuration } from "./duration";

// 노드와 SP 지정값 양쪽에 존재하는 파라미터만 합산 가능 — headcount는 Σ 버튼 없음(기존 동작 유지)
export type SummableField = "duration" | "cost_krw" | "cost_usd";

function collectValues(graph: Graph, field: SummableField): string[] {
  const values: string[] = [];
  for (const node of graph.nodes) {
    const raw =
      node.node_type === "subprocess" && node.linked_map_id !== null
        ? graph.subprocess_refs?.[node.linked_map_id]?.[field] ?? ""
        : (node[field] ?? "");
    if (raw !== "") values.push(raw);
  }
  return values;
}

/** 유효 기여값 합. 기여값 0개면 "" — 입력을 비워두는 것과 0을 구분한다. */
export function sumParamField(graph: Graph, field: SummableField): string {
  if (field === "duration") {
    let totalMinutes = 0;
    let contributed = 0;
    for (const raw of collectValues(graph, field)) {
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
  const valid = collectValues(graph, field).filter((v) => NUMERIC_PATTERN.test(v));
  if (valid.length === 0) return "";
  const maxDecimals = valid.reduce((max, v) => Math.max(max, v.split(".")[1]?.length ?? 0), 0);
  const scale = 10 ** maxDecimals;
  const total = valid.reduce((sum, v) => sum + Math.round(Number(v) * scale), 0);
  const result = total / scale;
  return String(result);
}
