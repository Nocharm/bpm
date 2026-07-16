// WBS(레벨 컬럼) Excel 모델 — 잎 업무 행 + 조상 경로(levels). 규칙 엔진은 1안(excel-export.ts)과
// 동형이되 start/end 전부 삭제·SP 무행이 다르다. 시트 기록은 Task 2에서 추가.
// 설계: docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md
import type { Graph, GraphEdge, GraphNode } from "./api";
import { orderNodesByFlow } from "./csv-export";
import { EXCEL_MAX_ROWS, getNodeRunParams } from "./excel-export";

export interface WbsNodeRow {
  kind: "node";
  no: number; // 최종 행 번호(1..n) — 삭제 규칙 적용 후 모델에서 부여
  levels: string[]; // 조상 경로 — [루트 맵 이름, SP 노드 타이틀…]. 길이 = 소속 레벨
  title: string;
  type: string;
  description: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  url: string;
  urlLabel: string;
  groups: string;
  next: string;
}

export interface WbsNoteRow {
  kind: "circular" | "denied" | "rowLimit";
  levels: string[];
  title: string;
}

export type WbsRow = WbsNodeRow | WbsNoteRow;

export interface WbsModel {
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  maxLevel: number; // 레벨 컬럼 수 — rows의 levels 최대 길이(행 없으면 1)
  rows: WbsRow[];
  truncated: boolean;
}

export async function buildWbsModel({
  graph,
  mapName,
  versionLabel,
  exportedAt,
  fetchResolved,
  maxRows = EXCEL_MAX_ROWS,
  rootMapId,
}: {
  graph: Graph;
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  fetchResolved: (mapId: number, followLatest: boolean, pinned: number | null) => Promise<Graph>;
  maxRows?: number;
  rootMapId?: number;
}): Promise<WbsModel> {
  const rows: WbsRow[] = [];
  let truncated = false;
  // 규칙4 주석 — 행 "객체" 참조로 기록해 번호 부여 후 일괄 조립(역방향 분기·다이아몬드 안전, 1안과 동일)
  const annotations: Array<{ target: WbsNodeRow; decision: WbsNodeRow; label: string }> = [];
  const cache = new Map<string, Promise<Graph>>();
  const fetchMemo = (mapId: number, followLatest: boolean, pinned: number | null): Promise<Graph> => {
    const key = `${mapId}:${followLatest}:${pinned}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = fetchResolved(mapId, followLatest, pinned);
    cache.set(key, p);
    return p;
  };

  const emit = async (g: Graph, levels: string[], ancestry: ReadonlySet<number>): Promise<void> => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const groupLabel = new Map(g.groups.map((gr) => [gr.id, gr.label]));
    const outgoing = new Map<string, GraphEdge[]>();
    for (const e of g.edges) {
      const list = outgoing.get(e.source_node_id);
      if (list) list.push(e);
      else outgoing.set(e.source_node_id, [e]);
    }
    const ordered = orderNodesByFlow(g.nodes, g.edges);
    // 1안과 동일: 나가는 엣지가 있고 전부 무라벨인 디시전 = 단순 병렬 분기(엣지 없는 디시전은 WIP로 유지)
    const isRemovedDecision = (n: GraphNode): boolean => {
      if (n.node_type !== "decision") return false;
      const out = outgoing.get(n.id) ?? [];
      return out.length > 0 && out.every((e) => e.label === "");
    };
    // 2안: start/end 전부 삭제(커스텀 제목 포함 — 구조 노드 완전 배제)·미연결 SP도 행 미차지
    const isRowRemoved = (n: GraphNode): boolean =>
      n.node_type === "start" || n.node_type === "end" || isRemovedDecision(n) ||
      (n.node_type === "subprocess" && n.linked_map_id === null);
    // 1안과 동일: 삭제 디시전 flow-through + 라벨 전파(next·주석 공용, seen은 순환 가드)
    const resolveTargets = (
      edge: GraphEdge,
      label: string,
      seen: ReadonlySet<string>,
    ): Array<{ node: GraphNode; label: string }> => {
      const target = byId.get(edge.target_node_id);
      if (!target) return [];
      if (!isRemovedDecision(target)) return [{ node: target, label }];
      if (seen.has(target.id)) return [];
      const nextSeen = new Set([...seen, target.id]);
      return (outgoing.get(target.id) ?? []).flatMap((e) => resolveTargets(e, label, nextSeen));
    };

    const rowByNodeId = new Map<string, WbsNodeRow>(); // 스코프(맵 인스턴스) 한정

    for (const node of ordered) {
      if (isRowRemoved(node)) continue; // 삭제 노드는 상한(maxRows)을 소비하지 않는다
      if (rows.length >= maxRows) {
        // return이 아닌 break — 주석 수집 패스를 실행해 이미 출력된 행의 주석 보존(1안과 동일)
        if (!truncated) rows.push({ kind: "rowLimit", levels, title: "" });
        truncated = true;
        break;
      }
      if (node.node_type === "subprocess" && node.linked_map_id !== null) {
        // SP는 행 미차지 — 레벨 경로에 노드 타이틀을 붙이고 링크 맵의 잎 행들을 제자리 전개
        if (ancestry.has(node.linked_map_id)) {
          rows.push({ kind: "circular", levels, title: node.title });
          continue;
        }
        let resolved: Graph;
        try {
          resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
        } catch {
          rows.push({ kind: "denied", levels, title: node.title });
          continue;
        }
        if (resolved.locked) {
          rows.push({ kind: "denied", levels, title: node.title });
          continue;
        }
        await emit(resolved, [...levels, node.title], new Set([...ancestry, node.linked_map_id]));
        continue;
      }
      // Set 중복 제거 — 삭제 디시전 경유 재수렴 시 같은 (대상, 라벨) 2회 도달 방지(1안과 동일)
      const next = Array.from(new Set(
        (outgoing.get(node.id) ?? [])
          .flatMap((e) => resolveTargets(e, e.label, new Set()))
          .map(({ node: t, label }) => (label === "" ? t.title : `${t.title}:${label}`)),
      )).join(";");
      const row: WbsNodeRow = {
        kind: "node",
        no: 0, // finalize에서 부여
        levels,
        title: node.title,
        type: node.node_type,
        description: node.description,
        assignee: node.assignee,
        department: node.department,
        system: node.system,
        ...getNodeRunParams(g, node),
        annual_count: node.annual_count ?? "",
        fte: node.fte ?? "",
        url: node.url ?? "",
        urlLabel: node.url_label ?? "",
        groups: node.group_ids.map((id) => groupLabel.get(id) ?? "").filter(Boolean).join(", "),
        next,
      };
      rows.push(row);
      rowByNodeId.set(node.id, row);
    }

    // 규칙4 주석 수집 — SP는 rowByNodeId에 없어 주석 자동 소멸. 재수렴 중복 방지 포함(1안과 동일)
    for (const node of ordered) {
      if (node.node_type !== "decision") continue;
      const decisionRow = rowByNodeId.get(node.id);
      if (!decisionRow) continue;
      const seenPairs = new Map<WbsNodeRow, Set<string>>();
      for (const e of outgoing.get(node.id) ?? []) {
        if (e.label === "") continue;
        for (const { node: t, label } of resolveTargets(e, e.label, new Set())) {
          const targetRow = rowByNodeId.get(t.id);
          if (!targetRow) continue;
          const labels = seenPairs.get(targetRow) ?? new Set<string>();
          if (labels.has(label)) continue;
          labels.add(label);
          seenPairs.set(targetRow, labels);
          annotations.push({ target: targetRow, decision: decisionRow, label });
        }
      }
    }
  };

  await emit(graph, [mapName], new Set(rootMapId != null ? [rootMapId] : []));

  // 번호 부여(1..n 연속) → 주석 조립 — next는 emit 시점 확정이라 주석이 섞이지 않는다
  let no = 0;
  for (const row of rows) {
    if (row.kind === "node") {
      no += 1;
      row.no = no;
    }
  }
  for (const { target, decision, label } of annotations) {
    target.title += ` [${decision.no}:${label}]`;
  }

  const maxLevel = rows.reduce((m, r) => Math.max(m, r.levels.length), 1);
  return { mapName, versionLabel, exportedAt, maxLevel, rows, truncated };
}
