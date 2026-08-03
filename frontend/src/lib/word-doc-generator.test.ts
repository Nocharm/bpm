// word-doc-generator 단위 테스트 — 원본 docx 픽스처를 넣고 출력 zip을 열어
// 책갈피 주입·순서도 추가·네임스페이스 보강·rels 병합을 문자열로 검증한다.
// @vitest-environment jsdom
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { generateCompleteWordDoc } from "@/lib/word-doc-generator";
import type { WordExportNode } from "@/lib/word-export";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const STYLES =
  `<?xml version="1.0"?><w:styles xmlns:w="${W_NS}">` +
  `<w:style w:type="paragraph" w:styleId="H1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>` +
  `</w:styles>`;

// 본문 제목 문단 — bookmark 없으면 파서가 합성 앵커(_bpmsecN)를 부여하는 주입 대상.
const heading = (title: string, bookmark?: string) =>
  `<w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr>` +
  (bookmark
    ? `<w:bookmarkStart w:id="5" w:name="${bookmark}"/><w:bookmarkEnd w:id="5"/>`
    : "") +
  `<w:r><w:t>${title}</w:t></w:r></w:p>`;

const SECT_PR = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';

const buildDocXml = (body: string) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:document xmlns:w="${W_NS}"><w:body>${body}${SECT_PR}</w:body></w:document>`;

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/></Types>';

const makeSourceDocx = (bodyXml: string, rels = RELS): Uint8Array =>
  zipSync({
    "word/document.xml": strToU8(buildDocXml(bodyXml)),
    "word/styles.xml": strToU8(STYLES),
    "word/_rels/document.xml.rels": strToU8(rels),
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
  });

async function unzipBlob(blob: Blob): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

const sectionNode = (anchor: string): WordExportNode => ({
  id: "s1", title: "6.1.1 검토", nodeType: "section",
  x: 0, y: 0, w: 113, h: 57, sectionAnchor: anchor,
});
const processNodeWithUrl: WordExportNode = {
  id: "p1", title: "접수", nodeType: "process",
  x: 200, y: 0, w: 172, h: 48, url: "https://example.com/x", urlLabel: "SOP",
};

describe("generateCompleteWordDoc — 합성 책갈피 주입", () => {
  it("_bpmsec 앵커를 쓰는 제목 문단 머리에 zero-length 책갈피를 주입한다", async () => {
    const src = makeSourceDocx(heading("Alpha"));
    const out = await unzipBlob(await generateCompleteWordDoc(src, [sectionNode("_bpmsec1")], []));
    const doc = out["word/document.xml"];
    const m = /<w:bookmarkStart w:id="(\d+)" w:name="_bpmsec1"\/>/.exec(doc);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(90000); // 신선한 id — 기존과 비충돌
    expect(doc).toContain(`<w:bookmarkEnd w:id="${m![1]}"/>`);
    // 제목 문단 안(스타일 뒤·런 앞)에 주입 — 원본 텍스트는 그대로.
    const headingP = doc.split("</w:p>").find((s) => s.includes("Alpha"));
    expect(headingP).toContain('w:name="_bpmsec1"');
    expect(headingP!.indexOf('w:name="_bpmsec1"')).toBeGreaterThan(headingP!.indexOf("pStyle"));
    expect(headingP!.indexOf('w:name="_bpmsec1"')).toBeLessThan(headingP!.indexOf("Alpha"));
  });

  it("실제 _Toc 책갈피가 있는 앵커에는 새로 주입하지 않는다", async () => {
    const src = makeSourceDocx(heading("Beta", "_Toc100"));
    const out = await unzipBlob(await generateCompleteWordDoc(src, [sectionNode("_Toc100")], []));
    // 원본의 책갈피 1개 그대로 — 순서도에는 bookmarkStart가 없다.
    expect(out["word/document.xml"].match(/<w:bookmarkStart /g)).toHaveLength(1);
  });

  it("매칭 제목이 없는 합성 앵커는 조용히 건너뛴다(문서 변경 케이스)", async () => {
    const src = makeSourceDocx(heading("Alpha"));
    const out = await unzipBlob(await generateCompleteWordDoc(src, [sectionNode("_bpmsec99")], []));
    const doc = out["word/document.xml"];
    // 책갈피 미주입(순서도 라벨의 w:anchor 링크 자체는 남는다 — dangling 허용)
    expect(doc).not.toContain('w:name="_bpmsec99"');
    expect(doc).not.toContain("<w:bookmarkStart");
    expect(doc).toContain("<w:drawing"); // 순서도 추가는 계속 진행
  });
});

describe("generateCompleteWordDoc — 순서도 페이지 추가", () => {
  it("페이지 나눔 + 순서도를 원본 내용 뒤·마지막 sectPr 앞에 넣는다", async () => {
    const src = makeSourceDocx(heading("Alpha"));
    const out = await unzipBlob(await generateCompleteWordDoc(src, [sectionNode("_bpmsec1")], []));
    const doc = out["word/document.xml"];
    const breakIdx = doc.search(/<w:br w:type="page"\/>/);
    const drawingIdx = doc.indexOf("<w:drawing");
    const sectPrIdx = doc.lastIndexOf("<w:sectPr");
    expect(breakIdx).toBeGreaterThan(doc.indexOf("Alpha")); // 원본 내용 뒤
    expect(drawingIdx).toBeGreaterThan(breakIdx);
    expect(sectPrIdx).toBeGreaterThan(drawingIdx); // 마지막 sectPr 앞
    expect(doc).toContain('prst="flowChartProcess"'); // 섹션 노드 도형
  });

  it("원본에 없던 드로잉 네임스페이스(wps 등)를 루트에 보강한다", async () => {
    const src = makeSourceDocx(heading("Alpha"));
    const out = await unzipBlob(await generateCompleteWordDoc(src, [sectionNode("_bpmsec1")], []));
    const root = /<w:document[^>]*>/.exec(out["word/document.xml"])![0];
    for (const [prefix, uri] of [
      ["r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"],
      ["wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"],
      ["a", "http://schemas.openxmlformats.org/drawingml/2006/main"],
      ["wps", "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"],
      ["wpg", "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"],
    ]) {
      expect(root).toContain(`xmlns:${prefix}="${uri}"`);
    }
  });

  it("스타일·Content_Types 등 다른 파트는 그대로 통과한다", async () => {
    const src = makeSourceDocx(heading("Alpha"));
    const out = await unzipBlob(await generateCompleteWordDoc(src, [sectionNode("_bpmsec1")], []));
    expect(out["word/styles.xml"]).toBe(STYLES);
    expect(out["[Content_Types].xml"]).toBe(CONTENT_TYPES);
  });
});

describe("generateCompleteWordDoc — rels 병합", () => {
  it("외부 url 노드의 하이퍼링크를 기존 rels에 External로 추가하고 기존 항목을 보존한다", async () => {
    const src = makeSourceDocx(heading("Alpha"));
    const out = await unzipBlob(
      await generateCompleteWordDoc(src, [sectionNode("_bpmsec1"), processNodeWithUrl], []),
    );
    const rels = out["word/_rels/document.xml.rels"];
    expect(rels).toContain('Id="rId1"'); // 기존 styles rel 보존
    expect(rels).toContain(
      '<Relationship Id="rIdHl1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/x" TargetMode="External"/>',
    );
    expect(out["word/document.xml"]).toContain('r:id="rIdHl1"');
  });

  it("relId가 기존 rels와 충돌하면 문단·rels 양쪽을 같은 새 id로 재명명한다", async () => {
    const relsWithClash =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdHl1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    const src = makeSourceDocx(heading("Alpha"), relsWithClash);
    const out = await unzipBlob(await generateCompleteWordDoc(src, [processNodeWithUrl], []));
    const rels = out["word/_rels/document.xml.rels"];
    const doc = out["word/document.xml"];
    expect(rels.match(/Id="rIdHl1"/g)).toHaveLength(1); // 충돌 id는 기존 것 하나뿐
    expect(rels).toContain('Id="rIdBpmHl1"');
    expect(rels).toContain('TargetMode="External"');
    expect(doc).toContain('r:id="rIdBpmHl1"');
    expect(doc).not.toContain('r:id="rIdHl1"');
  });
});
