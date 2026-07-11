// Excel 내보내기 모델 — 서브프로세스 전체 재귀 인라인(조상 검사·행 상한·locked) 순수 로직.
// exceljs 기록(다운로드)은 별도 모듈(Task 7) — 모델과 분리해 vitest로 검증한다.
// 설계: docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md §4
import type { Graph } from "./api";
import { orderNodesByFlow } from "./csv-export";

export interface ExcelNodeRow {
  kind: "node";
  depth: number; // 0=현재 맵, 서브프로세스 인라인마다 +1
  title: string;
  type: string;
  description: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  headcount: string;
  etf: string;
  cost: string;
  extra: string;
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
    for (const node of orderNodesByFlow(g.nodes, g.edges)) {
      if (rows.length >= maxRows) {
        // 재귀 레벨 무관 상한 공유 — truncated 이미 true면 rowLimit 재생성 없이 즉시 중단 전파
        if (!truncated) rows.push({ kind: "rowLimit", depth, title: "" });
        truncated = true;
        return;
      }
      const next = g.edges
        .filter((e) => e.source_node_id === node.id)
        .map((e) => {
          const target = byId.get(e.target_node_id);
          if (!target) return null;
          return e.label === "" ? target.title : `${target.title}:${e.label}`;
        })
        .filter((s): s is string => s !== null)
        .join(";");
      rows.push({
        kind: "node",
        depth,
        title: node.title,
        type: node.node_type,
        description: node.description,
        assignee: node.assignee,
        department: node.department,
        system: node.system,
        duration: node.duration,
        headcount: node.headcount ?? "",
        etf: node.etf ?? "",
        cost: node.cost ?? "",
        extra: node.extra ?? "",
        url: node.url ?? "",
        urlLabel: node.url_label ?? "",
        groups: node.group_ids.map((id) => groupLabel.get(id) ?? "").filter(Boolean).join(", "),
        next,
      });
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
  };

  await emit(graph, 0, new Set(rootMapId != null ? [rootMapId] : []));
  return { mapName, versionLabel, exportedAt, rows, truncated };
}

// 셀 색은 출력물이라 raw hex 허용 (design.md §1 예외 — csv-export.ts와 동일 논리)
const HEADER_FILL = "FFF3F0FA"; // 연보라 헤더 (ARGB)
const NOTE_TEXT: Record<ExcelNoteRow["kind"], string> = {
  circular: "(circular reference)",
  denied: "(access denied)",
  rowLimit: `(row limit ${EXCEL_MAX_ROWS} reached — output truncated)`,
};
const COLUMNS = [
  { header: "No", width: 6 }, { header: "Name", width: 32 }, { header: "Type", width: 12 },
  { header: "Description", width: 44 }, { header: "Assignee", width: 16 }, { header: "Department", width: 18 },
  { header: "System", width: 14 }, { header: "Duration (h)", width: 12 }, { header: "Headcount", width: 11 },
  { header: "ETF", width: 9 }, { header: "Cost", width: 11 }, { header: "Extra", width: 9 },
  { header: "URL", width: 24 }, { header: "Groups", width: 18 }, { header: "Next", width: 32 },
];

/** ExcelModel → .xlsx 파일 다운로드. exceljs는 dynamic import — 정적 import 시 에디터 번들에 항상 섞여든다. */
export async function downloadExcel(model: ExcelModel, fileName: string): Promise<void> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
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

  let no = 0;
  for (const row of model.rows) {
    if (row.kind !== "node") {
      const r = sheet.addRow(["", NOTE_TEXT[row.kind]]);
      r.getCell(2).font = { italic: true };
      r.getCell(2).alignment = { indent: row.depth * 2 };
      r.outlineLevel = Math.min(row.depth, 7);
      continue;
    }
    no += 1;
    const num = (v: string) => (v === "" ? "" : Number(v));
    const r = sheet.addRow([
      no, row.title, row.type, row.description, row.assignee, row.department, row.system,
      num(row.duration), num(row.headcount), num(row.etf), num(row.cost), num(row.extra),
      "", row.groups, row.next,
    ]);
    r.getCell(2).alignment = { indent: row.depth * 2 };
    r.getCell(8).numFmt = "0.00"; // H.MM 표기 보존 — "1.30"이 1.3으로 뭉개지지 않게
    if (row.url) {
      r.getCell(13).value = { text: row.urlLabel || row.url, hyperlink: row.url };
      r.getCell(13).font = { color: { argb: "FF6A41FF" }, underline: true };
    }
    r.outlineLevel = Math.min(row.depth, 7); // Excel outline 한계 7
  }

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
