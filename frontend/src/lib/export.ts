// 캔버스 PNG 내보내기 — React Flow 공식 권장 방식(html-to-image) (spec §7 Phase B).
// html-to-image는 HTML 요소의 computed style은 인라인하지만 SVG 하위 요소는 DOM 그대로 복제한다 —
// 스타일시트/CSS 변수 의존 엣지 stroke가 클론에서 소실되므로, 캡처 직전 엣지·화살촉에
// 인라인 스타일(검은 실선)을 직접 심고 캡처 후 원복한다.
// 캡처는 투명 배경으로 받아 캔버스에 합성한다 — 앱 캔버스 톤(bg-canvas)+dot-grid 배경과
// 좌하단 맵 정보 카드(이름·부서·오너·버전·게시일·프레임워크)를 그린 뒤 저장.
// Word 문서용 테마(word 옵션)는 캡처 동안 뷰포트에 .bpm-export-word 클래스를 붙여 노드·라벨·글꼴을 문서 톤으로
// 덮고(globals.css 토큰), 흰 배경 위 상단 정보 블록·병렬 범례를 합성한다.
// 색상은 출력물이라 raw hex 허용(design.md §1).

import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng } from "html-to-image";

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
const WORD_TITLE_FONT = `700 15px ${WORD_FONT_FAMILY}`;
const WORD_META_FONT = `400 11px ${WORD_FONT_FAMILY}`;
const WORD_LEGEND_FONT = `400 11px ${WORD_FONT_FAMILY}`;
const WORD_MARGIN = 20; // 머리 블록·범례의 좌우 여백
const WORD_HEADER_TOP = 16;
const WORD_TITLE_LINE_H = 22;
const WORD_META_LINE_H = 16;
const WORD_RULE_H = 2; // 머리 블록 아래 강조선 두께
const WORD_HEADER_GAP = 10; // 강조선-그림 간격
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
}

/** Word 모드 실행 인자 — 옵션 + 호출측이 번역한 범례 문구. */
export interface WordExportConfig {
  style: WordExportStyle;
  showParallel: boolean;
  showInfo: boolean;
  crossing: CrossingStyle;
  paper: PaperOrientation;
  printWidthPct: number;
  parallelLabel: string;
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

/** 머리 블록 높이 추정(메타 한 줄) — 인쇄 계획의 세로 크기용. 실제 합성은 메타 줄 수만큼 정확히 잰다. */
function estimateWordHeaderHeight(showInfo: boolean): number {
  return showInfo ? WORD_HEADER_TOP + WORD_TITLE_LINE_H + WORD_META_LINE_H + 6 + WORD_RULE_H + WORD_HEADER_GAP : 0;
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

export function getPrintPlan(
  frame: Pick<ExportFrame, "width" | "height" | "zoom">,
  options: Pick<PngExportOptions, "paper" | "printWidthPct" | "showInfo">,
): PrintPlan {
  const pageWidthCm = options.paper === "portrait" ? A4_SHORT_CM : A4_LONG_CM;
  const contentWidthCm = pageWidthCm - WORD_PAGE_MARGIN_CM * 2;
  const widthCm = (contentWidthCm * options.printWidthPct) / 100;
  const cssHeight = frame.height + estimateWordHeaderHeight(options.showInfo);
  const widthInch = widthCm / CM_PER_INCH;
  // 300dpi에 닿는 배율 — 최소 2(현행), 최대 4, 긴 변이 상한을 넘지 않게
  const wanted = Math.ceil((TARGET_DPI * widthInch) / frame.width);
  const sideCap = Math.floor(MAX_OUTPUT_SIDE_PX / Math.max(frame.width, cssHeight));
  const pixelRatio = Math.max(1, Math.min(MAX_PIXEL_RATIO, Math.max(PIXEL_RATIO, wanted), sideCap));
  const pixelWidth = frame.width * pixelRatio;
  return {
    contentWidthCm,
    widthCm,
    heightCm: (widthCm * cssHeight) / frame.width,
    pixelRatio,
    pixelWidth,
    pixelHeight: cssHeight * pixelRatio,
    dpi: pixelWidth / widthInch,
    nodeTextPt: (NODE_TITLE_PX * frame.zoom * widthInch * PT_PER_INCH) / frame.width,
  };
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
function applyEdgeFixups(
  viewport: HTMLElement,
  dark: boolean,
  word: { palette: WordPalette; showParallel: boolean; crossing: CrossingStyle } | null,
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
  for (const path of viewport.querySelectorAll(".react-flow__edge-path")) {
    setImportant(path, "stroke", edgeStroke);
    setImportant(path, "stroke-width", edgeStrokeWidth);
    setImportant(path, "stroke-dasharray", "none"); // animated 점선도 출력에선 실선
  }
  for (const hit of viewport.querySelectorAll(".react-flow__edge-interaction")) {
    setImportant(hit, "stroke", "none"); // 히트박스는 지금처럼 안 보이게
  }
  for (const head of viewport.querySelectorAll(".react-flow__arrowhead *")) {
    // marker 색은 var() 참조 — 클론에서 해석 불가라 엣지와 같은 색으로 고정
    setImportant(head, "stroke", edgeStroke);
    setImportant(head, "fill", edgeStroke);
  }
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
  for (const dot of viewport.querySelectorAll(".bpm-edge-pulse-still")) {
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
    const edgePaths = Array.from(viewport.querySelectorAll<SVGPathElement>(".react-flow__edge-path"));
    const layer = drawCrossings(edgePaths, word.crossing, edgeStroke);
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

// Word 문서용 합성 — 흰 바탕, (선택) 상단 머리 블록(제목 + 메타 줄 + 강조선), 그림, (병렬 표시가 있으면) 우하단 범례.
// 범례는 그림 여백(PADDING_PX) 안에 얹어 높이를 늘리지 않는다.
async function composeWordPng(
  dataUrl: string,
  frame: ExportFrame,
  info: ExportMapInfo | undefined,
  word: WordExportConfig,
  palette: WordPalette,
  parallelMarks: number,
  pixelRatio: number,
): Promise<string> {
  const image = await decodeImage(dataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  const innerWidth = frame.width - WORD_MARGIN * 2;
  const header = word.showInfo && info ? info : null;
  let metaLines: string[] = [];
  let headerHeight = 0;
  if (header) {
    ctx.font = WORD_META_FONT;
    metaLines = wrapMetaSegments(
      ctx,
      header.rows.map((row) => `${row.label} ${row.value}`),
      innerWidth,
    );
    headerHeight =
      WORD_HEADER_TOP + WORD_TITLE_LINE_H + metaLines.length * WORD_META_LINE_H + 6 + WORD_RULE_H + WORD_HEADER_GAP;
  }

  canvas.width = frame.width * pixelRatio;
  canvas.height = (frame.height + headerHeight) * pixelRatio;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, frame.width, frame.height + headerHeight);

  if (header) {
    ctx.textBaseline = "middle";
    ctx.font = WORD_TITLE_FONT;
    ctx.fillStyle = palette.accent;
    let y = WORD_HEADER_TOP + WORD_TITLE_LINE_H / 2;
    ctx.fillText(truncateToWidth(ctx, header.title, innerWidth), WORD_MARGIN, y);
    ctx.font = WORD_META_FONT;
    ctx.fillStyle = palette.meta;
    y += WORD_TITLE_LINE_H / 2 + WORD_META_LINE_H / 2;
    for (const line of metaLines) {
      ctx.fillText(line, WORD_MARGIN, y);
      y += WORD_META_LINE_H;
    }
    ctx.fillStyle = palette.accent;
    ctx.fillRect(WORD_MARGIN, headerHeight - WORD_HEADER_GAP - WORD_RULE_H, innerWidth, WORD_RULE_H);
  }
  ctx.drawImage(image, 0, headerHeight, frame.width, frame.height);

  if (parallelMarks > 0) {
    ctx.font = WORD_LEGEND_FONT;
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(word.parallelLabel).width;
    const y = headerHeight + frame.height - 18;
    const textX = frame.width - WORD_MARGIN - textWidth;
    const lineEnd = textX - 6;
    const lineStart = lineEnd - 22;
    const barX = (lineStart + lineEnd) / 2;
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = Number(WORD_EDGE_STROKE_WIDTH);
    ctx.beginPath();
    ctx.moveTo(lineStart, y);
    ctx.lineTo(lineEnd, y);
    for (const shift of [-PARALLEL_MARK_GAP, PARALLEL_MARK_GAP]) {
      ctx.moveTo(barX + shift, y - PARALLEL_MARK_HALF);
      ctx.lineTo(barX + shift, y + PARALLEL_MARK_HALF);
    }
    ctx.stroke();
    ctx.fillStyle = palette.ink;
    ctx.fillText(word.parallelLabel, textX, y);
  }

  return canvas.toDataURL("image/png");
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
  const wordClasses = word ? ["bpm-export-word", `bpm-export-word--${word.style}`] : [];
  const plan = word ? getPrintPlan(frame, { ...word }) : null;
  const pixelRatio = plan?.pixelRatio ?? PIXEL_RATIO;
  viewport.classList.add(...wordClasses);
  const palette = word ? readWordPalette(viewport) : null;
  let fixups: FixupResult | null = null;
  let dataUrl: string;
  try {
    fixups = applyEdgeFixups(
      viewport,
      dark,
      word && palette ? { palette, showParallel: word.showParallel, crossing: word.crossing } : null,
    );
    dataUrl = await toPng(viewport, {
      pixelRatio,
      width: frame.width,
      height: frame.height,
      style: {
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        transform: `translate(${frame.x}px, ${frame.y}px) scale(${frame.zoom})`,
      },
    });
  } finally {
    fixups?.undo();
    viewport.classList.remove(...wordClasses);
  }
  const link = document.createElement("a");
  link.download = fileName;
  if (!word || !palette || !plan) {
    link.href = await composePng(dataUrl, frame, info, dark);
    link.click();
    return;
  }
  const composed = await composeWordPng(dataUrl, frame, info, word, palette, fixups?.parallelMarks ?? 0, pixelRatio);
  // 인쇄 dpi를 실어 Word가 고른 너비로 삽입하게 한다
  const bytes = setPngDpi(decodeDataUrl(composed), plan.dpi);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "image/png" }));
  link.href = url;
  link.click();
  // 다운로드가 URL을 잡은 뒤 회수
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 전체 노드 bounds 기준으로 현재 캔버스를 PNG 파일로 저장한다.
 *  dark=true면 L5 새벽 조감도 톤(남색→차콜)으로 배경·엣지 색을 맞춘다(캔버스가 그 상태로 보일 때만 전달).
 *  word를 주면 Word 문서용 테마로 찍는다(dark 무시 — 문서는 항상 흰 바탕). */
export async function exportCanvasPng(
  nodes: Node[],
  fileName: string,
  info?: ExportMapInfo,
  dark?: boolean,
  word?: WordExportConfig,
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
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

/** 고정 프레임(비교 화면 등) PNG 저장 — 호출측 캔버스의 viewport를 지정 크기로 맞춰 캡처. */
export async function exportFramedPng(
  nodes: Node[],
  fileName: string,
  options: { width: number; height: number; minZoom: number },
  info?: ExportMapInfo,
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport || nodes.length === 0) {
    return;
  }
  const { width, height, minZoom } = options;
  const bounds = getNodesBounds(nodes);
  // minZoom으로도 지정 프레임에 안 들어가는 큰 맵은 프레임을 키워 잘림 방지(우측 끝 노드 잘림 픽스).
  // 1.25 = getViewportForBounds 패딩(0.1)보다 넉넉한 여유율. MAX_SIZE_PX 상한은 비율 유지 축소.
  let frameWidth = width;
  let frameHeight = height;
  const neededWidth = bounds.width * minZoom * 1.25;
  const neededHeight = bounds.height * minZoom * 1.25;
  if (neededWidth > frameWidth || neededHeight > frameHeight) {
    const shrink = Math.min(MAX_SIZE_PX / neededWidth, MAX_SIZE_PX / neededHeight, 1);
    frameWidth = Math.max(frameWidth, Math.ceil(neededWidth * shrink));
    frameHeight = Math.max(frameHeight, Math.ceil(neededHeight * shrink));
  }
  // zoom 하한을 낮춰 전달 — 프레임을 키웠으니 fit 줌이 항상 하한 위에서 잡히고, MAX 상한에
  // 눌린 초대형 맵도 fit이 이겨 잘리지 않는다.
  const transform = getViewportForBounds(bounds, frameWidth, frameHeight, 0.05, 2, 0.1);
  await downloadViewportPng(
    viewport,
    fileName,
    { width: frameWidth, height: frameHeight, x: transform.x, y: transform.y, zoom: transform.zoom },
    info,
    false,
  );
}
