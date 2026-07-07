// CSV 임포트 파서·그래프 변환 단위 테스트 (설계: docs/superpowers/specs/2026-07-06-csv-import-design.md)
import { describe, expect, it } from "vitest";

import type { Graph } from "./api";
import {
  buildAiPromptText,
  buildGraphFromCsv,
  buildTemplateCsv,
  decodeCsvBuffer,
  parseCsvRecords,
  stripCsvFences,
} from "./csv-import";

const HEADER = "Name,System,Duration,URL,Next";

function graphOf(csv: string): Graph {
  const outcome = buildGraphFromCsv(csv);
  expect(outcome.errors).toEqual([]);
  if (outcome.graph === null) throw new Error("graph is null");
  return outcome.graph;
}

describe("parseCsvRecords", () => {
  it("따옴표 안 쉼표·이스케이프 따옴표·CRLF를 처리한다", () => {
    const records = parseCsvRecords('a,"b,c","d""e"\r\nf,g,h\r\n');
    expect(records).toEqual([
      { cells: ["a", "b,c", 'd"e'], line: 1 },
      { cells: ["f", "g", "h"], line: 2 },
    ]);
  });

  it("따옴표 안 줄바꿈 셀 이후 행 번호가 파일 실제 행을 가리킨다", () => {
    const records = parseCsvRecords('a,"line1\nline2"\nb,c\n');
    expect(records[0].cells[1]).toBe("line1\nline2");
    expect(records[1]).toEqual({ cells: ["b", "c"], line: 3 });
  });

  it("전부 빈 셀인 행은 건너뛴다", () => {
    const records = parseCsvRecords("a,b\n,\n \nc,d\n");
    expect(records.map((r) => r.cells[0])).toEqual(["a", "c"]);
  });
});

describe("decodeCsvBuffer", () => {
  it("UTF-8 BOM을 제거한다", () => {
    const bytes = new TextEncoder().encode("\uFEFFName\nA");
    expect(decodeCsvBuffer(bytes.buffer)).toBe("Name\nA");
  });

  it("UTF-8이 아니면 EUC-KR로 폴백한다", () => {
    // "한글" EUC-KR 바이트: C7 D1 B1 DB
    const ascii = Array.from(new TextEncoder().encode("Name\n"));
    const bytes = new Uint8Array([...ascii, 0xc7, 0xd1, 0xb1, 0xdb]);
    expect(decodeCsvBuffer(bytes.buffer)).toBe("Name\n한글");
  });
});

describe("buildGraphFromCsv — 그래프 변환", () => {
  it("행 노드 + 자동 Start/End + decision 추론으로 그래프를 만든다", () => {
    const graph = graphOf(
      [
        HEADER,
        "Review,SAP ERP,2 days,https://ex.com/doc,Decide",
        "Decide,,,,Sign:approved;Reject:rejected",
        "Sign,,3 days,,",
        "Reject,,1 day,,",
      ].join("\n"),
    );
    // 4행 + Start + End = 6 노드
    expect(graph.nodes).toHaveLength(6);
    const byTitle = new Map(graph.nodes.map((n) => [n.title, n]));
    expect(byTitle.get("Start")?.node_type).toBe("start");
    expect(byTitle.get("End")?.node_type).toBe("end");
    expect(byTitle.get("End")?.is_primary_end).toBe(true);
    expect(byTitle.get("Decide")?.node_type).toBe("decision"); // Next 2개 → decision
    expect(byTitle.get("Review")?.node_type).toBe("process");
    expect(byTitle.get("Review")?.system).toBe("SAP ERP");
    expect(byTitle.get("Review")?.duration).toBe("2 days");
    expect(byTitle.get("Review")?.url).toBe("https://ex.com/doc");
    // 엣지: Start→Review, Review→Decide, Decide→Sign(approved), Decide→Reject(rejected), Sign→End, Reject→End
    expect(graph.edges).toHaveLength(6);
    const label = (from: string, to: string) =>
      graph.edges.find(
        (e) =>
          e.source_node_id === byTitle.get(from)?.id &&
          e.target_node_id === byTitle.get(to)?.id,
      )?.label;
    expect(label("Start", "Review")).toBe("");
    expect(label("Decide", "Sign")).toBe("approved");
    expect(label("Decide", "Reject")).toBe("rejected");
    expect(label("Sign", "End")).toBe("");
    // dagre 배치 — 좌표가 전부 (0,0)이 아니다
    expect(graph.nodes.some((n) => n.pos_x !== 0 || n.pos_y !== 0)).toBe(true);
    expect(graph.groups).toEqual([]);
  });

  it("헤더는 대소문자·순서 무관, 옵션 컬럼 생략 가능", () => {
    const graph = graphOf("next,NAME\nB,A\n,B");
    const byTitle = new Map(graph.nodes.map((n) => [n.title, n]));
    expect(byTitle.get("A")).toBeDefined();
    expect(byTitle.get("B")).toBeDefined();
  });

  it("템플릿 CSV는 에러 없이 변환된다", () => {
    const outcome = buildGraphFromCsv(buildTemplateCsv());
    expect(outcome.errors).toEqual([]);
    expect(outcome.graph).not.toBeNull();
  });
});

describe("buildGraphFromCsv — 검증 에러", () => {
  it("빈 파일 / 데이터 0행", () => {
    expect(buildGraphFromCsv("").errors[0].message).toMatch(/empty/i);
    expect(buildGraphFromCsv(HEADER).errors[0].message).toMatch(/no data/i);
  });

  it("미지 컬럼·Name 컬럼 누락", () => {
    expect(buildGraphFromCsv("Name,Foo\nA,").errors[0].message).toContain('Unknown column "Foo"');
    expect(buildGraphFromCsv("System\nERP").errors.some((e) => e.message.includes('"Name"'))).toBe(true);
  });

  it("Name 누락·중복은 파일 실제 행 번호로 보고한다", () => {
    const errors = buildGraphFromCsv(`${HEADER}\n,ERP,,,\nA,,,,\nA,,,,`).errors;
    expect(errors).toEqual([
      { line: 2, message: "Name is required" },
      { line: 4, message: 'Duplicate name "A"' },
    ]);
  });

  it("Next 대상 미존재·셀 내 중복", () => {
    const errors = buildGraphFromCsv(`${HEADER}\nA,,,,Missing\nB,,,,A;A`).errors;
    expect(errors.some((e) => e.line === 2 && e.message.includes('"Missing"'))).toBe(true);
    expect(errors.some((e) => e.line === 3 && e.message.includes("Duplicate Next"))).toBe(true);
  });

  it("URL 스킴·행 수 상한", () => {
    expect(
      buildGraphFromCsv(`${HEADER}\nA,,,ftp://x,`).errors[0].message,
    ).toMatch(/http/);
    const big = [HEADER, ...Array.from({ length: 501 }, (_, i) => `N${i},,,,`)].join("\n");
    expect(buildGraphFromCsv(big).errors[0].message).toMatch(/max 500/i);
  });

  it("자기 참조(재작업 루프)는 허용한다", () => {
    const graph = graphOf(`${HEADER}\nA,,,,A;B\nB,,,,`);
    const a = graph.nodes.find((n) => n.title === "A");
    expect(graph.edges.some((e) => e.source_node_id === a?.id && e.target_node_id === a?.id)).toBe(true);
  });

  it("Next 라벨 200자 초과는 에러, 정확히 200자는 통과 (Edge.label String(200) 미러)", () => {
    const over = buildGraphFromCsv(`${HEADER}\nA,,,,B:${"x".repeat(201)}\nB,,,,`).errors;
    expect(over.some((e) => e.line === 2 && e.message.includes("label exceeds"))).toBe(true);

    const exact = buildGraphFromCsv(`${HEADER}\nA,,,,B:${"y".repeat(200)}\nB,,,,`).errors;
    expect(exact).toEqual([]);
  });
});

describe("외부 AI 왕복 — 프롬프트·펜스 스트립", () => {
  it("buildAiPromptText: 헤더·규칙·예시가 스펙에서 파생된다", () => {
    const prompt = buildAiPromptText();
    expect(prompt).toContain("Name,System,Duration,URL,URL_Label,Next"); // 헤더 명시
    expect(prompt).toContain("Start·End(시작/종료) 행은 쓰지 마세요"); // 자동 생성 규칙
    expect(prompt).toContain("세미콜론(;)"); // Next 구분 규칙
    expect(prompt).toContain("최대 500개"); // MAX_DATA_ROWS 파생
    expect(prompt).toContain(buildTemplateCsv().split("\r\n")[1]); // 예시 행 포함
  });

  it("stripCsvFences: ```csv 펜스를 벗기고 본문만 반환", () => {
    const body = "Name,System,Duration,URL,Next\nA,,,,";
    expect(stripCsvFences("```csv\n" + body + "\n```")).toBe(body);
    expect(stripCsvFences("```\n" + body + "\n```")).toBe(body); // 언어 태그 없는 펜스
    expect(stripCsvFences(body)).toBe(body); // 펜스 없으면 그대로
  });

  it("펜스로 감싼 CSV도 스트립 후 정상 파싱된다 (붙여넣기 경로)", () => {
    const fenced = "```csv\nName,System,Duration,URL,Next\nA,,,,B\nB,,,,\n```";
    const outcome = buildGraphFromCsv(stripCsvFences(fenced));
    expect(outcome.errors).toEqual([]);
    expect(outcome.nodeCount).toBe(4); // A·B + 자동 Start/End
  });
});

describe("url_label column", () => {
  it("carries url_label onto the node when url present", () => {
    const out = buildGraphFromCsv(
      "Name,System,Duration,URL,URL_Label,Next\nA,,,https://example.com/a,Doc A,\n",
    );
    expect(out.errors).toEqual([]);
    const a = out.graph?.nodes.find((n) => n.title === "A");
    expect(a?.url_label).toBe("Doc A");
    expect(out.ignoredLabelCount).toBe(0);
  });

  it("ignores label without url and counts it (no error)", () => {
    const out = buildGraphFromCsv(
      "Name,System,Duration,URL,URL_Label,Next\nA,,,,Orphan,\nB,,,https://example.com/b,,\n",
    );
    expect(out.errors).toEqual([]);
    expect(out.ignoredLabelCount).toBe(1);
    const a = out.graph?.nodes.find((n) => n.title === "A");
    expect(a?.url_label).toBe("");
  });

  it("rejects over-long url_label when url present", () => {
    const out = buildGraphFromCsv(
      `Name,System,Duration,URL,URL_Label,Next\nA,,,https://example.com/a,${"x".repeat(101)},\n`,
    );
    expect(out.errors.some((e) => e.message.includes("url_label"))).toBe(true);
  });

  it("old 5-column header still parses (url_label optional)", () => {
    const out = buildGraphFromCsv("Name,System,Duration,URL,Next\nA,,,,\n");
    expect(out.errors).toEqual([]);
    expect(out.ignoredLabelCount).toBe(0);
  });
});
