// 캔버스 PNG 내보내기 — React Flow 공식 권장 방식(html-to-image) (spec §7 Phase B).
// html-to-image는 HTML 요소의 computed style은 인라인하지만 SVG 하위 요소는 DOM 그대로 복제한다 —
// 스타일시트/CSS 변수 의존 엣지 stroke가 클론에서 소실되므로, 캡처 직전 엣지·화살촉에
// 인라인 스타일(검은 실선)을 직접 심고 캡처 후 원복한다.
// 캡처는 투명 배경으로 받아 캔버스에 합성한다 — 앱 캔버스 톤(bg-canvas)+dot-grid 배경과
// 좌하단 맵 정보 카드(이름·부서·오너·버전·게시일·프레임워크)를 그린 뒤 저장.
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

/** PNG 좌하단 정보 카드 — 라벨/값 조립(i18n)은 호출측 책임. */
export interface ExportMapInfo {
  title: string;
  rows: { label: string; value: string }[];
}

interface Frame {
  width: number;
  height: number;
  x: number;
  y: number;
  zoom: number;
}

// 엣지·화살촉 인라인 보정 — 되돌리기 클로저 반환. 히트박스(edge-interaction)는 투명 유지.
// dark(L5 새벽 조감도) 캡처는 엣지 색을 라이트 톤으로 스왑 — 어두운 배경 위 검정 실선은 안 보인다.
function applyEdgeFixups(viewport: HTMLElement, dark: boolean): () => void {
  const edgeStroke = dark ? EDGE_STROKE_DARK : EDGE_STROKE;
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
    setImportant(path, "stroke-width", EDGE_STROKE_WIDTH);
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
  // SP "최신본 따르는 중"은 화면 전용 상태 표시(정상 상태 안내) — 출력물엔 불필요.
  // display:none이라 노드 높이도 그만큼 줄어든다 (사용자 요청 2026-08-31)
  for (const banner of viewport.querySelectorAll('[data-id="sp-banner-following"]')) {
    setImportant(banner, "display", "none");
  }
  return () => {
    for (const undo of undos) undo();
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

// 캡처 이미지 아래에 정보 카드 스트립을 붙여 합성 — 배경(캔버스 톤+dot-grid)은 전체에 깐다.
// dark(L5 새벽 조감도)면 남색→차콜 그라데이션으로 대체하고 dot-grid는 생략(화면과 동일 — 무늬 없는 민 무대).
async function composePng(
  dataUrl: string,
  frame: Frame,
  info: ExportMapInfo | undefined,
  dark: boolean,
): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("export image decode failed"));
    image.src = dataUrl;
  });

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
async function downloadViewportPng(
  viewport: HTMLElement,
  fileName: string,
  frame: Frame,
  info: ExportMapInfo | undefined,
  dark: boolean,
): Promise<void> {
  const undoFixups = applyEdgeFixups(viewport, dark);
  let dataUrl: string;
  try {
    dataUrl = await toPng(viewport, {
      pixelRatio: PIXEL_RATIO,
      width: frame.width,
      height: frame.height,
      style: {
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        transform: `translate(${frame.x}px, ${frame.y}px) scale(${frame.zoom})`,
      },
    });
  } finally {
    undoFixups();
  }
  const composed = await composePng(dataUrl, frame, info, dark);
  const link = document.createElement("a");
  link.href = composed;
  link.download = fileName;
  link.click();
}

/** 전체 노드 bounds 기준으로 현재 캔버스를 PNG 파일로 저장한다.
 *  dark=true면 L5 새벽 조감도 톤(남색→차콜)으로 배경·엣지 색을 맞춘다(캔버스가 그 상태로 보일 때만 전달). */
export async function exportCanvasPng(
  nodes: Node[],
  fileName: string,
  info?: ExportMapInfo,
  dark?: boolean,
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport || nodes.length === 0) {
    return;
  }
  const bounds = getNodesBounds(nodes);
  const width = Math.min(
    Math.max(Math.ceil(bounds.width) + PADDING_PX * 2, MIN_SIZE_PX),
    MAX_SIZE_PX,
  );
  const height = Math.min(
    Math.max(Math.ceil(bounds.height) + PADDING_PX * 2, MIN_SIZE_PX),
    MAX_SIZE_PX,
  );
  const transform = getViewportForBounds(bounds, width, height, 0.2, 2, 0.1);
  await downloadViewportPng(
    viewport,
    fileName,
    { width, height, x: transform.x, y: transform.y, zoom: transform.zoom },
    info,
    dark ?? false,
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
