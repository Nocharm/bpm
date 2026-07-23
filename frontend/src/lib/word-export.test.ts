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

  it("Arial + 돋움 8pt, 가운데 정렬(비볼드)", async () => {
    const parts = await unzipDocx(buildDocx([nodeDecision], noEdges));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('w:ascii="Arial"');
    expect(doc).toContain('w:eastAsia="돋움"');
    expect(doc).toContain('<w:sz w:val="16"/>'); // 8pt 통일
    expect(doc).toContain('<w:jc w:val="center"/>');
    expect(doc).not.toContain("<w:b/>"); // 볼드 제거(사용자 요청) — 도형 텍스트 비볼드
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

  it("어긋난 노드는 bentConnector3 + 화살촉 + stCxn/endCxn(도형 연결)", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision], [edgeAB]));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('prst="bentConnector3"'); // A·B 어긋남 → 꺾은선
    expect(doc).toContain('<a:tailEnd type="triangle"/>');
    // 도형 연결(Word에서 이동 시 선 따라옴) — right=idx2, left=idx0 (left0/top1/right2/bottom3)
    expect(doc).toContain('<a:stCxn id="2" idx="2"/>');
    expect(doc).toContain('<a:endCxn id="3" idx="0"/>');
  });

  it("정렬된 노드(같은 x)는 straightConnector1로 낸다", async () => {
    const a = { id: "a", title: "A", nodeType: "process" as const, x: 100, y: 0, w: 100, h: 50 };
    const b = { id: "b", title: "B", nodeType: "process" as const, x: 100, y: 200, w: 100, h: 50 };
    const e = { sourceId: "a", targetId: "b", sourceSide: "bottom" as const, targetSide: "top" as const };
    const doc = (await unzipDocx(buildDocx([a, b], [e])))["word/document.xml"];
    expect(doc).toContain('prst="straightConnector1"');
    expect(doc).not.toContain("bentConnector3");
  });

  it("fitToPage=false는 축소 없이 px×9525로 도형 크기를 그대로 낸다 (1.5×3cm 정확)", async () => {
    const big = { id: "n", title: "T", nodeType: "process" as const, x: 0, y: 0, w: 2000, h: 1000 };
    const exact = (await unzipDocx(buildDocx([big], [], false)))["word/document.xml"];
    const fit = (await unzipDocx(buildDocx([big], [])))["word/document.xml"];
    expect(exact).toContain('<a:ext cx="19050000" cy="9525000"/>'); // 2000·1000 px×9525, 미축소
    expect(fit).not.toContain('<a:ext cx="19050000"'); // fit=기본 → 페이지에 맞춰 축소
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
    expect(parts["word/document.xml"]).not.toContain('name="edge-'); // 커넥터 도형 자체가 안 생김
  });
});

describe("buildDocx — 하이퍼링크 URL 정규화", () => {
  it("공백·한글 URL은 percent-encode해 rels Target에 담고 본문에 하이퍼링크를 만든다", async () => {
    const node: WordExportNode = {
      ...nodeWithUrl, url: "http://server/문서 목록.docx", urlLabel: "문서 목록",
    };
    const parts = await unzipDocx(buildDocx([node], noEdges));
    const rels = parts["word/_rels/document.xml.rels"];
    const doc = parts["word/document.xml"];
    expect(rels).toContain(
      'Target="http://server/%EB%AC%B8%EC%84%9C%20%EB%AA%A9%EB%A1%9D.docx"',
    );
    expect(doc).toContain("<w:hyperlink ");
  });

  it("정규화 불가 URL은 링크 없이 라벨을 일반 텍스트 문단으로 렌더한다", async () => {
    const node: WordExportNode = {
      ...nodeWithUrl, url: "메모만 적음", urlLabel: undefined,
    };
    const parts = await unzipDocx(buildDocx([node], noEdges));
    const rels = parts["word/_rels/document.xml.rels"];
    const doc = parts["word/document.xml"];
    expect(rels).not.toContain("hyperlink");
    expect(doc).not.toContain("<w:hyperlink");
    expect(doc).toContain("메모만 적음</w:t>");
  });
});

describe("buildDocx — 섹션 노드 내부 앵커 링크", () => {
  it("첫 토큰만 내부 앵커 링크, 나머지는 plain 텍스트", async () => {
    const section: WordExportNode = {
      id: "n1", title: "1.22스탭 참고", nodeType: "section",
      x: 0, y: 0, w: 113, h: 57, sectionAnchor: "_Toc9001",
    };
    const parts = await unzipDocx(buildDocx([section], noEdges));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('<w:hyperlink w:anchor="_Toc9001">');
    expect(doc).toContain("1.22스탭"); // 링크된 첫 토큰
    expect(doc).toContain("참고"); // plain 잔여 텍스트도 여전히 존재
  });

  it("url까지 있으면 내부 앵커 링크·외부 url 링크가 공존한다", async () => {
    const section: WordExportNode = {
      id: "n1", title: "1.2 절차", nodeType: "section",
      x: 0, y: 0, w: 113, h: 57, sectionAnchor: "_Toc1",
      url: "https://x.test", urlLabel: "SOP",
    };
    const parts = await unzipDocx(buildDocx([section], noEdges));
    const doc = parts["word/document.xml"];
    const rels = parts["word/_rels/document.xml.rels"];
    expect(doc).toContain('<w:hyperlink w:anchor="_Toc1">'); // 내부
    expect(rels).toContain('TargetMode="External"'); // 외부(url 라인, 현행 유지)
  });
});

describe("buildDocx — 빈 노드 계약", () => {
  it("노드 0개면 명확한 메시지로 throw한다", () => {
    expect(() => buildDocx([], [])).toThrow(/node/i);
  });
});

describe("buildDocx — 엣지 라벨 bounds 클램프", () => {
  it("좌상단 노드 사이 긴 라벨이어도 모든 a:off 좌표가 0 이상이다", async () => {
    const nodeTL1: WordExportNode = {
      id: "tl1", title: "N1", nodeType: "process", x: 0, y: 0, w: 60, h: 40,
    };
    const nodeTL2: WordExportNode = {
      id: "tl2", title: "N2", nodeType: "process", x: 80, y: 0, w: 60, h: 40,
    };
    const longLabelEdge: WordExportEdge = {
      sourceId: "tl1", targetId: "tl2", label: "아주 아주 아주 긴 분기 라벨입니다 매우 깁니다",
      sourceSide: "right", targetSide: "left",
    };
    const parts = await unzipDocx(buildDocx([nodeTL1, nodeTL2], [longLabelEdge]));
    const doc = parts["word/document.xml"];
    for (const m of doc.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
    }
  });
});
