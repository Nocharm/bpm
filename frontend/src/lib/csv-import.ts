// CSV 임포트 — 템플릿·RFC4180 파싱·그래프 변환(자동 Start/End·decision 추론).
// 설계: docs/superpowers/specs/2026-07-10-csv-import-merge-design.md
import type { AiEdge, AiGroup, AiNode, Directory, Graph, GraphEdge, GraphNode } from "./api";
import { driftedAssignees, formatAssignees, parseAssignees } from "./assignee";
import { type AppNode, layoutSubsetWithDagre, layoutWithDagre, normalizeNodeType } from "./canvas";
import { normalizeDuration, normalizeNumericParam } from "./duration";
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

/** 비차단 경고 — 임포트를 막지 않는다. 백엔드는 담당자를 검증하지 않으므로 유일한 사전 안내다. */
export interface CsvImportWarning {
  line: number;
  message: string;
}

export interface CsvImportOutcome {
  graph: Graph | null;
  nodeCount: number;
  edgeCount: number;
  errors: CsvImportError[];
  warnings: CsvImportWarning[];
  ignoredLabelCount: number;
  merge: CsvMergeInfo;
}

/** base 그래프와의 이름 기준 머지 결과 — 프리뷰(added/removed 하이라이트)와 소멸 노드 처리에 쓴다. */
export interface CsvMergeInfo {
  // CSV에만 있어 새로 만든 노드 id — 프리뷰에서 "added" 하이라이트 대상
  addedNodeIds: string[];
  // base에만 있는 노드 — 삭제/유지 선택 대상
  removedNodes: GraphNode[];
  // base에 있으나 결과 그래프에 없는 엣지 — 프리뷰에서 빨간 점선
  lostEdges: GraphEdge[];
  // id를 재사용한 노드 수 (Start/End 포함)
  matchedCount: number;
}

export interface CsvDirectory {
  users: readonly { id: string; name: string; department: string }[];
  departments: readonly string[];
  // 정식 부서명 → { korean_name } — 한글로 적힌 부서 셀을 정식명으로 되돌린다
  dept_infos?: Readonly<Record<string, { korean_name?: string }>>;
}

/** 임포트 문맥 — 디렉터리는 담당자/부서 해석에, base는 머지(제목 기준 id 재사용)에 쓴다. */
export interface CsvImportContext {
  directory?: CsvDirectory;
  // 머지 대상 기존 그래프. 없거나 비어 있으면 전량 신규(현행 동작).
  base?: Graph;
}

// cost_usd 컬럼은 아직 없음 — CSV 스키마 개편은 후속 태스크 (여기선 기존 컬럼의 1:1 개명만)
const HEADER_COLUMNS = [
  "name", "description", "assignee", "department", "system", "duration",
  "headcount", "fte", "cost_krw", "annual_count", "url", "url_label", "next",
] as const;
type HeaderColumn = (typeof HEADER_COLUMNS)[number];

// 데이터 행 상한 — 초대형 파일 오업로드 방지
const MAX_DATA_ROWS = 500;
// 백엔드 NodeIn 제약 미러. description은 NodeIn에 max_length가 없고 Node.description이 Text 컬럼이라 제외한다.
const MAX_LEN: Record<Exclude<HeaderColumn, "next" | "description">, number> = {
  name: 200,
  assignee: 100,   // NodeIn.assignee — 해석된 "이름" 문자열 기준
  department: 100, // NodeIn.department
  system: 100,
  duration: 50,
  headcount: 50,
  fte: 50,
  cost_krw: 50,
  annual_count: 50,
  url: 500,
  url_label: 100,
};

// 십진 파라미터 컬럼 — 검증 에러 문구는 컬럼명이 아닌 사람이 읽는 라벨로
const NUMERIC_COLUMNS = ["headcount", "fte", "cost_krw", "annual_count"] as const;
const NUMERIC_COLUMN_LABEL: Record<(typeof NUMERIC_COLUMNS)[number], string> = {
  headcount: "Headcount",
  fte: "FTE",
  cost_krw: "Cost (KRW)",
  annual_count: "Annual volume",
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
  cost_krw: "",
  cost_usd: "",
  headcount: "",
  annual_count: "",
  fte: "",
  url: "",
  url_label: "",
  pos_x: 0,
  pos_y: 0,
  group_ids: [] as string[],
  linked_map_id: null,
  follow_latest: false,
  linked_version_id: null,
  is_primary_end: false,
};

// 빈 값은 "건드리지 않음" — 제안/CSV가 모르는 속성이 기존 값을 지우지 않게 (CSV·AI 병합 공용)
const pick = (next: string, existing: string): string => (next === "" ? existing : next);

// 매칭 노드: id·좌표·색·그룹·서브프로세스 링크 보존.
// 서브프로세스 노드는 node_type도 보존 — 추론/제안값으로 덮으면 Call Activity 렌더가 깨진다.
const mergeNode = (existing: GraphNode | null, next: GraphNode): GraphNode =>
  existing === null
    ? next
    : {
        ...existing,
        title: next.title,
        node_type: existing.linked_map_id !== null ? existing.node_type : next.node_type,
        description: pick(next.description, existing.description),
        assignee: pick(next.assignee, existing.assignee),
        department: pick(next.department, existing.department),
        system: pick(next.system, existing.system),
        duration: pick(next.duration, existing.duration),
        cost_krw: pick(next.cost_krw ?? "", existing.cost_krw ?? ""),
        cost_usd: pick(next.cost_usd ?? "", existing.cost_usd ?? ""),
        headcount: pick(next.headcount ?? "", existing.headcount ?? ""),
        annual_count: pick(next.annual_count ?? "", existing.annual_count ?? ""),
        fte: pick(next.fte ?? "", existing.fte ?? ""),
        url: pick(next.url ?? "", existing.url ?? ""),
        url_label: pick(next.url_label ?? "", existing.url_label ?? ""),
        sort_order: next.sort_order,
      };

/** login_id → 이름. 이미 이름이면 그대로(거짓 경고 방지). 못 찾으면 원문 + 경고. */
function resolveAssignee(
  raw: string, dir: CsvDirectory | undefined, line: number, warnings: CsvImportWarning[],
): string {
  if (raw === "" || dir === undefined) return raw;
  const resolvedNames = parseAssignees(raw).map((token) => {
    const byId = dir.users.find((user) => user.id === token);
    if (byId) return byId.name;
    if (dir.users.some((user) => user.name === token)) return token;
    warnings.push({ line, message: `Unknown assignee "${token}"` });
    return token;
  });
  return formatAssignees(resolvedNames);
}

/** 정식 부서명 그대로, 아니면 한글 부서명 역인덱스. 못 찾으면 원문 + 경고. */
function resolveDepartment(
  raw: string, dir: CsvDirectory | undefined, line: number, warnings: CsvImportWarning[],
): string {
  if (raw === "" || dir === undefined) return raw;
  if (dir.departments.includes(raw)) return raw;
  const canonical = Object.entries(dir.dept_infos ?? {}).find(
    ([, info]) => info.korean_name === raw,
  )?.[0];
  if (canonical) return canonical;
  warnings.push({ line, message: `Unknown department "${raw}"` });
  return raw;
}

/** dagre가 요구하는 최소 AppNode — layoutWithDagre는 data.nodeType 크기만 쓴다. */
function toLayoutNodes(nodes: GraphNode[]): AppNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: node.pos_x, y: node.pos_y },
    data: {
      label: node.title, description: "", nodeType: normalizeNodeType(node.node_type),
      color: "", assignee: "", department: "", system: node.system, duration: node.duration,
      url: node.url, urlLabel: node.url_label ?? "", groupIds: [], hasChildren: false,
    },
  }));
}

function toFlowEdges(edges: GraphEdge[]) {
  return edges.map((e) => ({ id: e.id, source: e.source_node_id, target: e.target_node_id }));
}

function applyPositions(nodes: GraphNode[], laid: AppNode[]): GraphNode[] {
  const posOf = new Map(laid.map((node) => [node.id, node.position]));
  return nodes.map((node) => {
    const pos = posOf.get(node.id);
    return pos ? { ...node, pos_x: pos.x, pos_y: pos.y } : node;
  });
}

/** 전량 신규(base 없음) — 현행 동작: 전체 dagre LR. */
function layoutEverything(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  return applyPositions(nodes, layoutWithDagre(toLayoutNodes(nodes), toFlowEdges(edges), "LR"));
}

/**
 * 머지 — 매칭 노드 좌표는 불변. 신규 노드만 기존 그래프 아래에 씨앗 배치 후 부분 dagre.
 * layoutSubsetWithDagre는 subset<2면 no-op이라 씨앗 배치가 1개짜리 신규 노드를 책임진다.
 */
function layoutAddedOnly(
  nodes: GraphNode[], edges: GraphEdge[], added: ReadonlySet<string>, baseNodes: GraphNode[],
): GraphNode[] {
  if (added.size === 0) return nodes;
  const baseMaxY = baseNodes.reduce((max, node) => Math.max(max, node.pos_y), 0);
  let slot = 0;
  const seeded = nodes.map((node) =>
    added.has(node.id) ? { ...node, pos_x: 80, pos_y: baseMaxY + 140 + slot++ * 120 } : node,
  );
  return applyPositions(seeded, layoutSubsetWithDagre(toLayoutNodes(seeded), toFlowEdges(edges), added, "LR"));
}

/** CSV 텍스트 → 검증 + 그래프(자동 Start/End, decision 추론, dagre LR 배치). 에러 있으면 graph=null. */
export function buildGraphFromCsv(text: string, context?: CsvImportContext): CsvImportOutcome {
  // 매번 새 객체를 만든다 — 공유 배열이면 한 호출자의 실수(mutate)가 이후 모든 실패 결과를 오염시킨다.
  const emptyMerge = (): CsvMergeInfo => ({ addedNodeIds: [], removedNodes: [], lostEdges: [], matchedCount: 0 });
  const fail = (errors: CsvImportError[]): CsvImportOutcome => ({
    graph: null,
    nodeCount: 0,
    edgeCount: 0,
    errors,
    warnings: [],
    ignoredLabelCount: 0,
    merge: emptyMerge(),
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
    description: cellOf(r, "description"),
    assignee: cellOf(r, "assignee"),
    department: cellOf(r, "department"),
    system: cellOf(r, "system"),
    duration: cellOf(r, "duration"),
    headcount: cellOf(r, "headcount"),
    fte: cellOf(r, "fte"),
    cost_krw: cellOf(r, "cost_krw"),
    annual_count: cellOf(r, "annual_count"),
    url: cellOf(r, "url"),
    url_label: cellOf(r, "url_label"),
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
    for (const col of ["name", "system", "duration", "headcount", "fte", "cost_krw", "annual_count", "url", "url_label"] as const) {
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
    const durationNorm = normalizeDuration(row.duration);
    if (durationNorm === null) {
      errors.push({ line: row.line, message: `Duration must be a number in H.MM hours — "${row.duration}"` });
    }
    for (const col of NUMERIC_COLUMNS) {
      if (normalizeNumericParam(row[col]) === null) {
        errors.push({ line: row.line, message: `${NUMERIC_COLUMN_LABEL[col]} must be a number — "${row[col]}"` });
      }
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

  // 담당자/부서 해석 — id→이름, 한글 부서명→정식명. 해석 후 길이를 재야 한다(id는 짧아도 이름은 길 수 있음)
  const warnings: CsvImportWarning[] = [];
  const resolved = new Map<string, { assignee: string; department: string }>();
  for (const row of rows) {
    if (!names.has(row.name)) continue; // 이름 에러 행은 스킵
    const assignee = resolveAssignee(row.assignee, context?.directory, row.line, warnings);
    const department = resolveDepartment(row.department, context?.directory, row.line, warnings);
    if (assignee.length > MAX_LEN.assignee) {
      errors.push({ line: row.line, message: `assignee exceeds ${MAX_LEN.assignee} characters` });
    }
    if (department.length > MAX_LEN.department) {
      errors.push({ line: row.line, message: `department exceeds ${MAX_LEN.department} characters` });
    }
    resolved.set(row.name, { assignee, department });
  }
  if (errors.length > 0) return fail(errors);

  // ── 기존 그래프와 매칭 ────────────────────────────────────────
  const baseNodes = context?.base?.nodes ?? [];
  const baseStart = baseNodes.find((node) => node.node_type === "start") ?? null;
  const baseEnds = baseNodes.filter((node) => node.node_type === "end");
  // 대표 끝 우선, 없으면 sort_order 최소 (validate_process의 기본 지정 규칙과 동일)
  const baseEnd =
    baseEnds.find((node) => node.is_primary_end) ??
    [...baseEnds].sort((a, b) => a.sort_order - b.sort_order)[0] ??
    null;

  // 제목 → 기존 노드. start/end는 타입으로 이미 잡았으니 제외.
  // 제목 중복 시 sort_order 최소가 이긴다(결정적) — 나머지는 removedNodes로 떨어진다.
  const reservedIds = new Set([baseStart?.id, baseEnd?.id].filter((id): id is string => id !== undefined));
  const byTitle = new Map<string, GraphNode>();
  for (const node of [...baseNodes].sort((a, b) => a.sort_order - b.sort_order)) {
    if (reservedIds.has(node.id)) continue;
    if (!byTitle.has(node.title)) byTitle.set(node.title, node);
  }

  const matchedIds = new Set<string>();
  const addedNodeIds: string[] = [];
  const idOf = new Map<string, string>();
  for (const row of rows) {
    const existing = byTitle.get(row.name);
    if (existing) {
      idOf.set(row.name, existing.id);
      matchedIds.add(existing.id);
    } else {
      const id = genId();
      idOf.set(row.name, id);
      addedNodeIds.push(id);
    }
  }
  const startId = baseStart?.id ?? genId();
  const endId = baseEnd?.id ?? genId();
  if (baseStart) matchedIds.add(startId); else addedNodeIds.push(startId);
  if (baseEnd) matchedIds.add(endId); else addedNodeIds.push(endId);

  // 노드 — Next 대상 2개 이상이면 decision. Start/End는 자동 생성(또는 base에서 매칭)
  const nodes: GraphNode[] = [
    // Start/End는 CSV가 이름을 싣지 않는다 → 기존 제목 유지("시작"을 "Start"로 덮으면 거짓 변경)
    mergeNode(baseStart, { ...NODE_DEFAULTS, id: startId, title: baseStart?.title ?? "Start", node_type: "start", sort_order: 0 }),
    ...rows.map((row, i) =>
      mergeNode(byTitle.get(row.name) ?? null, {
        ...NODE_DEFAULTS,
        id: idOf.get(row.name) as string,
        title: row.name,
        node_type: (nextsOf.get(row.name) ?? []).length >= 2 ? "decision" : "process",
        description: row.description,
        assignee: resolved.get(row.name)?.assignee ?? "",
        department: resolved.get(row.name)?.department ?? "",
        system: row.system,
        duration: normalizeDuration(row.duration) ?? "",
        cost_krw: normalizeNumericParam(row.cost_krw) ?? "",
        headcount: normalizeNumericParam(row.headcount) ?? "",
        annual_count: normalizeNumericParam(row.annual_count) ?? "",
        fte: normalizeNumericParam(row.fte) ?? "",
        url: row.url,
        url_label: row.url_label,
        sort_order: i + 1,
      }),
    ),
    {
      ...mergeNode(baseEnd, { ...NODE_DEFAULTS, id: endId, title: baseEnd?.title ?? "End", node_type: "end", sort_order: rows.length + 1 }),
      // 유일한 끝이므로 대표를 강제 — 기존 대표가 삭제 대상이었던 경우를 덮는다
      is_primary_end: true,
    },
  ];

  // URL 없는 라벨 소거 — 머지 후 "최종" URL 기준으로 판정한다(행의 URL이 비어도 기존 노드에 있을 수 있다)
  let ignoredLabelCount = 0;
  const finalNodes = nodes.map((node) => {
    if ((node.url ?? "") === "" && (node.url_label ?? "") !== "") {
      ignoredLabelCount += 1;
      return { ...node, url_label: "" };
    }
    return node;
  });

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

  // 좌표 — base 없으면 전체 dagre, 있으면 신규 노드만 부분 dagre(매칭 노드 좌표는 불변)
  const isMerge = baseNodes.length > 0;
  const positioned = isMerge
    ? layoutAddedOnly(finalNodes, edges, new Set(addedNodeIds), baseNodes)
    : layoutEverything(finalNodes, edges);

  const removedNodes = baseNodes.filter((node) => !matchedIds.has(node.id));
  const keptEdgeKeys = new Set(edges.map((e) => `${e.source_node_id}→${e.target_node_id}`));
  const lostEdges = (context?.base?.edges ?? []).filter(
    (e) => !keptEdgeKeys.has(`${e.source_node_id}→${e.target_node_id}`),
  );

  // 부서 불일치 경고 — resolveAssignee가 이미 경고한 미해석 토큰은 제외(중복 경고 방지)
  if (context?.directory) {
    const dir = context.directory;
    // driftedAssignees는 mutable Person[]을 받는다 — CsvDirectory.users는 readonly라 얕은 복사로 맞춘다
    const users = [...dir.users];
    for (const row of rows) {
      const info = resolved.get(row.name);
      if (!info || info.assignee === "") continue;
      const known = parseAssignees(info.assignee).filter((n) => dir.users.some((u) => u.name === n));
      const drifted = driftedAssignees(info.department, known, users);
      for (const name of drifted) {
        warnings.push({ line: row.line, message: `"${name}" is not in department "${info.department}"` });
      }
    }
  }

  return {
    graph: { nodes: positioned, edges, groups: context?.base?.groups ?? [] },
    nodeCount: positioned.length,
    edgeCount: edges.length,
    errors: [],
    warnings,
    ignoredLabelCount,
    merge: { addedNodeIds, removedNodes, lostEdges, matchedCount: matchedIds.size },
  };
}

/** AI graph 제안 입력 — AiProposal의 병합에 필요한 서브셋. */
export interface AiGraphProposalInput {
  nodes: AiNode[];
  edges: AiEdge[];
  groups: AiGroup[];
}

/**
 * AI graph 제안 → base와 제목 매칭 병합 (CSV 임포트와 같은 규칙·같은 Outcome).
 * 매칭 노드는 id·좌표·색·그룹·서브프로세스 링크 보존, AI가 비운 속성은 기존값 유지(pick).
 * base가 비어있지 않으면 AI groups 무시(기존 그룹 유지) — 병합 모드의 의도는 기존 맵 다듬기.
 */
export function buildGraphFromAiProposal(
  proposal: AiGraphProposalInput,
  context?: CsvImportContext,
): CsvImportOutcome {
  const emptyMerge = (): CsvMergeInfo => ({ addedNodeIds: [], removedNodes: [], lostEdges: [], matchedCount: 0 });
  if (proposal.nodes.length === 0) {
    return {
      graph: null, nodeCount: 0, edgeCount: 0,
      errors: [{ line: 0, message: "AI proposal has no nodes" }],
      warnings: [], ignoredLabelCount: 0, merge: emptyMerge(),
    };
  }

  const baseNodes = context?.base?.nodes ?? [];
  const isMerge = baseNodes.length > 0;

  // start/end는 타입 우선 매칭 (CSV와 동일 규칙 — validate_process 기본 지정과 정합)
  const baseStart = baseNodes.find((node) => node.node_type === "start") ?? null;
  const baseEnds = baseNodes.filter((node) => node.node_type === "end");
  const baseEnd =
    baseEnds.find((node) => node.is_primary_end) ??
    [...baseEnds].sort((a, b) => a.sort_order - b.sort_order)[0] ??
    null;
  const reservedIds = new Set([baseStart?.id, baseEnd?.id].filter((id): id is string => id !== undefined));
  const byTitle = new Map<string, GraphNode>();
  for (const node of [...baseNodes].sort((a, b) => a.sort_order - b.sort_order)) {
    if (reservedIds.has(node.id)) continue;
    if (!byTitle.has(node.title)) byTitle.set(node.title, node);
  }

  // 빈 캔버스 전용 — AI 그룹 생성(임시키 → 실제 id)
  const groupKeyToId = new Map<string, string>();
  const aiGroups: Graph["groups"] = isMerge
    ? []
    : proposal.groups.map((group) => {
        const id = genId();
        groupKeyToId.set(group.key, id);
        return { id, parent_group_id: null, label: group.label, color: group.color };
      });
  if (!isMerge) {
    // parent_key는 1차 생성 후 해석 (같은 응답 내 참조)
    proposal.groups.forEach((group, index) => {
      aiGroups[index].parent_group_id = group.parent_key
        ? groupKeyToId.get(group.parent_key) ?? null
        : null;
    });
  }

  const matchedIds = new Set<string>();
  const addedNodeIds: string[] = [];
  const keyToId = new Map<string, string>(); // AI 임시키 → 최종 id (edges 재매핑용)
  const byId = new Map(baseNodes.map((node) => [node.id, node]));
  let startUsed = false;
  let endUsed = false;
  const resolveId = (node: AiNode): string => {
    if (node.node_type === "start" && baseStart && !startUsed) {
      startUsed = true;
      matchedIds.add(baseStart.id);
      return baseStart.id;
    }
    if (node.node_type === "end" && baseEnd && !endUsed) {
      endUsed = true;
      matchedIds.add(baseEnd.id);
      return baseEnd.id;
    }
    const existing = byTitle.get(node.title);
    if (existing && !matchedIds.has(existing.id)) {
      matchedIds.add(existing.id);
      return existing.id;
    }
    const id = genId();
    addedNodeIds.push(id);
    return id;
  };

  const nodes: GraphNode[] = proposal.nodes.map((node, index) => {
    const id = resolveId(node);
    keyToId.set(node.key, id);
    const attr = node.attributes;
    const existing = byId.get(id) ?? null;
    const groupId = !isMerge && node.group_key ? groupKeyToId.get(node.group_key) : undefined;
    const candidate: GraphNode = {
      ...NODE_DEFAULTS,
      id,
      // start/end 타입 매칭은 기존 제목 유지 — "시작"을 "Start"로 덮으면 거짓 변경 (CSV와 동일)
      title:
        existing && (node.node_type === "start" || node.node_type === "end")
          ? existing.title
          : node.title,
      node_type: node.node_type,
      description: node.description,
      assignee: attr?.assignee ?? "",
      department: attr?.department ?? "",
      system: attr?.system ?? "",
      // 무효 duration 에코는 ""로 — pick이 기존 유효값을 지키게 (CSV 행 변환과 동일 규칙)
      duration: normalizeDuration(attr?.duration ?? "") ?? "",
      url: attr?.url ?? "",
      url_label: attr?.url_label ?? "",
      color: attr?.color ?? "",
      group_ids: groupId ? [groupId] : [],
      sort_order: index,
    };
    const merged = mergeNode(existing, candidate);
    // 신규 노드는 AI 색 허용, 매칭 노드는 mergeNode({...existing})가 기존 색 유지
    return merged;
  });

  // 제안이 start/end 타입 노드를 누락하면 기존 start/end를 무변경으로 유지 — 지우면 백엔드
  // validate_process(start/end 정확히 1개)에 걸려 Apply가 불투명한 422로 끝난다. 엣지는 합성하지
  // 않는다 — 끊긴 기존 엣지는 lostEdges로 프리뷰에 남는 것이 의도된 동작. 복사본을 넣어 이후
  // "대표 끝 보장" 등의 후속 변형이 caller가 쥔 base 그래프 객체를 직접 mutate하지 않게 한다.
  if (!startUsed && baseStart) {
    nodes.push({ ...baseStart });
    matchedIds.add(baseStart.id);
  }
  if (!endUsed && baseEnd) {
    nodes.push({ ...baseEnd });
    matchedIds.add(baseEnd.id);
  }

  // 대표 끝 보장 — 백엔드 validate_process(대표 끝 1개)와 정합. 매칭 end는 기존 플래그를 이미 보존.
  const ends = nodes.filter((node) => node.node_type === "end");
  if (ends.length > 0 && !ends.some((node) => node.is_primary_end)) {
    ends[0].is_primary_end = true;
  }

  const edges: GraphEdge[] = proposal.edges
    .map((edge): GraphEdge | null => {
      const source = keyToId.get(edge.source);
      const target = keyToId.get(edge.target);
      if (!source || !target) return null;
      return {
        id: genId(),
        source_node_id: source,
        target_node_id: target,
        label: edge.label,
        source_side: "right",
        target_side: "left",
        source_handle: null,
        target_handle: null,
      };
    })
    .filter((edge): edge is GraphEdge => edge !== null);

  const positioned = isMerge
    ? layoutAddedOnly(nodes, edges, new Set(addedNodeIds), baseNodes)
    : layoutEverything(nodes, edges);

  const removedNodes = baseNodes.filter((node) => !matchedIds.has(node.id));
  const keptEdgeKeys = new Set(edges.map((e) => `${e.source_node_id}→${e.target_node_id}`));
  const lostEdges = (context?.base?.edges ?? []).filter(
    (e) => !keptEdgeKeys.has(`${e.source_node_id}→${e.target_node_id}`),
  );

  return {
    graph: { nodes: positioned, edges, groups: isMerge ? context?.base?.groups ?? [] : aiGroups },
    nodeCount: positioned.length,
    edgeCount: edges.length,
    errors: [],
    warnings: [],
    ignoredLabelCount: 0,
    merge: { addedNodeIds, removedNodes, lostEdges, matchedCount: matchedIds.size },
  };
}

/**
 * 삭제 대신 유지 — 소멸 노드를 엣지 없이 되돌린다.
 * 엣지를 못 살리는 이유: 노드 출력은 1개로 고정이라(canvas.ts `removeOutgoingEdges`)
 * 들어오던 엣지를 살리면 출발 노드가 출력 2개가 된다. 나가던 엣지는 CSV가 흐름 전체를 규정하므로 사라진다.
 * 대표 끝은 이미 결과 그래프의 End가 쥐고 있으므로 유지 노드에서 떼어낸다(validate_process: 대표 끝 ≤1).
 */
export function withKeptNodes(graph: Graph, kept: GraphNode[]): Graph {
  if (kept.length === 0) return graph;
  const maxOrder = graph.nodes.reduce((max, node) => Math.max(max, node.sort_order), 0);
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      ...kept.map((node, i) => ({ ...node, sort_order: maxOrder + 1 + i, is_primary_end: false })),
    ],
  };
}

/** 맵 이름 프리필용 — 마지막 .csv 확장자만 뗀다. 다른 확장자는 이름의 일부로 본다. */
export function stripCsvExtension(fileName: string): string {
  return fileName.replace(/\.csv$/i, "");
}

/**
 * `/api/directory` 응답 → CSV 담당자/부서 해석용 디렉터리.
 * 맵 생성 시점엔 버전이 없어 listEligibleAssignees를 못 쓰므로 전 직원 디렉터리를 쓴다.
 * departments는 말단 부서명(node.department가 담는 값) — DirectoryDept.id는 org_path라 쓰면 안 된다.
 */
export function toCsvDirectory(dir: Directory): CsvDirectory {
  return {
    users: dir.users.map((user) => ({
      id: user.id,
      name: user.name,
      department: user.department,
    })),
    departments: dir.departments.map((dept) => dept.name),
    // korean_name은 없을 때 undefined가 아니라 "" 다
    dept_infos: Object.fromEntries(
      dir.departments
        .filter((dept) => dept.korean_name !== "")
        .map((dept) => [dept.name, { korean_name: dept.korean_name }]),
    ),
  };
}

/** 다운로드용 템플릿 — 구매 프로세스 예시. Excel 호환 CRLF(BOM은 다운로드 시 접두).
 *  Assignee는 사내 계정 id, Department는 정식 부서명. 값은 예시라 실제 디렉터리에 없으면 경고가 뜬다. */
export function buildTemplateCsv(): string {
  return [
    "Name,Description,Assignee,Department,System,Duration,Headcount,FTE,Cost_KRW,Annual_Count,URL,URL_Label,Next",
    "Review request,Check the request against the purchasing policy,hong.gd,Quality Part 1,SAP ERP,16,1,,,,,,Approval decision",
    'Approval decision,,"hong.gd, kim.cs",Quality Part 1,,0.30,2,,,,,,Sign contract:approved;Notify rejection:rejected',
    "Sign contract,,lee.yh,Finance Part,,24,1,,,,https://example.com/contract,Contract,",
    "Notify rejection,,,,,8,,,,,,,",
  ].join("\r\n");
}

/** 붙여넣은 텍스트의 코드펜스 관용 처리 — 외부 AI 답변이 ```csv … ``` 로 감싸 오는 경우 본문만 추출. */
export function stripCsvFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

/** 외부 AI에게 줄 절차 추출 프롬프트 — 임포트 스펙(컬럼·상한·규칙)과 동일 소스에서 파생.
 *  사용 흐름: 이 프롬프트 + 업무 문서를 외부 AI에 붙여넣기 → 받은 CSV를 임포트 붙여넣기 입력에. */
export function buildAiPromptText(): string {
  return [
    "당신은 업무 절차 분석가입니다. 아래에 첨부하는 업무 문서(규정·지침·절차서 등)를 읽고,",
    "문서에 기술된 업무 프로세스 흐름을 추출해 CSV 한 개로 작성하세요.",
    "",
    "[출력 형식 — 반드시 지킬 것]",
    "- 다른 설명·코드블록(```) 없이 CSV 텍스트만 출력하세요.",
    `- 첫 행(헤더)은 정확히: ${buildTemplateCsv().split("\r\n")[0]}`,
    "- 한 행 = 프로세스 단계 1개. 셀에 쉼표가 들어가면 그 셀을 큰따옴표로 감싸세요.",
    "",
    "[컬럼 규칙]",
    `- Name: 필수, 단계 이름. 파일 안에서 유일해야 하며 ${MAX_LEN.name}자 이하. 이 이름이 연결 참조 키입니다.`,
    "- Description: 선택, 그 단계가 무엇을 하는지 한두 문장. 콤마나 줄바꿈이 들어가면 셀 전체를 큰따옴표로 감싸세요. 길이 제한은 없습니다.",
    `- Assignee: 선택, 담당자의 사내 계정 id(login id). 여러 명이면 콤마로 나열하고 셀 전체를 큰따옴표로 감싸세요 — 예: "hong.gd, kim.cs". 한 행의 담당자는 모두 같은 부서여야 합니다. 모르면 비워두세요.`,
    `- Department: 선택, 담당 부서의 정식 부서명(${MAX_LEN.department}자 이하). 모르면 비워두세요.`,
    `- System: 선택, 사용 시스템(${MAX_LEN.system}자 이하). 모르면 비워두세요.`,
    "- Duration: 선택, 소요 시간(시간 단위 숫자, H.MM 표기 — 소수부 2자리는 분: 0.30=30분, 1.30=1시간 30분. \"2일\" 같은 텍스트 금지).",
    "- Headcount: 선택, 투입 인력(숫자만). 모르면 비워두세요.",
    "- ETF: 선택, 숫자만. 모르면 비워두세요.",
    "- Cost: 선택, 비용(숫자만). 모르면 비워두세요.",
    "- Extra: 선택, 예비 숫자 필드. 일반적으로 비워두세요.",
    `- URL: 선택, 관련 링크. http:// 또는 https:// 로 시작(${MAX_LEN.url}자 이하).`,
    `- URL_Label: 선택, 링크 표시 이름(${MAX_LEN.url_label}자 이하). URL이 있는 행에서만 의미(URL 없으면 무시됩니다).`,
    "- Next: 선택, 다음 단계의 Name을 세미콜론(;)으로 나열. 분기 조건은 \"대상이름:라벨\" 형식(라벨 200자 이하).",
    "  예: 승인 여부 단계가 승인/반려로 갈라지면 → 계약 체결:승인;반려 통보:반려",
    "",
    "[작성 규칙]",
    "- Start·End(시작/종료) 행은 쓰지 마세요 — 시스템이 자동 생성합니다.",
    "- 다음 단계가 2개 이상인 행은 자동으로 분기(판단) 노드가 되므로, 각 대상에 분기 라벨을 붙이세요.",
    "- Next의 대상 이름은 반드시 같은 CSV에 있는 Name이어야 합니다(오타 금지).",
    `- 데이터 행은 최대 ${MAX_DATA_ROWS}개입니다.`,
    "- 문서에 없는 단계를 지어내지 말고, 불명확한 속성(Description·Assignee·Department·System·Duration·URL)은 비워두세요.",
    "- 빈 칸은 기존 값을 지웁니다가 아니라 '건드리지 않음'입니다 — 이미 있는 맵에 임포트해도 기존 값이 보존됩니다.",
    "",
    "[예시]",
    buildTemplateCsv().replace(/\r\n/g, "\n"),
    "",
    "[업무 문서]",
    "(여기에 문서 내용을 붙여넣거나 파일을 첨부하세요)",
  ].join("\n");
}
