// 내보내기 컬럼 정의 단일 소스 — CSV 헤더(임포트 HEADER_COLUMNS·내보내기·템플릿·외부 AI 프롬프트)와
// Excel 열(1안·WBS 꼬리)이 여기서 파생되고, 내보내기 직전 컬럼 선택(체크박스)이 같은 목록을 쓴다.
// 설계: export-column-picker-design (사용자 결정 2026-10-02). 노드 속성을 표 표면에 올리면 여기 한 줄 추가.

export type ExportKind = "csv" | "excel";

export interface ExportColumnDef<K extends string> {
  key: K;
  header: string;
  // 잠금 열 — 선택 해제 불가. CSV는 다시 가져오기에 필요한 열, Excel은 맵을 다시 그릴 최소 열.
  required?: boolean;
  // 짝 열 — 이 키(값 열)가 선택돼 있는 동안 함께 고정. 값 열만 담아 줄을 고친 뒤 다시 가져오면
  // 빠진 줄 정렬 열(플래그·폼)이 통째로 지워지기 때문(csv-import mergeAlignedLines, 2026-10-02 검증).
  pairedWith?: string;
}

// CSV 25열 — 순서가 곧 내보내기·템플릿 헤더 순서. 임포트는 헤더 이름 매칭이라 순서·부분집합 무관.
// 잠금(사용자 결정 2026-10-02, CSV 내보내기는 임포트의 전 단계): Name(식별·헤더 필수), Next(빠지면 연결·분기 라벨·SP 출구가
// 전부 lostEdges), Parallel(빠지면 새 맵 만들기에서 병렬 노드가 경고 없이 판단 노드로 바뀜). 나머지는 빠지면 기존 값 유지.
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
  { key: "input_flags", header: "Input_Flags", pairedWith: "input" },
  { key: "input_forms", header: "Input_Forms", pairedWith: "input" },
  { key: "output", header: "Output" },
  { key: "output_forms", header: "Output_Forms", pairedWith: "output" },
  { key: "start_condition", header: "Start_Condition" },
  { key: "end_condition", header: "End_Condition" },
  { key: "gmp", header: "GMP" },
  { key: "url", header: "URL" },
  { key: "url_label", header: "URL_Label" },
  { key: "parallel", header: "Parallel", required: true },
  { key: "next", header: "Next", required: true },
] as const satisfies readonly ExportColumnDef<string>[];

export type CsvColumnKey = (typeof CSV_COLUMNS)[number]["key"];

// Excel 열 — 1안은 전부, WBS는 No·Name 자리에 No·Level 1..N·Task 구조 열을 두고 type 이후 선택분을 꼬리로 쓴다.
// 잠금(사용자 결정 2026-10-02, 맵을 다시 그릴 최소 정보): No(행 정체성·분기 주석 [No:라벨]의 참조), Name(노드·Next 대상
// 이름·분기 주석), Type(노드 모양: 시작·끝·판단·하위프로세스), Parallel(병렬 출구 — 없으면 접힌 무라벨 분기와 구분 불가),
// Next(유일한 연결 열: 방향·분기 라벨·SP 출구 끝 이름). Excel은 다시 가져오지 않으므로 짝 열 규칙은 없다.
export const EXCEL_COLUMNS = [
  { key: "no", header: "No", required: true },
  { key: "name", header: "Name", required: true },
  { key: "type", header: "Type", required: true },
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
  { key: "parallel", header: "Parallel", required: true },
  { key: "url", header: "URL" },
  { key: "groups", header: "Groups" },
  { key: "next", header: "Next", required: true },
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

/** 해제할 수 없는 열인지 — 잠금 열이거나, 짝 값 열이 선택돼 있는 줄 정렬 열. 피커 비활성과 정규화가 같은 판정을 쓴다. */
export function isExportColumnForced(def: ExportColumnDef<string>, picked: ReadonlySet<string>): boolean {
  return def.required === true || (def.pairedWith !== undefined && picked.has(def.pairedWith));
}

/** 선택 키 → 정식 순서로 정렬·잠금/짝 열 강제·미지 키 제거. 미지정(undefined)이면 전부. */
export function normalizeExportColumns<K extends string>(
  defs: readonly ExportColumnDef<K>[],
  keys: readonly string[] | undefined,
): K[] {
  if (keys === undefined) return defs.map((def) => def.key);
  const picked = new Set(keys);
  return defs.filter((def) => isExportColumnForced(def, picked) || picked.has(def.key)).map((def) => def.key);
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
