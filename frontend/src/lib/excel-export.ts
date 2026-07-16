// Excel 내보내기 모델 — 서브프로세스 전체 재귀 인라인(조상 검사·행 상한·locked) 순수 로직.
// exceljs 기록(다운로드)은 별도 모듈(Task 7) — 모델과 분리해 vitest로 검증한다.
// 설계: docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md §4,
//       docs/superpowers/specs/2026-07-13-node-params-redefinition-design.md §5.2,
//       docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md (구조 노드 정리+분기 주석)
import type { Graph, GraphEdge, GraphNode } from "./api";
import { orderNodesByFlow } from "./csv-export";
import { getInheritedParams } from "./params";

export interface ExcelNodeRow {
  kind: "node";
  no: number; // 최종 행 번호(1..n) — 삭제 규칙 적용 후 모델에서 부여, 시트는 그대로 기록
  depth: number; // 0=현재 맵, 서브프로세스 인라인마다 +1
  title: string;
  type: string;
  description: string;
  assignee: string;
  department: string;
  system: string;
  // 회당 파라미터 6종 — 표시 순서는 lib/params.ts PARAM_FIELDS와 동일
  duration: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  url: string;
  urlLabel: string;
  groups: string; // 그룹 라벨 ", " 조인
  next: string; // "대상" | "대상:라벨" ";" 조인 — End 포함(읽기용)
}

export interface ExcelNoteRow {
  kind: "circular" | "denied" | "rowLimit";
  depth: number;
  title: string; // 표기 문구 조립용(맵 이름 등)
}

export type ExcelRow = ExcelNodeRow | ExcelNoteRow;

export interface ExcelModel {
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  rows: ExcelRow[];
  truncated: boolean;
}

export const EXCEL_MAX_ROWS = 2000;

/**
 * 노드가 노출하는 회당 4필드(duration/cost_krw/cost_usd/headcount) — 서브프로세스는 자기 행이 아니라
 * 링크 맵의 sp_* 라이브 참조(g.subprocess_refs)에서 가져온다(캔버스 인스펙터·Σ 합산과 동일 소스,
 * design 2026-07-13 §3.1). annual_count·fte는 부모 맥락 값이라 노드 행 그대로 별도 취급.
 */
export function getNodeRunParams(g: Graph, node: GraphNode): Pick<ExcelNodeRow, "duration" | "cost_krw" | "cost_usd" | "headcount"> {
  if (node.node_type === "subprocess" && node.linked_map_id !== null) {
    return getInheritedParams(g.subprocess_refs?.[node.linked_map_id]);
  }
  return {
    duration: node.duration,
    cost_krw: node.cost_krw ?? "",
    cost_usd: node.cost_usd ?? "",
    headcount: node.headcount ?? "",
  };
}

export async function buildExcelModel({
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
  // 루트 맵 자신의 id — 전달 시 루트 역참조 순환을 재펼침 없이 즉시 circular 차단(조상 경로에 루트 포함, design §4)
  rootMapId?: number;
}): Promise<ExcelModel> {
  const rows: ExcelRow[] = [];
  let truncated = false;
  // 규칙4 주석 — 행 "객체" 참조로 기록해 번호 부여 후 일괄 조립(역방향 분기·다이아몬드 이중 인라인 안전)
  const annotations: Array<{ target: ExcelNodeRow; decision: ExcelNodeRow; label: string }> = [];
  // 같은 (mapId,followLatest,pinned) 조합은 fetch 1회 — 다이아몬드 참조(같은 맵 2회 인라인) 대비
  const cache = new Map<string, Promise<Graph>>();
  const fetchMemo = (mapId: number, followLatest: boolean, pinned: number | null): Promise<Graph> => {
    const key = `${mapId}:${followLatest}:${pinned}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = fetchResolved(mapId, followLatest, pinned);
    cache.set(key, p);
    return p;
  };

  const emit = async (g: Graph, depth: number, ancestry: ReadonlySet<number>): Promise<void> => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const groupLabel = new Map(g.groups.map((gr) => [gr.id, gr.label]));
    const outgoing = new Map<string, GraphEdge[]>();
    for (const e of g.edges) {
      const list = outgoing.get(e.source_node_id);
      if (list) list.push(e);
      else outgoing.set(e.source_node_id, [e]);
    }
    const ordered = orderNodesByFlow(g.nodes, g.edges);
    // 규칙1: 나가는 엣지가 있고 전부 무라벨인 디시전 = 단순 병렬 분기 — 행 미생성(엣지 없는 디시전은 WIP로 유지)
    const isRemovedDecision = (n: GraphNode): boolean => {
      if (n.node_type !== "decision") return false;
      const out = outgoing.get(n.id) ?? [];
      return out.length > 0 && out.every((e) => e.label === "");
    };
    // 규칙2: 루트 스코프 BFS 기점 start만 유지 — 서브프로세스 인라인·미도달 추가 start는 행 미생성
    const keptStartId = depth === 0 ? ordered.find((n) => n.node_type === "start")?.id : undefined;
    // 규칙3: 기본 제목 end는 행 미생성(커스텀 제목 end는 유지) — next의 "End" 표기는 그대로 남는다
    const isDefaultEnd = (n: GraphNode): boolean =>
      n.node_type === "end" && n.title.trim().toLowerCase() === "end";
    const isRowRemoved = (n: GraphNode): boolean =>
      (n.node_type === "start" && n.id !== keptStartId) || isDefaultEnd(n) || isRemovedDecision(n);

    // 삭제된 무라벨 디시전을 통과(flow-through)해 최종 (대상, 라벨)로 전개 — 라벨은 최종 대상까지 전파.
    // next 표기와 규칙4 주석이 공용. seen은 삭제 디시전끼리의 순환 가드.
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

    const rowByNodeId = new Map<string, ExcelNodeRow>(); // 스코프(맵 인스턴스) 한정 — 이중 인라인 안전

    for (const node of ordered) {
      if (isRowRemoved(node)) continue; // 삭제 행은 상한(maxRows)을 소비하지 않는다
      if (rows.length >= maxRows) {
        // 재귀 레벨 무관 상한 공유 — truncated 이미 true면 rowLimit 재생성 없이 중단 전파.
        // return이 아닌 break — 스코프 잔여 행만 포기하고 주석 수집 패스는 실행해 이미 출력된 행의 주석을 보존
        if (!truncated) rows.push({ kind: "rowLimit", depth, title: "" });
        truncated = true;
        break;
      }
      // Set 중복 제거 — 삭제 디시전 경유 재수렴 시 같은 (대상, 라벨)이 2회 도달("B;B") 방지
      const next = Array.from(new Set(
        (outgoing.get(node.id) ?? [])
          .flatMap((e) => resolveTargets(e, e.label, new Set()))
          .map(({ node: t, label }) => (label === "" ? t.title : `${t.title}:${label}`)),
      )).join(";");
      const row: ExcelNodeRow = {
        kind: "node",
        no: 0, // finalize에서 부여
        depth,
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
      if (node.node_type === "subprocess" && node.linked_map_id !== null && !truncated) {
        if (ancestry.has(node.linked_map_id)) {
          rows.push({ kind: "circular", depth: depth + 1, title: node.title });
          continue;
        }
        let resolved: Graph;
        try {
          resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
        } catch {
          rows.push({ kind: "denied", depth: depth + 1, title: node.title });
          continue;
        }
        if (resolved.locked) {
          rows.push({ kind: "denied", depth: depth + 1, title: node.title });
          continue;
        }
        await emit(resolved, depth + 1, new Set([...ancestry, node.linked_map_id]));
      }
    }

    // 규칙4: 유지된 디시전의 라벨 분기 → 최종 대상 행에 (디시전 행, 라벨) 기록 — 대상 행이 삭제됐으면 소멸
    for (const node of ordered) {
      if (node.node_type !== "decision") continue;
      const decisionRow = rowByNodeId.get(node.id);
      if (!decisionRow) continue; // 무라벨(삭제) 디시전
      // 재수렴 중복 주석 방지 — next 중복 제거와 동일 정책(같은 대상·라벨 쌍은 1회만)
      const seenPairs = new Map<ExcelNodeRow, Set<string>>();
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

  await emit(graph, 0, new Set(rootMapId != null ? [rootMapId] : []));

  // 번호 부여(삭제 후 1..n 연속) → 주석 조립. next 문자열은 emit 시점 확정이라 주석이 섞이지 않는다.
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

  return { mapName, versionLabel, exportedAt, rows, truncated };
}

// 셀 색은 출력물이라 raw hex 허용 (design.md §1 예외 — csv-export.ts와 동일 논리)
export const HEADER_FILL = "FFF3F0FA"; // 연보라 헤더 (ARGB)
export const NOTE_TEXT: Record<ExcelNoteRow["kind"], string> = {
  circular: "(circular reference)",
  denied: "(access denied)",
  rowLimit: `(row limit ${EXCEL_MAX_ROWS} reached — output truncated)`,
};
// 컬럼 순서·서식 단일 소스(design 2026-07-13 §5.2) — numFmt는 셀 인덱스 대신 이 정의에서 파생시켜
// 컬럼 추가/재배열 시 인덱스가 조용히 어긋나는 사고를 막는다.
export const COLUMNS = [
  { header: "No", width: 6 }, { header: "Name", width: 32 }, { header: "Type", width: 12 },
  { header: "Description", width: 44 }, { header: "Assignee", width: 16 }, { header: "Department", width: 18 },
  { header: "System", width: 14 },
  { header: "Duration (h)", width: 12, numFmt: "0.00" }, // H.MM 표기 보존 — "1.30"이 1.3으로 뭉개지지 않게
  { header: "Cost (KRW)", width: 14, numFmt: "#,##0" },
  { header: "Cost (USD)", width: 14, numFmt: "#,##0.00" },
  { header: "Headcount", width: 11, numFmt: "0.00" },
  { header: "Annual volume", width: 13, numFmt: "#,##0" },
  { header: "FTE", width: 8, numFmt: "0.00" },
  { header: "URL", width: 24 }, { header: "Groups", width: 18 }, { header: "Next", width: 32 },
] as const;

const URL_COLUMN = COLUMNS.findIndex((c) => c.header === "URL") + 1; // 1-based — exceljs getCell 인덱스

/**
 * ExcelModel → 워크시트 기록(시트 생성·스타일·셀 값). Blob/anchor(브라우저 다운로드)와 분리해
 * DOM 없이도(vitest) 컬럼 서식·값을 검증할 수 있게 한다.
 */
export function writeExcelSheet(workbook: import("exceljs").Workbook, model: ExcelModel): void {
  const sheet = workbook.addWorksheet("Process Map", {
    views: [{ state: "frozen", ySplit: 4 }],
    properties: { outlineLevelRow: 1, defaultRowHeight: 16 },
  });
  sheet.addRow([model.mapName]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([`Version: ${model.versionLabel}    Exported: ${model.exportedAt}${model.truncated ? "    (truncated)" : ""}`]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin" } };
  });
  COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

  for (const row of model.rows) {
    if (row.kind !== "node") {
      const r = sheet.addRow(["", NOTE_TEXT[row.kind]]);
      r.getCell(2).font = { italic: true };
      r.getCell(2).alignment = { indent: row.depth * 2 };
      r.outlineLevel = Math.min(row.depth, 7);
      continue;
    }
    const num = (v: string) => (v === "" ? "" : Number(v));
    const r = sheet.addRow([
      row.no, row.title, row.type, row.description, row.assignee, row.department, row.system,
      num(row.duration), num(row.cost_krw), num(row.cost_usd), num(row.headcount), num(row.annual_count), num(row.fte),
      "", row.groups, row.next,
    ]);
    r.getCell(2).alignment = { indent: row.depth * 2 };
    COLUMNS.forEach((c, i) => {
      if ("numFmt" in c) r.getCell(i + 1).numFmt = c.numFmt;
    });
    if (row.url) {
      r.getCell(URL_COLUMN).value = { text: row.urlLabel || row.url, hyperlink: row.url };
      r.getCell(URL_COLUMN).font = { color: { argb: "FF6A41FF" }, underline: true };
    }
    r.outlineLevel = Math.min(row.depth, 7); // Excel outline 한계 7
  }
}

/** 워크북 조립 콜백 → .xlsx 다운로드 — exceljs 동적 import 공용(1안/2안 시트가 공유). */
export async function downloadWorkbookXlsx(
  write: (workbook: import("exceljs").Workbook) => void,
  fileName: string,
): Promise<void> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  write(workbook);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** ExcelModel → .xlsx 파일 다운로드. */
export async function downloadExcel(model: ExcelModel, fileName: string): Promise<void> {
  await downloadWorkbookXlsx((workbook) => writeExcelSheet(workbook, model), fileName);
}
