// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseWordSections } from "./word-import";

// 커스텀 제목 스타일에 outlineLvl 지정(실물 SBL_Text N …과 동형 — 이름 무관, outlineLvl로만 레벨 판정).
const STYLES =
  `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:style w:type="paragraph" w:styleId="H1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="H2"><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="H3"><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title"/>` + // 문서 제목 — outlineLvl 없음(헤딩 아님)
  `</w:styles>`;

const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;
const doc = (body: string) => `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;

// TOC 항목 문단(캐시): 내부 하이퍼링크(w:anchor) + "번호\t제목\t페이지" 런. (스타일 무관 — 하이퍼링크로 식별)
const tocEntry = (anchor: string, number: string, title: string, page = "3") =>
  `<w:p><w:hyperlink w:anchor="${anchor}">` +
  `<w:r><w:t>${number}</w:t></w:r><w:r><w:tab/></w:r>` +
  `<w:r><w:t>${title}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${page}</w:t></w:r>` +
  `</w:hyperlink></w:p>`;

// 본문 제목 문단: 커스텀 스타일 + 책갈피(들) + 제목 런(번호는 자동넘버라 런에 없음).
const heading = (styleId: string, bookmarks: string[], title: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` +
  bookmarks.map((n, i) => `<w:bookmarkStart w:id="${i}" w:name="${n}"/>`).join("") +
  `<w:r><w:t>${title}</w:t></w:r></w:p>`;

const makeDocx = (documentXml: string, stylesXml = STYLES): Uint8Array =>
  zipSync({ "word/document.xml": strToU8(documentXml), "word/styles.xml": strToU8(stylesXml) });

describe("parseWordSections", () => {
  it("레벨은 커스텀 스타일의 outlineLvl로 판정하고 번호는 TOC 캐시에서 가져온다", async () => {
    const xml = doc(tocEntry("_Toc1", "1.", "Purpose") + heading("H1", ["_Toc1"], "Purpose"));
    const out = await parseWordSections(makeDocx(xml));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ anchor: "_Toc1", number: "1", title: "Purpose", level: 1 });
  });

  it("3단계+ 번호는 TOC 부모에서 씨앗 받아 로컬 카운터로 재구성한다", async () => {
    const xml = doc(
      tocEntry("_Toc1", "1.", "Purpose") + tocEntry("_Toc2", "1.1", "Scope") +
      heading("H1", ["_Toc1"], "Purpose") + heading("H2", ["_Toc2"], "Scope") +
      heading("H3", ["_Toc3"], "Detail A") + heading("H3", ["_Toc4"], "Detail B"),
    );
    const out = await parseWordSections(makeDocx(xml));
    expect(out.map((s) => s.number)).toEqual(["1", "1.1", "1.1.1", "1.1.2"]);
    expect(out.map((s) => s.level)).toEqual([1, 2, 3, 3]);
    expect(out[2].anchor).toBe("_Toc3"); // TOC에 없는 3단계도 본문 책갈피로 잡힘
  });

  it("잔재로 중복된 책갈피 중 TOC가 참조하는 활성 앵커를 고르고 한 번만 낸다", async () => {
    const xml = doc(
      tocEntry("_Toc_active", "6.1", "Procedure") +
      heading("H2", ["_Toc_stale", "_Toc_active"], "Procedure"),
    );
    const out = await parseWordSections(makeDocx(xml));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ anchor: "_Toc_active", number: "6.1", level: 2 });
  });

  it("_GoBack·outlineLvl 없는 문서 제목·비제목 문단은 제외한다", async () => {
    const xml = doc(
      `<w:p><w:bookmarkStart w:id="9" w:name="_GoBack"/><w:r><w:t>본문</w:t></w:r></w:p>` +
      heading("Title", ["_TocTitle"], "SOP 제목"), // Title 스타일=outlineLvl 없음 → 헤딩 아님
    );
    const out = await parseWordSections(makeDocx(xml));
    expect(out).toHaveLength(0);
  });

  it("Eng·Kor 두 TOC와 각 본문 제목을 모두 뽑는다", async () => {
    const xml = doc(
      tocEntry("_TocE1", "1.", "Purpose") + tocEntry("_TocK1", "1.", "목적") +
      heading("H1", ["_TocE1"], "Purpose") + heading("H1", ["_TocK1"], "목적"),
    );
    const out = await parseWordSections(makeDocx(xml));
    expect(out.map((s) => s.anchor)).toEqual(["_TocE1", "_TocK1"]);
    expect(out.map((s) => s.title)).toEqual(["Purpose", "목적"]);
  });
});
