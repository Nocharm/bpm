// CSV 내보내기 — csv-import 포맷 미러(왕복). 표현 불가 구조는 warnings로 명시.
// 설계: 2026-07-11-numeric-params-excel-csv-export-design.md §3, 열 선택은 export-column-picker-design(2026-10-02)
import type { Graph, GraphEdge, GraphNode } from "./api";
import { CSV_COLUMNS, type CsvColumnKey, normalizeExportColumns } from "./export-columns";
import { endKeyOfEdge, PRIMARY_END_HANDLE } from "./subprocess-embed";

/** 내보내기 셀의 시스템 — Other면 원문 메모(있을 때)를 싣는다. 재임포트 commitSystem이 미일치→Other+같은 메모로 복원. */
export function formatSystemCell(system: string, fallback: string): string {
  return system === "Other" && fallback.trim() !== "" ? fallback : system;
}

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

// 선택 열이 비었을 때도 행 셀 개수를 헤더와 맞추기 위한 셀 계산기 — Record라 열을 추가하면 tsc가 셀 누락을 잡는다.
type CsvCellOf = (node: GraphNode, next: string) => string;
const CSV_CELL: Record<CsvColumnKey, CsvCellOf> = {
  name: (node) => node.title,
  description: (node) => node.description,
  assignee: (node) => node.assignee,
  role: (node) => node.assignee_role ?? "",
  department: (node) => node.department,
  // Other 시스템은 원문 메모를 셀에 실어 재임포트가 같은 Other+메모로 돌아온다 (system_fallback 전용 열은 없다)
  system: (node) => formatSystemCell(node.system, node.system_fallback ?? ""),
  // 서브프로세스 노드는 자기 행의 duration/cost_*/headcount(보통 빈값)를 쓴다 — 링크 맵의
  // 상속값(excel-export.ts는 getInheritedParams로 이 값을 씀)을 쓰지 않는 것은 의도적 차이다.
  // CSV는 왕복(export→import) 포맷이라, 상속값을 쓰면 재임포트 시 "링크 맵 지정값이라 무시됨"
  // drop-warning이 매번 뜬다(mergeNode의 dropUneditableParams). Excel은 읽기전용 리포트라 무관.
  duration: (node) => node.duration,
  touch_time: (node) => node.touch_time ?? "",
  cost_krw: (node) => node.cost_krw ?? "",
  cost_usd: (node) => node.cost_usd ?? "",
  headcount: (node) => node.headcount ?? "",
  annual_count: (node) => node.annual_count ?? "",
  fte: (node) => node.fte ?? "",
  input: (node) => node.input ?? "",
  // Input_Flags·폼 — Input/Output 줄과 1:1 정렬(빈 줄 포함), 왕복 표면 (io-linking §3, 폼·GMP 2026-10-02)
  input_flags: (node) => node.input_flags ?? "",
  input_forms: (node) => node.input_forms ?? "",
  output: (node) => node.output ?? "",
  output_forms: (node) => node.output_forms ?? "",
  start_condition: (node) => node.start_condition ?? "",
  end_condition: (node) => node.end_condition ?? "",
  // SP 행은 자기 저장값(보통 빈값) — 링크 맵 상속 GMP를 실으면 재임포트마다 드롭 경고가 뜬다(파라미터와 같은 이유)
  gmp: (node) => node.gmp ?? "",
  url: (node) => node.url ?? "",
  url_label: (node) => node.url_label ?? "",
  // 병렬 출구(기본 출구) — 재임포트가 decision 대신 병렬 일반 노드로 되돌린다 (출력 규칙 2026-10-01).
  // 분기·끝 노드는 병렬 대상이 아니라(에디터 메뉴도 금지) 남은 플래그를 싣지 않는다 — 실으면 분기가 process로 뒤집힌다.
  parallel: (node) =>
    node.node_type !== "decision" && node.node_type !== "end" && (node.parallel_outputs ?? []).includes(PRIMARY_END_HANDLE)
      ? "Y"
      : "",
  next: (_node, next) => next,
};

export interface CsvExportOptions {
  // 내보낼 열(정식 순서로 재정렬·Name 강제). 미지정이면 25열 전부.
  columns?: readonly CsvColumnKey[];
}

/** Graph → CSV(선택 열, CSV_COLUMNS 순서) + 표현 불가 경고. BOM 없음·CRLF 조인 — BOM은 다운로드 시 접두. */
export function buildCsvFromGraph(graph: Graph, options: CsvExportOptions = {}): { csv: string; warnings: string[] } {
  const warnings: string[] = [];
  const columns = normalizeExportColumns(CSV_COLUMNS, options.columns);
  const header = CSV_COLUMNS.filter((c) => columns.includes(c.key)).map((c) => c.header).join(",");
  const nodes = orderNodesByFlow(graph.nodes, graph.edges);
  const start = nodes.find((n) => n.node_type === "start") ?? null;
  const ends = nodes.filter((n) => n.node_type === "end");
  const primaryEnd = ends.find((n) => n.is_primary_end) ?? [...ends].sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
  for (const extraEnd of ends.filter((n) => n !== primaryEnd)) {
    warnings.push(`Secondary end node "${extraEnd.title}" is not expressible in CSV - skipped`);
  }
  const rows = nodes.filter((n) => n.node_type !== "start" && n.node_type !== "end");
  const titles = new Map<string, number>();
  for (const n of rows) titles.set(n.title, (titles.get(n.title) ?? 0) + 1);
  for (const [title, count] of titles) {
    if (count > 1) warnings.push(`Duplicate title "${title}" - re-import will fail on this file`);
  }
  const rowIds = new Set(rows.map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const line = (node: GraphNode): string => {
    const outs = graph.edges.filter((e) => e.source_node_id === node.id);
    const parts: string[] = [];
    // 같은 대상은 한 번만 — SP의 두 끝이 같은 대상으로 가면 "T;T"가 되어 재임포트가 중복 대상 에러를 낸다
    const seenTargets = new Set<string>();
    const isParallelRow = CSV_CELL.parallel(node, "") === "Y";
    const isSubprocess = node.node_type === "subprocess";
    for (const e of outs) {
      if (primaryEnd && e.target_node_id === primaryEnd.id) {
        if (e.label !== "" || outs.length > 1) {
          warnings.push(`Edge "${node.title}" → End ${e.label ? `(label "${e.label}") ` : ""}is not expressible in CSV - dropped`);
        }
        continue; // 유일·무라벨이면 임포트가 재생성
      }
      const target = byId.get(e.target_node_id);
      if (target && target.node_type === "end") {
        // 보조 끝으로 들어가는 연결 — CSV엔 End 행이 없어 빠지고, 재임포트는 이 행을 대표 End에 잇는다
        warnings.push(
          `Edge "${node.title}" → secondary end "${target.title}" ${e.label ? `(label "${e.label}") ` : ""}` +
            `is not expressible in CSV - dropped (re-import connects this row to the primary End)` +
            (isParallelRow ? " - Parallel row will re-import with fewer than 2 Next targets" : ""),
        );
        continue;
      }
      if (!target || !rowIds.has(target.id)) continue;
      // SP 끝별 출구 — Next는 끝 키를 싣지 않는다(D3). 같은 맵 재가져오기는 기존 연결의 끝을 이월하고, 새 맵은 대표 끝
      const endKey = isSubprocess ? endKeyOfEdge({ sourceHandle: e.source_handle }) : PRIMARY_END_HANDLE;
      if (endKey !== PRIMARY_END_HANDLE) {
        warnings.push(
          `Subprocess "${node.title}" exit "${endKey}" → "${target.title}" is not expressible in CSV - ` +
            "re-import keeps it only when the same connection already exists",
        );
      }
      if (seenTargets.has(target.id)) {
        warnings.push(`"${node.title}" reaches "${target.title}" more than once - kept once in Next`);
        continue;
      }
      seenTargets.add(target.id);
      // 임포트 파서는 Next를 ";"로 쪼개고 첫 ":"에서 target/label을 가른다 — 그 문자가 제목/라벨에 있으면 오파싱
      if (/[;:]/.test(target.title)) {
        warnings.push(`Next target "${target.title}" contains ";" or ":" - re-import will misparse this reference`);
      }
      if (e.label.includes(";")) {
        warnings.push(`Edge label "${e.label}" (from "${node.title}") contains ";" - re-import will misparse this reference`);
      }
      parts.push(e.label === "" ? target.title : `${target.title}:${e.label}`);
    }
    if (node.node_type === "decision" && parts.length < 2) {
      warnings.push(`Decision "${node.title}" has fewer than 2 branches - re-import will infer process`);
    }
    // SP 끝별 병렬은 Parallel 열(기본 출구 전용)로 표현되지 않는다 — 같은 맵 재가져오기는 빈 칸=유지라 보존된다
    if (isSubprocess) {
      for (const key of node.parallel_outputs ?? []) {
        if (key === PRIMARY_END_HANDLE) continue;
        warnings.push(`Subprocess "${node.title}" has a parallel exit on end "${key}" - per-end parallel is not expressible in CSV`);
      }
    }
    const next = parts.join(";");
    return columns.map((key) => escapeCell(CSV_CELL[key](node, next))).join(",");
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
    if (!same) warnings.push("Start connections differ from computed roots - re-import will recompute them");
  }
  return { csv: [header, ...rows.map(line)].join("\r\n"), warnings };
}
