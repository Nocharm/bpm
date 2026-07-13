// CSV 내보내기 — csv-import 포맷 미러(왕복). 표현 불가 구조는 warnings로 명시.
// 설계: docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md §3
import type { Graph, GraphEdge, GraphNode } from "./api";

const HEADER = "Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next";

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** start부터 outgoing(sort_order 순) BFS — 흐름 순. 미도달 노드는 sort_order 순으로 뒤에. */
export function orderNodesByFlow(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const list = outgoing.get(e.source_node_id);
    if (list) list.push(e);
    else outgoing.set(e.source_node_id, [e]);
  }
  const bySort = (a: GraphNode, b: GraphNode) => a.sort_order - b.sort_order;
  const start = nodes.filter((n) => n.node_type === "start").sort(bySort)[0];
  const visited = new Set<string>();
  const ordered: GraphNode[] = [];
  const queue: string[] = start ? [start.id] : [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (node) ordered.push(node);
    const targets = (outgoing.get(id) ?? [])
      .map((e) => byId.get(e.target_node_id))
      .filter((n): n is GraphNode => n !== undefined)
      .sort(bySort);
    for (const t of targets) queue.push(t.id);
  }
  for (const node of [...nodes].sort(bySort)) {
    if (!visited.has(node.id)) ordered.push(node);
  }
  return ordered;
}

/** Graph → CSV(14컬럼) + 표현 불가 경고. BOM 없음·CRLF 조인 — BOM은 다운로드 시 접두(Task 7). */
export function buildCsvFromGraph(graph: Graph): { csv: string; warnings: string[] } {
  const warnings: string[] = [];
  const nodes = orderNodesByFlow(graph.nodes, graph.edges);
  const start = nodes.find((n) => n.node_type === "start") ?? null;
  const ends = nodes.filter((n) => n.node_type === "end");
  const primaryEnd = ends.find((n) => n.is_primary_end) ?? [...ends].sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
  for (const extraEnd of ends.filter((n) => n !== primaryEnd)) {
    warnings.push(`Secondary end node "${extraEnd.title}" is not expressible in CSV — skipped`);
  }
  const rows = nodes.filter((n) => n.node_type !== "start" && n.node_type !== "end");
  const titles = new Map<string, number>();
  for (const n of rows) titles.set(n.title, (titles.get(n.title) ?? 0) + 1);
  for (const [title, count] of titles) {
    if (count > 1) warnings.push(`Duplicate title "${title}" — re-import will fail on this file`);
  }
  const rowIds = new Set(rows.map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const line = (node: GraphNode): string => {
    const outs = graph.edges.filter((e) => e.source_node_id === node.id);
    const parts: string[] = [];
    for (const e of outs) {
      if (primaryEnd && e.target_node_id === primaryEnd.id) {
        if (e.label !== "" || outs.length > 1) {
          warnings.push(`Edge "${node.title}" → End ${e.label ? `(label "${e.label}") ` : ""}is not expressible in CSV — dropped`);
        }
        continue; // 유일·무라벨이면 임포트가 재생성
      }
      const target = byId.get(e.target_node_id);
      if (!target || !rowIds.has(target.id)) continue;
      // 임포트 파서는 Next를 ";"로 쪼개고 첫 ":"에서 target/label을 가른다 — 그 문자가 제목/라벨에 있으면 오파싱
      if (/[;:]/.test(target.title)) {
        warnings.push(`Next target "${target.title}" contains ";" or ":" — re-import will misparse this reference`);
      }
      if (e.label.includes(";")) {
        warnings.push(`Edge label "${e.label}" (from "${node.title}") contains ";" — re-import will misparse this reference`);
      }
      parts.push(e.label === "" ? target.title : `${target.title}:${e.label}`);
    }
    if (node.node_type === "decision" && parts.length < 2) {
      warnings.push(`Decision "${node.title}" has fewer than 2 branches — re-import will infer process`);
    }
    return [
      node.title, node.description, node.assignee, node.department, node.system,
      node.duration, node.cost_krw ?? "", node.cost_usd ?? "", node.headcount ?? "",
      node.annual_count ?? "", node.fte ?? "", node.url ?? "", node.url_label ?? "", parts.join(";"),
    ].map(escapeCell).join(",");
  };
  if (start) {
    const startTargets = new Set(
      graph.edges.filter((e) => e.source_node_id === start.id).map((e) => e.target_node_id),
    );
    const incoming = new Set(
      graph.edges.filter((e) => e.source_node_id !== start.id).map((e) => e.target_node_id),
    );
    const roots = new Set(rows.filter((n) => !incoming.has(n.id)).map((n) => n.id));
    const same = startTargets.size === roots.size && [...startTargets].every((id) => roots.has(id));
    if (!same) warnings.push("Start connections differ from computed roots — re-import will recompute them");
  }
  return { csv: [HEADER, ...rows.map(line)].join("\r\n"), warnings };
}
