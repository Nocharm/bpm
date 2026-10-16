// WBS(레벨 컬럼) Excel 모델 — 잎 업무 행 + 조상 경로(levels). 규칙 엔진은 1안(excel-export.ts)과
// 동형이되 start/end 전부 삭제·SP 무행이 다르다. 시트 기록은 Task 2에서 추가.
// 설계: 2026-07-17-excel-export-wbs-v2-design.md, 열 선택은 export-column-picker-design(2026-10-02)
import type { Graph, GraphEdge, GraphNode } from "./api";
import { orderNodesByFlow } from "./csv-export";
import {
  applyExcelCellFormats,
  applyExcelHeaderStyle,
  applyExcelPrintLayout,
  applyExcelWorkbookInfo,
  buildExcelMeta,
  buildNodeRowFields,
  dedupeExcelNextRefs,
  EXCEL_MAX_ROWS,
  EXCEL_MUTED_ARGB,
  type ExcelMetaRow,
  type ExcelNextRef,
  type ExcelRowFields,
  downloadWorkbookXlsx,
  formatExcelNextCell,
  getExcelEdgeLabel,
  getNodeDisplayTitle,
  getSubprocessExitTitles,
  NOTE_TEXT,
  selectExcelColumns,
  setExcelFont,
  writeExcelMeta,
} from "./excel-export";
import type { ExcelColumnKey } from "./export-columns";

export interface WbsNodeRow extends ExcelRowFields {
  kind: "node";
  levels: string[]; // 조상 경로 — [루트 맵 이름, SP 노드 표시 제목…]. 길이 = 소속 레벨
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
  meta: ExcelMetaRow[];
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
  meta,
}: {
  graph: Graph;
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  fetchResolved: (mapId: number, followLatest: boolean, pinned: number | null) => Promise<Graph>;
  maxRows?: number;
  rootMapId?: number;
  meta?: ExcelMetaRow[]; // 표 위 메타 블록 — 미지정이면 맵·버전·내보낸 시각만(1안과 동일)
}): Promise<WbsModel> {
  const rows: WbsRow[] = [];
  let truncated = false;
  let nodeRowCount = 0; // 상한은 노드 행만 센다(1안과 동일)
  // 규칙4 주석 — 행 "객체" 참조로 기록해 번호 부여 후 일괄 조립(역방향 분기·다이아몬드 안전, 1안과 동일)
  const annotations: Array<{ target: WbsNodeRow; decision: WbsNodeRow; label: string }> = [];
  // Next 칸 — 같은 맵 인스턴스의 행으로 풀고 번호 부여 뒤 조립(1안과 동일). 시작·끝·펼친 SP는 행이 없어 제목만
  const pendingNext: Array<{ row: WbsNodeRow; refs: ExcelNextRef[]; scopeRows: ReadonlyMap<string, WbsNodeRow> }> = [];
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
    // 1안과 동일: 나가는 엣지가 있고 전부 무라벨인 디시전(라벨 없는 택일) = 행 미생성(엣지 없는 디시전은 WIP로 유지).
    // 병렬 출구는 parallel_outputs 노드 속성이라 process 행으로 남는다 (출력 규칙 2026-10-01)
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

    // 같은 (대상 노드, 라벨)은 한 번만 — 삭제 디시전 경유 재수렴 대비(1안과 동일).
    // SP 출구의 무라벨 엣지는 끝 제목을 라벨로(1안과 같은 미러), 대상 SP는 링크 맵 현재 이름
    const nextRefsOf = (node: GraphNode, exitTitles: ReadonlyMap<string, string> | null): ExcelNextRef[] =>
      dedupeExcelNextRefs(
        (outgoing.get(node.id) ?? [])
          .flatMap((e) => resolveTargets(e, getExcelEdgeLabel(e, node, exitTitles), new Set()))
          .map(({ node: t, label }) => ({ targetId: t.id, title: getNodeDisplayTitle(g, t), label })),
      );

    for (const node of ordered) {
      if (isRowRemoved(node)) continue; // 삭제 노드는 상한(maxRows)을 소비하지 않는다
      if (nodeRowCount >= maxRows) {
        // return이 아닌 break — 주석 수집 패스를 실행해 이미 출력된 행의 주석 보존(1안과 동일)
        if (!truncated) rows.push({ kind: "rowLimit", levels, title: "" });
        truncated = true;
        break;
      }
      if (node.node_type === "subprocess" && node.linked_map_id !== null) {
        const displayTitle = getNodeDisplayTitle(g, node);
        // SP는 행 미차지 — 레벨 경로에 노드 표시 제목을 붙이고 링크 맵의 잎 행들을 제자리 전개
        if (ancestry.has(node.linked_map_id)) {
          rows.push({ kind: "circular", levels, title: displayTitle });
          continue;
        }
        let resolved: Graph | undefined;
        try {
          resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
        } catch {
          resolved = undefined;
        }
        if (resolved && !resolved.locked) {
          await emit(resolved, [...levels, displayTitle], new Set([...ancestry, node.linked_map_id]));
          continue;
        }
        // 잠김(권한 마스킹)·해석 실패 SP는 전개 불가 — 자신이 잎 행이 되어 흐름을 보존하고(1안 SP 행과
        // 동일 소스: 식별·파라미터·IO 지정정보 상속·설명 베이스+추가분 합성) 아래 denied 노트로 하위 가림을 표시
        const exitTitles = getSubprocessExitTitles(outgoing.get(node.id) ?? [], null);
        const spRow: WbsNodeRow = {
          kind: "node",
          no: 0, // finalize에서 부여
          levels,
          ...buildNodeRowFields(g, node, { groupLabel, next: "", exitTitles }),
        };
        rows.push(spRow);
        nodeRowCount += 1;
        rowByNodeId.set(node.id, spRow);
        pendingNext.push({ row: spRow, refs: nextRefsOf(node, exitTitles), scopeRows: rowByNodeId });
        rows.push({ kind: "denied", levels: [...levels, displayTitle], title: displayTitle });
        continue;
      }
      const row: WbsNodeRow = {
        kind: "node",
        no: 0, // finalize에서 부여
        levels,
        ...buildNodeRowFields(g, node, { groupLabel, next: "", exitTitles: null }),
      };
      rows.push(row);
      nodeRowCount += 1;
      rowByNodeId.set(node.id, row);
      pendingNext.push({ row, refs: nextRefsOf(node, null), scopeRows: rowByNodeId });
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

  // 번호 부여(1..n 연속) → Next 조립(대상 제목은 emit 시점 값이라 주석이 섞이지 않는다) → 주석 조립
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

  const maxLevel = rows.reduce((m, r) => Math.max(m, r.levels.length), 1);
  return {
    mapName,
    versionLabel,
    exportedAt,
    meta: meta ?? buildExcelMeta({ mapName, versionLabel, exportedAt }),
    maxLevel,
    rows,
    truncated,
  };
}

const LEVEL_FONT_ARGB = "FF9CA3AF"; // 레벨 경로 회색 톤다운 — 출력물이라 raw hex 허용(design.md §1 예외)

/**
 * 레벨 셀 값 — Level 1은 모든 행이 루트 맵 이름이라 첫 행에만 적고(반복은 정보가 없다), Level 2 이하는
 * 하위프로세스 경로라 필터·정렬에 쓰도록 행마다 적는다. 미리보기도 같은 규칙.
 */
export function getWbsLevelCells(row: WbsRow, rowIndex: number, maxLevel: number): string[] {
  return Array.from({ length: maxLevel }, (_, i) => (i === 0 && rowIndex > 0 ? "" : (row.levels[i] ?? "")));
}

/**
 * WbsModel → "WBS" 워크시트 기록 — 메타 블록 + 동적 레벨 컬럼(No | Level 1..N | Task | 속성 꼬리) + 인쇄 배치.
 * 꼬리는 1안 열 정의의 Type 이후 선택분(No·Name은 구조 열이 대신한다) — 서식은 정의에서 파생(1안 교훈).
 * 반환값=헤더 행 번호.
 */
export function writeWbsSheet(
  workbook: import("exceljs").Workbook,
  model: WbsModel,
  columnKeys?: readonly ExcelColumnKey[],
): number {
  applyExcelWorkbookInfo(workbook, model.mapName);
  const sheet = workbook.addWorksheet("WBS");
  const headerRowNo = writeExcelMeta(sheet, model.meta);
  const tail = selectExcelColumns(columnKeys).filter((c) => c.key !== "no" && c.key !== "name");
  applyExcelHeaderStyle(
    sheet.addRow([
      "No",
      ...Array.from({ length: model.maxLevel }, (_, i) => `Level ${i + 1}`),
      "Task",
      ...tail.map((c) => c.header),
    ]),
  );
  const taskCol = 2 + model.maxLevel; // 1=No, 2..1+N=레벨, 그 다음이 Task
  sheet.getColumn(1).width = 6;
  for (let i = 0; i < model.maxLevel; i += 1) sheet.getColumn(2 + i).width = 18;
  sheet.getColumn(taskCol).width = 32;
  tail.forEach((c, i) => {
    sheet.getColumn(taskCol + 1 + i).width = c.width;
  });
  // No·레벨 셀 서식 — 위 정렬·줄바꿈(긴 하위프로세스 이름), 레벨은 회색
  const styleStructureCells = (r: import("exceljs").Row) => {
    setExcelFont(r.getCell(1));
    r.getCell(1).alignment = { vertical: "top" };
    for (let i = 0; i < model.maxLevel; i += 1) {
      setExcelFont(r.getCell(2 + i), { color: { argb: LEVEL_FONT_ARGB } });
      r.getCell(2 + i).alignment = { vertical: "top", wrapText: true };
    }
  };

  model.rows.forEach((row, rowIndex) => {
    const levelCells = getWbsLevelCells(row, rowIndex, model.maxLevel);
    if (row.kind !== "node") {
      const r = sheet.addRow(["", ...levelCells, NOTE_TEXT[row.kind]]);
      styleStructureCells(r);
      setExcelFont(r.getCell(taskCol), { italic: true, color: { argb: EXCEL_MUTED_ARGB } });
      r.getCell(taskCol).alignment = { vertical: "top", wrapText: true };
      return;
    }
    const r = sheet.addRow([row.no, ...levelCells, row.title, ...tail.map((column) => column.cell(row))]);
    styleStructureCells(r);
    setExcelFont(r.getCell(taskCol));
    r.getCell(taskCol).alignment = { vertical: "top", wrapText: true };
    applyExcelCellFormats(r, tail, taskCol + 1, row);
  });
  // No·레벨·Task 고정 — 옆으로 넘겨도 어느 업무의 행인지 보인다
  applyExcelPrintLayout(sheet, {
    headerRow: headerRowNo,
    columnCount: taskCol + tail.length,
    frozenColumns: taskCol,
    mapName: model.mapName,
    versionLabel: model.versionLabel,
  });
  return headerRowNo;
}

/** WbsModel → .xlsx 다운로드 — 1안과 동일한 공용 다운로드 경로(선택 열). */
export async function downloadWbsExcel(
  model: WbsModel,
  fileName: string,
  columns?: readonly ExcelColumnKey[],
): Promise<void> {
  await downloadWorkbookXlsx((workbook) => writeWbsSheet(workbook, model, columns), fileName);
}
