// 내보내기 컬럼 정의 단일 소스 — CSV 헤더(임포트 HEADER_COLUMNS·내보내기·템플릿·외부 AI 프롬프트)와
// Excel 열(1안·WBS 꼬리)이 여기서 파생되고, 내보내기 직전 컬럼 선택(체크박스)이 같은 목록을 쓴다.
// 설계: export-column-picker-design (사용자 결정 2026-10-02). 노드 속성을 표 표면에 올리면 여기 한 줄 추가.

export type ExportKind = "csv" | "excel";

export interface ExportColumnDef<K extends string> {
  key: K;
  header: string;
  // 잠금 열 — 선택 해제 불가(CSV Name, Excel No·Name)
  required?: boolean;
}

// CSV 25열 — 순서가 곧 내보내기·템플릿 헤더 순서. 임포트는 헤더 이름 매칭이라 순서·부분집합 무관.
export const CSV_COLUMNS = [
  { key: "name", header: "Name", required: true },
  { key: "description", header: "Description" },
  { key: "assignee", header: "Assignee" },
  { key: "role", header: "Role" },
  { key: "department", header: "Department" },
  { key: "system", header: "System" },
  { key: "duration", header: "Duration" },
  { key: "touch_time", header: "Touch_Time" },
  { key: "cost_krw", header: "Cost_KRW" },
  { key: "cost_usd", header: "Cost_USD" },
  { key: "headcount", header: "Headcount" },
  { key: "annual_count", header: "Annual_Count" },
  { key: "fte", header: "FTE" },
  { key: "input", header: "Input" },
  { key: "input_flags", header: "Input_Flags" },
  { key: "input_forms", header: "Input_Forms" },
  { key: "output", header: "Output" },
  { key: "output_forms", header: "Output_Forms" },
  { key: "start_condition", header: "Start_Condition" },
  { key: "end_condition", header: "End_Condition" },
  { key: "gmp", header: "GMP" },
  { key: "url", header: "URL" },
  { key: "url_label", header: "URL_Label" },
  { key: "parallel", header: "Parallel" },
  { key: "next", header: "Next" },
] as const satisfies readonly ExportColumnDef<string>[];

export type CsvColumnKey = (typeof CSV_COLUMNS)[number]["key"];

// Excel 열 — 1안은 전부, WBS는 No·Name 자리에 No·Level 1..N·Task 구조 열을 두고 type 이후 선택분을 꼬리로 쓴다.
export const EXCEL_COLUMNS = [
  { key: "no", header: "No", required: true },
  { key: "name", header: "Name", required: true },
  { key: "type", header: "Type" },
  { key: "description", header: "Description" },
  { key: "assignee", header: "Assignee" },
  { key: "role", header: "Role" },
  { key: "department", header: "Department" },
  { key: "system", header: "System" },
  { key: "duration", header: "Duration (h)" },
  { key: "touch_time", header: "Touch time (h)" },
  { key: "cost_krw", header: "Cost (KRW)" },
  { key: "cost_usd", header: "Cost (USD)" },
  { key: "headcount", header: "Headcount" },
  { key: "annual_count", header: "Annual volume" },
  { key: "fte", header: "FTE" },
  { key: "input", header: "Input" },
  { key: "output", header: "Output" },
  { key: "start_condition", header: "Start condition" },
  { key: "end_condition", header: "End condition" },
  { key: "gmp", header: "GMP" },
  { key: "parallel", header: "Parallel" },
  { key: "url", header: "URL" },
  { key: "groups", header: "Groups" },
  { key: "next", header: "Next" },
] as const satisfies readonly ExportColumnDef<string>[];

export type ExcelColumnKey = (typeof EXCEL_COLUMNS)[number]["key"];

const STORAGE_KEY: Record<ExportKind, string> = {
  csv: "bpm.exportColumns.csv",
  excel: "bpm.exportColumns.excel",
};

/** 종류별 정의 목록 — 피커·로드/세이브가 같은 목록을 본다. */
export function getExportColumnDefs(kind: ExportKind): readonly ExportColumnDef<string>[] {
  return kind === "csv" ? CSV_COLUMNS : EXCEL_COLUMNS;
}

/** 선택 키 → 정식 순서로 정렬·잠금 열 강제·미지 키 제거. 미지정(undefined)이면 전부. */
export function normalizeExportColumns<K extends string>(
  defs: readonly ExportColumnDef<K>[],
  keys: readonly string[] | undefined,
): K[] {
  if (keys === undefined) return defs.map((def) => def.key);
  const picked = new Set(keys);
  return defs.filter((def) => def.required === true || picked.has(def.key)).map((def) => def.key);
}

/**
 * 저장된 선택 → 선택 키(정식 순서). 저장은 "제외한 키"라 이후 새로 생긴 열은 기본 켜짐.
 * localStorage는 사생활 모드·차단에서 throw하거나 비어 있을 수 있어 실패하면 기본(전부)으로 수렴.
 */
export function loadExportColumns(kind: ExportKind): string[] {
  const defs = getExportColumnDefs(kind);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY[kind]);
    if (raw === null) return normalizeExportColumns(defs, undefined);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return normalizeExportColumns(defs, undefined);
    const excluded = new Set(parsed.filter((value): value is string => typeof value === "string"));
    return normalizeExportColumns(defs, defs.map((def) => def.key).filter((key) => !excluded.has(key)));
  } catch {
    return normalizeExportColumns(defs, undefined);
  }
}

/** 선택 키 저장 — 제외 키만 기록. 저장 실패(차단·용량)는 이번 세션 선택만 유지하면 되므로 무시한다. */
export function saveExportColumns(kind: ExportKind, keys: readonly string[]): void {
  const picked = new Set(keys);
  const excluded = getExportColumnDefs(kind)
    .filter((def) => def.required !== true && !picked.has(def.key))
    .map((def) => def.key);
  try {
    window.localStorage.setItem(STORAGE_KEY[kind], JSON.stringify(excluded));
  } catch {
    // 편의 저장일 뿐 — 실패해도 현재 모달의 선택은 state로 살아 있다
  }
}
