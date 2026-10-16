// Excel 내보내기 모델 — 서브프로세스 전체 재귀 인라인(조상 검사·행 상한·locked) 순수 로직.
// exceljs 기록(다운로드)은 별도 모듈(Task 7) — 모델과 분리해 vitest로 검증한다.
// 설계: 2026-07-11-numeric-params-excel-csv-export-design.md §4,
//       2026-07-13-node-params-redefinition-design.md §5.2,
//       2026-07-17-excel-export-format-v1-design.md (구조 노드 정리+분기 주석),
//       export-column-picker-design(2026-10-02, 열 선택·IO/조건/GMP/병렬 열)
import type { Graph, GraphEdge, GraphNode } from "./api";
import { formatSystemCell, orderNodesByFlow } from "./csv-export";
import { parseDurationMinutes } from "./duration";
import { EXCEL_COLUMNS, type ExcelColumnKey, normalizeExportColumns } from "./export-columns";
import { formatGmp } from "./gmp";
import { getIoLine } from "./io-items";
import { getOutputGroups } from "./output-rules";
import { getInheritedParams } from "./params";
import { deriveSubEnds, endKeyOfEdge, PRIMARY_END_HANDLE } from "./subprocess-embed";
import { mergeSubprocessDescription } from "./subprocess-description";

/** 1안·WBS 노드 행이 공유하는 셀 값 — 열 정의(COLUMNS)의 cell이 이 필드만 읽는다. */
export interface ExcelRowFields {
  no: number; // 최종 행 번호(1..n) — 삭제 규칙 적용 후 모델에서 부여, 시트는 그대로 기록
  title: string;
  type: string;
  description: string;
  assignee: string;
  assignee_role: string;
  department: string;
  system: string;
  // 회당 파라미터 7종 — 표시 순서는 lib/params.ts PARAM_FIELDS와 동일
  duration: string;
  touch_time: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  // IO 셀 — 줄마다 `항목[ [optional]][ · 폼]` (에디터 SP 상속 표기 관례), 조건·GMP는 표시 문자열
  input: string;
  output: string;
  start_condition: string;
  end_condition: string;
  gmp: string;
  // 병렬 출구 — 일반 노드는 기본 출구가 병렬이면 "Y", SP는 병렬로 켠 끝 이름 목록
  parallel: string;
  url: string;
  urlLabel: string;
  groups: string; // 그룹 라벨 ", " 조인
  next: string; // "3. 대상" | "3. 대상 [라벨]" "; " 조인(행 없는 대상은 번호 없이) — 번호 부여 뒤 formatExcelNextCell
}

export interface ExcelNodeRow extends ExcelRowFields {
  kind: "node";
  depth: number; // 0=현재 맵, 서브프로세스 인라인마다 +1
}

export interface ExcelNoteRow {
  kind: "circular" | "denied" | "rowLimit";
  depth: number;
  title: string; // 표기 문구 조립용(맵 이름 등)
}

export type ExcelRow = ExcelNodeRow | ExcelNoteRow;

/** 표 위 메타 블록 한 줄 — 라벨/값(빈 값은 기록하지 않는다). */
export interface ExcelMetaRow {
  label: string;
  value: string;
}

export interface ExcelModel {
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  meta: ExcelMetaRow[];
  rows: ExcelRow[];
  truncated: boolean;
}

export type ExcelExportFormat = "map" | "wbs";

const EXCEL_FORMAT_STORAGE_KEY = "bpm.excelExportFormat";

/** 마지막으로 고른 형식 — 저장값이 없거나 깨졌거나 저장소가 막혀 있으면 Process Map. */
export function loadExcelExportFormat(): ExcelExportFormat {
  try {
    return window.localStorage.getItem(EXCEL_FORMAT_STORAGE_KEY) === "wbs" ? "wbs" : "map";
  } catch {
    return "map";
  }
}

/** 형식 기억 — 저장 실패(차단·용량)는 이번 창의 선택만 유지하면 되므로 넘어간다. */
export function saveExcelExportFormat(format: ExcelExportFormat): void {
  try {
    window.localStorage.setItem(EXCEL_FORMAT_STORAGE_KEY, format);
  } catch {
    // 편의 저장일 뿐 — 실패해도 현재 창의 형식은 state로 살아 있다
  }
}

/** 메타 블록 원천 값 — 게시일·프레임워크 경로처럼 없는 값은 빈 문자열로 두면 줄째 빠진다. */
export interface ExcelMetaInput {
  mapName: string;
  owningDept?: string;
  owner?: string;
  versionLabel: string;
  published?: string;
  framework?: string;
  exportedAt: string;
}

export interface ExcelMetaLabels {
  map: string;
  owningDept: string;
  owner: string;
  version: string;
  published: string;
  framework: string;
  exportedAt: string;
}

// 라벨을 받지 못한 호출(테스트·기본값)용 — 화면은 i18n 라벨(PNG 정보 카드와 같은 키)을 넘긴다
export const DEFAULT_EXCEL_META_LABELS: ExcelMetaLabels = {
  map: "Map",
  owningDept: "Owning dept",
  owner: "Owner",
  version: "Version",
  published: "Published",
  framework: "Framework",
  exportedAt: "Exported",
};

/** 메타 블록 줄 — 맵·주관 부서·오너·버전·게시일·프레임워크·내보낸 시각 순, 빈 값 줄은 뺀다. */
export function buildExcelMeta(input: ExcelMetaInput, labels: ExcelMetaLabels = DEFAULT_EXCEL_META_LABELS): ExcelMetaRow[] {
  return [
    { label: labels.map, value: input.mapName },
    { label: labels.owningDept, value: input.owningDept ?? "" },
    { label: labels.owner, value: input.owner ?? "" },
    { label: labels.version, value: input.versionLabel },
    { label: labels.published, value: input.published ?? "" },
    { label: labels.framework, value: input.framework ?? "" },
    { label: labels.exportedAt, value: input.exportedAt },
  ].filter((row) => row.value.trim() !== "");
}

export const EXCEL_MAX_ROWS = 2000;

/**
 * 노드가 노출하는 회당 5필드(duration/touch_time/cost_krw/cost_usd/headcount) — 서브프로세스는 자기 행이 아니라
 * 링크 맵의 sp_* 라이브 참조(g.subprocess_refs)에서 가져온다(캔버스 인스펙터·Σ 합산과 동일 소스,
 * design 2026-07-13 §3.1). annual_count·fte는 부모 맥락 값이라 노드 행 그대로 별도 취급.
 */
export function getNodeRunParams(g: Graph, node: GraphNode): Pick<ExcelRowFields, "duration" | "touch_time" | "cost_krw" | "cost_usd" | "headcount"> {
  if (node.node_type === "subprocess" && node.linked_map_id !== null) {
    return getInheritedParams(g.subprocess_refs?.[node.linked_map_id]);
  }
  return {
    duration: node.duration,
    touch_time: node.touch_time ?? "",
    cost_krw: node.cost_krw ?? "",
    cost_usd: node.cost_usd ?? "",
    headcount: node.headcount ?? "",
  };
}

const isLinkedSubprocess = (node: GraphNode): node is GraphNode & { linked_map_id: number } =>
  node.node_type === "subprocess" && node.linked_map_id !== null;

/** 노드 표시 제목 — SP는 링크 맵 현재 이름(캔버스 라이브 라벨과 같은 규칙, 삭제 맵은 저장 제목). */
export function getNodeDisplayTitle(g: Graph, node: GraphNode): string {
  // 빈 제목 끝(임포트 L6 기본·에디터 신규 끝)은 Next 셀이 빈칸이 되지 않게 "End" — 제목 있는 끝은 원문 그대로
  if (node.node_type === "end" && node.title.trim() === "") return "End";
  if (!isLinkedSubprocess(node)) return node.title;
  // 빈 이름도 미수신으로 본다(캔버스 liveLabel의 truthy 판정과 같음)
  return g.subprocess_refs?.[node.linked_map_id]?.name || node.title;
}

/**
 * 행 식별 필드 — SP는 캔버스가 보여 주는 링크 맵 지정값(담당·역할·부서·시스템·URL), 미지정이면 노드 값.
 * 시스템은 CSV와 같은 표기(Other면 원문 메모, formatSystemCell).
 */
export function getNodeIdentityFields(
  g: Graph,
  node: GraphNode,
): Pick<ExcelRowFields, "title" | "assignee" | "assignee_role" | "department" | "system" | "url" | "urlLabel"> {
  const ref = isLinkedSubprocess(node) ? g.subprocess_refs?.[node.linked_map_id] : undefined;
  const title = getNodeDisplayTitle(g, node);
  if (ref?.designated) {
    return {
      title,
      assignee: ref.assignee ?? "",
      assignee_role: ref.assignee_role ?? "",
      department: ref.department ?? "",
      system: ref.system ?? "",
      url: ref.url ?? "",
      urlLabel: ref.url_label ?? "",
    };
  }
  return {
    title,
    assignee: node.assignee,
    assignee_role: node.assignee_role ?? "",
    department: node.department,
    system: formatSystemCell(node.system, node.system_fallback ?? ""),
    url: node.url ?? "",
    urlLabel: node.url_label ?? "",
  };
}

/** IO 셀 — 항목 줄마다 `[optional]`·` · 폼`을 붙인다. 플래그·폼은 항목과 1:1 줄 정렬. */
export function formatIoCell(
  items: string | null | undefined,
  flags: string | null | undefined,
  forms: string | null | undefined,
): string {
  const text = items ?? "";
  if (text === "") return "";
  return text
    .split("\n")
    .map((item, index) => {
      const optional = getIoLine(flags, index) === "optional" ? " [optional]" : "";
      const form = getIoLine(forms, index);
      return `${item}${optional}${form !== "" ? ` · ${form}` : ""}`;
    })
    .join("\n");
}

// GMP 표시 라벨(lib/gmp.ts) — 미지 값은 원문 그대로
const formatGmpCell = (value: string | null | undefined): string => formatGmp(value) || (value ?? "");

/** IO·조건·GMP — SP는 링크 맵 지정값(파라미터와 같은 상속 규칙), 미지정이면 노드 값. */
export function getNodeDetailFields(
  g: Graph,
  node: GraphNode,
): Pick<ExcelRowFields, "input" | "output" | "start_condition" | "end_condition" | "gmp"> {
  const ref = isLinkedSubprocess(node) ? g.subprocess_refs?.[node.linked_map_id] : undefined;
  if (ref?.designated) {
    return {
      input: formatIoCell(ref.input, "", ref.input_forms),
      output: formatIoCell(ref.output, "", ref.output_forms),
      start_condition: ref.start_condition ?? "",
      end_condition: ref.end_condition ?? "",
      gmp: formatGmpCell(ref.gmp),
    };
  }
  return {
    input: formatIoCell(node.input, node.input_flags, node.input_forms),
    output: formatIoCell(node.output, "", node.output_forms),
    start_condition: node.start_condition ?? "",
    end_condition: node.end_condition ?? "",
    gmp: formatGmpCell(node.gmp),
  };
}

/**
 * SP 출구 끝 키 → 끝 제목. 링크 맵을 읽었으면 그 끝 목록(2개 이상일 때만, 캔버스 출구 라벨 미러와 같은 조건),
 * 못 읽었으면(순환·권한) 보조 끝 키 자체가 끝 제목이라 그것만 안다. 해당 없으면 null.
 */
export function getSubprocessExitTitles(
  outgoing: readonly GraphEdge[],
  resolved: Graph | null,
): ReadonlyMap<string, string> | null {
  if (resolved && !resolved.locked) {
    const ends = deriveSubEnds(resolved);
    return ends.length >= 2 ? new Map(ends.map((end) => [end.key, end.title])) : null;
  }
  const keys = outgoing
    .map((edge) => endKeyOfEdge({ sourceHandle: edge.source_handle }))
    .filter((key) => key !== PRIMARY_END_HANDLE);
  return keys.length > 0 ? new Map(keys.map((key) => [key, key])) : null;
}

/** Next 셀의 엣지 라벨 — SP에서 나가는 무라벨 엣지는 끝 제목을 라벨처럼 표기(에디터 출구 라벨 미러, 데이터 불변). */
export function getExcelEdgeLabel(
  edge: GraphEdge,
  source: GraphNode,
  exitTitles: ReadonlyMap<string, string> | null,
): string {
  if (edge.label !== "" || source.node_type !== "subprocess" || exitTitles === null) return edge.label;
  return exitTitles.get(endKeyOfEdge({ sourceHandle: edge.source_handle })) ?? "";
}

/** Next 칸 한 항목 — 대상 노드 id(같은 맵 인스턴스 안)·표시 제목·엣지 라벨. 번호는 행 번호 부여 뒤에 붙인다. */
export interface ExcelNextRef {
  targetId: string;
  title: string;
  label: string;
}

/**
 * Next 칸 문자열 — 대상을 줄 번호로 가리킨다: "3. 검토 [예]; 5. 반려" (사용자 결정 2026-10-02).
 * 제목으로만 가리키면 같은 제목의 두 대상이 하나로 합쳐지고, 제목·라벨의 `;`·`:`가 구분자와 섞였다.
 * 행이 없는 대상(기본 End·WBS의 시작/끝/펼친 하위프로세스·행 상한 밖)은 번호 없이 제목만.
 */
export function formatExcelNextCell(
  refs: readonly ExcelNextRef[],
  rowNoOf: (targetId: string) => number | undefined,
): string {
  return refs
    .map(({ targetId, title, label }) => {
      const no = rowNoOf(targetId);
      const target = no === undefined ? title : `${no}. ${title}`;
      return label === "" ? target : `${target} [${label}]`;
    })
    .join("; ");
}

/** 같은 (대상 노드, 라벨)은 한 번만 — 삭제된 무라벨 디시전을 거쳐 같은 대상에 두 번 닿는 재수렴 대비. 다른 노드는 제목이 같아도 따로 남는다. */
export function dedupeExcelNextRefs(refs: readonly ExcelNextRef[]): ExcelNextRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.targetId}\u0000${ref.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 병렬 셀 — 분기·끝은 병렬 대상이 아니라 빈칸, SP는 병렬로 켠 끝 이름(제목을 모르는 대표 끝은 "Y").
 * 켠 키 ∪ 실제로 2갈래 이상 병렬로 갈라지는 출구(시작 노드 기본 병렬·임포트 레거시 gateway=parallel, lib/output-rules).
 * 속성만 보면 이 둘이 빈칸이 돼 접힌 무라벨 분기(여러 Next)와 구분되지 않는다 — Parallel은 맵을 다시 그릴 잠금 열(2026-10-02).
 */
export function formatParallelCell(
  node: GraphNode,
  edges: readonly GraphEdge[],
  exitTitles: ReadonlyMap<string, string> | null,
): string {
  if (node.node_type === "decision" || node.node_type === "end") return "";
  const keySet = new Set(node.parallel_outputs ?? []);
  const groups = getOutputGroups(
    { id: node.id, nodeType: node.node_type, parallelOutputs: node.parallel_outputs },
    edges.map((edge) => ({ source: edge.source_node_id, sourceHandle: edge.source_handle, gateway: edge.gateway })),
  );
  for (const group of groups) {
    if (group.parallel && group.count >= 2) keySet.add(group.key);
  }
  const keys = [...keySet];
  if (node.node_type !== "subprocess") return keys.includes(PRIMARY_END_HANDLE) ? "Y" : "";
  return keys.map((key) => exitTitles?.get(key) ?? (key === PRIMARY_END_HANDLE ? "Y" : key)).join(", ");
}

/** 노드 → 행 셀 필드(번호 제외). 1안·WBS가 같은 소스로 SP 상속·설명 합성·그룹 라벨을 만든다. */
export function buildNodeRowFields(
  g: Graph,
  node: GraphNode,
  opts: { groupLabel: ReadonlyMap<string, string>; next: string; exitTitles: ReadonlyMap<string, string> | null },
): Omit<ExcelRowFields, "no"> {
  return {
    ...getNodeIdentityFields(g, node),
    type: node.node_type,
    // subprocess는 노드에 이 맵의 추가분만 저장됨 — 링크 맵 description(베이스, SubprocessRefOut.sp_description 키)과
    // 줄바꿈 합성해 출력
    description: isLinkedSubprocess(node)
      ? mergeSubprocessDescription(g.subprocess_refs?.[node.linked_map_id]?.sp_description, node.description)
      : node.description,
    ...getNodeRunParams(g, node),
    annual_count: node.annual_count ?? "",
    fte: node.fte ?? "",
    ...getNodeDetailFields(g, node),
    parallel: formatParallelCell(node, g.edges, opts.exitTitles),
    groups: node.group_ids.map((id) => opts.groupLabel.get(id) ?? "").filter(Boolean).join(", "),
    next: opts.next,
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
  meta,
}: {
  graph: Graph;
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  fetchResolved: (mapId: number, followLatest: boolean, pinned: number | null) => Promise<Graph>;
  maxRows?: number;
  // 표 위 메타 블록 — 미지정이면 맵·버전·내보낸 시각만(영문 라벨)
  meta?: ExcelMetaRow[];
  // 루트 맵 자신의 id — 전달 시 루트 역참조 순환을 재펼침 없이 즉시 circular 차단(조상 경로에 루트 포함, design §4)
  rootMapId?: number;
}): Promise<ExcelModel> {
  const rows: ExcelRow[] = [];
  let truncated = false;
  // 상한은 노드 행만 센다 — 순환·권한 노트 행이 많은 맵에서 실제 업무 행이 먼저 잘리지 않게
  let nodeRowCount = 0;
  // 규칙4 주석 — 행 "객체" 참조로 기록해 번호 부여 후 일괄 조립(역방향 분기·다이아몬드 이중 인라인 안전)
  const annotations: Array<{ target: ExcelNodeRow; decision: ExcelNodeRow; label: string }> = [];
  // Next 칸 — 대상은 같은 맵 인스턴스(scopeRows)의 행으로 풀고 번호 부여 뒤 조립(앞쪽 행이 뒤 행을 가리켜도 안전)
  const pendingNext: Array<{ row: ExcelNodeRow; refs: ExcelNextRef[]; scopeRows: ReadonlyMap<string, ExcelNodeRow> }> = [];
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
    // 규칙1: 나가는 엣지가 있고 전부 무라벨인 디시전(라벨 없는 택일) = 행 미생성(엣지 없는 디시전은 WIP로 유지).
    // 병렬 출구는 parallel_outputs 노드 속성이라 process 행으로 남고 Parallel 열에 표기된다 (출력 규칙 2026-10-01)
    const isRemovedDecision = (n: GraphNode): boolean => {
      if (n.node_type !== "decision") return false;
      const out = outgoing.get(n.id) ?? [];
      return out.length > 0 && out.every((e) => e.label === "");
    };
    // 규칙2: 루트 스코프 BFS 기점 start만 유지 — 서브프로세스 인라인·미도달 추가 start는 행 미생성
    const keptStartId = depth === 0 ? ordered.find((n) => n.node_type === "start")?.id : undefined;
    // 규칙3: 기본 제목 end는 행 미생성(커스텀 제목 end는 유지) — next의 "End" 표기는 그대로 남는다.
    // 빈 제목도 기본 — 에디터·임포트가 끝을 빈 제목으로 만들고 표시는 "End"라 같은 노드다(2026-10-02)
    const isDefaultEnd = (n: GraphNode): boolean =>
      n.node_type === "end" && ["", "end"].includes(n.title.trim().toLowerCase());
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
      if (nodeRowCount >= maxRows) {
        // 재귀 레벨 무관 상한 공유 — truncated 이미 true면 rowLimit 재생성 없이 중단 전파.
        // return이 아닌 break — 스코프 잔여 행만 포기하고 주석 수집 패스는 실행해 이미 출력된 행의 주석을 보존
        if (!truncated) rows.push({ kind: "rowLimit", depth, title: "" });
        truncated = true;
        break;
      }
      // SP는 행을 만들기 전에 링크 맵을 읽는다 — 출구 끝 제목(Next 라벨 미러·병렬 끝 이름)이 그 끝 목록에서 나온다
      let resolved: Graph | null = null;
      let note: "circular" | "denied" | null = null;
      if (isLinkedSubprocess(node) && !truncated) {
        if (ancestry.has(node.linked_map_id)) {
          note = "circular";
        } else {
          try {
            resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
            if (resolved.locked) note = "denied";
          } catch {
            note = "denied";
          }
        }
      }
      const out = outgoing.get(node.id) ?? [];
      const exitTitles =
        node.node_type === "subprocess" ? getSubprocessExitTitles(out, note === null ? resolved : null) : null;
      // Next는 대상 행 번호가 정해진 뒤 조립 — 여기선 (대상 노드, 제목, 라벨)만 모은다
      const nextRefs = dedupeExcelNextRefs(
        out
          .flatMap((e) => resolveTargets(e, getExcelEdgeLabel(e, node, exitTitles), new Set()))
          .map(({ node: t, label }) => ({ targetId: t.id, title: getNodeDisplayTitle(g, t), label })),
      );
      const row: ExcelNodeRow = {
        kind: "node",
        no: 0, // finalize에서 부여
        depth,
        ...buildNodeRowFields(g, node, { groupLabel, next: "", exitTitles }),
      };
      rows.push(row);
      nodeRowCount += 1;
      rowByNodeId.set(node.id, row);
      pendingNext.push({ row, refs: nextRefs, scopeRows: rowByNodeId });
      if (note !== null) {
        rows.push({ kind: note, depth: depth + 1, title: row.title });
        continue;
      }
      if (resolved && isLinkedSubprocess(node)) {
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

  // 번호 부여(삭제 후 1..n 연속) → Next 조립(대상 제목은 emit 시점 값이라 주석이 섞이지 않는다) → 주석 조립
  let no = 0;
  for (const row of rows) {
    if (row.kind === "node") {
      no += 1;
      row.no = no;
    }
  }
  for (const { row, refs, scopeRows } of pendingNext) {
    row.next = formatExcelNextCell(refs, (targetId) => scopeRows.get(targetId)?.no);
  }
  for (const { target, decision, label } of annotations) {
    target.title += ` [${decision.no}:${label}]`;
  }

  return { mapName, versionLabel, exportedAt, meta: meta ?? buildExcelMeta({ mapName, versionLabel, exportedAt }), rows, truncated };
}

// 출력물 서식 — 셀 값이라 CSS 변수를 못 쓴다(design.md §1 데이터/출력 예외). 사용자 악센트와 무관하게 고정해
// 같은 맵은 누가 내보내도 같은 파일이 된다
const EXCEL_FONT_NAME = "Malgun Gothic"; // 맑은 고딕 — Windows 기본 한글 글꼴(화면·인쇄 공통)
const EXCEL_FONT_SIZE = 10;
export const EXCEL_HEADER_FILL_ARGB = "FFE7E7E7"; // 중립 회색 헤더
export const EXCEL_LINK_ARGB = "FF0563C1"; // Excel 기본 하이퍼링크 파랑
export const EXCEL_MUTED_ARGB = "FF6B7280"; // 메타 라벨·보조 텍스트 회색
// 인쇄 여백(인치) — Excel "좁게" 프리셋과 같은 값
const EXCEL_PRINT_MARGINS = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
const A4_PAPER_SIZE = 9; // OOXML paperSize 코드

/**
 * 셀 글꼴 — 모든 셀 글꼴은 이 함수로만 넣는다. exceljs의 `cell.font = {...}`는 객체 전체를 바꿔서
 * 굵게·색만 따로 넣으면 글꼴 이름·크기가 기본값(Calibri 11)으로 돌아간다.
 */
export function setExcelFont(cell: import("exceljs").Cell, extra: Partial<import("exceljs").Font> = {}): void {
  cell.font = { name: EXCEL_FONT_NAME, size: EXCEL_FONT_SIZE, ...extra };
}

// 머리글 텍스트의 `&`는 Excel 머리글 코드 접두라 `&&`로 적어야 글자 그대로 찍힌다
const escapeHeaderFooterText = (text: string): string => text.replace(/&/g, "&&");

/** 문서 속성 — 파일 정보 창·검색에 맵 이름이 보이게 한다. */
export function applyExcelWorkbookInfo(workbook: import("exceljs").Workbook, mapName: string): void {
  workbook.title = mapName;
  workbook.creator = "BPM";
  workbook.created = new Date();
}

/**
 * 표 위 메타 블록 — 라벨(A:B 병합, 회색)과 값(C) 한 줄씩, 빈 값 줄은 쓰지 않고 끝에 빈 줄 하나.
 * 값은 줄바꿈 없이 오른쪽 빈 칸으로 넘쳐 보이게 둔다. 반환값은 다음 행 번호(헤더 자리).
 */
export function writeExcelMeta(sheet: import("exceljs").Worksheet, meta: readonly ExcelMetaRow[]): number {
  const rows = meta.filter((row) => row.value.trim() !== "");
  rows.forEach((row, index) => {
    const r = sheet.addRow([row.label, "", row.value]);
    sheet.mergeCells(r.number, 1, r.number, 2);
    setExcelFont(r.getCell(1), { color: { argb: EXCEL_MUTED_ARGB } });
    // 첫 줄(맵 이름)은 문서 제목처럼 굵게
    setExcelFont(r.getCell(3), index === 0 ? { bold: true, size: 12 } : {});
  });
  if (rows.length > 0) sheet.addRow([]);
  return sheet.rowCount + 1;
}

/** 헤더 행 서식 — 굵은 글꼴·회색 채움·아래 테두리·줄바꿈(긴 헤더가 좁은 열에서 잘리지 않게). */
export function applyExcelHeaderStyle(headerRow: import("exceljs").Row): void {
  headerRow.eachCell((cell) => {
    setExcelFont(cell, { bold: true });
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_HEADER_FILL_ARGB } };
    cell.border = { bottom: { style: "thin" } };
    cell.alignment = { vertical: "top", wrapText: true };
  });
}

/**
 * 인쇄·탐색 배치 — A4 가로·폭 1쪽 맞춤(높이 자유)·좁은 여백·헤더 행 반복 인쇄·머리글(맵 이름|버전|쪽),
 * 헤더 행과 식별 열 고정, 헤더~마지막 행 자동 필터. frozenColumns=왼쪽에 고정할 열 수.
 */
export function applyExcelPrintLayout(
  sheet: import("exceljs").Worksheet,
  opts: { headerRow: number; columnCount: number; frozenColumns: number; mapName: string; versionLabel: string },
): void {
  const { headerRow, columnCount, frozenColumns, mapName, versionLabel } = opts;
  sheet.pageSetup = {
    ...sheet.pageSetup,
    paperSize: A4_PAPER_SIZE,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0, // 0 = 세로 쪽수 제한 없음
    margins: EXCEL_PRINT_MARGINS,
    printTitlesRow: `${headerRow}:${headerRow}`,
  };
  sheet.headerFooter = {
    oddHeader: `&L${escapeHeaderFooterText(mapName)}&C${escapeHeaderFooterText(versionLabel)}&R&P / &N`,
  };
  sheet.views = [{ state: "frozen", xSplit: frozenColumns, ySplit: headerRow }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(sheet.rowCount, headerRow), column: columnCount },
  };
}

export const NOTE_TEXT: Record<ExcelNoteRow["kind"], string> = {
  circular: "(circular reference)",
  denied: "(access denied)",
  rowLimit: `(row limit ${EXCEL_MAX_ROWS} reached - output truncated)`,
};

export interface ExcelColumnSpec {
  key: ExcelColumnKey;
  header: string;
  required?: boolean;
  width: number;
  numFmt?: string;
  cell: (row: ExcelRowFields) => string | number;
}

// 숫자 셀 — 경계에서 정규화된 값이라 보통 숫자지만, 숫자가 아니면 NaN 대신 원문 텍스트로 남긴다
const toNumberCell = (value: string): string | number => {
  if (value.trim() === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

// 시간 셀 — H.MM(소수부=분)을 Excel 시간 값(일 단위: 분/1440)으로. `[h]:mm` 서식이라 SUM이 시:분으로 맞게 더해진다
// (H.MM 숫자를 그대로 두면 1.30+1.30=2.60처럼 십진 합산돼 틀렸다). 해석 불가 값은 원문 텍스트
const toDurationCell = (value: string): string | number => {
  if (value.trim() === "") return "";
  const minutes = parseDurationMinutes(value);
  return minutes === null ? value : minutes / 1440;
};

export const EXCEL_DURATION_NUMFMT = "[h]:mm";

// 열별 폭·서식·셀 — 키·헤더·순서는 lib/export-columns.ts EXCEL_COLUMNS가 단일 소스(design 2026-07-13 §5.2).
// Record라 열을 추가하면 tsc가 서식·셀 누락을 잡고, numFmt·하이퍼링크 위치는 셀 인덱스가 아닌 이 정의에서 파생한다.
const EXCEL_COLUMN_FORMATS: Record<ExcelColumnKey, Omit<ExcelColumnSpec, "key" | "header" | "required">> = {
  no: { width: 6, cell: (row) => row.no },
  name: { width: 32, cell: (row) => row.title },
  type: { width: 12, cell: (row) => row.type },
  description: { width: 44, cell: (row) => row.description },
  assignee: { width: 16, cell: (row) => row.assignee },
  role: { width: 14, cell: (row) => row.assignee_role },
  department: { width: 18, cell: (row) => row.department },
  system: { width: 14, cell: (row) => row.system },
  // 시:분 시간 값(H.MM 계약 → 분/1440) — CSV는 H.MM 그대로(왕복용)
  duration: { width: 12, numFmt: EXCEL_DURATION_NUMFMT, cell: (row) => toDurationCell(row.duration) },
  touch_time: { width: 13, numFmt: EXCEL_DURATION_NUMFMT, cell: (row) => toDurationCell(row.touch_time) },
  cost_krw: { width: 14, numFmt: "#,##0", cell: (row) => toNumberCell(row.cost_krw) },
  cost_usd: { width: 14, numFmt: "#,##0.00", cell: (row) => toNumberCell(row.cost_usd) },
  headcount: { width: 11, numFmt: "0.00", cell: (row) => toNumberCell(row.headcount) },
  annual_count: { width: 13, numFmt: "#,##0", cell: (row) => toNumberCell(row.annual_count) },
  fte: { width: 8, numFmt: "0.00", cell: (row) => toNumberCell(row.fte) },
  input: { width: 28, cell: (row) => row.input },
  output: { width: 28, cell: (row) => row.output },
  start_condition: { width: 20, cell: (row) => row.start_condition },
  end_condition: { width: 20, cell: (row) => row.end_condition },
  gmp: { width: 12, cell: (row) => row.gmp },
  parallel: { width: 10, cell: (row) => row.parallel },
  // 하이퍼링크 셀은 applyExcelCellFormats가 덮는다(텍스트=라벨 또는 URL)
  url: { width: 24, cell: () => "" },
  groups: { width: 18, cell: (row) => row.groups },
  next: { width: 32, cell: (row) => row.next },
};

export const COLUMNS: readonly ExcelColumnSpec[] = EXCEL_COLUMNS.map((def) => ({
  ...def,
  ...EXCEL_COLUMN_FORMATS[def.key],
}));

/** 선택 키 → 열 정의(정식 순서, 잠금 열 No·Name·Type·Parallel·Next 강제). 미지정이면 전부. */
export function selectExcelColumns(keys?: readonly ExcelColumnKey[]): ExcelColumnSpec[] {
  const selected = new Set<string>(normalizeExportColumns(EXCEL_COLUMNS, keys));
  return COLUMNS.filter((column) => selected.has(column.key));
}

/**
 * 데이터 행 셀 서식 — 글꼴·위 정렬·numFmt·URL 하이퍼링크를 열 정의에서 파생(1안·WBS 공용). 텍스트 열은 줄바꿈해
 * 여러 줄 IO·긴 설명이 인쇄에서 잘리지 않게 한다. firstCol=첫 열 위치(1-based).
 */
export function applyExcelCellFormats(
  r: import("exceljs").Row,
  columns: readonly ExcelColumnSpec[],
  firstCol: number,
  row: ExcelRowFields,
): void {
  columns.forEach((column, i) => {
    const cell = r.getCell(firstCol + i);
    if (column.numFmt) cell.numFmt = column.numFmt;
    cell.alignment = column.numFmt ? { vertical: "top" } : { vertical: "top", wrapText: true };
    if (column.key === "url" && row.url) {
      cell.value = { text: row.urlLabel || row.url, hyperlink: row.url };
      setExcelFont(cell, { color: { argb: EXCEL_LINK_ARGB }, underline: true });
    } else {
      setExcelFont(cell);
    }
  });
}

/**
 * ExcelModel → 워크시트 기록(시트 생성·스타일·셀 값·인쇄 배치). Blob/anchor(브라우저 다운로드)와 분리해
 * DOM 없이도(vitest) 컬럼 서식·값을 검증할 수 있게 한다. columnKeys 미지정이면 전 열. 반환값=헤더 행 번호.
 */
export function writeExcelSheet(
  workbook: import("exceljs").Workbook,
  model: ExcelModel,
  columnKeys?: readonly ExcelColumnKey[],
): number {
  const columns = selectExcelColumns(columnKeys);
  applyExcelWorkbookInfo(workbook, model.mapName);
  const sheet = workbook.addWorksheet("Process Map", {
    properties: { outlineLevelRow: 1, defaultRowHeight: 16 },
  });
  const headerRowNo = writeExcelMeta(sheet, model.meta);
  applyExcelHeaderStyle(sheet.addRow(columns.map((c) => c.header)));
  columns.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

  for (const row of model.rows) {
    if (row.kind !== "node") {
      const r = sheet.addRow(["", NOTE_TEXT[row.kind]]);
      setExcelFont(r.getCell(2), { italic: true, color: { argb: EXCEL_MUTED_ARGB } });
      r.getCell(2).alignment = { vertical: "top", indent: row.depth * 2 };
      r.outlineLevel = Math.min(row.depth, 7);
      continue;
    }
    const r = sheet.addRow(columns.map((column) => column.cell(row)));
    applyExcelCellFormats(r, columns, 1, row);
    // Name은 잠금 열이라 항상 2번째 — 정렬 객체는 통째로 바뀌므로 줄바꿈·위 정렬을 유지한 채 들여쓰기만 더한다
    r.getCell(2).alignment = { ...r.getCell(2).alignment, indent: row.depth * 2 };
    r.outlineLevel = Math.min(row.depth, 7); // Excel outline 한계 7
  }
  // No·Name 고정 — 옆으로 넘겨도 어느 노드의 행인지 보인다
  applyExcelPrintLayout(sheet, {
    headerRow: headerRowNo,
    columnCount: columns.length,
    frozenColumns: 2,
    mapName: model.mapName,
    versionLabel: model.versionLabel,
  });
  return headerRowNo;
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

/** ExcelModel → .xlsx 파일 다운로드(선택 열, 미지정이면 전 열). */
export async function downloadExcel(
  model: ExcelModel,
  fileName: string,
  columns?: readonly ExcelColumnKey[],
): Promise<void> {
  await downloadWorkbookXlsx((workbook) => writeExcelSheet(workbook, model, columns), fileName);
}
