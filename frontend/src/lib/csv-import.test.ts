// CSV 임포트 파서·그래프 변환 단위 테스트 (설계: docs/superpowers/specs/2026-07-10-csv-import-merge-design.md)
import { describe, expect, it } from "vitest";

import type { AiNode, Directory, Graph, GraphEdge, GraphNode } from "./api";
import {
  buildAiPromptText,
  buildGraphFromAiProposal,
  buildGraphFromCsv,
  buildTemplateCsv,
  type CsvDirectory,
  decodeCsvBuffer,
  parseCsvRecords,
  stripCsvExtension,
  stripCsvFences,
  toCsvDirectory,
  withKeptNodes,
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
        "Review,SAP ERP,2,https://ex.com/doc,Decide",
        "Decide,,,,Sign:approved;Reject:rejected",
        "Sign,,3,,",
        "Reject,,1,,",
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
    expect(byTitle.get("Review")?.duration).toBe("2");
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

  it("14컬럼 헤더를 파싱한다", () => {
    const csv = [
      "Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next",
      "검토,,,,,1.30,1250000,,2,1200,0.8,,,",
    ].join("\n");
    const outcome = buildGraphFromCsv(csv);
    expect(outcome.errors).toEqual([]);
    const node = outcome.graph!.nodes.find((n) => n.title === "검토")!;
    expect(node.duration).toBe("1.30");
    expect(node.cost_krw).toBe("1250000");
    expect(node.cost_usd).toBe("");
    expect(node.headcount).toBe("2");
    expect(node.annual_count).toBe("1200");
    expect(node.fte).toBe("0.8");
  });

  it("콤마 표기 비용을 허용한다", () => {
    const csv = ["Name,Duration,Cost_KRW", '검토,1.30,"1,250,000"'].join("\n");
    const outcome = buildGraphFromCsv(csv);
    expect(outcome.errors).toEqual([]);
    expect(outcome.graph!.nodes.find((n) => n.title === "검토")!.cost_krw).toBe("1250000");
  });

  it("원·달러를 동시에 채운 행은 에러", () => {
    const csv = ["Name,Cost_KRW,Cost_USD", "검토,1000,10"].join("\n");
    const outcome = buildGraphFromCsv(csv);
    expect(outcome.graph).toBeNull();
    expect(outcome.errors[0].message).toMatch(/only one/i);
  });

  it("구 헤더(ETF/Cost/Extra)는 미지원 헤더 에러", () => {
    const csv = ["Name,ETF", "검토,1"].join("\n");
    const outcome = buildGraphFromCsv(csv);
    expect(outcome.graph).toBeNull();
    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.errors[0].message).toContain('Unknown column "ETF"');
  });

  it("숫자 파라미터 컬럼을 파싱·정규화한다", () => {
    const csv = [
      "Name,Duration,Headcount,FTE,Cost_KRW,Annual_Count,Next",
      "A,0.75,2,1.5,300,7,B",
      "B,,,,,,",
    ].join("\r\n");
    const outcome = buildGraphFromCsv(csv);
    const a = outcome.graph?.nodes.find((n) => n.title === "A");
    expect(a?.duration).toBe("1.15"); // 60분 이월
    expect([a?.headcount, a?.fte, a?.cost_krw, a?.annual_count]).toEqual(["2", "1.5", "300", "7"]);
  });

  it("비숫자 파라미터는 행 번호와 함께 에러", () => {
    const csv = ["Name,Duration,Headcount", "A,2일,두명"].join("\r\n");
    const outcome = buildGraphFromCsv(csv);
    expect(outcome.graph).toBeNull();
    expect(outcome.errors).toEqual([
      { line: 2, message: expect.stringContaining("Duration") },
      { line: 2, message: expect.stringContaining("Headcount") },
    ]);
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
    expect(prompt).toContain(
      "Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next",
    ); // 헤더 명시
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

// ── 설명 · 담당자(login_id) · 부서 컬럼 ──────────────────────────

const H9 = "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next";

const DIR: CsvDirectory = {
  users: [
    { id: "hong.gd", name: "홍길동", department: "Quality Part 1" },
    { id: "kim.cs", name: "김철수", department: "Quality Part 1" },
    { id: "lee.yh", name: "이영희", department: "Finance Part" },
  ],
  departments: ["Quality Part 1", "Finance Part"],
  dept_infos: { "Quality Part 1": { korean_name: "품질1파트" } },
};

function outcomeOf(csv: string, directory?: CsvDirectory) {
  return buildGraphFromCsv(csv, directory ? { directory } : undefined);
}

describe("buildGraphFromCsv — Description/Assignee/Department 컬럼", () => {
  it("설명 셀을 노드 description으로 싣는다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,담당자가 내용을 확인한다,,,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.description).toBe("담당자가 내용을 확인한다");
  });

  it("따옴표 안 콤마·줄바꿈을 품은 설명을 그대로 싣는다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,"1줄, 쉼표\n2줄",,,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.description).toBe("1줄, 쉼표\n2줄");
  });

  it("login_id를 이름으로 해석한다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,hong.gd,Quality Part 1,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.warnings).toEqual([]);
    const node = o.graph!.nodes.find((n) => n.title === "요청 검토")!;
    expect(node.assignee).toBe("홍길동");
    expect(node.department).toBe("Quality Part 1");
  });

  it("따옴표 셀의 복수 login_id를 해석해 \", \"로 잇는다", () => {
    const o = outcomeOf(`${H9}\n승인,,"hong.gd, kim.cs",Quality Part 1,,,,,\n`, DIR);
    expect(o.warnings).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "승인")!.assignee).toBe("홍길동, 김철수");
  });

  it("이미 이름으로 적힌 토큰은 경고 없이 통과시킨다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,홍길동,Quality Part 1,,,,,\n`, DIR);
    expect(o.warnings).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.assignee).toBe("홍길동");
  });

  it("해석되지 않는 담당자는 원문을 남기고 경고한다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,ghost.id,Quality Part 1,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.assignee).toBe("ghost.id");
    expect(o.warnings).toHaveLength(1);
    expect(o.warnings[0].line).toBe(2);
    expect(o.warnings[0].message).toContain("ghost.id");
  });

  it("한글 부서명을 정식 부서명으로 되돌린다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,hong.gd,품질1파트,,,,,\n`, DIR);
    expect(o.warnings).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.department).toBe("Quality Part 1");
  });

  it("알 수 없는 부서는 원문을 남기고 경고한다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,,없는파트,,,,,\n`, DIR);
    expect(o.graph!.nodes.find((n) => n.title === "요청 검토")!.department).toBe("없는파트");
    expect(o.warnings.some((w) => w.message.includes("없는파트"))).toBe(true);
  });

  it("담당자 부서가 행 부서와 다르면 경고한다 (assignee.ts 불변식)", () => {
    const o = outcomeOf(`${H9}\n승인,,"hong.gd, lee.yh",Quality Part 1,,,,,\n`, DIR);
    expect(o.errors).toEqual([]);
    expect(o.warnings.some((w) => w.message.includes("이영희"))).toBe(true);
  });

  it("해석 후 길이가 100자를 넘으면 에러다 (NodeIn max_length 미러)", () => {
    const longName = "가".repeat(101);
    const dir: CsvDirectory = { users: [{ id: "x", name: longName, department: "Finance Part" }], departments: ["Finance Part"] };
    const o = outcomeOf(`${H9}\n요청 검토,,x,Finance Part,,,,,\n`, dir);
    expect(o.graph).toBeNull();
    expect(o.errors[0].message).toContain("assignee");
  });

  it("디렉터리가 없으면 해석도 경고도 하지 않는다", () => {
    const o = outcomeOf(`${H9}\n요청 검토,,hong.gd,품질1파트,,,,,\n`);
    expect(o.warnings).toEqual([]);
    const node = o.graph!.nodes.find((n) => n.title === "요청 검토")!;
    expect(node.assignee).toBe("hong.gd");
    expect(node.department).toBe("품질1파트");
  });

  it("새 열이 없는 옛 CSV도 그대로 파싱된다 (회귀)", () => {
    const o = outcomeOf(`${HEADER}\nReview request,SAP,2,,\n`, DIR);
    expect(o.errors).toEqual([]);
    const node = o.graph!.nodes.find((n) => n.title === "Review request")!;
    expect(node.description).toBe("");
    expect(node.assignee).toBe("");
    expect(node.department).toBe("");
    expect(node.system).toBe("SAP");
  });
});

// ── 머지 임포트 (base 지정) ─────────────────────────────────────

const NODE_BASE: Omit<GraphNode, "id" | "title" | "node_type" | "sort_order"> = {
  description: "", color: "", assignee: "", department: "", system: "", duration: "",
  url: "", url_label: "", pos_x: 0, pos_y: 0, group_ids: [],
  linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
};

function baseGraph(): Graph {
  return {
    nodes: [
      { ...NODE_BASE, id: "s1", title: "시작", node_type: "start", sort_order: 0 },
      {
        ...NODE_BASE, id: "a1", title: "Review request", node_type: "process", sort_order: 1,
        pos_x: 300, pos_y: 40, color: "#334155", assignee: "홍길동", department: "Quality Part 1",
        system: "SAP", description: "기존 설명", group_ids: ["g1"],
      },
      { ...NODE_BASE, id: "e1", title: "종료", node_type: "end", sort_order: 2, pos_x: 600, is_primary_end: true },
    ],
    edges: [
      { id: "x1", source_node_id: "s1", target_node_id: "a1", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null },
      { id: "x2", source_node_id: "a1", target_node_id: "e1", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null },
    ],
    groups: [{ id: "g1", parent_group_id: null, label: "검수", color: "" }],
  };
}

function mergeOf(csv: string, base = baseGraph()) {
  return buildGraphFromCsv(csv, { base });
}

describe("buildGraphFromCsv — 머지", () => {
  it("제목이 같은 노드는 id를 재사용한다 (계보·코멘트 보존의 근거)", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.errors).toEqual([]);
    expect(o.graph!.nodes.find((n) => n.title === "Review request")!.id).toBe("a1");
    expect(o.merge.matchedCount).toBe(3); // start + Review request + end
    expect(o.merge.addedNodeIds).toEqual([]);
    expect(o.merge.removedNodes).toEqual([]);
  });

  it("빈 셀은 기존 값을 지킨다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.description).toBe("기존 설명");
    expect(node.assignee).toBe("홍길동");
    expect(node.department).toBe("Quality Part 1");
    expect(node.system).toBe("SAP");
  });

  it("값이 있는 셀은 덮어쓴다", () => {
    const o = buildGraphFromCsv(`${H9}\nReview request,새 설명,kim.cs,Quality Part 1,ERP,5,,,\n`, { base: baseGraph(), directory: DIR });
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.description).toBe("새 설명");
    expect(node.assignee).toBe("김철수");
    expect(node.department).toBe("Quality Part 1");
    expect(node.system).toBe("ERP");
    expect(node.duration).toBe("5");
  });

  it("CSV가 싣지 않는 필드는 언제나 보존한다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.color).toBe("#334155");
    expect(node.group_ids).toEqual(["g1"]);
    expect(node.pos_x).toBe(300);
  });

  it("기존 그룹을 그대로 통과시킨다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.graph!.groups).toEqual([{ id: "g1", parent_group_id: null, label: "검수", color: "" }]);
  });

  it("Start/End는 타입으로 매칭하고 기존 제목을 유지한다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    const start = o.graph!.nodes.find((n) => n.node_type === "start")!;
    const end = o.graph!.nodes.find((n) => n.node_type === "end")!;
    expect([start.id, start.title]).toEqual(["s1", "시작"]);
    expect([end.id, end.title]).toEqual(["e1", "종료"]);
    expect(end.is_primary_end).toBe(true);
  });

  it("서브프로세스 노드는 node_type을 보존한다 (Call Activity 링크 유지)", () => {
    const base = baseGraph();
    base.nodes[1] = { ...base.nodes[1], node_type: "subprocess", linked_map_id: 7 };
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`, base);
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    expect(node.node_type).toBe("subprocess");
    expect(node.linked_map_id).toBe(7);
  });

  it("서브프로세스 매칭 행은 annual_count·fte만 반영하고 나머지 4필드는 드롭 + 경고 (링크 맵 지정값 보호)", () => {
    const base = baseGraph();
    base.nodes[1] = {
      ...base.nodes[1], node_type: "subprocess", linked_map_id: 7,
      duration: "2", cost_krw: "5000", headcount: "3", annual_count: "10", fte: "0.2",
    };
    const csv = [
      "Name,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE",
      "Review request,9,99999,,9,50,0.9",
    ].join("\n");
    const o = mergeOf(csv, base);
    expect(o.errors).toEqual([]);
    const node = o.graph!.nodes.find((n) => n.id === "a1")!;
    // 링크 맵이 소유한 4필드는 CSV 값이 반영되지 않고 기존값을 그대로 지킨다
    expect(node.duration).toBe("2");
    expect(node.cost_krw).toBe("5000");
    expect(node.headcount).toBe("3");
    // 부모가 편집 가능한 2필드는 CSV 값이 반영된다
    expect(node.annual_count).toBe("50");
    expect(node.fte).toBe("0.9");
    expect(o.warnings.some((w) => w.line === 2 && w.message.includes("Review request"))).toBe(true);
  });

  it("CSV에만 있는 행은 신규 노드가 되고 addedNodeIds에 담긴다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,Sign contract\nSign contract,,,,,,,,\n`);
    const sign = o.graph!.nodes.find((n) => n.title === "Sign contract")!;
    expect(o.merge.addedNodeIds).toEqual([sign.id]);
    expect(sign.id).not.toBe("a1");
  });

  it("base에만 있는 노드는 결과에서 빠지고 removedNodes로 보고된다", () => {
    const o = mergeOf(`${H9}\nSign contract,,,,,,,,\n`);
    expect(o.graph!.nodes.some((n) => n.id === "a1")).toBe(false);
    expect(o.merge.removedNodes.map((n) => n.id)).toEqual(["a1"]);
  });

  it("결과 그래프에 없는 base 엣지를 lostEdges로 보고한다", () => {
    const o = mergeOf(`${H9}\nSign contract,,,,,,,,\n`);
    expect(o.merge.lostEdges.map((e) => e.id).sort()).toEqual(["x1", "x2"]);
  });

  it("흐름이 그대로면 lostEdges가 비어 있다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.merge.lostEdges).toEqual([]);
  });

  it("신규 노드만 재배치하고 매칭 노드 좌표는 건드리지 않는다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,Sign contract\nSign contract,,,,,,,,\n`);
    expect(o.graph!.nodes.find((n) => n.id === "a1")!.pos_x).toBe(300);
    expect(o.graph!.nodes.find((n) => n.id === "s1")!.pos_x).toBe(0);
  });

  it("base 미지정이면 전량 신규다 (회귀)", () => {
    const o = buildGraphFromCsv(`${H9}\nReview request,,,,,,,,\n`);
    expect(o.merge.removedNodes).toEqual([]);
    expect(o.merge.matchedCount).toBe(0);
    expect(o.merge.addedNodeIds).toHaveLength(3); // Start + 1행 + End
    expect(o.graph!.groups).toEqual([]);
  });

  it("빈 base는 base 미지정과 같다", () => {
    const o = buildGraphFromCsv(`${H9}\nReview request,,,,,,,,\n`, { base: { nodes: [], edges: [], groups: [] } });
    expect(o.merge.matchedCount).toBe(0);
    expect(o.merge.removedNodes).toEqual([]);
  });
});

describe("withKeptNodes", () => {
  it("소멸 노드를 엣지 없이 되돌리고 sort_order를 뒤에 붙인다", () => {
    const o = mergeOf(`${H9}\nSign contract,,,,,,,,\n`);
    const maxOrder = o.graph!.nodes.reduce((max, n) => Math.max(max, n.sort_order), 0);
    const kept = withKeptNodes(o.graph!, o.merge.removedNodes);
    const review = kept.nodes.find((n) => n.id === "a1")!;
    expect(review.title).toBe("Review request");
    expect(review.color).toBe("#334155");
    expect(kept.edges.some((e) => e.source_node_id === "a1" || e.target_node_id === "a1")).toBe(false);
    expect(review.sort_order).toBe(maxOrder + 1);
  });

  it("유지 노드가 대표 끝을 다시 들고 오지 않는다 (validate_process 위반 방지)", () => {
    const base = baseGraph();
    base.nodes.push({ ...NODE_BASE, id: "e2", title: "취소 종료", node_type: "end", sort_order: 3 });
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`, base);
    const kept = withKeptNodes(o.graph!, o.merge.removedNodes);
    expect(kept.nodes.filter((n) => n.is_primary_end)).toHaveLength(1);
  });

  it("빈 배열이면 그래프를 그대로 반환한다", () => {
    const o = mergeOf(`${H9}\nReview request,,,,,,,,\n`);
    expect(withKeptNodes(o.graph!, [])).toBe(o.graph!);
  });
});

// ── 생성 플로우용 순수 헬퍼 ──────────────────────────────────────

describe("stripCsvExtension", () => {
  it(".csv 확장자를 뗀다", () => {
    expect(stripCsvExtension("sales-process.csv")).toBe("sales-process");
  });

  it("대문자 확장자도 뗀다", () => {
    expect(stripCsvExtension("SALES.CSV")).toBe("SALES");
  });

  it("마지막 .csv만 뗀다 (앞의 점은 이름의 일부)", () => {
    expect(stripCsvExtension("2026.q3.plan.csv")).toBe("2026.q3.plan");
  });

  it("다른 확장자는 건드리지 않는다", () => {
    expect(stripCsvExtension("notes.txt")).toBe("notes.txt");
  });

  it("확장자가 없으면 그대로 둔다", () => {
    expect(stripCsvExtension("plan")).toBe("plan");
  });

  it("확장자뿐이면 빈 문자열이 된다", () => {
    expect(stripCsvExtension(".csv")).toBe("");
  });

  it("빈 문자열은 빈 문자열이다", () => {
    expect(stripCsvExtension("")).toBe("");
  });
});

describe("toCsvDirectory", () => {
  const dir: Directory = {
    users: [
      { id: "hong.gd", name: "홍길동", department: "Quality Part 1" },
      { id: "lee.yh", name: "이영희", department: "Finance Part" },
    ],
    departments: [
      { id: "HQ/Quality Office/Quality Part 1", name: "Quality Part 1", korean_name: "품질1파트", manager: "hong.gd" },
      { id: "HQ/Finance Part", name: "Finance Part", korean_name: "", manager: "" },
    ],
  };

  it("부서 목록은 org_path가 아니라 말단명이다 (node.department가 담는 값)", () => {
    expect(toCsvDirectory(dir).departments).toEqual(["Quality Part 1", "Finance Part"]);
  });

  it("한글 부서명이 있는 부서만 dept_infos에 담는다", () => {
    expect(toCsvDirectory(dir).dept_infos).toEqual({
      "Quality Part 1": { korean_name: "품질1파트" },
    });
  });

  it("사용자는 id·name·department만 옮긴다", () => {
    expect(toCsvDirectory(dir).users).toEqual([
      { id: "hong.gd", name: "홍길동", department: "Quality Part 1" },
      { id: "lee.yh", name: "이영희", department: "Finance Part" },
    ]);
  });

  it("빈 디렉터리도 안전하다", () => {
    expect(toCsvDirectory({ users: [], departments: [] })).toEqual({
      users: [],
      departments: [],
      dept_infos: {},
    });
  });

  it("결과를 buildGraphFromCsv가 그대로 쓸 수 있다 (login_id → 이름 해석)", () => {
    const csv = "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next\n검토,,hong.gd,품질1파트,,,,,\n";
    const outcome = buildGraphFromCsv(csv, { directory: toCsvDirectory(dir) });
    expect(outcome.errors).toEqual([]);
    expect(outcome.warnings).toEqual([]);
    const node = outcome.graph!.nodes.find((n) => n.title === "검토")!;
    expect(node.assignee).toBe("홍길동");
    expect(node.department).toBe("Quality Part 1");
  });
});

describe("buildGraphFromAiProposal (2026-07-11 AI graph merge)", () => {
  const aiNode = (key: string, title: string, node_type = "process", attributes: Partial<NonNullable<AiNode["attributes"]>> | null = null): AiNode => ({
    key, title, node_type, description: "",
    attributes: attributes ? { assignee: null, department: null, system: null, duration: null, color: null, url: null, url_label: null, ...attributes } : null,
    group_key: null,
  });
  const baseNode = (id: string, title: string, over: Partial<GraphNode> = {}): GraphNode => ({
    id, title, description: "", node_type: "process", color: "#6a9985", assignee: "홍길동", department: "구매팀",
    system: "", duration: "", url: "", url_label: "", pos_x: 300, pos_y: 200, sort_order: 1,
    group_ids: ["g1"], linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
    ...over,
  });
  const base = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({
    nodes, edges, groups: [{ id: "g1", parent_group_id: null, label: "Lane", color: "" }],
  });

  it("reuses matched node id and preserves coords/color/group/assignee", () => {
    const existing = baseNode("n1", "견적 검토");
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "견적 검토")], edges: [], groups: [] },
      { base: base([existing]) },
    );
    const merged = outcome.graph?.nodes.find((n) => n.title === "견적 검토");
    expect(merged?.id).toBe("n1");
    expect(merged?.pos_x).toBe(300);
    expect(merged?.color).toBe("#6a9985");
    expect(merged?.group_ids).toEqual(["g1"]);
    expect(merged?.assignee).toBe("홍길동"); // AI가 비우면 기존 유지
    expect(outcome.merge.matchedCount).toBeGreaterThanOrEqual(1);
  });

  it("preserves subprocess node_type/link/color on title match", () => {
    const sub = baseNode("s1", "발주 하위", { node_type: "subprocess", linked_map_id: 7, color: "" });
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "발주 하위", "process", { color: "#aa0000" })], edges: [], groups: [] },
      { base: base([sub]) },
    );
    const merged = outcome.graph?.nodes.find((n) => n.id === "s1");
    expect(merged?.node_type).toBe("subprocess");
    expect(merged?.linked_map_id).toBe(7);
    expect(merged?.color).toBe(""); // 매칭 노드 색은 기존 유지(AI 색 무시)
  });

  it("sets assignee when AI provides one explicitly", () => {
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "견적 검토", "process", { assignee: "김담당" })], edges: [], groups: [] },
      { base: base([baseNode("n1", "견적 검토")]) },
    );
    expect(outcome.graph?.nodes.find((n) => n.id === "n1")?.assignee).toBe("김담당");
  });

  it("normalizes AI duration — invalid echo keeps existing, valid form adopted", () => {
    const existing = baseNode("n1", "견적 검토", { duration: "1.30" });
    const invalid = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "견적 검토", "process", { duration: "3일" })], edges: [], groups: [] },
      { base: base([existing]) },
    );
    expect(invalid.graph?.nodes.find((n) => n.id === "n1")?.duration).toBe("1.30");
    const valid = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "견적 검토", "process", { duration: "2.90" })], edges: [], groups: [] },
      { base: base([existing]) },
    );
    expect(valid.graph?.nodes.find((n) => n.id === "n1")?.duration).toBe("3.30"); // 60분 이월 정규화
  });

  it("lists unmatched base nodes as removed and lost edges", () => {
    const a = baseNode("n1", "유지됨");
    const b = baseNode("n2", "사라짐", { sort_order: 2 });
    const edge: GraphEdge = { id: "e1", source_node_id: "n1", target_node_id: "n2", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null };
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "유지됨")], edges: [], groups: [] },
      { base: base([a, b], [edge]) },
    );
    expect(outcome.merge.removedNodes.map((n) => n.id)).toEqual(["n2"]);
    expect(outcome.merge.lostEdges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("remaps AI edges to reused ids and ignores AI groups when base is non-empty", () => {
    const outcome = buildGraphFromAiProposal(
      {
        nodes: [aiNode("a", "견적 검토"), aiNode("b", "신규 승인")],
        edges: [{ source: "a", target: "b", label: "ok" }],
        groups: [{ key: "gx", label: "AI lane", color: "", parent_key: null }],
      },
      { base: base([baseNode("n1", "견적 검토")]) },
    );
    const added = outcome.graph?.nodes.find((n) => n.title === "신규 승인");
    expect(outcome.graph?.edges).toEqual([
      expect.objectContaining({ source_node_id: "n1", target_node_id: added?.id, label: "ok" }),
    ]);
    expect(outcome.graph?.groups.map((g) => g.id)).toEqual(["g1"]); // 기존 그룹 유지, AI 그룹 무시
    expect(added?.group_ids).toEqual([]);
  });

  it("matches start/end by type and keeps their titles", () => {
    const start = baseNode("st", "시작", { node_type: "start", sort_order: 0 });
    const end = baseNode("en", "완료", { node_type: "end", is_primary_end: true, sort_order: 9 });
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("s", "Start", "start"), aiNode("e", "End", "end")], edges: [], groups: [] },
      { base: base([start, end]) },
    );
    const ids = outcome.graph?.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["en", "st"]);
    expect(outcome.merge.addedNodeIds).toEqual([]);
  });

  it("creates AI groups and full layout on empty base", () => {
    const node = { ...aiNode("a", "단독"), group_key: "gx" };
    const outcome = buildGraphFromAiProposal(
      { nodes: [node], edges: [], groups: [{ key: "gx", label: "AI lane", color: "", parent_key: null }] },
      { base: { nodes: [], edges: [], groups: [] } },
    );
    expect(outcome.graph?.groups).toHaveLength(1);
    expect(outcome.graph?.nodes[0]?.group_ids).toEqual([outcome.graph?.groups[0]?.id]);
  });

  it("fails on empty proposal", () => {
    const outcome = buildGraphFromAiProposal({ nodes: [], edges: [], groups: [] }, {});
    expect(outcome.graph).toBeNull();
    expect(outcome.errors).toHaveLength(1);
  });

  it("retains base start/end when the proposal omits them (no opaque 422)", () => {
    const start = baseNode("st", "시작", { node_type: "start", sort_order: 0 });
    const end = baseNode("en", "완료", { node_type: "end", is_primary_end: true, sort_order: 9 });
    const mid = baseNode("n1", "견적 검토");
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "견적 검토")], edges: [], groups: [] },
      { base: base([start, mid, end]) },
    );
    const ids = outcome.graph?.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["en", "n1", "st"]); // start/end 유지 — 소멸 아님
    expect(outcome.merge.removedNodes).toEqual([]);
    expect(outcome.graph?.nodes.filter((n) => n.node_type === "start")).toHaveLength(1);
  });

  it("duplicate base titles — lowest sort_order wins the id, the rest become removed", () => {
    const first = baseNode("n1", "중복", { sort_order: 1 });
    const second = baseNode("n2", "중복", { sort_order: 5 });
    const outcome = buildGraphFromAiProposal(
      { nodes: [aiNode("a", "중복")], edges: [], groups: [] },
      { base: base([first, second]) },
    );
    expect(outcome.graph?.nodes.find((n) => n.title === "중복")?.id).toBe("n1");
    expect(outcome.merge.removedNodes.map((n) => n.id)).toEqual(["n2"]);
  });
});
