// 내보내기 컬럼 정의 단일 소스 — CSV 헤더(임포트 HEADER_COLUMNS·내보내기·템플릿·외부 AI 프롬프트)와
// Excel 열(1안·WBS 꼬리)이 여기서 파생되고, 내보내기 직전 컬럼 선택(체크박스)이 같은 목록을 쓴다.
// 설계: export-column-picker-design (사용자 결정 2026-10-02). 노드 속성을 표 표면에 올리면 여기 한 줄 추가.

export type ExportKind = "csv" | "excel";

// 피커 묶음 — 흐름(잠금 열)·일반·속성·수행 지표·입출력·조건. 순서가 곧 피커 표시 순서(인스펙터 카드와 같은 속성→지표→입출력).
// 내보내기 열 순서는 정의 배열 순서 그대로라 묶음과 무관하다.
export const EXPORT_COLUMN_GROUPS = ["flow", "general", "attributes", "metrics", "details"] as const;
export type ExportColumnGroup = (typeof EXPORT_COLUMN_GROUPS)[number];

export interface ExportColumnDef<K extends string> {
  key: K;
  header: string;
  group: ExportColumnGroup;
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
  { key: "name", group: "flow", header: "Name", required: true },
  { key: "description", group: "general", header: "Description" },
  { key: "assignee", group: "attributes", header: "Assignee" },
  { key: "role", group: "attributes", header: "Role" },
  { key: "department", group: "attributes", header: "Department" },
  { key: "system", group: "attributes", header: "System" },
  { key: "duration", group: "metrics", header: "Duration" },
  { key: "touch_time", group: "metrics", header: "Touch_Time" },
  { key: "cost_krw", group: "metrics", header: "Cost_KRW" },
  { key: "cost_usd", group: "metrics", header: "Cost_USD" },
  { key: "headcount", group: "metrics", header: "Headcount" },
  { key: "annual_count", group: "metrics", header: "Annual_Count" },
  { key: "fte", group: "metrics", header: "FTE" },
  { key: "input", group: "details", header: "Input" },
  { key: "input_flags", group: "details", header: "Input_Flags", pairedWith: "input" },
  { key: "input_forms", group: "details", header: "Input_Forms", pairedWith: "input" },
  { key: "output", group: "details", header: "Output" },
  { key: "output_forms", group: "details", header: "Output_Forms", pairedWith: "output" },
  { key: "start_condition", group: "details", header: "Start_Condition" },
  { key: "end_condition", group: "details", header: "End_Condition" },
  { key: "gmp", group: "attributes", header: "GMP" },
  { key: "url", group: "general", header: "URL" },
  { key: "url_label", group: "general", header: "URL_Label" },
  { key: "parallel", group: "flow", header: "Parallel", required: true },
  { key: "next", group: "flow", header: "Next", required: true },
] as const satisfies readonly ExportColumnDef<string>[];

export type CsvColumnKey = (typeof CSV_COLUMNS)[number]["key"];

// Excel 열 — 1안은 전부, WBS는 No·Name 자리에 No·Level 1..N·Task 구조 열을 두고 type 이후 선택분을 꼬리로 쓴다.
// 잠금(사용자 결정 2026-10-02, 맵을 다시 그릴 최소 정보): No(행 정체성·분기 주석 [No:라벨]의 참조), Name(노드·Next 대상
// 이름·분기 주석), Type(노드 모양: 시작·끝·판단·하위프로세스), Parallel(병렬 출구 — 없으면 접힌 무라벨 분기와 구분 불가),
// Next(유일한 연결 열: 방향·분기 라벨·SP 출구 끝 이름). Excel은 다시 가져오지 않으므로 짝 열 규칙은 없다.
export const EXCEL_COLUMNS = [
  { key: "no", group: "flow", header: "No", required: true },
  { key: "name", group: "flow", header: "Name", required: true },
  { key: "type", group: "flow", header: "Type", required: true },
  { key: "description", group: "general", header: "Description" },
  { key: "assignee", group: "attributes", header: "Assignee" },
  { key: "role", group: "attributes", header: "Role" },
  { key: "department", group: "attributes", header: "Department" },
  { key: "system", group: "attributes", header: "System" },
  { key: "duration", group: "metrics", header: "Duration (h)" },
  { key: "touch_time", group: "metrics", header: "Touch time (h)" },
  { key: "cost_krw", group: "metrics", header: "Cost (KRW)" },
  { key: "cost_usd", group: "metrics", header: "Cost (USD)" },
  { key: "headcount", group: "metrics", header: "Headcount" },
  { key: "annual_count", group: "metrics", header: "Annual volume" },
  { key: "fte", group: "metrics", header: "FTE" },
  { key: "input", group: "details", header: "Input" },
  { key: "output", group: "details", header: "Output" },
  { key: "start_condition", group: "details", header: "Start condition" },
  { key: "end_condition", group: "details", header: "End condition" },
  { key: "gmp", group: "attributes", header: "GMP" },
  { key: "parallel", group: "flow", header: "Parallel", required: true },
  { key: "url", group: "general", header: "URL" },
  { key: "groups", group: "general", header: "Groups" },
  { key: "next", group: "flow", header: "Next", required: true },
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

/** 묶음 머리 상태 — 잠금 열을 뺀 열 기준. 짝 열은 값 열과 함께 켜지고 꺼지므로 같은 묶음에 넣어 센다. */
export function getExportGroupState(
  defs: readonly ExportColumnDef<string>[],
  selected: readonly string[],
  group: ExportColumnGroup,
): { isLocked: boolean; onCount: number; total: number; isAllOn: boolean; isSomeOn: boolean } {
  const picked = new Set(selected);
  const members = defs.filter((def) => def.group === group);
  const togglable = members.filter((def) => def.required !== true);
  const isOn = (def: ExportColumnDef<string>) => isExportColumnForced(def, picked) || picked.has(def.key);
  const togglableOn = togglable.filter(isOn).length;
  return {
    isLocked: togglable.length === 0,
    onCount: members.filter(isOn).length,
    total: members.length,
    isAllOn: togglable.length > 0 && togglableOn === togglable.length,
    isSomeOn: togglableOn > 0,
  };
}

/**
 * 묶음 일괄 체크/해제 — 잠금 열을 뺀 묶음 열이 전부 켜져 있으면 모두 끄고, 하나라도 꺼져 있으면 모두 켠다.
 * 짝 열도 함께 끈다(값 열이 같이 꺼지면 풀리고, 값 열이 다른 묶음에 켜져 있으면 정규화가 다시 붙인다).
 */
export function toggleExportColumnGroup<K extends string>(
  defs: readonly ExportColumnDef<K>[],
  selected: readonly string[],
  group: ExportColumnGroup,
): K[] {
  const picked = new Set(selected);
  const { isAllOn } = getExportGroupState(defs, selected, group);
  for (const def of defs) {
    if (def.group !== group || def.required === true) continue;
    if (isAllOn) picked.delete(def.key);
    else picked.add(def.key);
  }
  return normalizeExportColumns(defs, [...picked]);
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
