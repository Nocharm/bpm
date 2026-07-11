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
};

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
  const paragraphs =
    buildCenteredParagraph(node.title, { bold: true }) +
    (hyperlinkRelId && node.url
      ? buildHyperlinkParagraph(node.urlLabel || node.url, hyperlinkRelId)
      : "");
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
  const layout = computeLayout(nodes);
  // 도형 id: 1은 docPr, 노드는 2부터
  const shapeIdOf = new Map(nodes.map((node, i) => [node.id, i + 2]));
  const hyperlinks: { relId: string; url: string }[] = [];
  const shapes: string[] = [];
  nodes.forEach((node, i) => {
    let relId: string | null = null;
    if (node.url) {
      relId = `rIdHl${hyperlinks.length + 1}`;
      hyperlinks.push({ relId, url: node.url });
    }
    shapes.push(buildNodeShape(node, i + 2, layout, relId));
  });
  void edges; // 연결선은 Task 2에서 shapes에 추가
  void shapeIdOf;
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
