// 완결 Word 문서 생성 — 원본 SOP .docx 사본에 (a) 합성 섹션 책갈피(_bpmsecN) 주입,
// (b) 순서도를 새 페이지로 말미에 추가한다. 원본 내용은 삭제·수정하지 않는다(빈 책갈피
// 마커 추가 + 페이지 추가만 — Word가 상호참조 삽입 시 하는 것과 동일한 무해 수술).
// 배경: 3단계+ 제목은 TOC 밖이라 _Toc 책갈피가 없음 → 파서(word-import)가 부여한 합성
// 앵커를 실제 책갈피로 실체화해야 섹션 노드의 내부 하이퍼링크가 열린다.

import { W, attr, buildStyleLevels, collectHeadings } from "@/lib/word-import";
import {
  DRAWING_NAMESPACES,
  buildFlowchartDrawing,
  buildHyperlinkRelXml,
  type WordExportEdge,
  type WordExportNode,
} from "@/lib/word-export";

const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const RELS_PATH = "word/_rels/document.xml.rels";
const EMPTY_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
const PAGE_BREAK_P = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const INJECTED_BOOKMARK_ID_FLOOR = 90000; // 주입 책갈피 id 시작값 — 실문서 id와 확실히 분리

// 제목 <w:p> 직계 자식 pPr — getElementsByTagName은 중첩(txbx 등)을 집을 수 있어 직계만 본다.
function findDirectChildPPr(p: Element): Element | null {
  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType === 1 && (child as Element).localName === "pPr" &&
        (child as Element).namespaceURI === W) {
      return child as Element;
    }
  }
  return null;
}

function findMaxBookmarkId(doc: Document): number {
  let max = 0;
  for (const b of Array.from(doc.getElementsByTagNameNS(W, "bookmarkStart"))) {
    const id = Number(attr(b, "id"));
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

// 노드가 실제로 쓰는 합성 앵커(_bpmsecN)만 골라, 대응 제목 문단 머리(빈 범위)에 책갈피를 주입.
// 실제 _Toc/이름 책갈피는 이미 존재하므로 건너뛰고, 매칭 제목이 없는 앵커(문서 변경)는 조용히 스킵.
function injectSyntheticBookmarks(
  doc: Document,
  styleLevels: Map<string, number>,
  nodes: WordExportNode[],
): void {
  const wanted = new Set(
    nodes
      .map((node) => node.sectionAnchor)
      .filter((anchor): anchor is string => !!anchor && anchor.startsWith("_bpmsec")),
  );
  if (wanted.size === 0) return;
  let nextId = Math.max(INJECTED_BOOKMARK_ID_FLOOR, findMaxBookmarkId(doc) + 1);
  for (const hit of collectHeadings(doc, styleLevels)) {
    if (!wanted.has(hit.anchor)) continue;
    const start = doc.createElementNS(W, "w:bookmarkStart");
    start.setAttributeNS(W, "w:id", String(nextId));
    start.setAttributeNS(W, "w:name", hit.anchor);
    const end = doc.createElementNS(W, "w:bookmarkEnd");
    end.setAttributeNS(W, "w:id", String(nextId));
    nextId += 1;
    const pPr = findDirectChildPPr(hit.element);
    // pPr 바로 뒤(없으면 문단 첫 자식) — 런 앞의 zero-length 책갈피라 텍스트·서식·넘버링 불변.
    hit.element.insertBefore(start, pPr ? pPr.nextSibling : hit.element.firstChild);
    hit.element.insertBefore(end, start.nextSibling);
  }
}

// 순서도 DrawingML이 참조하는 네임스페이스를 루트 <w:document>에 보강(없는 것만).
function ensureDrawingNamespaces(doc: Document): void {
  const root = doc.documentElement;
  for (const [prefix, uri] of DRAWING_NAMESPACES) {
    if (!root.hasAttribute(`xmlns:${prefix}`)) {
      root.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, uri);
    }
  }
}

// 원본에 이미 그림이 있으면 wp:docPr id=1이 충돌(문서 전역 유일해야 함) — 최댓값+1로 재부여.
function remapDocPrId(paragraphXml: string, originalDocumentXml: string): string {
  const ids = Array.from(
    originalDocumentXml.matchAll(/<wp:docPr [^>]*\bid="(\d+)"/g),
    (m) => Number(m[1]),
  );
  if (ids.length === 0) return paragraphXml;
  const nextId = Math.max(...ids) + 1;
  return paragraphXml.replace(
    '<wp:docPr id="1" name="ProcessMap"/>',
    `<wp:docPr id="${nextId}" name="ProcessMap"/>`,
  );
}

// 순서도 하이퍼링크를 기존 rels에 병합 — relId 충돌 시 문단·rels 양쪽을 같은 새 id로 재명명.
function mergeHyperlinkRels(
  relsText: string,
  paragraphXml: string,
  hyperlinks: { relId: string; url: string }[],
): { relsText: string; paragraphXml: string } {
  if (hyperlinks.length === 0) return { relsText, paragraphXml };
  if (!relsText.includes("</Relationships>")) {
    throw new Error("generateCompleteWordDoc: malformed document.xml.rels (no </Relationships>)");
  }
  const existingIds = new Set(Array.from(relsText.matchAll(/Id="([^"]+)"/g), (m) => m[1]));
  let remapSeq = 1;
  let outParagraph = paragraphXml;
  const entries: string[] = [];
  for (const { relId, url } of hyperlinks) {
    let finalId = relId;
    while (existingIds.has(finalId)) finalId = `rIdBpmHl${remapSeq++}`;
    existingIds.add(finalId);
    if (finalId !== relId) {
      // r:id="…" 전체(따옴표 포함)를 치환 — rIdHl1 vs rIdHl10 부분 일치 없음.
      outParagraph = outParagraph.replaceAll(`r:id="${relId}"`, `r:id="${finalId}"`);
    }
    entries.push(buildHyperlinkRelXml(finalId, url));
  }
  return {
    relsText: relsText.replace("</Relationships>", `${entries.join("")}</Relationships>`),
    paragraphXml: outParagraph,
  };
}

// 페이지 나눔 + 순서도 문단을 body 마지막 직계 sectPr 앞(없으면 body 끝)에 DOM으로 삽입.
function appendFlowchartPage(doc: Document, paragraphXml: string): void {
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) {
    throw new Error("generateCompleteWordDoc: w:body not found in document.xml");
  }
  const wrapperXml =
    `<wrap xmlns:w="${W}"` +
    DRAWING_NAMESPACES.map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join("") +
    `>${PAGE_BREAK_P}${paragraphXml}</wrap>`;
  const parsed = new DOMParser().parseFromString(wrapperXml, "application/xml");
  let lastSectPr: Node | null = null;
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType === 1 && (child as Element).localName === "sectPr" &&
        (child as Element).namespaceURI === W) {
      lastSectPr = child;
    }
  }
  for (const child of Array.from(parsed.documentElement.childNodes)) {
    body.insertBefore(doc.importNode(child, true), lastSectPr);
  }
}

/**
 * 원본 SOP .docx + 캔버스 노드/엣지 → 완결 문서 Blob.
 * 합성 앵커(_bpmsecN) 책갈피를 주입해 섹션 링크를 실체화하고, 순서도를 새 페이지로 덧붙인다.
 * document.xml·rels 외 파트(스타일·넘버링·미디어…)는 그대로 통과.
 */
export async function generateCompleteWordDoc(
  originalDocx: Uint8Array,
  nodes: WordExportNode[],
  edges: WordExportEdge[],
): Promise<Blob> {
  const { unzipSync, strFromU8, zipSync, strToU8 } = await import("fflate");
  const files = unzipSync(originalDocx);
  const docPart = files["word/document.xml"];
  if (!docPart) {
    throw new Error("generateCompleteWordDoc: word/document.xml not found in source docx");
  }
  const documentXmlText = strFromU8(docPart).replace(/^\uFEFF/, ""); // BOM은 DOMParser를 깨뜨림
  const doc = new DOMParser().parseFromString(documentXmlText, "application/xml");
  const stylesPart = files["word/styles.xml"];
  const styleLevels = stylesPart
    ? buildStyleLevels(strFromU8(stylesPart))
    : new Map<string, number>();

  // 순서도 문단이 붙기 전에 주입 — 걷기 대상 문단 집합이 파서(word-import) 시점과 동일해야
  // 합성 앵커 순번이 어긋나지 않는다.
  injectSyntheticBookmarks(doc, styleLevels, nodes);

  // fitToPage=false — Word 맵 완결문서는 도형을 정확히 1.5×3cm로(축소 없음).
  const { paragraphXml: rawParagraphXml, hyperlinks } = buildFlowchartDrawing(nodes, edges, false);
  const originalRelsText = files[RELS_PATH] ? strFromU8(files[RELS_PATH]) : EMPTY_RELS_XML;
  const merged = mergeHyperlinkRels(originalRelsText, rawParagraphXml, hyperlinks);
  const paragraphXml = remapDocPrId(merged.paragraphXml, documentXmlText);

  ensureDrawingNamespaces(doc);
  appendFlowchartPage(doc, paragraphXml);

  // XMLSerializer는 XML 선언을 안 붙인다 — 원본 선언(있으면 그대로)을 앞에 복원.
  const xmlDecl =
    documentXmlText.match(/^<\?xml[^?]*\?>/)?.[0] ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const serialized = new XMLSerializer().serializeToString(doc);
  const newDocumentXml = serialized.startsWith("<?xml") ? serialized : xmlDecl + serialized;

  files["word/document.xml"] = strToU8(newDocumentXml);
  files[RELS_PATH] = strToU8(merged.relsText);
  const zipped = zipSync(files);
  return new Blob([zipped], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
