// 캔버스 PNG 내보내기 — React Flow 공식 권장 방식(html-to-image) (spec §7 Phase B).
// html-to-image는 HTML 요소의 computed style은 인라인하지만 SVG 하위 요소는 DOM 그대로 복제한다 —
// 스타일시트/CSS 변수 의존 엣지 stroke가 클론에서 소실되므로, 캡처 직전 엣지·화살촉에
// 인라인 스타일(검은 실선)을 직접 심고 캡처 후 원복한다.
// 캡처는 투명 배경으로 받아 캔버스에 합성한다 — 앱 캔버스 톤(bg-canvas)+dot-grid 배경과
// 좌하단 맵 정보 카드(이름·부서·오너·버전·게시일·프레임워크)를 그린 뒤 저장.
// Word 문서용 테마(word 옵션)는 캡처 동안 뷰포트에 .bpm-export-word 클래스를 붙여 노드·라벨·글꼴을 문서 톤으로
// 덮고(globals.css 토큰), 흰 배경 위 상단 정보 블록·병렬 범례를 인쇄 크기(pt) 고정으로 합성한다.
// 나눠 싣기(layout=split)면 노드 사이 빈 칸에서 잘라 조각마다 PNG를 만들어 ZIP 하나로 내려받는다(lib/print-split).
// 비교 화면(exportComparePng)은 엣지 diff 색을 그대로 인라인하고 정보 블록·범례를 합성한다(파일 아래쪽 절).
// 색상은 출력물이라 raw hex 허용(design.md §1).

import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng } from "html-to-image";

import {
  findCutCrossings,
  getConnectorLabel,
  getPieceBounds,
  measureSplitSource,
  planSplit,
  type SplitPlan,
  type SplitSource,
} from "@/lib/print-split";

const PADDING_PX = 50; // 노드 경계 바깥 여백
const MIN_SIZE_PX = 400;
const MAX_SIZE_PX = 4096; // 브라우저 캔버스 크기 한계 보호
const PIXEL_RATIO = 2; // 2배 해상도 — 노드 테두리·텍스트 선명도
const EDGE_STROKE = "#000000"; // 출력 엣지(라이트 배경) — 검은 실선
const EDGE_STROKE_DARK = "#F6F6F8"; // 출력 엣지(L5 새벽 조감도 다크 배경) — 어두운 실선이 묻혀 라이트 캔버스 톤으로 대비 확보
const EDGE_STROKE_WIDTH = "1.5";

// 배경/카드 팔레트 — globals.css 토큰 실값 미러(출력물 예외)
const BG_COLOR = "#F6F6F8"; // --color-canvas
const BG_TOP_DARK = "#1B2743"; // --color-canvas-l5-sky — L5 새벽 조감도 dark export 배경 상단
const BG_BOTTOM_DARK = "#363843"; // --color-canvas-l5 — L5 새벽 조감도 dark export 배경 하단
const DOT_COLOR = "#BDBDC9"; // --color-canvas-dot
const DOT_GAP = 24; // dot-grid 간격(css px) — 앱 캔버스와 유사한 밀도
const DOT_RADIUS = 1;
const CARD_BG = "#FFFFFF"; // --color-surface
const CARD_BORDER = "#E6E6EA"; // --color-hairline
const INK = "#16161D"; // --color-ink
const INK_TERTIARY = "#7A7A7A"; // --color-ink-tertiary
const CARD_MARGIN = 20; // 카드-가장자리 여백
const CARD_PAD = 16;
const TITLE_FONT = "600 17px Pretendard, sans-serif";
const ROW_FONT = "400 13px Pretendard, sans-serif";
const TITLE_LINE_H = 24;
const ROW_LINE_H = 20;
const LABEL_VALUE_GAP = 14; // 라벨 열-값 열 간격

const WORD_FONT_FAMILY = 'Arial, "Malgun Gothic", "맑은 고딕", sans-serif';
// 문서용 머리 블록·범례·연결 기호 — 인쇄 크기(pt) 고정. 그림 배율과 무관하게 같은 크기로 찍힌다(맵이 길어도 같이 줄지 않게,
// 사용자 결정 2026-10-19). 합성 때 그림의 css px/pt로 환산한다
const PRINT_TITLE_PT = 11;
const PRINT_META_PT = 7.5;
const PRINT_TITLE_LINE_PT = 14;
const PRINT_META_LINE_PT = 10;
const PRINT_HEADER_TOP_PT = 2;
const PRINT_RULE_GAP_PT = 3;
const PRINT_RULE_PT = 1; // 머리 블록 아래 강조선
const PRINT_HEADER_GAP_PT = 6; // 강조선-그림 간격
const PRINT_SIDE_PT = 4; // 머리 블록·범례 좌우 여백
const PRINT_LEGEND_PT = 7.5;
export const PRINT_LEGEND_ROW_PT = 14; // 그림 아래 범례 줄
const PRINT_LEGEND_GAP_PT = 10; // 범례 항목 사이
const PRINT_SWATCH_PT = 7; // 비교 범례 견본 한 변
const PRINT_CONNECTOR_R_PT = 4.5; // 연결 기호 원 반지름
const PRINT_CONNECTOR_SPACE_PT = PRINT_CONNECTOR_R_PT * 2 + 1; // 잘린 쪽마다 조각 바깥에 더하는 연결 기호 자리
const PRINT_CONNECTOR_FONT_PT = 6;
const PRINT_PIECE_NUMBER_PT = 6.5; // 조각 번호(1/5)
export const PRINT_PIECE_NUMBER_ROW_PT = 9;
const WORD_EDGE_STROKE_WIDTH = "1.25";
const PARALLEL_MARK_OFFSET = 10; // 병렬 표시 위치 — 출발점에서 경로를 따라 px
const PARALLEL_MARK_HALF = 5; // 병렬 표시 막대 반 길이
const PARALLEL_MARK_GAP = 2; // 두 막대 사이 반 간격
const CROSSING_RADIUS = 5; // 교차 점프 반원 반지름(px)
const CROSSING_GAP = 8; // 터널 끊김 반 길이(px) — 5는 2배 해상도에서도 끊김이 거의 안 보였다
const CROSSING_END_MARGIN = CROSSING_GAP + 3; // 선 끝(꺾임·합류·핸들)에서 이만큼 안쪽 교차만 — T자 합류는 교차가 아니다
const CROSSING_SAMPLE_STEP = 2; // 경로 샘플 간격(px) — 직선 구간 판별용
const CROSSING_AXIS_EPS = 0.5; // 가로·세로 구간 판정 허용 오차(px)
const PAPER = "#FFFFFF"; // Word 출력 바탕 — 교차 자리 지우개 색
// 인쇄 크기 — A4(cm)와 Word 기본 여백(보통 2.54cm). 본문 폭이 그림 너비 100%의 기준
const A4_SHORT_CM = 21;
const A4_LONG_CM = 29.7;
const WORD_PAGE_MARGIN_CM = 2.54;
const CM_PER_INCH = 2.54;
const TARGET_DPI = 300; // 인쇄 품질 목표 — 출력 배율을 이만큼까지 자동으로 올린다
const MAX_PIXEL_RATIO = 4;
const MAX_OUTPUT_SIDE_PX = 12000; // 브라우저 캔버스 한계(면적·변) 여유 상한
const NODE_TITLE_PX = 14; // 노드 제목 글자 크기(text-sm) — 인쇄 pt 환산용
const PT_PER_INCH = 72;

/** Word 문서용 스타일 — globals.css `.bpm-export-word--<style>` 토큰 묶음과 1:1. */
export type WordExportStyle = "mono" | "gray" | "navy";
export const WORD_EXPORT_STYLES: WordExportStyle[] = ["mono", "gray", "navy"];

/** 교차선 표시 — 가로선이 세로선을 반원으로 넘어가거나(jump), 세로선이 교차 자리에서 끊긴다(gap). */
export type CrossingStyle = "none" | "jump" | "gap";
export const CROSSING_STYLES: CrossingStyle[] = ["none", "jump", "gap"];

/** Word 용지 방향 — A4 세로·가로. */
export type PaperOrientation = "portrait" | "landscape";
export const PAPER_ORIENTATIONS: PaperOrientation[] = ["portrait", "landscape"];
export const PRINT_WIDTH_PCT_MIN = 30;
export const PRINT_WIDTH_PCT_MAX = 100;

/** 인쇄 배치 — 한 장 / 읽을 수 있게 나눔(노드 사이 빈 칸에서 잘라 조각마다 PNG, ZIP 하나로, lib/print-split). */
export type PrintLayout = "single" | "split";
export const PRINT_LAYOUTS: PrintLayout[] = ["single", "split"];

/** PNG 내보내기 선택 — 옵션 창(png-export-modal)이 고르고 브라우저에 기억한다. */
export interface PngExportOptions {
  theme: "screen" | "word";
  wordStyle: WordExportStyle;
  // 병렬 출구 표시(출구 뒤 이중 막대 + 범례) — 화면의 흐름 펄스를 대신한다
  showParallel: boolean;
  // 상단 맵 정보 블록(제목 + 메타 한 줄)
  showInfo: boolean;
  crossing: CrossingStyle;
  paper: PaperOrientation;
  // 그림 너비 — 본문 폭 대비 %(30..100). Word에 넣으면 이 크기로 들어가도록 PNG에 DPI를 싣는다
  printWidthPct: number;
  // 입출력 목록을 줄 제한 없이 펼쳐 찍고 분기 노드 IO 아일랜드도 목록으로 편다(두 테마 공통)
  expandIo: boolean;
  // 연결선 펼침 — 같은 핸들에서 나가는 연결선을 원호 레인으로 펼친다(lib/edge-fanout). 끄면 한 점에서 겹쳐 나간다(Word만)
  edgeFan: boolean;
  layout: PrintLayout;
}

/** Word 모드 실행 인자 — 옵션 + 호출측이 번역한 범례 문구. */
export interface WordExportConfig {
  style: WordExportStyle;
  showParallel: boolean;
  showInfo: boolean;
  crossing: CrossingStyle;
  paper: PaperOrientation;
  printWidthPct: number;
  layout: PrintLayout;
  parallelLabel: string;
  connectorLabel: string;
}

const PNG_EXPORT_STORAGE_KEY = "bpm.pngExport";
const DEFAULT_PNG_EXPORT_OPTIONS: PngExportOptions = {
  theme: "screen",
  wordStyle: "navy",
  showParallel: true,
  showInfo: true,
  crossing: "jump",
  paper: "portrait",
  printWidthPct: 100,
  expandIo: false,
  edgeFan: true,
  layout: "single",
};

/** 마지막 선택 — 저장값이 없거나 깨졌으면 기본값(화면 그대로). */
export function loadPngExportOptions(): PngExportOptions {
  try {
    const raw = window.localStorage.getItem(PNG_EXPORT_STORAGE_KEY);
    if (!raw) return DEFAULT_PNG_EXPORT_OPTIONS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PNG_EXPORT_OPTIONS;
    const value = parsed as Partial<Record<keyof PngExportOptions, unknown>>;
    return {
      theme: value.theme === "word" ? "word" : "screen",
      wordStyle: WORD_EXPORT_STYLES.find((style) => style === value.wordStyle) ?? DEFAULT_PNG_EXPORT_OPTIONS.wordStyle,
      showParallel: typeof value.showParallel === "boolean" ? value.showParallel : DEFAULT_PNG_EXPORT_OPTIONS.showParallel,
      showInfo: typeof value.showInfo === "boolean" ? value.showInfo : DEFAULT_PNG_EXPORT_OPTIONS.showInfo,
      crossing: CROSSING_STYLES.find((style) => style === value.crossing) ?? DEFAULT_PNG_EXPORT_OPTIONS.crossing,
      paper: PAPER_ORIENTATIONS.find((paper) => paper === value.paper) ?? DEFAULT_PNG_EXPORT_OPTIONS.paper,
      printWidthPct:
        typeof value.printWidthPct === "number" &&
        value.printWidthPct >= PRINT_WIDTH_PCT_MIN &&
        value.printWidthPct <= PRINT_WIDTH_PCT_MAX
          ? value.printWidthPct
          : DEFAULT_PNG_EXPORT_OPTIONS.printWidthPct,
      expandIo: typeof value.expandIo === "boolean" ? value.expandIo : DEFAULT_PNG_EXPORT_OPTIONS.expandIo,
      edgeFan: typeof value.edgeFan === "boolean" ? value.edgeFan : DEFAULT_PNG_EXPORT_OPTIONS.edgeFan,
      layout: PRINT_LAYOUTS.find((layout) => layout === value.layout) ?? DEFAULT_PNG_EXPORT_OPTIONS.layout,
    };
  } catch {
    // 사생활 모드·차단된 저장소 — 기본값으로 진행(기억은 편의 기능)
    return DEFAULT_PNG_EXPORT_OPTIONS;
  }
}

export function savePngExportOptions(options: PngExportOptions): void {
  try {
    window.localStorage.setItem(PNG_EXPORT_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // 저장 실패는 다음 열기 때 기본값으로 돌아갈 뿐 — 내보내기 자체는 계속한다
  }
}

/** 캡처 프레임 — 노드 bounds + 여백을 [MIN, MAX]로 자른 크기와 그 안에 맞춘 뷰포트 변환(css px). */
export interface ExportFrame {
  width: number;
  height: number;
  x: number;
  y: number;
  zoom: number;
}

export function measureExportFrame(nodes: Node[]): ExportFrame {
  const bounds = getNodesBounds(nodes);
  const width = Math.min(Math.max(Math.ceil(bounds.width) + PADDING_PX * 2, MIN_SIZE_PX), MAX_SIZE_PX);
  const height = Math.min(Math.max(Math.ceil(bounds.height) + PADDING_PX * 2, MIN_SIZE_PX), MAX_SIZE_PX);
  const transform = getViewportForBounds(bounds, width, height, 0.2, 2, 0.1);
  return { width, height, x: transform.x, y: transform.y, zoom: transform.zoom };
}

/** 문서용 머리 블록 높이(pt) — 제목 + 메타 줄 + 강조선. */
export function getPrintHeaderPt(metaLines: number): number {
  return (
    PRINT_HEADER_TOP_PT +
    PRINT_TITLE_LINE_PT +
    metaLines * PRINT_META_LINE_PT +
    PRINT_RULE_GAP_PT +
    PRINT_RULE_PT +
    PRINT_HEADER_GAP_PT
  );
}

/** Word 인쇄 계획 — 용지·그림 너비에서 인쇄 크기(cm), 출력 배율·픽셀, 해상도(dpi), 노드 글자 크기(pt)를 정한다. */
export interface PrintPlan {
  contentWidthCm: number;
  widthCm: number;
  heightCm: number;
  pixelRatio: number;
  pixelWidth: number;
  pixelHeight: number;
  dpi: number;
  nodeTextPt: number;
}

function getPrintWidthInch(options: Pick<PngExportOptions, "paper" | "printWidthPct">): number {
  const pageWidthCm = options.paper === "portrait" ? A4_SHORT_CM : A4_LONG_CM;
  return ((pageWidthCm - WORD_PAGE_MARGIN_CM * 2) * options.printWidthPct) / 100 / CM_PER_INCH;
}

/** figure = 본문 폭(×그림 너비 %)에 맞춰 넣을 그림(css px), chromePt = 그 위아래에 붙는 머리 블록·범례(pt).
 *  captureSide = 실제로 찍는 이미지의 긴 변(css px) — 나눠 싣기는 맵 전체를 한 번 찍어 자르므로 조각보다 크다. */
export function getPrintPlan(
  figure: Pick<ExportFrame, "width" | "height" | "zoom">,
  options: Pick<PngExportOptions, "paper" | "printWidthPct">,
  chromePt = 0,
  captureSide = 0,
): PrintPlan {
  const widthInch = getPrintWidthInch(options);
  const contentWidthCm = (options.paper === "portrait" ? A4_SHORT_CM : A4_LONG_CM) - WORD_PAGE_MARGIN_CM * 2;
  const widthCm = widthInch * CM_PER_INCH;
  const cssHeight = figure.height + (chromePt * figure.width) / (widthInch * PT_PER_INCH);
  // 300dpi에 닿는 배율 — 최소 2(현행), 최대 4, 긴 변이 상한을 넘지 않게
  const wanted = Math.ceil((TARGET_DPI * widthInch) / figure.width);
  const sideCap = Math.floor(MAX_OUTPUT_SIDE_PX / Math.max(figure.width, cssHeight, captureSide));
  const pixelRatio = Math.max(1, Math.min(MAX_PIXEL_RATIO, Math.max(PIXEL_RATIO, wanted), sideCap));
  const pixelWidth = figure.width * pixelRatio;
  return {
    contentWidthCm,
    widthCm,
    heightCm: (widthCm * cssHeight) / figure.width,
    pixelRatio,
    pixelWidth,
    pixelHeight: cssHeight * pixelRatio,
    dpi: pixelWidth / widthInch,
    nodeTextPt: (NODE_TITLE_PX * figure.zoom * widthInch * PT_PER_INCH) / figure.width,
  };
}

/** 문서용 인쇄 계획 — 한 장이면 getPrintPlan 그대로, 나눠 싣기면 가장 넓은 조각을 본문 폭에 맞춘 배율(모든 조각 공통).
 *  split은 나눠 싣기를 골랐고 재료(measureSplitSource)가 있을 때만 — 맵이 한 조각에 들어가면 한 장과 같다. */
export interface DocumentPrintPlan extends PrintPlan {
  split: SplitPlan | null;
  // 조각마다 인쇄 크기(cm) — 연결 기호 자리·조각 번호 줄 포함, 머리 블록·범례 제외(인쇄 크기 패널의 쪽 그림). 한 장이면 []
  pieceSizesCm: { width: number; height: number }[];
}

export function getDocumentPrintPlan(
  frame: Pick<ExportFrame, "width" | "height" | "zoom">,
  options: Pick<PngExportOptions, "paper" | "printWidthPct" | "layout">,
  chromePt: number,
  source: SplitSource | null,
): DocumentPrintPlan {
  if (options.layout === "split" && source) {
    const widthInch = getPrintWidthInch(options);
    const markerInch = PRINT_CONNECTOR_SPACE_PT / PT_PER_INCH;
    // 노드 제목이 최소 판독 크기(7pt)로 찍히는 조각 폭 상한 — 양쪽에 연결 기호 자리를 둔 가운데 조각 기준
    const limit = (NODE_TITLE_PX * frame.zoom * (widthInch - 2 * markerInch) * PT_PER_INCH) / A4_GUIDE_MINIMUM_PT;
    const split = planSplit(source, limit);
    if (split.pieces.length > 1) {
      const last = split.pieces.length - 1;
      const cutSides = (index: number) => (index > 0 ? 1 : 0) + (index < last ? 1 : 0);
      // 모든 조각 공통 배율(css px/인치) — 잘린 쪽마다 붙는 연결 기호 자리까지 더해 가장 넓은 조각이 본문 폭에 맞게
      const cssPerInch = Math.max(
        ...split.pieces.map((piece, index) => (piece.x1 - piece.x0) / (widthInch - cutSides(index) * markerInch)),
      );
      const heights = split.pieces.map((piece) => {
        const { y0, y1 } = getPieceBounds(source, piece);
        return y1 - y0;
      });
      const figure = { width: cssPerInch * widthInch, height: Math.max(...heights), zoom: frame.zoom };
      const plan = getPrintPlan(figure, options, PRINT_PIECE_NUMBER_ROW_PT, Math.max(frame.width, frame.height));
      const toCm = (css: number) => (css / cssPerInch) * CM_PER_INCH;
      const pieceSizesCm = split.pieces.map((piece, index) => ({
        width: toCm(piece.x1 - piece.x0) + cutSides(index) * markerInch * CM_PER_INCH,
        height: toCm(heights[index]) + (PRINT_PIECE_NUMBER_ROW_PT / PT_PER_INCH) * CM_PER_INCH,
      }));
      return { ...plan, split, pieceSizesCm };
    }
  }
  return { ...getPrintPlan(frame, options, chromePt), split: null, pieceSizesCm: [] };
}

/** A4 가이드 경계 — 노드 제목이 readablePt·minimumPt로 인쇄되는 캡처 프레임 폭(css px, 여백 50 포함). 에디터 가이드 선이 쓴다. */
export const A4_GUIDE_READABLE_PT = 9;
export const A4_GUIDE_MINIMUM_PT = 7;

export function getA4GuideWidths(paper: PaperOrientation): { readable: number; minimum: number; contentWidthCm: number } {
  const contentWidthCm = (paper === "portrait" ? A4_SHORT_CM : A4_LONG_CM) - WORD_PAGE_MARGIN_CM * 2;
  const widthAt = (pt: number) => (NODE_TITLE_PX * (contentWidthCm / CM_PER_INCH) * PT_PER_INCH) / pt;
  return { readable: widthAt(A4_GUIDE_READABLE_PT), minimum: widthAt(A4_GUIDE_MINIMUM_PT), contentWidthCm };
}

/** 가이드 선 기준 왼쪽 끝 — 내보내기 프레임과 같은 여백(PADDING_PX)만큼 노드 bounds 바깥. */
export const A4_GUIDE_PADDING_PX = PADDING_PX;

// PNG CRC32(IEEE) — pHYs 청크 무결성
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function getCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG에 pHYs(인치당 픽셀) 청크를 IHDR 바로 뒤에 넣는다 — Word는 이 값으로 삽입 크기를 정한다. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const IHDR_END = 8 + 25; // 시그니처 8 + IHDR(길이4·타입4·데이터13·CRC4)
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // 단위 = 미터
  view.setUint32(17, getCrc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, IHDR_END), 0);
  out.set(chunk, IHDR_END);
  out.set(png.subarray(IHDR_END), IHDR_END + chunk.length);
  return out;
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Word 테마 색 — globals.css 토큰을 캡처 중 뷰포트에서 읽은 실값(SVG·캔버스 합성용). */
interface WordPalette {
  edge: string;
  regionFill: string;
  regionStroke: string;
  regionDash: string;
  accent: string;
  ink: string;
  meta: string;
}

function readWordPalette(viewport: HTMLElement): WordPalette {
  const css = getComputedStyle(viewport);
  const read = (name: string) => css.getPropertyValue(name).trim();
  return {
    edge: read("--word-edge"),
    regionFill: read("--word-region-fill"),
    regionStroke: read("--word-region-stroke"),
    regionDash: read("--word-region-dash"),
    accent: read("--word-accent"),
    ink: read("--word-ink"),
    meta: read("--word-meta"),
  };
}

/** PNG 좌하단 정보 카드 — 라벨/값 조립(i18n)은 호출측 책임. */
export interface ExportMapInfo {
  title: string;
  rows: { label: string; value: string }[];
}

// 병렬 출구 표시 — 출발점에서 경로를 따라 조금 간 자리에 경로와 직교하는 짧은 막대 두 개(=). 같은 출구의 형제
// 엣지는 공통 구간에서 같은 자리에 겹쳐 하나로 보인다. 정지 장면 점(data-pulse-kind)이 병렬 갈래의 표지다.
function drawParallelMark(edgePath: SVGPathElement, stroke: string): SVGPathElement {
  const length = edgePath.getTotalLength();
  const at = Math.min(PARALLEL_MARK_OFFSET, length * 0.3);
  const center = edgePath.getPointAtLength(at);
  const ahead = edgePath.getPointAtLength(Math.min(at + 1, length));
  const dx = ahead.x - center.x;
  const dy = ahead.y - center.y;
  const norm = Math.hypot(dx, dy) || 1;
  const [tx, ty] = [dx / norm, dy / norm];
  const [nx, ny] = [-ty, tx];
  const bar = (shift: number) => {
    const cx = center.x + tx * shift;
    const cy = center.y + ty * shift;
    return `M${cx - nx * PARALLEL_MARK_HALF},${cy - ny * PARALLEL_MARK_HALF} L${cx + nx * PARALLEL_MARK_HALF},${cy + ny * PARALLEL_MARK_HALF}`;
  };
  const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
  mark.setAttribute("d", `${bar(-PARALLEL_MARK_GAP)} ${bar(PARALLEL_MARK_GAP)}`);
  mark.setAttribute("stroke", stroke);
  mark.setAttribute("stroke-width", WORD_EDGE_STROKE_WIDTH);
  mark.setAttribute("fill", "none");
  edgePath.parentNode?.appendChild(mark);
  return mark;
}

/** 경로 위 가로·세로 직선 구간 — 교차 판정 단위. at=고정 좌표(가로면 y), from<to=변하는 좌표 범위. */
export interface AxisRun {
  axis: "h" | "v";
  at: number;
  from: number;
  to: number;
  edge: number;
}

interface Point {
  x: number;
  y: number;
}

/** 샘플 점열에서 가로·세로로 곧게 이어지는 구간만 뽑는다. 둥근 모서리·곡선 구간은 대각 이동이라 끊긴다. */
export function findAxisRuns(points: Point[], edge: number): AxisRun[] {
  const runs: AxisRun[] = [];
  let current: AxisRun | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const axis = Math.abs(dy) < CROSSING_AXIS_EPS && Math.abs(dx) >= CROSSING_AXIS_EPS
      ? "h"
      : Math.abs(dx) < CROSSING_AXIS_EPS && Math.abs(dy) >= CROSSING_AXIS_EPS
        ? "v"
        : null;
    const at = axis === "h" ? a.y : a.x;
    const [lo, hi] = axis === "h" ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (axis !== null && current !== null && current.axis === axis && Math.abs(current.at - at) < CROSSING_AXIS_EPS) {
      current.from = Math.min(current.from, lo);
      current.to = Math.max(current.to, hi);
      continue;
    }
    if (current !== null) runs.push(current);
    current = axis === null ? null : { axis, at, from: lo, to: hi, edge };
  }
  if (current !== null) runs.push(current);
  return runs;
}

/** 서로 다른 엣지의 가로·세로 구간이 양쪽 끝에서 충분히 안쪽에서 만나는 점. 같은 자리는 하나로. */
export function findCrossings(runs: AxisRun[]): Point[] {
  const horizontals = runs.filter((run) => run.axis === "h");
  const verticals = runs.filter((run) => run.axis === "v");
  const seen = new Set<string>();
  const crossings: Point[] = [];
  for (const h of horizontals) {
    for (const v of verticals) {
      if (h.edge === v.edge) continue;
      const isInsideH = v.at > h.from + CROSSING_END_MARGIN && v.at < h.to - CROSSING_END_MARGIN;
      const isInsideV = h.at > v.from + CROSSING_END_MARGIN && h.at < v.to - CROSSING_END_MARGIN;
      if (!isInsideH || !isInsideV) continue;
      const key = `${Math.round(v.at)}:${Math.round(h.at)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      crossings.push({ x: v.at, y: h.at });
    }
  }
  return crossings;
}

function sampleEdgePath(path: SVGPathElement): Point[] {
  const length = path.getTotalLength();
  const points: Point[] = [];
  for (let at = 0; at < length; at += CROSSING_SAMPLE_STEP) {
    const point = path.getPointAtLength(at);
    points.push({ x: point.x, y: point.y });
  }
  const end = path.getPointAtLength(length);
  points.push({ x: end.x, y: end.y });
  return points;
}

// 교차 표시 — 모든 엣지 위(마지막 엣지 svg)에 한 묶음으로 덧그린다: 교차 자리를 바탕색으로 지우고
// jump면 세로선을 다시 잇고 가로선을 반원으로 넘기며, gap이면 가로선만 다시 이어 세로선이 끊겨 보이게 한다.
function drawCrossings(paths: SVGPathElement[], style: Exclude<CrossingStyle, "none">, stroke: string): SVGGElement | null {
  const visible = paths.filter((path) => {
    const group = path.closest(".react-flow__edge");
    const css = group ? getComputedStyle(group) : null;
    return css === null || (css.display !== "none" && css.visibility !== "hidden");
  });
  const runs = visible.flatMap((path, index) => findAxisRuns(sampleEdgePath(path), index));
  const crossings = findCrossings(runs);
  const host = visible[visible.length - 1]?.ownerSVGElement;
  if (crossings.length === 0 || !host) return null;
  const ns = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(ns, "g");
  const addPath = (d: string, color: string, width: string) => {
    const el = document.createElementNS(ns, "path");
    el.setAttribute("d", d);
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", width);
    el.setAttribute("fill", "none");
    layer.appendChild(el);
  };
  const r = CROSSING_RADIUS;
  const eraseWidth = String(Number(WORD_EDGE_STROKE_WIDTH) + 2.5);
  for (const { x, y } of crossings) {
    if (style === "jump") {
      addPath(`M${x - r},${y} L${x + r},${y}`, PAPER, eraseWidth);
      addPath(`M${x},${y - 3} L${x},${y + 3}`, stroke, WORD_EDGE_STROKE_WIDTH);
      // 왼→오 진행에서 sweep 1 = 화면 위로 볼록
      addPath(`M${x - r},${y} A${r},${r} 0 0 1 ${x + r},${y}`, stroke, WORD_EDGE_STROKE_WIDTH);
    } else {
      addPath(`M${x},${y - CROSSING_GAP} L${x},${y + CROSSING_GAP}`, PAPER, eraseWidth);
      addPath(`M${x - 3},${y} L${x + 3},${y}`, stroke, WORD_EDGE_STROKE_WIDTH);
    }
  }
  host.appendChild(layer);
  return layer;
}

interface FixupResult {
  undo: () => void;
  parallelMarks: number;
}

// 엣지·화살촉 인라인 보정 — 되돌리기 클로저 반환. 히트박스(edge-interaction)는 투명 유지.
// dark(L5 새벽 조감도) 캡처는 엣지 색을 라이트 톤으로 스왑 — 어두운 배경 위 검정 실선은 안 보인다.
// word면 Word 팔레트 색으로 엣지·영역 박스를 칠하고(SVG는 클론에 스타일시트가 안 실린다) 펄스 점을 빼고
// 병렬 표시를 원하면 막대를 심는다.
// compare면(비교 화면) 검정 강제 대신 엣지마다 실제 계산 색·점선·굵기·화살촉 색을 인라인한다 — diff 색이 출력의 내용이다.
// 문서용(compare.document)은 펄스 점을 빼고, 무변경 엣지의 중립 회색은 globals.css .bpm-export-compare-doc 변수가 정한다.
function applyEdgeFixups(
  viewport: HTMLElement,
  dark: boolean,
  word: { palette: WordPalette; showParallel: boolean; crossing: CrossingStyle } | null,
  compare: { document: boolean } | null = null,
): FixupResult {
  const edgeStroke = word ? word.palette.edge : dark ? EDGE_STROKE_DARK : EDGE_STROKE;
  const edgeStrokeWidth = word ? WORD_EDGE_STROKE_WIDTH : EDGE_STROKE_WIDTH;
  const undos: Array<() => void> = [];
  const setImportant = (el: Element, prop: string, value: string) => {
    const style = (el as SVGElement).style;
    const prev = style.getPropertyValue(prop);
    const prevPriority = style.getPropertyPriority(prop);
    style.setProperty(prop, value, "important");
    undos.push(() => {
      if (prev) style.setProperty(prop, prev, prevPriority);
      else style.removeProperty(prop);
    });
  };
  // 계산값을 먼저 모두 읽고 나서 심는다 — 읽기·쓰기를 번갈아 하면 엣지마다 스타일 재계산이 돈다
  const edgePaths = Array.from(viewport.querySelectorAll(".react-flow__edge-path"));
  const heads = Array.from(viewport.querySelectorAll(".react-flow__arrowhead *"));
  const computedPaths = compare
    ? edgePaths.map((path) => {
        const css = getComputedStyle(path);
        return { stroke: css.stroke, width: css.strokeWidth, dash: css.strokeDasharray };
      })
    : null;
  const computedHeads = compare
    ? heads.map((head) => {
        const css = getComputedStyle(head);
        return { stroke: css.stroke, fill: css.fill };
      })
    : null;
  edgePaths.forEach((path, index) => {
    const computed = computedPaths?.[index];
    if (computed) {
      setImportant(path, "stroke", computed.stroke);
      setImportant(path, "stroke-width", computed.width);
      setImportant(path, "stroke-dasharray", computed.dash);
      return;
    }
    setImportant(path, "stroke", edgeStroke);
    setImportant(path, "stroke-width", edgeStrokeWidth);
    setImportant(path, "stroke-dasharray", "none"); // animated 점선도 출력에선 실선
  });
  for (const hit of viewport.querySelectorAll(".react-flow__edge-interaction")) {
    setImportant(hit, "stroke", "none"); // 히트박스는 지금처럼 안 보이게
  }
  heads.forEach((head, index) => {
    // marker 색은 var() 참조 — 클론에서 해석 불가라 실값으로 고정(편집 화면은 엣지와 같은 색, 비교는 계산 색)
    const computed = computedHeads?.[index];
    setImportant(head, "stroke", computed?.stroke ?? edgeStroke);
    setImportant(head, "fill", computed?.fill ?? edgeStroke);
  });
  // 마름모 제목 — 인쇄(PNG)에선 3줄 클램프만 해제해 전문 노출. 폭은 화면 그대로(max-w-24) 유지
  // — 폭을 늘리면 마름모 밖으로 퍼져 어색 (사용자 결정 2026-08-23)
  for (const span of viewport.querySelectorAll(".bpm-decision-title")) {
    setImportant(span, "-webkit-line-clamp", "unset");
    setImportant(span, "display", "inline");
    setImportant(span, "overflow", "visible");
  }
  // 흐름 펄스 — 출력은 정지 화면이라 움직이는 점(캡처 순간의 아무 프레임)을 빼고 정지 장면 점으로 병렬/분기를 남긴다
  for (const dot of viewport.querySelectorAll(".bpm-edge-pulse")) {
    setImportant(dot, "display", "none");
  }
  let parallelMarks = 0;
  // 비교 화면 정지 장면 점(숨김 클래스 없이 상시 표시, data-pulse-kind) — 문서용은 빼고, 화면 그대로는 var() 색을 실값으로
  if (compare) {
    const dots = Array.from(viewport.querySelectorAll("[data-pulse-kind]"));
    const fills = dots.map((dot) => getComputedStyle(dot).fill);
    dots.forEach((dot, index) => {
      if (compare.document) setImportant(dot, "display", "none");
      else setImportant(dot, "fill", fills[index]);
    });
  }
  for (const dot of viewport.querySelectorAll(".bpm-edge-pulse-still")) {
    if (compare?.document) {
      setImportant(dot, "display", "none");
      continue;
    }
    if (!word) {
      setImportant(dot, "display", "inline");
      continue;
    }
    // Word 출력은 점 대신 병렬 표시 막대만(분기 점은 라벨이 이미 말한다). 숨김 클래스는 SVG 클론에 안 실리니 인라인으로
    setImportant(dot, "display", "none");
    if (!word.showParallel || dot.getAttribute("data-pulse-kind") !== "parallel") continue;
    const edgePath = dot.closest(".react-flow__edge")?.querySelector<SVGPathElement>(".react-flow__edge-path");
    if (!edgePath) continue;
    const mark = drawParallelMark(edgePath, edgeStroke);
    undos.push(() => mark.remove());
    parallelMarks += 1;
  }
  if (word && word.crossing !== "none") {
    const crossingPaths = Array.from(viewport.querySelectorAll<SVGPathElement>(".react-flow__edge-path"));
    const layer = drawCrossings(crossingPaths, word.crossing, edgeStroke);
    if (layer) undos.push(() => layer.remove());
  }
  if (word) {
    for (const fill of viewport.querySelectorAll(".bpm-group-fill")) {
      setImportant(fill, "fill", word.palette.regionFill);
    }
    for (const outline of viewport.querySelectorAll(".bpm-group-outline")) {
      setImportant(outline, "stroke", word.palette.regionStroke);
      setImportant(outline, "stroke-dasharray", word.palette.regionDash);
      setImportant(outline, "stroke-width", "1");
      setImportant(outline, "stroke-linejoin", "miter"); // 문서용은 각진 모서리
    }
    // SP 상태 배너(새 게시본·핀 고정·미지정 안내)는 편집 안내라 문서엔 뺀다 — 노드 높이도 함께 줄어든다
    for (const banner of viewport.querySelectorAll('[data-id^="sp-banner-"]')) {
      setImportant(banner, "display", "none");
    }
  }
  // 화면 전용 안내(A4 가이드 등) — 어떤 형식이든 출력엔 넣지 않는다
  for (const el of viewport.querySelectorAll(".bpm-print-hide")) {
    setImportant(el, "display", "none");
  }
  // SP "최신본 따르는 중"은 화면 전용 상태 표시(정상 상태 안내) — 출력물엔 불필요.
  // display:none이라 노드 높이도 그만큼 줄어든다 (사용자 요청 2026-08-31)
  for (const banner of viewport.querySelectorAll('[data-id="sp-banner-following"]')) {
    setImportant(banner, "display", "none");
  }
  return {
    undo: () => {
      for (const undo of undos) undo();
    },
    parallelMarks,
  };
}

// 폭 초과 텍스트 말줄임 — canvas measureText 기준
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// " · "로 이은 메타 조각을 폭에 맞춰 줄로 나눈다 — 조각 하나가 한 줄보다 길면 말줄임
function wrapMetaSegments(ctx: CanvasRenderingContext2D, segments: string[], maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const segment of segments) {
    const candidate = current ? `${current} · ${segment}` : segment;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = truncateToWidth(ctx, segment, maxWidth);
  }
  if (current) lines.push(current);
  return lines;
}

async function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("export image decode failed"));
    image.src = dataUrl;
  });
  return image;
}

/** 문서용 합성 색 — Word 테마 팔레트 또는 비교 문서용 변수. */
interface DocumentColors {
  title: string;
  meta: string;
  rule: string;
  ink: string;
  edge: string;
}

/** 문서용 범례 항목 — 병렬 표시(=)·연결 기호(Ⓐ)·비교 상태 견본. */
type DocumentLegendItem =
  | { kind: "parallel"; label: string }
  | { kind: "connector"; label: string }
  | { kind: "swatch"; label: string; fill: string; fillAlpha: number; stroke: string; dashed: boolean };

/** 문서용 그림 주변 — 머리 블록(meta는 줄마다 " · "로 이을 조각, 폭에 맞춰 접는다)·범례·색. */
interface DocumentChrome {
  header: { title: string; meta: string[][] } | null;
  legend: DocumentLegendItem[];
  legendAlign: "left" | "right";
  colors: DocumentColors;
  connectorLabel: string;
}

/** 잘린 연결선 끝 표시 — y는 프레임 css px. */
interface ConnectorMark {
  y: number;
  label: string;
}

/** 합성할 조각 하나 — 캡처 이미지에서 잘라 올 영역(프레임 css px)과 그 둘레에 붙일 것. */
interface DocumentPiece {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  header: DocumentChrome["header"];
  number: string | null;
  legend: DocumentLegendItem[];
  // 잘린 쪽 — 지나가는 연결선이 없어도 연결 기호 자리를 둔다(인쇄 계획이 이 폭까지 본문 폭에 맞춘다)
  cutLeft: boolean;
  cutRight: boolean;
  left: ConnectorMark[];
  right: ConnectorMark[];
}

// 연결 기호 — 흰 원 + 문자. 그림 연결선과 같은 색 테두리
function drawConnector(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, colors: DocumentColors, pxPerPt: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, PRINT_CONNECTOR_R_PT * pxPerPt, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 0.75 * pxPerPt;
  ctx.stroke();
  ctx.font = `700 ${PRINT_CONNECTOR_FONT_PT * pxPerPt}px ${WORD_FONT_FAMILY}`;
  ctx.fillStyle = colors.ink;
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy);
  ctx.textAlign = "left";
}

// 범례 항목 글리프 — 가로 폭(px)을 돌려준다. draw=false면 폭만 잰다
function drawLegendGlyph(
  ctx: CanvasRenderingContext2D,
  item: DocumentLegendItem,
  x: number,
  y: number,
  colors: DocumentColors,
  pxPerPt: number,
  draw: boolean,
): number {
  const pt = (value: number) => value * pxPerPt;
  if (item.kind === "connector") {
    if (draw) drawConnector(ctx, x + pt(PRINT_CONNECTOR_R_PT), y, "A", colors, pxPerPt);
    return pt(PRINT_CONNECTOR_R_PT * 2);
  }
  if (item.kind === "parallel") {
    const length = pt(12);
    if (draw) {
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = pt(0.75);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length, y);
      for (const shift of [-pt(1.2), pt(1.2)]) {
        ctx.moveTo(x + length / 2 + shift, y - pt(3));
        ctx.lineTo(x + length / 2 + shift, y + pt(3));
      }
      ctx.stroke();
    }
    return length;
  }
  const size = pt(PRINT_SWATCH_PT);
  if (draw) {
    // 노드와 같은 표기 — 상태색 틴트 + 테두리(삭제는 점선)
    const top = y - size / 2;
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, top, size, size);
    ctx.globalAlpha = item.fillAlpha;
    ctx.fillStyle = item.fill;
    ctx.fillRect(x, top, size, size);
    ctx.globalAlpha = 1;
    const line = pt(0.9);
    ctx.strokeStyle = item.stroke;
    ctx.lineWidth = line;
    ctx.setLineDash(item.dashed ? [pt(1.8), pt(1.2)] : []);
    ctx.strokeRect(x + line / 2, top + line / 2, size - line, size - line);
    ctx.setLineDash([]);
  }
  return size;
}

// 문서용 조각 합성 — 흰 바탕에 (머리 블록) · (조각 번호) · 그림 · 잘린 연결선 양끝 연결 기호 · (범례 줄).
// 글자·기호는 pt 고정이라 pxPerPt(그림 css px / pt)로 환산한다. imageScale = 캡처 이미지 px / 프레임 css px
function composeDocumentPiece(
  image: HTMLImageElement,
  imageScale: number,
  piece: DocumentPiece,
  chrome: DocumentChrome,
  pxPerPt: number,
  pixelRatio: number,
): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("document PNG export: 2d canvas unavailable");
  const pt = (value: number) => value * pxPerPt;
  const { colors } = chrome;
  const markerSpace = pt(PRINT_CONNECTOR_SPACE_PT);
  const leftPad = piece.cutLeft ? markerSpace : 0;
  const rightPad = piece.cutRight ? markerSpace : 0;
  const width = leftPad + piece.sw + rightPad;
  const side = pt(PRINT_SIDE_PT);
  const innerWidth = width - side * 2;
  const metaFont = `400 ${pt(PRINT_META_PT)}px ${WORD_FONT_FAMILY}`;
  ctx.font = metaFont;
  const metaLines = piece.header ? piece.header.meta.flatMap((segments) => wrapMetaSegments(ctx, segments, innerWidth)) : [];
  const headerHeight = piece.header ? pt(getPrintHeaderPt(metaLines.length)) : 0;
  const numberHeight = piece.number ? pt(PRINT_PIECE_NUMBER_ROW_PT) : 0;
  const legendHeight = piece.legend.length > 0 ? pt(PRINT_LEGEND_ROW_PT) : 0;
  const figureTop = headerHeight + numberHeight;
  const height = figureTop + piece.sh + legendHeight;

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  if (piece.header) {
    ctx.font = `700 ${pt(PRINT_TITLE_PT)}px ${WORD_FONT_FAMILY}`;
    ctx.fillStyle = colors.title;
    let y = pt(PRINT_HEADER_TOP_PT + PRINT_TITLE_LINE_PT / 2);
    ctx.fillText(truncateToWidth(ctx, piece.header.title, innerWidth), side, y);
    ctx.font = metaFont;
    ctx.fillStyle = colors.meta;
    y += pt(PRINT_TITLE_LINE_PT / 2 + PRINT_META_LINE_PT / 2);
    for (const line of metaLines) {
      ctx.fillText(line, side, y);
      y += pt(PRINT_META_LINE_PT);
    }
    ctx.fillStyle = colors.rule;
    ctx.fillRect(side, headerHeight - pt(PRINT_HEADER_GAP_PT + PRINT_RULE_PT), innerWidth, pt(PRINT_RULE_PT));
  }
  if (piece.number) {
    ctx.font = `400 ${pt(PRINT_PIECE_NUMBER_PT)}px ${WORD_FONT_FAMILY}`;
    ctx.fillStyle = colors.meta;
    ctx.textAlign = "right";
    ctx.fillText(piece.number, width - side, headerHeight + numberHeight / 2);
    ctx.textAlign = "left";
  }
  ctx.drawImage(
    image,
    piece.sx * imageScale,
    piece.sy * imageScale,
    piece.sw * imageScale,
    piece.sh * imageScale,
    leftPad,
    figureTop,
    piece.sw,
    piece.sh,
  );
  // 연결 기호 — 원이 잘린 경계 바로 바깥에 붙는다(선이 원으로 들어가 끝나 보이게)
  const r = pt(PRINT_CONNECTOR_R_PT);
  for (const mark of piece.left) drawConnector(ctx, leftPad - r, figureTop + mark.y - piece.sy, mark.label, colors, pxPerPt);
  for (const mark of piece.right) {
    drawConnector(ctx, leftPad + piece.sw + r, figureTop + mark.y - piece.sy, mark.label, colors, pxPerPt);
  }

  if (piece.legend.length > 0) {
    ctx.font = `400 ${pt(PRINT_LEGEND_PT)}px ${WORD_FONT_FAMILY}`;
    const y = figureTop + piece.sh + legendHeight / 2;
    const gap = pt(3);
    const itemWidths = piece.legend.map(
      (item) => drawLegendGlyph(ctx, item, 0, 0, colors, pxPerPt, false) + gap + ctx.measureText(item.label).width,
    );
    const total = itemWidths.reduce((sum, w) => sum + w, 0) + pt(PRINT_LEGEND_GAP_PT) * (itemWidths.length - 1);
    let x = chrome.legendAlign === "right" ? width - side - total : side;
    piece.legend.forEach((item, index) => {
      const glyph = drawLegendGlyph(ctx, item, x, y, colors, pxPerPt, true);
      ctx.font = `400 ${pt(PRINT_LEGEND_PT)}px ${WORD_FONT_FAMILY}`;
      ctx.fillStyle = colors.ink;
      ctx.fillText(item.label, x + glyph + gap, y);
      x += itemWidths[index] + pt(PRINT_LEGEND_GAP_PT);
    });
  }
  return canvas.toDataURL("image/png");
}

// 문서용 내려받기 — 한 장이면 PNG 하나, 나눠 싣기면 조각마다 PNG(같은 dpi = 같은 배율)를 ZIP 하나로.
// 잘린 자리마다 지나가는 연결선에 위→아래, 왼→오른쪽 순으로 문자를 매겨 양쪽 조각에 같은 문자를 단다.
async function downloadDocumentFigure(
  fileName: string,
  dataUrl: string,
  frame: ExportFrame,
  plan: DocumentPrintPlan,
  source: SplitSource | null,
  chrome: DocumentChrome,
): Promise<void> {
  const image = await decodeImage(dataUrl);
  const imageScale = image.naturalWidth / frame.width;
  const figureWidth = plan.pixelWidth / plan.pixelRatio;
  const pxPerPt = figureWidth / ((plan.widthCm / CM_PER_INCH) * PT_PER_INCH);
  if (!plan.split || !source) {
    const composed = composeDocumentPiece(
      image,
      imageScale,
      {
        sx: 0,
        sy: 0,
        sw: frame.width,
        sh: frame.height,
        header: chrome.header,
        number: null,
        legend: chrome.legend,
        cutLeft: false,
        cutRight: false,
        left: [],
        right: [],
      },
      chrome,
      pxPerPt,
      plan.pixelRatio,
    );
    downloadPngWithDpi(fileName, composed, plan.dpi);
    return;
  }
  const { pieces } = plan.split;
  let next = 0;
  const cuts = pieces
    .slice(1)
    .map((piece) => findCutCrossings(source.edges, piece.x0).map((y) => ({ y, label: getConnectorLabel(next++) })));
  const stem = fileName.replace(/\.png$/i, "");
  const files = pieces.map((piece, index) => {
    const { y0, y1 } = getPieceBounds(source, piece);
    const isLast = index === pieces.length - 1;
    const composed = composeDocumentPiece(
      image,
      imageScale,
      {
        sx: piece.x0,
        sy: y0,
        sw: piece.x1 - piece.x0,
        sh: y1 - y0,
        header: index === 0 ? chrome.header : null,
        number: `${index + 1}/${pieces.length}`,
        legend: isLast ? [...chrome.legend, { kind: "connector", label: chrome.connectorLabel }] : [],
        cutLeft: index > 0,
        cutRight: !isLast,
        left: index > 0 ? cuts[index - 1] : [],
        right: isLast ? [] : cuts[index],
      },
      chrome,
      pxPerPt,
      plan.pixelRatio,
    );
    return { name: `${stem}_${index + 1}-${pieces.length}.png`, bytes: setPngDpi(decodeDataUrl(composed), plan.dpi) };
  });
  await downloadZip(`${stem}.zip`, files);
}

// 조각 PNG 묶음 — PNG는 이미 압축돼 있어 무압축(STORE, jszip 기본)으로 담는다. jszip은 필요할 때만 불러온다
async function downloadZip(fileName: string, files: { name: string; bytes: Uint8Array }[]): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.bytes);
  const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
  clickDownload(fileName, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 캡처 이미지 아래에 정보 카드 스트립을 붙여 합성 — 배경(캔버스 톤+dot-grid)은 전체에 깐다.
// dark(L5 새벽 조감도)면 남색→차콜 그라데이션으로 대체하고 dot-grid는 생략(화면과 동일 — 무늬 없는 민 무대).
async function composePng(
  dataUrl: string,
  frame: ExportFrame,
  info: ExportMapInfo | undefined,
  dark: boolean,
): Promise<string> {
  const image = await decodeImage(dataUrl);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  // 카드 크기 산정 — 그래프 영역과 겹치지 않게 프레임 아래 스트립에 그린다
  const maxCardWidth = Math.max(frame.width - CARD_MARGIN * 2, 200);
  let cardWidth = 0;
  let cardHeight = 0;
  let labelWidth = 0;
  if (info) {
    ctx.font = ROW_FONT;
    labelWidth = Math.max(0, ...info.rows.map((row) => ctx.measureText(row.label).width));
    const valueWidth = Math.max(0, ...info.rows.map((row) => ctx.measureText(row.value).width));
    ctx.font = TITLE_FONT;
    const titleWidth = ctx.measureText(info.title).width;
    cardWidth = Math.min(
      Math.ceil(Math.max(titleWidth, labelWidth + LABEL_VALUE_GAP + valueWidth)) + CARD_PAD * 2,
      maxCardWidth,
    );
    cardHeight = CARD_PAD * 2 + TITLE_LINE_H + (info.rows.length > 0 ? 6 + info.rows.length * ROW_LINE_H : 0);
  }
  const stripHeight = info ? cardHeight + CARD_MARGIN + 8 : 0;

  canvas.width = frame.width * PIXEL_RATIO;
  canvas.height = (frame.height + stripHeight) * PIXEL_RATIO;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  const totalHeight = frame.height + stripHeight;
  if (dark) {
    const gradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
    gradient.addColorStop(0, BG_TOP_DARK);
    gradient.addColorStop(1, BG_BOTTOM_DARK);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, frame.width, totalHeight);
  } else {
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, frame.width, totalHeight);
    ctx.fillStyle = DOT_COLOR;
    for (let x = DOT_GAP / 2; x < frame.width; x += DOT_GAP) {
      for (let y = DOT_GAP / 2; y < totalHeight; y += DOT_GAP) {
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.drawImage(image, 0, 0, frame.width, frame.height);

  if (info) {
    const cardX = CARD_MARGIN;
    const cardY = frame.height + 8;
    drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 6);
    ctx.fillStyle = CARD_BG;
    ctx.fill();
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.font = TITLE_FONT;
    ctx.fillStyle = INK;
    const innerWidth = cardWidth - CARD_PAD * 2;
    ctx.fillText(
      truncateToWidth(ctx, info.title, innerWidth),
      cardX + CARD_PAD,
      cardY + CARD_PAD + TITLE_LINE_H / 2,
    );
    ctx.font = ROW_FONT;
    let rowY = cardY + CARD_PAD + TITLE_LINE_H + 6 + ROW_LINE_H / 2;
    for (const row of info.rows) {
      ctx.fillStyle = INK_TERTIARY;
      ctx.fillText(row.label, cardX + CARD_PAD, rowY);
      ctx.fillStyle = INK;
      ctx.fillText(
        truncateToWidth(ctx, row.value, innerWidth - labelWidth - LABEL_VALUE_GAP),
        cardX + CARD_PAD + labelWidth + LABEL_VALUE_GAP,
        rowY,
      );
      rowY += ROW_LINE_H;
    }
  }

  return canvas.toDataURL("image/png");
}

// 뷰포트를 프레임 크기·변환으로 투명 캡처 — 편집 화면·비교 화면 공통
function captureViewport(viewport: HTMLElement, frame: ExportFrame, pixelRatio: number): Promise<string> {
  return toPng(viewport, {
    pixelRatio,
    width: frame.width,
    height: frame.height,
    style: {
      width: `${frame.width}px`,
      height: `${frame.height}px`,
      transform: `translate(${frame.x}px, ${frame.y}px) scale(${frame.zoom})`,
    },
  });
}

function clickDownload(fileName: string, href: string): void {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = href;
  link.click();
}

// 인쇄 dpi(pHYs)를 실어 Blob URL로 내려받는다 — Word가 고른 너비로 삽입하게
function downloadPngWithDpi(fileName: string, dataUrl: string, dpi: number): void {
  const bytes = setPngDpi(decodeDataUrl(dataUrl), dpi);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "image/png" }));
  clickDownload(fileName, url);
  // 다운로드가 URL을 잡은 뒤 회수
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 보정을 심은 채 투명 캡처 → 배경·정보 카드 합성 → 다운로드. finally로 반드시 원복.
// word면 캡처 동안만 Word 테마 클래스를 붙인다(화면엔 그 순간만 문서 톤이 비친다).
async function downloadViewportPng(
  viewport: HTMLElement,
  fileName: string,
  frame: ExportFrame,
  info: ExportMapInfo | undefined,
  dark: boolean,
  word: WordExportConfig | null = null,
): Promise<void> {
  if (!word) {
    let fixups: FixupResult | null = null;
    let dataUrl: string;
    try {
      fixups = applyEdgeFixups(viewport, dark, null);
      dataUrl = await captureViewport(viewport, frame, PIXEL_RATIO);
    } finally {
      fixups?.undo();
    }
    clickDownload(fileName, await composePng(dataUrl, frame, info, dark));
    return;
  }
  const wordClasses = ["bpm-export-word", `bpm-export-word--${word.style}`];
  viewport.classList.add(...wordClasses);
  const palette = readWordPalette(viewport);
  const header = word.showInfo && info ? { title: info.title, meta: [info.rows.map((row) => `${row.label} ${row.value}`)] } : null;
  // 인쇄 계획의 세로 크기 — 머리 블록은 메타 한 줄로 어림(합성은 실제 줄 수), 범례는 병렬 표시를 켰으면
  const chromePt = (header ? getPrintHeaderPt(1) : 0) + (word.showParallel ? PRINT_LEGEND_ROW_PT : 0);
  let fixups: FixupResult | null = null;
  let dataUrl: string;
  let plan: DocumentPrintPlan;
  let source: SplitSource | null = null;
  try {
    fixups = applyEdgeFixups(viewport, dark, { palette, showParallel: word.showParallel, crossing: word.crossing });
    // 자를 자리는 문서 톤(글꼴·숨긴 배너)이 적용된 모습으로 잰다
    source = word.layout === "split" ? measureSplitSource(viewport, frame) : null;
    plan = getDocumentPrintPlan(frame, word, chromePt, source);
    dataUrl = await captureViewport(viewport, frame, plan.pixelRatio);
  } finally {
    fixups?.undo();
    viewport.classList.remove(...wordClasses);
  }
  await downloadDocumentFigure(fileName, dataUrl, frame, plan, source, {
    header,
    legend: (fixups?.parallelMarks ?? 0) > 0 ? [{ kind: "parallel", label: word.parallelLabel }] : [],
    legendAlign: "right",
    colors: { title: palette.accent, meta: palette.meta, rule: palette.accent, ink: palette.ink, edge: palette.edge },
    connectorLabel: word.connectorLabel,
  });
}

/** 전체 노드 bounds 기준으로 현재 캔버스를 PNG 파일로 저장한다.
 *  dark=true면 L5 새벽 조감도 톤(남색→차콜)으로 배경·엣지 색을 맞춘다(캔버스가 그 상태로 보일 때만 전달).
 *  word를 주면 Word 문서용 테마로 찍는다(dark 무시 — 문서는 항상 흰 바탕).
 *  root는 캡처할 캔버스를 품은 요소 — 기본은 문서 전체(에디터는 캔버스가 하나). */
export async function exportCanvasPng(
  nodes: Node[],
  fileName: string,
  info?: ExportMapInfo,
  dark?: boolean,
  word?: WordExportConfig,
  root: ParentNode = document,
): Promise<void> {
  const viewport = root.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport || nodes.length === 0) {
    return;
  }
  await downloadViewportPng(
    viewport,
    fileName,
    measureExportFrame(nodes),
    info,
    word ? false : (dark ?? false),
    word ?? null,
  );
}

// ---- 비교 화면 PNG ----
// 비교 화면은 diff 색이 내용이라 엣지·화살촉 색을 지우지 않고(applyEdgeFixups compare), 캡처 동안 뷰포트에
// .bpm-export-compare(+문서용 .bpm-export-compare-doc)를 붙인다(globals.css). 위에 정보 블록, 아래에 범례 줄을 합성.

/** 그림 경계(flow 좌표). */
export interface FlowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 프레임 — 그림 경계 + 여백. 작은 맵은 키우지 않고(줌 상한 1) 큰 맵만 긴 변 상한에 맞춰 줄인다
const COMPARE_FRAME_PADDING_PX = 40;
const COMPARE_FRAME_MIN_PX = 320;

/** 그림 경계 → 캡처 프레임. 줌은 1을 넘지 않고, 최소 크기보다 크면 경계 + 여백 그대로(가운데 정렬). */
export function measureCompareFrame(bounds: FlowBounds): ExportFrame {
  const inner = MAX_SIZE_PX - COMPARE_FRAME_PADDING_PX * 2;
  const zoom = Math.min(1, inner / Math.max(bounds.width, 1), inner / Math.max(bounds.height, 1));
  const width = Math.max(COMPARE_FRAME_MIN_PX, Math.ceil(bounds.width * zoom) + COMPARE_FRAME_PADDING_PX * 2);
  const height = Math.max(COMPARE_FRAME_MIN_PX, Math.ceil(bounds.height * zoom) + COMPARE_FRAME_PADDING_PX * 2);
  return {
    width,
    height,
    zoom,
    x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}

// 화면 그대로 합성 치수(css px) — 정보 블록(제목 + 메타 2줄 + 구분선)과 범례 줄. 메타는 줄바꿈 없이 말줄임이라 높이가
// 고정이다. 문서용은 pt 고정 치수(PRINT_*)를 쓴다
const COMPARE_MARGIN = 20;
const COMPARE_HEADER_TOP = 16;
const COMPARE_TITLE_LINE_H = 22;
const COMPARE_META_LINE_H = 16;
const COMPARE_META_LINES = 2;
const COMPARE_RULE_GAP = 6;
const COMPARE_RULE_H = 2;
const COMPARE_HEADER_GAP = 10;
const COMPARE_HEADER_H =
  COMPARE_HEADER_TOP +
  COMPARE_TITLE_LINE_H +
  COMPARE_META_LINE_H * COMPARE_META_LINES +
  COMPARE_RULE_GAP +
  COMPARE_RULE_H +
  COMPARE_HEADER_GAP;
const COMPARE_LEGEND_H = 36;
const COMPARE_SWATCH = 12;
// 문서용 클래스가 글꼴·테두리를 바꾸면 노드 실측이 달라져 비교 화면이 다시 배치한다 — 자리 잡을 때까지 기다린 뒤 잰다
// (비교 화면 배치 안정 대기 120ms + 측정 프레임 여유)
const COMPARE_DOC_SETTLE_MS = 450;

export type CompareLegendStatus = "added" | "changed" | "removed" | "unchanged";

/** 비교 PNG 실행 인자 — 문구(i18n)는 호출측이 조립한다. */
export interface CompareExportConfig {
  document: boolean;
  header: { title: string; metaLines: string[] } | null;
  legend: { status: CompareLegendStatus; label: string }[] | null;
  // 무변경 노드를 회색으로 누르는 상태 색 구성(C안) — 범례 '바뀌지 않음' 견본 색
  muteUnchanged: boolean;
  paper: PaperOrientation;
  printWidthPct: number;
  // 나눠 싣기·연결 기호 범례 문구 — 문서용만
  layout: PrintLayout;
  connectorLabel: string;
}

/** 실제로 그려진 그림의 경계(flow 좌표) — 노드 밖에 매달린 diff 필·조건 캡션, 우회 아크, 연결선 라벨까지.
 *  측정할 것이 없으면(가려진 캔버스 등) null. */
export function measureRenderedFlowBounds(viewport: HTMLElement): FlowBounds | null {
  const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
  const origin = viewport.getBoundingClientRect();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const add = (x: number, y: number, width: number, height: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  };
  for (const el of viewport.querySelectorAll(".react-flow__node, .react-flow__node *, .react-flow__edgelabel-renderer *")) {
    // 투명 핸들·숨긴 호버 요소는 그림이 아니다
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    add((rect.left - origin.left) / zoom, (rect.top - origin.top) / zoom, rect.width / zoom, rect.height / zoom);
  }
  for (const path of viewport.querySelectorAll<SVGPathElement>(".react-flow__edge-path")) {
    // 연결선 svg는 flow 좌표 그대로라 getBBox가 곧 flow 경계
    const box = path.getBBox();
    if (box.width === 0 && box.height === 0) continue;
    add(box.x, box.y, box.width, box.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

interface CompareColors {
  added: string;
  changed: string;
  removed: string;
  unchangedFill: string;
  unchangedFillAlpha: number;
  unchangedStroke: string;
  ink: string;
  sub: string;
  rule: string;
  edge: string;
}

// 상태 색은 뷰포트가 물려받은 [data-diff-palette] 토큰 실값, 문서용 중립 톤은 .bpm-export-compare-doc 변수
function readCompareColors(viewport: HTMLElement, isDocument: boolean, muteUnchanged: boolean): CompareColors {
  const css = getComputedStyle(viewport);
  const read = (name: string) => css.getPropertyValue(name).trim();
  const mutedInk = read("--color-ink-muted");
  return {
    added: read("--color-added"),
    changed: read("--color-diff-changed"),
    removed: read("--color-removed"),
    unchangedFill: isDocument ? read("--cmp-doc-node-fill") : muteUnchanged ? mutedInk : CARD_BG,
    // 화면 C안 무변경 노드는 회색 22% 바탕(process-node mutedNodeStyle과 같은 비율)
    unchangedFillAlpha: !isDocument && muteUnchanged ? 0.22 : 1,
    unchangedStroke: isDocument ? read("--cmp-doc-node-stroke") : muteUnchanged ? mutedInk : CARD_BORDER,
    ink: isDocument ? read("--cmp-doc-ink") : INK,
    sub: isDocument ? read("--cmp-doc-sub") : INK_TERTIARY,
    rule: isDocument ? read("--cmp-doc-ink") : CARD_BORDER,
    edge: isDocument ? read("--cmp-doc-edge") : INK,
  };
}

// 문서용 범례 — 화면 범례(composeComparePng)와 같은 견본 규칙을 pt 크기 범례 항목으로
function buildCompareDocumentLegend(
  legend: NonNullable<CompareExportConfig["legend"]>,
  colors: CompareColors,
): DocumentLegendItem[] {
  const colorOf: Record<Exclude<CompareLegendStatus, "unchanged">, string> = {
    added: colors.added,
    changed: colors.changed,
    removed: colors.removed,
  };
  return legend.map((item) =>
    item.status === "unchanged"
      ? {
          kind: "swatch",
          label: item.label,
          fill: colors.unchangedFill,
          fillAlpha: colors.unchangedFillAlpha,
          stroke: colors.unchangedStroke,
          dashed: false,
        }
      : {
          kind: "swatch",
          label: item.label,
          fill: colorOf[item.status],
          fillAlpha: 0.12,
          stroke: colorOf[item.status],
          dashed: item.status === "removed",
        },
  );
}

/** 비교 문서용 인쇄 계획의 세로 여분(pt) — 정보 블록(메타 2줄)·범례 줄. 옵션 창 인쇄 크기 패널도 쓴다. */
export function getCompareDocumentChromePt(options: { showInfo: boolean; showLegend: boolean }): number {
  return (options.showInfo ? getPrintHeaderPt(COMPARE_META_LINES) : 0) + (options.showLegend ? PRINT_LEGEND_ROW_PT : 0);
}

// 비교 PNG 화면 그대로 합성 — 캔버스 톤+점 격자 바탕, (선택) 상단 정보 블록, 그림, (선택) 하단 범례 줄.
// 문서용은 인쇄 크기 고정 합성(downloadDocumentFigure)이 맡는다
async function composeComparePng(
  dataUrl: string,
  frame: ExportFrame,
  config: CompareExportConfig,
  colors: CompareColors,
  pixelRatio: number,
): Promise<string> {
  const image = await decodeImage(dataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  const headerHeight = config.header ? COMPARE_HEADER_H : 0;
  const legendHeight = config.legend ? COMPARE_LEGEND_H : 0;
  const totalHeight = headerHeight + frame.height + legendHeight;
  const family = "Pretendard, sans-serif";
  canvas.width = frame.width * pixelRatio;
  canvas.height = totalHeight * pixelRatio;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, frame.width, totalHeight);
  ctx.fillStyle = DOT_COLOR;
  for (let x = DOT_GAP / 2; x < frame.width; x += DOT_GAP) {
    for (let y = DOT_GAP / 2; y < totalHeight; y += DOT_GAP) {
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const innerWidth = frame.width - COMPARE_MARGIN * 2;
  ctx.textBaseline = "middle";
  if (config.header) {
    ctx.font = `600 17px ${family}`;
    ctx.fillStyle = colors.ink;
    let y = COMPARE_HEADER_TOP + COMPARE_TITLE_LINE_H / 2;
    ctx.fillText(truncateToWidth(ctx, config.header.title, innerWidth), COMPARE_MARGIN, y);
    ctx.font = `400 12px ${family}`;
    ctx.fillStyle = colors.sub;
    y += COMPARE_TITLE_LINE_H / 2 + COMPARE_META_LINE_H / 2;
    for (const line of config.header.metaLines.slice(0, COMPARE_META_LINES)) {
      ctx.fillText(truncateToWidth(ctx, line, innerWidth), COMPARE_MARGIN, y);
      y += COMPARE_META_LINE_H;
    }
    ctx.fillStyle = colors.rule;
    ctx.fillRect(COMPARE_MARGIN, headerHeight - COMPARE_HEADER_GAP - 1, innerWidth, 1);
  }
  ctx.drawImage(image, 0, headerHeight, frame.width, frame.height);

  if (config.legend) {
    const y = headerHeight + frame.height + COMPARE_LEGEND_H / 2 - 4;
    ctx.font = `400 12px ${family}`;
    let x = COMPARE_MARGIN;
    const colorOf: Record<Exclude<CompareLegendStatus, "unchanged">, string> = {
      added: colors.added,
      changed: colors.changed,
      removed: colors.removed,
    };
    for (const item of config.legend) {
      const top = y - COMPARE_SWATCH / 2;
      const stroke = item.status === "unchanged" ? colors.unchangedStroke : colorOf[item.status];
      // 노드와 같은 표기 — 상태색 12% 틴트 + 테두리(삭제는 점선), 바뀌지 않음은 현재 구성의 무변경 노드 톤
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(x, top, COMPARE_SWATCH, COMPARE_SWATCH);
      ctx.globalAlpha = item.status === "unchanged" ? colors.unchangedFillAlpha : 0.12;
      ctx.fillStyle = item.status === "unchanged" ? colors.unchangedFill : stroke;
      ctx.fillRect(x, top, COMPARE_SWATCH, COMPARE_SWATCH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(item.status === "removed" ? [3, 2] : []);
      ctx.strokeRect(x + 0.75, top + 0.75, COMPARE_SWATCH - 1.5, COMPARE_SWATCH - 1.5);
      ctx.setLineDash([]);
      x += COMPARE_SWATCH + 6;
      ctx.fillStyle = colors.ink;
      ctx.fillText(item.label, x, y);
      x += ctx.measureText(item.label).width + 16;
    }
  }
  return canvas.toDataURL("image/png");
}

/** 비교 화면 캔버스(root 안의 뷰포트)를 PNG로 저장한다 — 그려진 그림 경계 + 여백(작은 맵은 확대하지 않음).
 *  문서용은 흰 바탕·Arial·중립 무변경 노드에 상태 색을 유지하고, 인쇄 계획의 dpi를 PNG에 싣는다.
 *  찍을 캔버스나 노드가 없으면 Error — 호출측이 사용자에게 알린다. */
export async function exportComparePng(
  root: ParentNode,
  nodes: Node[],
  fileName: string,
  config: CompareExportConfig,
): Promise<void> {
  const viewport = root.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport) throw new Error("compare PNG export: canvas viewport not found");
  if (nodes.length === 0) throw new Error("compare PNG export: no nodes to capture");
  const classes = ["bpm-export-compare", ...(config.document ? ["bpm-export-compare-doc"] : [])];
  viewport.classList.add(...classes);
  let fixups: FixupResult | null = null;
  let dataUrl: string;
  let frame: ExportFrame;
  let colors: CompareColors;
  let plan: DocumentPrintPlan | null = null;
  let source: SplitSource | null = null;
  try {
    if (config.document) await new Promise<void>((resolve) => window.setTimeout(resolve, COMPARE_DOC_SETTLE_MS));
    frame = measureCompareFrame(measureRenderedFlowBounds(viewport) ?? getNodesBounds(nodes));
    colors = readCompareColors(viewport, config.document, config.muteUnchanged);
    if (config.document) {
      source = config.layout === "split" ? measureSplitSource(viewport, frame) : null;
      const chromePt = getCompareDocumentChromePt({ showInfo: config.header !== null, showLegend: config.legend !== null });
      plan = getDocumentPrintPlan(frame, config, chromePt, source);
    }
    fixups = applyEdgeFixups(viewport, false, null, { document: config.document });
    dataUrl = await captureViewport(viewport, frame, plan?.pixelRatio ?? PIXEL_RATIO);
  } finally {
    fixups?.undo();
    viewport.classList.remove(...classes);
  }
  if (!plan) {
    clickDownload(fileName, await composeComparePng(dataUrl, frame, config, colors, PIXEL_RATIO));
    return;
  }
  await downloadDocumentFigure(fileName, dataUrl, frame, plan, source, {
    header: config.header
      ? { title: config.header.title, meta: config.header.metaLines.slice(0, COMPARE_META_LINES).map((line) => [line]) }
      : null,
    legend: config.legend ? buildCompareDocumentLegend(config.legend, colors) : [],
    legendAlign: "left",
    colors: { title: colors.ink, meta: colors.sub, rule: colors.rule, ink: colors.ink, edge: colors.edge },
    connectorLabel: config.connectorLabel,
  });
}
