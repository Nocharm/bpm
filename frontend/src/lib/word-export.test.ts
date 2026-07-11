// word-export 단위 테스트 — 생성 Blob을 unzip해 OOXML 내용을 검증한다.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildDocx, type WordExportEdge, type WordExportNode } from "@/lib/word-export";

async function unzipDocx(blob: Blob): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

const nodeWithUrl: WordExportNode = {
  id: "a", title: "접수 검토", nodeType: "process",
  x: 0, y: 0, w: 172, h: 48,
  url: "https://example.com/sop?a=1&b=2", urlLabel: "접수 기준서",
};
const nodeDecision: WordExportNode = {
  id: "b", title: "적합 여부", nodeType: "decision", x: 300, y: 200, w: 96, h: 96,
};
const nodeStart: WordExportNode = {
  id: "s", title: "Start", nodeType: "start", x: -100, y: -50, w: 96, h: 40,
};
// Task 1은 연결선 미구현 — 엣지 타입만 소비(Task 2 테스트가 실데이터로 확장)
const noEdges: WordExportEdge[] = [];

describe("buildDocx — 패키지 골격", () => {
  it("docx 4파트를 만든다", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl], noEdges));
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels",
      "word/_rels/document.xml.rels", "word/document.xml",
    ]);
    expect(parts["[Content_Types].xml"]).toContain("wordprocessingml.document.main+xml");
  });
});

describe("buildDocx — 노드 도형", () => {
  it("노드 타입을 Word 플로차트 프리셋으로 매핑한다", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision, nodeStart], noEdges));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('prst="flowChartProcess"');
    expect(doc).toContain('prst="flowChartDecision"');
    expect(doc).toContain('prst="flowChartTerminator"');
  });

  it("흑백톤 — 흰 채움·검정 테두리", async () => {
    const parts = await unzipDocx(buildDocx([nodeDecision], noEdges));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
    expect(doc).toContain('<a:srgbClr val="000000"/>');
  });

  it("Arial + 바탕체 11pt, 제목 굵게 가운데 정렬", async () => {
    const parts = await unzipDocx(buildDocx([nodeDecision], noEdges));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('w:ascii="Arial"');
    expect(doc).toContain('w:eastAsia="바탕체"');
    expect(doc).toContain('<w:sz w:val="22"/>');
    expect(doc).toContain('<w:jc w:val="center"/>');
    expect(doc).toContain("<w:b/>");
  });

  it("url 있는 노드만 하이퍼링크 — rels TargetMode=External + 파랑 밑줄 라벨", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision], noEdges));
    const rels = parts["word/_rels/document.xml.rels"];
    const doc = parts["word/document.xml"];
    expect(rels).toContain('Target="https://example.com/sop?a=1&amp;b=2"');
    expect(rels).toContain('TargetMode="External"');
    const hlId = /Id="(rIdHl\d+)"[^>]*TargetMode="External"/.exec(rels)?.[1];
    expect(doc).toContain(`<w:hyperlink r:id="${hlId}">`);
    expect(doc).toContain("접수 기준서");
    expect(doc).toContain('<w:color w:val="0563C1"/><w:u w:val="single"/>');
    // url 없는 노드에는 하이퍼링크가 안 생긴다 — 문서 전체 하이퍼링크 1개
    expect(doc.match(/<w:hyperlink /g)?.length).toBe(1);
  });

  it("urlLabel이 비면 url 자체를 표시한다", async () => {
    const bare = { ...nodeWithUrl, urlLabel: undefined };
    const parts = await unzipDocx(buildDocx([bare], noEdges));
    expect(parts["word/document.xml"]).toContain("https://example.com/sop?a=1&amp;b=2</w:t>");
  });

  it("XML 특수문자를 이스케이프한다", async () => {
    const tricky = { ...nodeDecision, title: 'A&B <T> "q"' };
    const parts = await unzipDocx(buildDocx([tricky], noEdges));
    expect(parts["word/document.xml"]).toContain("A&amp;B &lt;T&gt; &quot;q&quot;");
  });
});

describe("buildDocx — 좌표·축척", () => {
  it("음수 좌표를 포함해 원점 기준으로 평행이동한다 (모든 off ≥ 0)", async () => {
    const parts = await unzipDocx(buildDocx([nodeStart, nodeDecision], noEdges));
    const doc = parts["word/document.xml"];
    for (const m of doc.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
    }
  });

  it("큰 맵은 A4 가용 영역 안으로 축소된다", async () => {
    const wide: WordExportNode = { ...nodeDecision, id: "w", x: 3000, y: 4000 };
    const parts = await unzipDocx(buildDocx([nodeWithUrl, wide], noEdges));
    const doc = parts["word/document.xml"];
    const ext = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(doc);
    expect(Number(ext?.[1])).toBeLessThanOrEqual(5_760_720); // 16.0cm
    expect(Number(ext?.[2])).toBeLessThanOrEqual(8_892_540); // 24.7cm
  });

  it("작은 맵은 확대하지 않는다 (scale 상한 1 — 172px = 1638300EMU)", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl], noEdges));
    expect(parts["word/document.xml"]).toContain('cx="1638300"');
  });
});

describe("buildDocx — 연결선·엣지 라벨", () => {
  const edgeAB: WordExportEdge = {
    sourceId: "a", targetId: "b", label: "적합", sourceSide: "right", targetSide: "left",
  };

  it("bentConnector3 + 화살촉 + 도형 접점(stCxn/endCxn)으로 연결한다", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision], [edgeAB]));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('prst="bentConnector3"');
    expect(doc).toContain('<a:tailEnd type="triangle"/>');
    // 노드 도형 id: a=2, b=3. right=3, left=1 (top0/left1/bottom2/right3)
    expect(doc).toContain('<a:stCxn id="2" idx="3"/>');
    expect(doc).toContain('<a:endCxn id="3" idx="1"/>');
  });

  it("라벨 있는 엣지만 중점에 라벨 텍스트박스를 만든다", async () => {
    const noLabel: WordExportEdge = { ...edgeAB, label: undefined };
    const withLabel = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision], [edgeAB]));
    const without = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision], [noLabel]));
    expect(withLabel["word/document.xml"]).toContain("적합</w:t>");
    // 라벨 박스는 테두리 없음(noFill 라인) + 흰 배경으로 선을 가린다
    expect(withLabel["word/document.xml"]).toContain("<a:ln><a:noFill/></a:ln>");
    expect(without["word/document.xml"]).not.toContain("적합</w:t>");
  });

  it("역방향(오른→왼) 엣지는 flip으로 표현한다", async () => {
    const back: WordExportEdge = {
      sourceId: "b", targetId: "a", sourceSide: "left", targetSide: "right",
    };
    const parts = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision], [back]));
    expect(parts["word/document.xml"]).toContain('flipH="1"');
  });

  it("없는 노드를 참조하는 엣지는 조용히 건너뛴다", async () => {
    const dangling: WordExportEdge = {
      sourceId: "a", targetId: "ghost", sourceSide: "right", targetSide: "left",
    };
    const parts = await unzipDocx(buildDocx([nodeWithUrl], [dangling]));
    expect(parts["word/document.xml"]).not.toContain("bentConnector3");
  });
});
