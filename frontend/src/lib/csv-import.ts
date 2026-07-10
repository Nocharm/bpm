// CSV 임포트 — 템플릿·RFC4180 파싱·그래프 변환(자동 Start/End·decision 추론).
// 설계: docs/superpowers/specs/2026-07-06-csv-import-design.md
import type { Edge } from "@xyflow/react";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { driftedAssignees, formatAssignees, parseAssignees } from "./assignee";
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
}

export interface CsvDirectory {
  users: readonly { id: string; name: string; department: string }[];
  departments: readonly string[];
  // 정식 부서명 → { korean_name } — 한글로 적힌 부서 셀을 정식명으로 되돌린다
  dept_infos?: Readonly<Record<string, { korean_name?: string }>>;
}

/** 임포트 문맥 — 디렉터리는 담당자/부서 해석에, base(Task 4)는 머지에 쓴다. */
export interface CsvImportContext {
  directory?: CsvDirectory;
}

const HEADER_COLUMNS = [
  "name", "description", "assignee", "department", "system", "duration", "url", "url_label", "next",
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
  url: 500,
  url_label: 100,
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
  url_label: "",
  pos_x: 0,
  pos_y: 0,
  group_ids: [] as string[],
  linked_map_id: null,
  follow_latest: false,
  linked_version_id: null,
  is_primary_end: false,
};

/** login_id → 이름. 이미 이름이면 그대로(거짓 경고 방지). 못 찾으면 원문 + 경고. */
function resolveAssignee(
  raw: string, dir: CsvDirectory | undefined, line: number, warnings: CsvImportWarning[],
): string {
  if (raw === "" || dir === undefined) return raw;
  const names = parseAssignees(raw).map((token) => {
    const byId = dir.users.find((user) => user.id === token);
    if (byId) return byId.name;
    if (dir.users.some((user) => user.name === token)) return token;
    warnings.push({ line, message: `Unknown assignee "${token}"` });
    return token;
  });
  return formatAssignees(names);
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

/** CSV 텍스트 → 검증 + 그래프(자동 Start/End, decision 추론, dagre LR 배치). 에러 있으면 graph=null. */
export function buildGraphFromCsv(text: string, context?: CsvImportContext): CsvImportOutcome {
  const fail = (errors: CsvImportError[]): CsvImportOutcome => ({
    graph: null,
    nodeCount: 0,
    edgeCount: 0,
    errors,
    warnings: [],
    ignoredLabelCount: 0,
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
    url: cellOf(r, "url"),
    url_label: cellOf(r, "url_label"),
    nextRaw: cellOf(r, "next"),
    line: r.line,
  }));

  // URL 없는 라벨은 에러가 아니라 무시 — 임포트 전 서머리에 건수 안내 (url-label design 2026-07-07)
  let ignoredLabelCount = 0;
  for (const row of rows) {
    if (row.url === "" && row.url_label !== "") {
      ignoredLabelCount += 1;
      row.url_label = "";
    }
  }

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
    for (const col of ["name", "system", "duration", "url", "url_label"] as const) {
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
      description: row.description,
      assignee: resolved.get(row.name)?.assignee ?? "",
      department: resolved.get(row.name)?.department ?? "",
      system: row.system,
      duration: row.duration,
      url: row.url,
      url_label: row.url_label,
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
      urlLabel: node.url_label ?? "",
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

  // 부서 불일치 경고 — resolveAssignee가 이미 경고한 미해석 토큰은 제외(중복 경고 방지)
  if (context?.directory) {
    const dir = context.directory;
    for (const row of rows) {
      const info = resolved.get(row.name);
      if (!info || info.assignee === "") continue;
      const known = parseAssignees(info.assignee).filter((n) => dir.users.some((u) => u.name === n));
      // driftedAssignees는 mutable Person[]을 받는다 — CsvDirectory.users는 readonly라 얕은 복사로 맞춘다
      const drifted = driftedAssignees(info.department, known, [...dir.users]);
      for (const name of drifted) {
        warnings.push({ line: row.line, message: `"${name}" is not in department "${info.department}"` });
      }
    }
  }

  return {
    graph: { nodes: positioned, edges, groups: [] },
    nodeCount: positioned.length,
    edgeCount: edges.length,
    errors: [],
    warnings,
    ignoredLabelCount,
  };
}

/** 다운로드용 템플릿 — 구매 프로세스 예시. Excel 호환 CRLF(BOM은 다운로드 시 접두).
 *  Assignee는 사내 계정 id, Department는 정식 부서명. 값은 예시라 실제 디렉터리에 없으면 경고가 뜬다. */
export function buildTemplateCsv(): string {
  return [
    "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next",
    "Review request,Check the request against the purchasing policy,hong.gd,Quality Part 1,SAP ERP,2 days,,,Approval decision",
    'Approval decision,,"hong.gd, kim.cs",Quality Part 1,,,,,Sign contract:approved;Notify rejection:rejected',
    "Sign contract,,lee.yh,Finance Part,,3 days,https://example.com/contract,Contract,",
    "Notify rejection,,,,,1 day,,,",
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
    `- Duration: 선택, 소요 시간(예: 2 days, 3시간 — ${MAX_LEN.duration}자 이하).`,
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
