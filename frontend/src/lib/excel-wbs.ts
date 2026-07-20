// WBS(레벨 컬럼) Excel 모델 — 잎 업무 행 + 조상 경로(levels). 규칙 엔진은 1안(excel-export.ts)과
// 동형이되 start/end 전부 삭제·SP 무행이 다르다. 시트 기록은 Task 2에서 추가.
// 설계: docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md
import type { Graph, GraphEdge, GraphNode } from "./api";
import { orderNodesByFlow } from "./csv-export";
import { COLUMNS, EXCEL_MAX_ROWS, HEADER_FILL, NOTE_TEXT, downloadWorkbookXlsx, getNodeRunParams } from "./excel-export";
import { mergeSubprocessDescription } from "./subprocess-description";

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

    // Set 중복 제거 — 삭제 디시전 경유 재수렴 시 같은 (대상, 라벨) 2회 도달 방지(1안과 동일)
    const nextOf = (node: GraphNode): string =>
      Array.from(new Set(
        (outgoing.get(node.id) ?? [])
          .flatMap((e) => resolveTargets(e, e.label, new Set()))
          .map(({ node: t, label }) => (label === "" ? t.title : `${t.title}:${label}`)),
      )).join(";");

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
        let resolved: Graph | undefined;
        try {
          resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
        } catch {
          resolved = undefined;
        }
        if (resolved && !resolved.locked) {
          await emit(resolved, [...levels, node.title], new Set([...ancestry, node.linked_map_id]));
          continue;
        }
        // 잠김(권한 마스킹)·해석 실패 SP는 전개 불가 — 자신이 잎 행이 되어 흐름을 보존하고(1안 SP 행과
        // 동일 소스: 파라미터 지정정보 상속·설명 베이스+추가분 합성) 아래 denied 노트로 하위 가림을 표시
        const spRow: WbsNodeRow = {
          kind: "node",
          no: 0, // finalize에서 부여
          levels,
          title: node.title,
          type: node.node_type,
          description: mergeSubprocessDescription(
            g.subprocess_refs?.[node.linked_map_id]?.sp_description,
            node.description,
          ),
          assignee: node.assignee,
          department: node.department,
          system: node.system,
          ...getNodeRunParams(g, node),
          annual_count: node.annual_count ?? "",
          fte: node.fte ?? "",
          url: node.url ?? "",
          urlLabel: node.url_label ?? "",
          groups: node.group_ids.map((id) => groupLabel.get(id) ?? "").filter(Boolean).join(", "),
          next: nextOf(node),
        };
        rows.push(spRow);
        rowByNodeId.set(node.id, spRow);
        rows.push({ kind: "denied", levels: [...levels, node.title], title: node.title });
        continue;
      }
      const next = nextOf(node);
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

    // 규칙4 주석 수집 — 전개된 SP는 rowByNodeId에 없어 주석 자동 소멸(잠긴 SP 잎 행은 대상 유지).
    // 재수렴 중복 방지 포함(1안과 동일)
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

const LEVEL_FONT_ARGB = "FF9CA3AF"; // 레벨 경로 회색 톤다운 — 출력물이라 raw hex 허용(design.md §1 예외)

/** WbsModel → "WBS" 워크시트 기록 — 동적 레벨 컬럼(No | Level 1..N | Task | 1안 속성 꼬리). */
export function writeWbsSheet(workbook: import("exceljs").Workbook, model: WbsModel): void {
  const sheet = workbook.addWorksheet("WBS", { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.addRow([model.mapName]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([`Version: ${model.versionLabel}    Exported: ${model.exportedAt}${model.truncated ? "    (truncated)" : ""}`]);
  sheet.addRow([]);
  // 속성 꼬리는 1안 COLUMNS의 Type~Next 정의 재사용 — numFmt를 인덱스가 아닌 정의에서 파생(1안 교훈)
  const tail = COLUMNS.slice(2);
  const headerRow = sheet.addRow([
    "No",
    ...Array.from({ length: model.maxLevel }, (_, i) => `Level ${i + 1}`),
    "Task",
    ...tail.map((c) => c.header),
  ]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin" } };
  });
  const taskCol = 2 + model.maxLevel; // 1=No, 2..1+N=레벨, 그 다음이 Task
  sheet.getColumn(1).width = 6;
  for (let i = 0; i < model.maxLevel; i += 1) sheet.getColumn(2 + i).width = 18;
  sheet.getColumn(taskCol).width = 32;
  tail.forEach((c, i) => {
    sheet.getColumn(taskCol + 1 + i).width = c.width;
  });
  const urlCol = taskCol + 1 + tail.findIndex((c) => c.header === "URL");

  for (const row of model.rows) {
    const levelCells = Array.from({ length: model.maxLevel }, (_, i) => row.levels[i] ?? "");
    if (row.kind !== "node") {
      const r = sheet.addRow(["", ...levelCells, NOTE_TEXT[row.kind]]);
      r.getCell(taskCol).font = { italic: true };
      for (let i = 0; i < model.maxLevel; i += 1) r.getCell(2 + i).font = { color: { argb: LEVEL_FONT_ARGB } };
      continue;
    }
    const num = (v: string) => (v === "" ? "" : Number(v));
    const r = sheet.addRow([
      row.no, ...levelCells, row.title, row.type, row.description, row.assignee, row.department, row.system,
      num(row.duration), num(row.cost_krw), num(row.cost_usd), num(row.headcount), num(row.annual_count), num(row.fte),
      "", row.groups, row.next,
    ]);
    for (let i = 0; i < model.maxLevel; i += 1) r.getCell(2 + i).font = { color: { argb: LEVEL_FONT_ARGB } };
    tail.forEach((c, i) => {
      if ("numFmt" in c) r.getCell(taskCol + 1 + i).numFmt = c.numFmt;
    });
    if (row.url) {
      r.getCell(urlCol).value = { text: row.urlLabel || row.url, hyperlink: row.url };
      r.getCell(urlCol).font = { color: { argb: "FF6A41FF" }, underline: true };
    }
  }
}

/** WbsModel → .xlsx 다운로드 — 1안과 동일한 공용 다운로드 경로. */
export async function downloadWbsExcel(model: WbsModel, fileName: string): Promise<void> {
  await downloadWorkbookXlsx((workbook) => writeWbsSheet(workbook, model), fileName);
}
