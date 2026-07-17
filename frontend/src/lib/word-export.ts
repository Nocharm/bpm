// Word 도형 순서도 내보내기 — 노드/엣지를 Word 순정 도형(DrawingML)으로 담은 .docx 생성.
// OOXML 4파트를 직접 조립한다(docx 라이브러리는 도형 프리셋·연결선 미지원). zip은 fflate.
// 스타일: 흑백톤 + Arial/바탕체 11pt, 하이퍼링크만 Word 표준 파랑.
// spec: docs/superpowers/specs/2026-07-11-word-export-design.md

import { strToU8, zipSync } from "fflate";

import type { HandleSide, ProcessNodeType } from "@/lib/canvas";

export interface WordExportNode {
  id: string;
  title: string;
  nodeType: ProcessNodeType;
  x: number; // 캔버스 px (표시 좌표)
  y: number;
  w: number;
  h: number;
  url?: string;
  urlLabel?: string;
}

export interface WordExportEdge {
  sourceId: string;
  targetId: string;
  label?: string;
  sourceSide: HandleSide;
  targetSide: HandleSide;
}

const EMU_PER_PX = 9525;
const PAGE_W_EMU = 5_760_720; // A4 세로, 여백 2.5cm 제외 가용 폭 16.0cm
const PAGE_H_EMU = 8_892_540; // 가용 높이 24.7cm
const PADDING_PX = 20; // 노드 bounds 바깥 여백
const FONT_HALF_PT = "22"; // 11pt (half-point 단위)
const HYPERLINK_BLUE = "0563C1"; // Word 표준 하이퍼링크 색 — 흑백톤의 유일한 예외

const NODE_PRESET: Record<ProcessNodeType, string> = {
  process: "flowChartProcess",
  decision: "flowChartDecision",
  start: "flowChartTerminator",
  end: "flowChartTerminator",
  subprocess: "flowChartPredefinedProcess",
  // 자리표시자 — 섹션 노드는 Task E2 내보내기 게이팅에서 흐름도 도형 자체가 제외될 예정
  section: "flowChartProcess",
};

// 하이퍼링크 rels Target(xsd:anyURI)용 정규화 — 공백·한글이 든 URL을 raw로 넣으면
// Word가 문서 전체를 손상으로 거부할 수 있다. 스킴 없는 값 등 파싱 실패 시 null(링크 생략).
function normalizeHyperlinkUrl(url: string): string | null {
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 불허 제어문자 제거 (no-control-regex는 이 ESLint 설정에서 비활성 — disable 주석 불요)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// px→EMU 변환 — A4 가용 영역에 들어가게 축소만 하는 단일 배율(확대 안 함)
interface Layout {
  toX(px: number): number;
  toY(px: number): number;
  toLen(px: number): number;
  extW: number;
  extH: number;
}

function computeLayout(nodes: WordExportNode[]): Layout {
  const minX = Math.min(...nodes.map((n) => n.x)) - PADDING_PX;
  const minY = Math.min(...nodes.map((n) => n.y)) - PADDING_PX;
  const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + PADDING_PX;
  const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + PADDING_PX;
  const scale = Math.min(
    1,
    PAGE_W_EMU / ((maxX - minX) * EMU_PER_PX),
    PAGE_H_EMU / ((maxY - minY) * EMU_PER_PX),
  );
  const toEmu = (px: number) => Math.round(px * EMU_PER_PX * scale);
  return {
    toX: (px) => toEmu(px - minX),
    toY: (px) => toEmu(px - minY),
    toLen: (px) => Math.max(1, toEmu(px)),
    extW: toEmu(maxX - minX),
    extH: toEmu(maxY - minY),
  };
}

function buildRunProps(opts: { bold?: boolean; hyperlink?: boolean }): string {
  return (
    "<w:rPr>" +
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="바탕체" w:cs="Arial"/>' +
    (opts.bold ? "<w:b/>" : "") +
    (opts.hyperlink ? `<w:color w:val="${HYPERLINK_BLUE}"/><w:u w:val="single"/>` : "") +
    `<w:sz w:val="${FONT_HALF_PT}"/><w:szCs w:val="${FONT_HALF_PT}"/>` +
    "</w:rPr>"
  );
}

const CENTERED_P_PROPS = '<w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>';

function buildCenteredParagraph(text: string, opts: { bold?: boolean }): string {
  return (
    `<w:p>${CENTERED_P_PROPS}<w:r>${buildRunProps(opts)}` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function buildHyperlinkParagraph(text: string, relId: string): string {
  return (
    `<w:p>${CENTERED_P_PROPS}<w:hyperlink r:id="${relId}">` +
    `<w:r>${buildRunProps({ hyperlink: true })}` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:hyperlink></w:p>`
  );
}

// 노드 1개 → wps 도형. hyperlinkRelId가 있으면 2행째에 URL 라벨 하이퍼링크.
function buildNodeShape(
  node: WordExportNode,
  shapeId: number,
  layout: Layout,
  hyperlinkRelId: string | null,
): string {
  const urlLine = node.url
    ? hyperlinkRelId
      ? buildHyperlinkParagraph(node.urlLabel || node.url, hyperlinkRelId)
      : buildCenteredParagraph(node.urlLabel || node.url, {}) // 정규화 실패 URL — 링크 없이 일반 텍스트
    : "";
  const paragraphs = buildCenteredParagraph(node.title, { bold: true }) + urlLine;
  return (
    "<wps:wsp>" +
    `<wps:cNvPr id="${shapeId}" name="${escapeXml(node.title)}"/>` +
    "<wps:cNvSpPr/>" +
    "<wps:spPr>" +
    `<a:xfrm><a:off x="${layout.toX(node.x)}" y="${layout.toY(node.y)}"/>` +
    `<a:ext cx="${layout.toLen(node.w)}" cy="${layout.toLen(node.h)}"/></a:xfrm>` +
    `<a:prstGeom prst="${NODE_PRESET[node.nodeType]}"><a:avLst/></a:prstGeom>` +
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
    '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
    "</wps:spPr>" +
    `<wps:txbx><w:txbxContent>${paragraphs}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="18288" tIns="9144" rIns="18288" bIns="9144" anchor="ctr">' +
    "<a:normAutofit/></wps:bodyPr>" +
    "</wps:wsp>"
  );
}

// 프리셋 4접점(cxnLst) 인덱스 — flowChart류 프리셋은 top/left/bottom/right 순.
// ⚠️ 실제 Word에서 접점 위치는 Task 4 수동 검증으로 확인한다(스펙 §4 — 구현 시 실측 확정).
const SIDE_TO_CXN_IDX: Record<HandleSide, number> = { top: 0, left: 1, bottom: 2, right: 3 };

// 노드 변의 중앙점 (캔버스 px)
function getSideAnchor(node: WordExportNode, side: HandleSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: node.x + node.w / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.w / 2, y: node.y + node.h };
    case "left":
      return { x: node.x, y: node.y + node.h / 2 };
    case "right":
      return { x: node.x + node.w, y: node.y + node.h / 2 };
  }
}

// 엣지 1개 → 꺾인 연결선. 접점 연결로 Word에서 도형을 움직여도 선이 따라온다.
function buildConnectorShape(
  edge: WordExportEdge,
  shapeId: number,
  sourceNode: WordExportNode,
  targetNode: WordExportNode,
  sourceShapeId: number,
  targetShapeId: number,
  layout: Layout,
): string {
  const start = getSideAnchor(sourceNode, edge.sourceSide);
  const end = getSideAnchor(targetNode, edge.targetSide);
  const flipH = end.x < start.x;
  const flipV = end.y < start.y;
  const off = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
  const ext = { w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
  return (
    "<wps:wsp>" +
    `<wps:cNvPr id="${shapeId}" name="edge-${shapeId}"/>` +
    "<wps:cNvCnPr>" +
    `<a:stCxn id="${sourceShapeId}" idx="${SIDE_TO_CXN_IDX[edge.sourceSide]}"/>` +
    `<a:endCxn id="${targetShapeId}" idx="${SIDE_TO_CXN_IDX[edge.targetSide]}"/>` +
    "</wps:cNvCnPr>" +
    "<wps:spPr>" +
    `<a:xfrm${flipH ? ' flipH="1"' : ""}${flipV ? ' flipV="1"' : ""}>` +
    `<a:off x="${layout.toX(off.x)}" y="${layout.toY(off.y)}"/>` +
    `<a:ext cx="${layout.toLen(ext.w)}" cy="${layout.toLen(ext.h)}"/></a:xfrm>` +
    '<a:prstGeom prst="bentConnector3"><a:avLst/></a:prstGeom>' +
    "<a:noFill/>" +
    '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill>' +
    '<a:tailEnd type="triangle"/></a:ln>' +
    "</wps:spPr><wps:bodyPr/></wps:wsp>"
  );
}

const EDGE_LABEL_CHAR_PX = 14; // 11pt 한글 폭 어림 — 라벨 박스 크기 산정용
const EDGE_LABEL_H_PX = 24;

// 좌상단 경계 노드 + 긴 라벨은 mid 계산이 음수 off를 낼 수 있다 — 그룹 chExt(groupExt) 안에 들어오게 클램프.
function clampOffset(value: number, boxSize: number, groupExt: number): number {
  const maxOff = Math.max(0, groupExt - boxSize);
  return Math.min(Math.max(value, 0), maxOff);
}

// 분기 라벨 — 연결선 중점 위 무테두리 텍스트박스(흰 배경으로 선을 가림)
function buildEdgeLabelShape(
  label: string,
  shapeId: number,
  sourceNode: WordExportNode,
  targetNode: WordExportNode,
  edge: WordExportEdge,
  layout: Layout,
): string {
  const start = getSideAnchor(sourceNode, edge.sourceSide);
  const end = getSideAnchor(targetNode, edge.targetSide);
  const w = Math.max(30, label.length * EDGE_LABEL_CHAR_PX);
  const mid = {
    x: (start.x + end.x) / 2 - w / 2,
    y: (start.y + end.y) / 2 - EDGE_LABEL_H_PX / 2,
  };
  const boxW = layout.toLen(w);
  const boxH = layout.toLen(EDGE_LABEL_H_PX);
  const offX = clampOffset(layout.toX(mid.x), boxW, layout.extW);
  const offY = clampOffset(layout.toY(mid.y), boxH, layout.extH);
  return (
    "<wps:wsp>" +
    `<wps:cNvPr id="${shapeId}" name="label-${shapeId}"/>` +
    "<wps:cNvSpPr/>" +
    "<wps:spPr>" +
    `<a:xfrm><a:off x="${offX}" y="${offY}"/>` +
    `<a:ext cx="${boxW}" cy="${boxH}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
    "<a:ln><a:noFill/></a:ln>" +
    "</wps:spPr>" +
    `<wps:txbx><w:txbxContent>${buildCenteredParagraph(label, {})}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>' +
    "</wps:wsp>"
  );
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

function buildDocumentRelsXml(hyperlinks: { relId: string; url: string }[]): string {
  const rels = hyperlinks
    .map(
      ({ relId, url }) =>
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(url)}" TargetMode="External"/>`,
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  );
}

function buildDocumentXml(shapesXml: string, extW: number, extH: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"' +
    ' xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    "<w:body><w:p><w:r><w:drawing>" +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${extW}" cy="${extH}"/>` +
    '<wp:docPr id="1" name="ProcessMap"/>' +
    "<a:graphic>" +
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    "<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>" +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${extW}" cy="${extH}"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="${extW}" cy="${extH}"/></a:xfrm>` +
    "<a:noFill/></wpg:grpSpPr>" +
    shapesXml +
    "</wpg:wgp></a:graphicData></a:graphic></wp:inline>" +
    "</w:drawing></w:r></w:p>" +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
    "</w:sectPr></w:body></w:document>"
  );
}

/** 노드/엣지를 Word 도형 순서도 docx Blob으로 만든다 (순수 — DOM 불의존). */
export function buildDocx(nodes: WordExportNode[], edges: WordExportEdge[]): Blob {
  if (nodes.length === 0) {
    throw new Error("buildDocx: nodes must not be empty");
  }
  const layout = computeLayout(nodes);
  // 도형 id: 1은 docPr, 노드는 2부터
  const shapeIdOf = new Map(nodes.map((node, i) => [node.id, i + 2]));
  const hyperlinks: { relId: string; url: string }[] = [];
  const shapes: string[] = [];
  nodes.forEach((node, i) => {
    let relId: string | null = null;
    const normalizedUrl = node.url ? normalizeHyperlinkUrl(node.url) : null;
    if (normalizedUrl) {
      relId = `rIdHl${hyperlinks.length + 1}`;
      hyperlinks.push({ relId, url: normalizedUrl });
    }
    shapes.push(buildNodeShape(node, i + 2, layout, relId));
  });
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  let nextShapeId = nodes.length + 2;
  for (const edge of edges) {
    const sourceNode = nodeOf.get(edge.sourceId);
    const targetNode = nodeOf.get(edge.targetId);
    if (!sourceNode || !targetNode) {
      continue; // 없는 노드 참조 — 저장 데이터 이상, 도형만 건너뛴다
    }
    const sourceShapeId = shapeIdOf.get(edge.sourceId);
    const targetShapeId = shapeIdOf.get(edge.targetId);
    if (sourceShapeId === undefined || targetShapeId === undefined) {
      continue;
    }
    shapes.push(
      buildConnectorShape(edge, nextShapeId++, sourceNode, targetNode, sourceShapeId, targetShapeId, layout),
    );
    if (edge.label) {
      shapes.push(buildEdgeLabelShape(edge.label, nextShapeId++, sourceNode, targetNode, edge, layout));
    }
  }
  const documentXml = buildDocumentXml(shapes.join(""), layout.extW, layout.extH);
  const zipped = zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES_XML),
    "_rels/.rels": strToU8(ROOT_RELS_XML),
    "word/document.xml": strToU8(documentXml),
    "word/_rels/document.xml.rels": strToU8(buildDocumentRelsXml(hyperlinks)),
  });
  return new Blob([zipped], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/** 현재 화면 노드/엣지를 Word 도형 순서도(.docx) 파일로 저장한다. 노드 0개면 no-op. */
export function exportCanvasWord(
  nodes: WordExportNode[],
  edges: WordExportEdge[],
  fileName: string,
): void {
  if (nodes.length === 0) {
    return;
  }
  const blob = buildDocx(nodes, edges);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
