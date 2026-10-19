// 비교 화면 PNG 내보내기 옵션 — 옵션 창(compare-png-export-modal)과 비교 화면 출력(lib/export exportComparePng)이 공유.
// 형식은 화면 그대로(비교 화면 모습) / 문서용(결재자 보고용 흰 바탕·Arial, 상태 색은 유지). 범례·정보 블록은 두 형식 공통.
// 마지막 선택은 브라우저에 기억(bpm.comparePngExport) — 표시 정보는 비교 화면 설정에서 시작하므로 기억하지 않는다.
// 문서용의 연결선 펼침·나눠 싣기는 편집 화면 Word 출력과 같은 규칙(lib/export·lib/print-split).

import {
  PAPER_ORIENTATIONS,
  PRINT_LAYOUTS,
  PRINT_WIDTH_PCT_MAX,
  PRINT_WIDTH_PCT_MIN,
  type PaperOrientation,
  type PrintLayout,
} from "@/lib/export";

export type ComparePngFormat = "screen" | "document";

export interface ComparePngExportOptions {
  format: ComparePngFormat;
  // 하단 범례(추가·변경·삭제·바뀌지 않음, 현재 상태 색 구성)
  showLegend: boolean;
  // 상단 정보 블록(맵 이름 + 기준 → 대상 + 내보낸 시각 + 변경 건수)
  showInfo: boolean;
  paper: PaperOrientation;
  printWidthPct: number;
  // 연결선 펼침(같은 핸들 형제 원호 레인) — 문서용만, 끄면 한 점에서 겹쳐 나간다
  edgeFan: boolean;
  layout: PrintLayout;
}

const STORAGE_KEY = "bpm.comparePngExport";
export const DEFAULT_COMPARE_PNG_EXPORT_OPTIONS: ComparePngExportOptions = {
  format: "screen",
  showLegend: true,
  showInfo: true,
  paper: "landscape",
  printWidthPct: 100,
  edgeFan: true,
  layout: "single",
};

/** 마지막 선택 — 저장값이 없거나 깨졌으면 필드별 기본값. */
export function loadComparePngExportOptions(): ComparePngExportOptions {
  const fallback = DEFAULT_COMPARE_PNG_EXPORT_OPTIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const value = parsed as Partial<Record<keyof ComparePngExportOptions, unknown>>;
    return {
      format: value.format === "document" ? "document" : "screen",
      showLegend: typeof value.showLegend === "boolean" ? value.showLegend : fallback.showLegend,
      showInfo: typeof value.showInfo === "boolean" ? value.showInfo : fallback.showInfo,
      paper: PAPER_ORIENTATIONS.find((paper) => paper === value.paper) ?? fallback.paper,
      printWidthPct:
        typeof value.printWidthPct === "number" &&
        value.printWidthPct >= PRINT_WIDTH_PCT_MIN &&
        value.printWidthPct <= PRINT_WIDTH_PCT_MAX
          ? value.printWidthPct
          : fallback.printWidthPct,
      edgeFan: typeof value.edgeFan === "boolean" ? value.edgeFan : fallback.edgeFan,
      layout: PRINT_LAYOUTS.find((layout) => layout === value.layout) ?? fallback.layout,
    };
  } catch {
    // 사생활 모드·차단된 저장소 — 기본값으로 진행(기억은 편의 기능)
    return fallback;
  }
}

export function saveComparePngExportOptions(options: ComparePngExportOptions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // 저장 실패는 다음 열기 때 기본값으로 돌아갈 뿐 — 내보내기 자체는 계속한다
  }
}
