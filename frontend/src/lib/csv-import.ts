// CSV 임포트 — 템플릿·RFC4180 파싱·그래프 변환(자동 Start/End·decision 추론).
// 설계: docs/superpowers/specs/2026-07-06-csv-import-design.md
import type { Edge } from "@xyflow/react";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { type AppNode, layoutWithDagre, normalizeNodeType } from "./canvas";
import { genId } from "./id";

export interface CsvRecord {
  cells: string[];
  // 레코드가 시작하는 파일 실제 행 번호(1-기준) — Excel 행 번호와 일치
  line: number;
}

export interface CsvImportError {
  line: number;
  message: string;
}

export interface CsvImportOutcome {
  graph: Graph | null;
  nodeCount: number;
  edgeCount: number;
  errors: CsvImportError[];
}

const HEADER_COLUMNS = ["name", "system", "duration", "url", "next"] as const;
type HeaderColumn = (typeof HEADER_COLUMNS)[number];

// 데이터 행 상한 — 초대형 파일 오업로드 방지
const MAX_DATA_ROWS = 500;
// 백엔드 NodeIn max_length 미러 — 서버 422 전에 행 단위로 안내
const MAX_LEN: Record<Exclude<HeaderColumn, "next">, number> = {
  name: 200,
  system: 100,
  duration: 50,
  url: 500,
};

export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // 구형 Excel "CSV(쉼표로 분리)" — CP949 저장본 폴백
    return stripBom(new TextDecoder("euc-kr").decode(bytes));
  }
}

function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/** RFC4180 파싱 — 따옴표 셀(쉼표·줄바꿈·"" 이스케이프)·CRLF. 전부 빈 행은 건너뛴다. */
export function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== "")) {
      records.push({ cells, line: recordLine });
    }
    cells = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\n") {
      endRecord();
      line += 1;
      recordLine = line;
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  endRecord();
  return records;
}

// CSV가 다루지 않는 GraphNode 속성 기본값
const NODE_DEFAULTS = {
  description: "",
  color: "",
  assignee: "",
  department: "",
  system: "",
  duration: "",
  url: "",
  pos_x: 0,
  pos_y: 0,
  group_ids: [] as string[],
  linked_map_id: null,
  follow_latest: false,
  linked_version_id: null,
  is_primary_end: false,
};

/** CSV 텍스트 → 검증 + 그래프(자동 Start/End, decision 추론, dagre LR 배치). 에러 있으면 graph=null. */
export function buildGraphFromCsv(text: string): CsvImportOutcome {
  const fail = (errors: CsvImportError[]): CsvImportOutcome => ({
    graph: null,
    nodeCount: 0,
    edgeCount: 0,
    errors,
  });

  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return fail([{ line: 1, message: "Empty file — header row required" }]);
  }

  // 헤더 매핑 — 대소문자 무시·순서 무관, 미지 컬럼은 에러(오타 방지)
  const header = records[0];
  const colIndex = new Map<HeaderColumn, number>();
  const headerErrors: CsvImportError[] = [];
  header.cells.forEach((raw, i) => {
    const name = raw.trim().toLowerCase();
    if (name === "") return;
    if (!(HEADER_COLUMNS as readonly string[]).includes(name)) {
      headerErrors.push({ line: header.line, message: `Unknown column "${raw.trim()}"` });
      return;
    }
    if (colIndex.has(name as HeaderColumn)) {
      headerErrors.push({ line: header.line, message: `Duplicate column "${raw.trim()}"` });
      return;
    }
    colIndex.set(name as HeaderColumn, i);
  });
  if (!colIndex.has("name")) {
    headerErrors.push({ line: header.line, message: 'Missing required column "Name"' });
  }
  if (headerErrors.length > 0) return fail(headerErrors);

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return fail([{ line: header.line, message: "No data rows" }]);
  }
  if (dataRecords.length > MAX_DATA_ROWS) {
    return fail([
      { line: dataRecords[MAX_DATA_ROWS].line, message: `Too many rows — max ${MAX_DATA_ROWS}` },
    ]);
  }

  const cellOf = (record: CsvRecord, col: HeaderColumn): string => {
    const idx = colIndex.get(col);
    return idx === undefined ? "" : (record.cells[idx] ?? "").trim();
  };
  const rows = dataRecords.map((r) => ({
    name: cellOf(r, "name"),
    system: cellOf(r, "system"),
    duration: cellOf(r, "duration"),
    url: cellOf(r, "url"),
    nextRaw: cellOf(r, "next"),
    line: r.line,
  }));

  const errors: CsvImportError[] = [];
  const names = new Set<string>();
  for (const row of rows) {
    if (row.name === "") {
      errors.push({ line: row.line, message: "Name is required" });
      continue;
    }
    if (names.has(row.name)) {
      errors.push({ line: row.line, message: `Duplicate name "${row.name}"` });
      continue;
    }
    names.add(row.name);
    for (const col of ["name", "system", "duration", "url"] as const) {
      if (row[col].length > MAX_LEN[col]) {
        errors.push({ line: row.line, message: `${col} exceeds ${MAX_LEN[col]} characters` });
      }
    }
    if (row.url !== "" && !/^https?:\/\//i.test(row.url)) {
      errors.push({
        line: row.line,
        message: `URL must start with http:// or https:// — "${row.url}"`,
      });
    }
  }

  // Next 파싱 — "대상" 또는 "대상:라벨", 세미콜론 구분(빈 항목 무시)
  const nextsOf = new Map<string, { target: string; label: string }[]>();
  for (const row of rows) {
    if (!names.has(row.name)) continue; // 이름 에러 행은 스킵
    const refs: { target: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const entryRaw of row.nextRaw.split(";")) {
      const entry = entryRaw.trim();
      if (entry === "") continue;
      const colon = entry.indexOf(":");
      const target = (colon < 0 ? entry : entry.slice(0, colon)).trim();
      const label = colon < 0 ? "" : entry.slice(colon + 1).trim();
      if (!names.has(target)) {
        errors.push({ line: row.line, message: `Next target "${target}" not found` });
        continue;
      }
      if (seen.has(target)) {
        errors.push({ line: row.line, message: `Duplicate Next target "${target}"` });
        continue;
      }
      // Edge.label String(200) 미러 — 로컬 sqlite는 통과하고 서버 postgres에서 500 나는 것 방지
      if (label.length > 200) {
        errors.push({ line: row.line, message: `label exceeds 200 characters — "${label.slice(0, 30)}…"` });
        continue;
      }
      seen.add(target);
      refs.push({ target, label });
    }
    nextsOf.set(row.name, refs);
  }
  if (errors.length > 0) return fail(errors);

  // 노드 — Next 대상 2개 이상이면 decision. Start/End는 자동 생성
  const idOf = new Map<string, string>();
  rows.forEach((row) => idOf.set(row.name, genId()));
  const startId = genId();
  const endId = genId();
  const nodes: GraphNode[] = [
    { ...NODE_DEFAULTS, id: startId, title: "Start", node_type: "start", sort_order: 0 },
    ...rows.map((row, i) => ({
      ...NODE_DEFAULTS,
      id: idOf.get(row.name) as string,
      title: row.name,
      node_type: (nextsOf.get(row.name) ?? []).length >= 2 ? "decision" : "process",
      system: row.system,
      duration: row.duration,
      url: row.url,
      sort_order: i + 1,
    })),
    {
      ...NODE_DEFAULTS,
      id: endId,
      title: "End",
      node_type: "end",
      sort_order: rows.length + 1,
      is_primary_end: true,
    },
  ];

  const edges: GraphEdge[] = [];
  const addEdge = (source: string, target: string, label: string) => {
    edges.push({
      id: genId(),
      source_node_id: source,
      target_node_id: target,
      label,
      source_side: "right",
      target_side: "left",
      source_handle: null,
      target_handle: null,
    });
  };
  const hasIncoming = new Set<string>();
  for (const row of rows) {
    for (const ref of nextsOf.get(row.name) ?? []) {
      addEdge(idOf.get(row.name) as string, idOf.get(ref.target) as string, ref.label);
      if (ref.target !== row.name) hasIncoming.add(ref.target);
    }
  }
  // Start → 진입 엣지 없는 노드 전부. 전부 순환이면 첫 행(백엔드 "start 1개" 규칙 충족용 진입점)
  const roots = rows.filter((row) => !hasIncoming.has(row.name));
  for (const row of roots.length > 0 ? roots : [rows[0]]) {
    addEdge(startId, idOf.get(row.name) as string, "");
  }
  // 말단(Next 없음) → End. 말단이 없으면(전부 순환) End는 미연결로 남는다
  for (const row of rows) {
    if ((nextsOf.get(row.name) ?? []).length === 0) {
      addEdge(idOf.get(row.name) as string, endId, "");
    }
  }

  // dagre LR 자동 배치 — layoutWithDagre는 data.nodeType 크기만 사용하므로 최소 AppNode로 충분
  const appNodes: AppNode[] = nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: 0, y: 0 },
    data: {
      label: node.title,
      description: "",
      nodeType: normalizeNodeType(node.node_type),
      color: "",
      assignee: "",
      department: "",
      system: node.system,
      duration: node.duration,
      url: node.url,
      groupIds: [],
      hasChildren: false,
    },
  }));
  const flowEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
  }));
  const posOf = new Map(
    layoutWithDagre(appNodes, flowEdges, "LR").map((n) => [n.id, n.position]),
  );
  const positioned = nodes.map((node) => {
    const pos = posOf.get(node.id);
    return pos ? { ...node, pos_x: pos.x, pos_y: pos.y } : node;
  });

  return {
    graph: { nodes: positioned, edges, groups: [] },
    nodeCount: positioned.length,
    edgeCount: edges.length,
    errors: [],
  };
}

/** 다운로드용 템플릿 — 구매 프로세스 예시. Excel 호환 CRLF(BOM은 다운로드 시 접두). */
export function buildTemplateCsv(): string {
  return [
    "Name,System,Duration,URL,Next",
    "Review request,SAP ERP,2 days,,Approval decision",
    "Approval decision,,,,Sign contract:approved;Notify rejection:rejected",
    "Sign contract,,3 days,https://example.com/contract,",
    "Notify rejection,,1 day,,",
  ].join("\r\n");
}
