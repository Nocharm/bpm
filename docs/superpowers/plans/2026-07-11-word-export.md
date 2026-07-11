# Word 도형 순서도 내보내기 (Word Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터 현재 화면의 노드/엣지를 Word 순정 도형(DrawingML) 순서도로 담은 `.docx`를 다운로드한다 — 도형 안에 노드 라벨 + URL 라벨 하이퍼링크, 전체 그룹화로 SOP 복붙 시 링크·도형 유지.

**Architecture:** `src/lib/word-export.ts` 순수 함수가 OOXML 4파트(`[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels`)를 문자열로 조립하고 `fflate`로 zip → Blob. page.tsx는 `nodesRef`/`edgesRef`를 내보내기 모델로 변환해 호출. 진입점은 인스펙터 맵 탭의 PNG 버튼 아래 별도 버튼(PNG 코드 무변경).

**Tech Stack:** TypeScript(strict), fflate(신규 prod dep, zip), vitest, playwright-core(브라우저 검증)

**Spec:** `docs/superpowers/specs/2026-07-11-word-export-design.md` (승인됨)

## Global Constraints

- **스타일**: 흑백톤 — 도형 흰 채움(`FFFFFF`) + 검정 테두리(`000000`) + 검정 텍스트. 하이퍼링크만 Word 표준 파랑 `0563C1` + 밑줄.
- **폰트**: 영문·숫자 `Arial`(`w:ascii`/`w:hAnsi`/`w:cs`), 한글 `바탕체`(`w:eastAsia`), **11pt**(`w:sz w:val="22"`), 가운데 정렬.
- **PNG 내보내기 코드 무변경** — `src/lib/export.ts`, PNG 버튼(page.tsx ~7782), 컨텍스트 메뉴 `ctx.exportPng`, `Ctrl+⇧E` 어디도 건드리지 않는다.
- **v1 제외**: 그룹 박스 렌더, 참조 표, 컨텍스트 메뉴/단축키 진입점, 비교 화면, 서브프로세스 딥링크.
- `crypto.randomUUID`/`crypto.subtle` 금지(평문 HTTP). id 필요 시 `@/lib/id`의 `genId()`. 이 기능은 난수 불필요.
- raw hex 색상은 **docx 출력물이라 허용**(design.md §1 예외 — chrome 아님). 단 인스펙터 버튼 UI는 토큰만.
- UI 문구는 i18n 키로만(en/ko 두 맵 모두 추가). 주요 신규 UI 요소에 `data-id` 부여.
- 각 태스크 커밋에 `PROGRESS.md` 갱신 동반(git.md). 커밋 메시지: `type(scope): English — 한국어`.
- 게이트: `npm test`(vitest run) + `npx tsc --noEmit`(**vitest·next build가 못 잡는 테스트 파일 타입 에러 검출용 — 상시 실행**) + `npm run lint` + `npm run build`.
- 모든 명령은 `frontend/` 에서 실행 (워크트리: `.claude/worktrees/word-export/frontend`).
- ugrep은 `[mapId]` 브라켓 디렉터리를 조용히 건너뜀 — page.tsx 검색은 `find`+per-file grep 또는 Python.

---

### Task 1: word-export.ts 순수 빌더 — docx 패키지 골격 + 노드 도형 + 하이퍼링크

**Files:**
- Modify: `frontend/package.json` (fflate 추가 — `npm install fflate` 사용)
- Create: `frontend/src/lib/word-export.ts`
- Test: `frontend/src/lib/word-export.test.ts`

**Interfaces (Produces — Task 2·3이 의존):**
```ts
export interface WordExportNode {
  id: string;
  title: string;
  nodeType: ProcessNodeType; // "process" | "decision" | "start" | "end" | "subprocess" (@/lib/canvas)
  x: number; y: number; w: number; h: number; // 캔버스 px (표시 좌표·크기)
  url?: string;
  urlLabel?: string;
}
export interface WordExportEdge {
  sourceId: string;
  targetId: string;
  label?: string;
  sourceSide: HandleSide; // "left" | "right" | "top" | "bottom" (@/lib/canvas)
  targetSide: HandleSide;
}
export function buildDocx(nodes: WordExportNode[], edges: WordExportEdge[]): Blob
```

- [ ] **Step 1: fflate 설치**

```bash
npm install fflate
```

Expected: `package.json` dependencies에 `"fflate": "^0.8.x"` 추가. 선정 사유(스펙 §3): docx는 zip 컨테이너인데 `docx` npm 라이브러리는 도형 프리셋·연결선 미지원 → zip만 필요, fflate는 ~8KB 의존성 0.

- [ ] **Step 2: 실패하는 테스트 작성** — `src/lib/word-export.test.ts`

```ts
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

describe("buildDocx — 패키지 골격", () => {
  it("docx 4파트를 만든다", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl], []));
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels",
      "word/_rels/document.xml.rels", "word/document.xml",
    ]);
    expect(parts["[Content_Types].xml"]).toContain("wordprocessingml.document.main+xml");
  });
});

describe("buildDocx — 노드 도형", () => {
  it("노드 타입을 Word 플로차트 프리셋으로 매핑한다", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision, nodeStart], []));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('prst="flowChartProcess"');
    expect(doc).toContain('prst="flowChartDecision"');
    expect(doc).toContain('prst="flowChartTerminator"');
  });

  it("흑백톤 — 흰 채움·검정 테두리", async () => {
    const parts = await unzipDocx(buildDocx([nodeDecision], []));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
    expect(doc).toContain('<a:srgbClr val="000000"/>');
  });

  it("Arial + 바탕체 11pt, 제목 굵게 가운데 정렬", async () => {
    const parts = await unzipDocx(buildDocx([nodeDecision], []));
    const doc = parts["word/document.xml"];
    expect(doc).toContain('w:ascii="Arial"');
    expect(doc).toContain('w:eastAsia="바탕체"');
    expect(doc).toContain('<w:sz w:val="22"/>');
    expect(doc).toContain('<w:jc w:val="center"/>');
    expect(doc).toContain("<w:b/>");
  });

  it("url 있는 노드만 하이퍼링크 — rels TargetMode=External + 파랑 밑줄 라벨", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl, nodeDecision], []));
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
    const parts = await unzipDocx(buildDocx([bare], []));
    expect(parts["word/document.xml"]).toContain("https://example.com/sop?a=1&amp;b=2</w:t>");
  });

  it("XML 특수문자를 이스케이프한다", async () => {
    const tricky = { ...nodeDecision, title: 'A&B <T> "q"' };
    const parts = await unzipDocx(buildDocx([tricky], []));
    expect(parts["word/document.xml"]).toContain("A&amp;B &lt;T&gt; &quot;q&quot;");
  });
});

describe("buildDocx — 좌표·축척", () => {
  it("음수 좌표를 포함해 원점 기준으로 평행이동한다 (모든 off ≥ 0)", async () => {
    const parts = await unzipDocx(buildDocx([nodeStart, nodeDecision], []));
    const doc = parts["word/document.xml"];
    for (const m of doc.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
    }
  });

  it("큰 맵은 A4 가용 영역 안으로 축소된다", async () => {
    const wide: WordExportNode = { ...nodeDecision, id: "w", x: 3000, y: 4000 };
    const parts = await unzipDocx(buildDocx([nodeWithUrl, wide], []));
    const doc = parts["word/document.xml"];
    const ext = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(doc);
    expect(Number(ext?.[1])).toBeLessThanOrEqual(5_760_720); // 16.0cm
    expect(Number(ext?.[2])).toBeLessThanOrEqual(8_892_540); // 24.7cm
  });

  it("작은 맵은 확대하지 않는다 (scale 상한 1 — 172px = 1638300EMU)", async () => {
    const parts = await unzipDocx(buildDocx([nodeWithUrl], []));
    expect(parts["word/document.xml"]).toContain('cx="1638300"');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/word-export.test.ts`
Expected: FAIL — `Cannot find module '@/lib/word-export'` 류.

- [ ] **Step 4: 구현** — `src/lib/word-export.ts`

```ts
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
    // XML 1.0 불허 제어문자 제거
    // eslint-disable-next-line no-control-regex
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/word-export.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: 전체 게이트**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 전부 통과 (기존 테스트 무회귀)

- [ ] **Step 7: PROGRESS.md 갱신 + 커밋**

`PROGRESS.md`의 `## 2026-07-11 — Word 도형 순서도 내보내기 설계 (worktree-word-export)` 섹션에 한 줄 추가:
```
- T1: word-export.ts 순수 빌더 — docx 4파트 조립 + 노드 도형(프리셋 매핑·흑백·Arial/바탕체 11pt·하이퍼링크 rels) + fflate 도입, vitest 10건.
```

```bash
git add package.json package-lock.json src/lib/word-export.ts src/lib/word-export.test.ts ../PROGRESS.md
git commit -m "feat(word-export): docx builder with node shapes and hyperlinks — docx 빌더(노드 도형·하이퍼링크)"
```

---

### Task 2: 연결선(화살표) + 접점 연결 + 엣지 라벨

**Files:**
- Modify: `frontend/src/lib/word-export.ts` (Task 1에서 생성)
- Test: `frontend/src/lib/word-export.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: Task 1의 `buildDocx(nodes, edges)`, `WordExportEdge`, `Layout`, `escapeXml`, `buildRunProps`, `CENTERED_P_PROPS`
- Produces: `buildDocx`가 edges를 실제 렌더 — 연결선 `bentConnector3` + `stCxn`/`endCxn` 접점 + 라벨 텍스트박스. 시그니처 변경 없음.

- [ ] **Step 1: 실패하는 테스트 추가** — `word-export.test.ts` 맨 아래에 append

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/word-export.test.ts`
Expected: 새 4건 FAIL (`bentConnector3` 미존재 등), 기존 10건 PASS

- [ ] **Step 3: 구현** — `word-export.ts`에 아래 함수를 추가하고 `buildDocx`를 수정

추가 함수 (`buildNodeShape` 아래):

```ts
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
  return (
    "<wps:wsp>" +
    `<wps:cNvPr id="${shapeId}" name="label-${shapeId}"/>` +
    "<wps:cNvSpPr/>" +
    "<wps:spPr>" +
    `<a:xfrm><a:off x="${layout.toX(mid.x)}" y="${layout.toY(mid.y)}"/>` +
    `<a:ext cx="${layout.toLen(w)}" cy="${layout.toLen(EDGE_LABEL_H_PX)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
    "<a:ln><a:noFill/></a:ln>" +
    "</wps:spPr>" +
    `<wps:txbx><w:txbxContent>${buildCenteredParagraph(label, {})}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>' +
    "</wps:wsp>"
  );
}
```

`buildDocx`의 `void edges; void shapeIdOf;` 두 줄을 아래로 교체:

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/word-export.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: 전체 게이트**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 전부 통과

- [ ] **Step 6: PROGRESS.md 한 줄 추가 + 커밋**

```
- T2: 연결선 bentConnector3 + stCxn/endCxn 접점(도형 이동 시 추종) + 분기 라벨 텍스트박스 + 역방향 flip, vitest 4건 추가.
```

```bash
git add src/lib/word-export.ts src/lib/word-export.test.ts ../PROGRESS.md
git commit -m "feat(word-export): connectors with shape anchors and edge labels — 접점 연결선·분기 라벨"
```

---

### Task 3: 진입점 통합 — exportCanvasWord + i18n + 인스펙터 맵 탭 버튼

**Files:**
- Modify: `frontend/src/lib/word-export.ts` (다운로드 트리거 추가)
- Modify: `frontend/src/lib/i18n-messages.ts` (en/ko 키 2쌍)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (핸들러 + 버튼)

**Interfaces:**
- Consumes: Task 1·2의 `buildDocx`, `WordExportNode`, `WordExportEdge`; canvas.ts의 `nodeSizeOf(nodeType)`, `sideFromHandleId(id, fallback)`; page.tsx의 `nodesRef`(1043행 부근)·`edgesRef`(1044행)·`versions`/`versionId`/`mapName`/`setStatus`/`t`
- Produces: `exportCanvasWord(nodes, edges, fileName): void` — 노드 0개 no-op, Blob 다운로드 트리거. 인스펙터 버튼 `data-id="inspector-export-word"`(Task 4 셀렉터).

- [ ] **Step 1: exportCanvasWord 추가** — `word-export.ts` 맨 아래

```ts
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
```

- [ ] **Step 2: i18n 키 추가** — `src/lib/i18n-messages.ts`

en 맵(273행 `"err.exportPng"` 아래, 496행 `"inspector.exportPng"` 아래 — 각 인접 위치):
```ts
  "err.exportWord": "Failed to export Word",
  "inspector.exportWord": "Download Word",
```
ko 맵(1587행 `"err.exportPng"` 아래, 1810행 `"inspector.exportPng"` 아래):
```ts
  "err.exportWord": "Word 내보내기에 실패했습니다",
  "inspector.exportWord": "Word로 다운로드",
```

- [ ] **Step 3: page.tsx 핸들러 추가** — `handleExportPng`(4270행 부근) 바로 아래. **플레인 함수로**(React Compiler가 memoize — `useCallback` 수동 deps 불일치 함정 회피, AGENTS.md)

```tsx
  const handleExportWord = () => {
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    const sanitize = (text: string) => text.replace(/[^\w가-힣.-]+/g, "-");
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14);
    try {
      const exportNodes = nodesRef.current.map((node) => {
        const size = nodeSizeOf(node.data.nodeType);
        return {
          id: node.id,
          title: node.data.label,
          nodeType: node.data.nodeType,
          x: node.position.x,
          y: node.position.y,
          w: size.w,
          h: size.h,
          url: node.data.url,
          urlLabel: node.data.urlLabel,
        };
      });
      const exportEdges = edgesRef.current.map((edge) => ({
        sourceId: edge.source,
        targetId: edge.target,
        label: typeof edge.label === "string" && edge.label ? edge.label : undefined,
        sourceSide: sideFromHandleId(edge.sourceHandle, "right"),
        targetSide: sideFromHandleId(edge.targetHandle, "left"),
      }));
      exportCanvasWord(
        exportNodes,
        exportEdges,
        `${sanitize(mapName)}_${sanitize(versionLabel)}_${stamp}.docx`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t("err.exportWord"));
    }
  };
```

import 정리 (page.tsx 상단):
- `import { exportCanvasWord } from "@/lib/word-export";` 추가 (181행 `exportCanvasPng` import 근처)
- 기존 `@/lib/canvas` import 목록에 `nodeSizeOf`, `sideFromHandleId`가 없으면 추가
- lucide-react import 목록에 `FileText`가 없으면 추가

- [ ] **Step 4: 인스펙터 맵 탭 버튼 추가** — page.tsx 7789행 부근, PNG 버튼 `</button>` **바로 아래**(PNG 버튼 코드는 무변경)

```tsx
                    <button
                      type="button"
                      data-id="inspector-export-word"
                      onClick={handleExportWord}
                      className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-hairline px-3 py-2 text-caption font-medium text-ink-secondary hover:bg-surface-alt"
                    >
                      <FileText size={16} strokeWidth={1.5} />
                      {t("inspector.exportWord")}
                    </button>
```

(디자인 룰: PNG는 accent 채움 primary — Word는 hairline 보조 버튼으로 위계 구분. 커서·눌림은 전역 base가 처리, hover 배경 토큰만.)

- [ ] **Step 5: 전체 게이트**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: 전부 통과. build에서 React Compiler 에러(`react-hooks/preserve-manual-memoization`) 없어야 함.

- [ ] **Step 6: PROGRESS.md 한 줄 추가 + 커밋**

```
- T3: exportCanvasWord 다운로드 트리거 + i18n 2쌍(en/ko) + 인스펙터 맵 탭 하단 Word 버튼(data-id=inspector-export-word, PNG 무변경).
```

```bash
git add src/lib/word-export.ts src/lib/i18n-messages.ts "src/app/maps/[mapId]/page.tsx" ../PROGRESS.md
git commit -m "feat(editor): Word export button in inspector map tab — 인스펙터 맵 탭 Word 다운로드 버튼"
```

---

### Task 4: 브라우저 검증(Playwright) + 실행 + 문서 마감

**Files:**
- Create: `frontend/scripts/pw-verify-word-export.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 3의 `data-id="inspector-export-word"` 버튼, 인스펙터 맵 탭(`button[aria-label="Map"]`, en 로케일), 백엔드 GET/PUT `/api/versions/{versionId}/graph`(노드 `url`/`url_label` snake_case)
- Produces: 검증 스크립트 + 실행 결과(PROGRESS.md 기록)

- [ ] **Step 1: 기존 하네스 확인**

`scripts/pw-verify-png-export.mjs`를 읽고 부트 패턴(chromium.launch + `bpm.devUser`/`bpm.lang` init script + check/skip 헬퍼 + console error 수집)을 그대로 따른다. 아래 Step 2 코드는 그 패턴 기준.

- [ ] **Step 2: 스크립트 작성** — `scripts/pw-verify-word-export.mjs`

```js
// Word 내보내기 e2e — 인스펙터 맵 탭 Word 버튼 → .docx 다운로드 → unzip 구조 검증. 시나리오:
//   ① 인스펙터 맵 탭에 Word 버튼이 있다 (PNG 버튼은 그대로).
//   ② 다운로드 파일명이 {맵}_{버전}_{stamp}.docx 패턴.
//   ③ docx 4파트 존재 + 도형 수 = 캔버스 노드 수, 연결선 수 = 엣지 수.
//   ④ URL 있는 노드 → rels 하이퍼링크(TargetMode=External) + 문서에 URL 라벨 텍스트.
//      (시드에 URL 노드가 없으면 그래프 PUT으로 1개 심고 끝나면 원복.)
//   ⑤ 흑백톤(FFFFFF/000000) + Arial/바탕체 + sz 22.
//   ⑥ console error 0.
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-word-export.mjs
//   PowerShell: node scripts\pw-verify-word-export.mjs
// 전제: backend :8000 (AUTH_ENFORCE 없이), frontend :3000, playwright-core 설치(npm i --no-save playwright-core)
//   bash:       cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000
//   PowerShell: cd backend; $env:AUTH_ENABLED="false"; .venv\Scripts\uvicorn app.main:app --port 8000
// ⚠️ 좀비 next dev가 :3000 점유 시 pkill -f "next dev" 후 재기동 (docs/lessons/browser-verification.md)
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unzipSync, strFromU8 } from "fflate";
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = process.env.MAP_ID ?? "2";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// 에디터 로드 — 그래프 응답에서 versionId 캡처
let versionId = null;
page.on("response", (res) => {
  const m = /\/api\/versions\/(\d+)\/graph(?!\/)/.exec(res.url());
  if (m) versionId = Number(m[1]);
});
await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 15000 });
if (!versionId) throw new Error("graph 응답에서 versionId를 못 얻음");

// 그래프 상태 파악 — URL 노드 없으면 첫 노드에 심고 종료 시 원복
const getGraph = () =>
  page.evaluate(async (vid) => {
    const res = await fetch(`/api/versions/${vid}/graph`);
    return res.json();
  }, versionId);
const putGraph = (graph) =>
  page.evaluate(
    async ({ vid, body }) => {
      const res = await fetch(`/api/versions/${vid}/graph`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.status;
    },
    { vid: versionId, body: graph },
  );

const original = await getGraph();
let mutated = false;
if (!original.nodes.some((n) => n.url)) {
  const patched = structuredClone(original);
  patched.nodes[0].url = "https://example.com/sop";
  patched.nodes[0].url_label = "SOP 문서";
  const status = await putGraph(patched);
  if (status !== 200) throw new Error(`URL 시드 PUT 실패 status=${status}`);
  mutated = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
}
const graph = await getGraph();
const urlNodeCount = graph.nodes.filter((n) => n.url).length;

try {
  // ① 인스펙터 맵 탭 → Word 버튼 존재 (PNG 버튼도 그대로)
  await page.locator('button[aria-label="Map"]').first().click();
  const wordBtn = page.locator('[data-id="inspector-export-word"]');
  check("① Word 버튼 존재", (await wordBtn.count()) === 1);
  check(
    "① PNG 버튼 유지",
    (await page.getByRole("button", { name: "Download PNG" }).count()) === 1,
  );

  // ② 다운로드 + 파일명 패턴
  const [download] = await Promise.all([page.waitForEvent("download"), wordBtn.click()]);
  const fileName = download.suggestedFilename();
  check("② 파일명 .docx 패턴", /_\d{14}\.docx$/.test(fileName), fileName);
  const filePath = join(tmpdir(), fileName);
  await download.saveAs(filePath);

  // ③~⑤ unzip 검증
  const parts = Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(readFileSync(filePath)))).map(([k, v]) => [
      k,
      strFromU8(v),
    ]),
  );
  const doc = parts["word/document.xml"] ?? "";
  const rels = parts["word/_rels/document.xml.rels"] ?? "";
  check("③ docx 4파트", Object.keys(parts).length === 4, Object.keys(parts).join(","));
  const shapeCount = (doc.match(/<wps:cNvSpPr\/>/g) ?? []).length; // 노드+라벨 박스
  const connectorCount = (doc.match(/<wps:cNvCnPr>/g) ?? []).length;
  const labelCount = (doc.match(/name="label-/g) ?? []).length;
  check(
    "③ 도형 수 = 노드 수",
    shapeCount - labelCount === graph.nodes.length,
    `shapes=${shapeCount - labelCount} nodes=${graph.nodes.length}`,
  );
  check(
    "③ 연결선 수 = 엣지 수",
    connectorCount === graph.edges.length,
    `connectors=${connectorCount} edges=${graph.edges.length}`,
  );
  const relHlCount = (rels.match(/TargetMode="External"/g) ?? []).length;
  check("④ 하이퍼링크 수 = URL 노드 수", relHlCount === urlNodeCount, `rels=${relHlCount} urls=${urlNodeCount}`);
  check("④ 하이퍼링크 본문 참조", (doc.match(/<w:hyperlink /g) ?? []).length === urlNodeCount);
  check("⑤ 흑백톤", doc.includes('val="FFFFFF"') && doc.includes('val="000000"'));
  check("⑤ Arial/바탕체 11pt", doc.includes('w:ascii="Arial"') && doc.includes('w:eastAsia="바탕체"') && doc.includes('<w:sz w:val="22"/>'));

  // ⑥ 콘솔 에러
  check("⑥ console error 0", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 200));
} finally {
  if (mutated) {
    const status = await putGraph(original);
    console.log(`원복 PUT status=${status}`);
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
```

- [ ] **Step 3: 환경 기동 + 실행**

```bash
# 좀비 정리 후 백엔드·프론트 기동 (워크트리 루트 기준)
pkill -f "next dev" || true
cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000 &
cd frontend && npm run dev &
# 준비되면
cd frontend && npm i --no-save playwright-core && node scripts/pw-verify-word-export.mjs
```

Expected: `10/10 PASS`, exit 0. 시드에 URL 노드가 없으면 "원복 PUT status=200" 로그 확인(dev.db 오염 방지).
FAIL 시: `docs/lessons/browser-verification.md`의 dev.db 오염/좀비 프론트 함정 먼저 의심.

- [ ] **Step 4: 실제 Word 수동 검증 항목 기록 (자동화 불가)**

PROGRESS.md에 남길 미검증 항목 — Windows PC에서:
1. 생성 .docx를 Word로 열기(복구 프롬프트 없이 열려야 함) 2. 도형 그룹 선택·복사 → 새 문서 붙여넣기 3. 하이퍼링크 Ctrl+클릭 동작 4. 접점(stCxn idx) 위치가 의도한 변인지 — 어긋나면 `SIDE_TO_CXN_IDX` 보정.

- [ ] **Step 5: PROGRESS.md 갱신 + 커밋**

```
- T4: pw-verify-word-export.mjs — 버튼/다운로드/unzip 구조/하이퍼링크/흑백·폰트/콘솔 10항목, 로컬 실행 결과 기록. ⚠️ Word 실물 열기·복붙·링크 클릭·접점 위치는 Windows 수동 검증 대기.
```

```bash
git add scripts/pw-verify-word-export.mjs ../PROGRESS.md
git commit -m "test(word-export): browser verify for docx download — Word 내보내기 브라우저 검증"
```

---

## Self-Review 결과

- **Spec coverage**: §2 요구사항(현재 스코프 노드/엣지 T3, 라벨+URL라벨 2행 T1, 기타 필드 제외 T1/T3, 그룹화 T1 wpg, PNG 무변경 T3 Step4, 그룹박스 제외 — 렌더 안 함) / §3(순수 함수 T1, fflate T1, 진입점 T3, 파일명 T3) / §4(프리셋 T1, 흑백 T1, Arial/바탕체 11pt T1, 페이지 fit T1, 접점 T2, 엣지 라벨 T2) / §5(no-op T3, err.exportWord T3, 이스케이프 T1) / §6(vitest T1·T2, Playwright T4, 수동 T4) — 전부 태스크에 매핑됨.
- **잔여 리스크(계획된 것)**: `SIDE_TO_CXN_IDX`의 프리셋별 접점 순서와 `wp:inline` 그룹의 Word 호환은 T4 수동 검증에서 실측 — 스펙 §4가 "구현 시 실측 확정"으로 명시한 항목. 어긋나면 T4에서 상수/앵커 방식 보정.
- **Type consistency**: `buildDocx(nodes, edges)` 시그니처 T1~T3 동일, `WordExportNode.title`←`NodeData.label` 매핑은 T3 핸들러에서 수행, `exportCanvasWord`는 T3에서 정의·사용.
