// io-items 단위 테스트 — 줄 정렬·판정·인덱스·SP id 부여 + 흐름 경로·불러오기 후보. 설계: docs/superpowers/specs/2026-08-21-io-linking-design.md

import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import {
  applyIoImport, assignSpIoIds, buildIoIndex, buildIoMirrorIndex, canReachForward, collectIoImportCandidates,
  countIoLines, getFlowPathBetween, getIoItemState, getIoLine, setIoLine,
  type IoImportCandidate, type IoNode, type SpRefMap,
} from "./io-items";

const node = (id: string, data: Partial<IoNode["data"]>): IoNode => ({
  id, data: { label: id, nodeType: "process", ...data },
});
const NO_SP: SpRefMap = new Map();

describe("io line helpers", () => {
  it("getIoLine은 범위 밖·빈 문자열에서 빈 값", () => {
    expect(getIoLine("a\nb", 1)).toBe("b");
    expect(getIoLine("a", 3)).toBe("");
    expect(getIoLine(undefined, 0)).toBe("");
  });
  it("setIoLine은 빈 줄 패딩 후 교체, 후행 빈 줄 소거", () => {
    expect(setIoLine("", 2, "x")).toBe("\n\nx");
    expect(setIoLine("a\nb\nc", 2, "")).toBe("a\nb");
    expect(setIoLine("a", 0, "z")).toBe("z");
  });
  it("countIoLines는 빈 문자열=0, 그 외는 줄 수", () => {
    expect(countIoLines(undefined)).toBe(0);
    expect(countIoLines("")).toBe(0);
    expect(countIoLines("a")).toBe(1);
    expect(countIoLines("a\nb\nc")).toBe(3);
  });
});

describe("state & index", () => {
  const origin = node("A", { output: "회의록\n견적", output_ids: "itm_1" });
  const mirror = node("B", { input: "회의록", input_links: "itm_1" });
  it("origin/mirror/plain 판정", () => {
    expect(getIoItemState(origin, "output", 0)).toBe("origin");
    expect(getIoItemState(origin, "output", 1)).toBe("plain");
    expect(getIoItemState(mirror, "input", 0)).toBe("mirror");
  });
  it("같은 줄 id+link 공존 시 origin 우선(무효 링크는 reconcile 소거 대상)", () => {
    const both = node("C", { output: "x", output_ids: "itm_9", output_links: "itm_1" });
    expect(getIoItemState(both, "output", 0)).toBe("origin");
  });
  it("인덱스 — 중복 itemId는 먼저 만난 쪽만, 빈 텍스트 줄 id는 무시", () => {
    const dup = node("D", { output: "복제", output_ids: "itm_1" });
    const idx = buildIoIndex([origin, dup, mirror], NO_SP);
    expect(idx.get("itm_1")).toMatchObject({ nodeId: "A", kind: "out", index: 0, text: "회의록" });
  });
  it("빈 텍스트 줄 id는 인덱싱하지 않는다", () => {
    const blankText = node("E", { output: "\n실item", output_ids: "itm_blank\nitm_real" });
    const idx = buildIoIndex([blankText], NO_SP);
    expect(idx.has("itm_blank")).toBe(false);
    expect(idx.get("itm_real")).toMatchObject({ nodeId: "E", kind: "out", index: 1, text: "실item" });
  });
  it("SP 노드는 지정 ref의 spin/spout로 인덱싱, 미지정 SP는 제외", () => {
    const sp = node("S", { nodeType: "subprocess", linkedMapId: 7 });
    const refs: SpRefMap = new Map([[7, {
      designated: true, input: "원료 목록", output: "검사 성적서",
      input_ids: "sp_in1", output_ids: "sp_out1", input_forms: "", output_forms: "Excel",
    } as never]]);
    const idx = buildIoIndex([sp], refs);
    expect(idx.get("sp_out1")).toMatchObject({ nodeId: "S", kind: "spout", form: "Excel" });
    expect(idx.get("sp_in1")).toMatchObject({ nodeId: "S", kind: "spin" });

    const undesignated = node("U", { nodeType: "subprocess", linkedMapId: 8 });
    // 텍스트·id를 채워야 가드(!ref?.designated) 제거 시 실패하는 유의미한 케이스가 된다 — 빈 mock은 가드 없이도 통과(공허한 단언).
    const refsUndesignated: SpRefMap = new Map([[8, {
      designated: false, input: "원료 목록", output: "검사 성적서",
      input_ids: "sp_in1_u", output_ids: "sp_out1_u", input_forms: "", output_forms: "",
    } as never]]);
    const idxUndesignated = buildIoIndex([undesignated], refsUndesignated);
    expect(idxUndesignated.size).toBe(0);
  });
  it("미러 역인덱스", () => {
    const m = buildIoMirrorIndex([origin, mirror]);
    expect(m.get("itm_1")).toEqual([{ nodeId: "B", side: "input", index: 0 }]);
  });
});

describe("assignSpIoIds", () => {
  it("텍스트 일치 줄은 기존 id 보존, 신규·개명 줄은 새 id, 전 줄 부여", () => {
    const out = assignSpIoIds("검사 성적서\n신규 항목", "검사 성적서", "sp_out1");
    const lines = out.split("\n");
    expect(lines[0]).toBe("sp_out1");
    expect(lines[1]).not.toBe("");
    expect(lines[1]).not.toBe("sp_out1");
  });
  it("빈 텍스트면 빈 결과", () => {
    expect(assignSpIoIds("", "구항목", "sp_1")).toBe("");
  });
});

describe("getFlowPathBetween / canReachForward", () => {
  const chain: Edge[] = [
    { id: "e1", source: "A", target: "B" } as Edge,
    { id: "e2", source: "B", target: "C" } as Edge,
  ];
  it("직선 경로는 엣지 id 순서대로", () => {
    expect(getFlowPathBetween(chain, "A", "C")).toEqual(["e1", "e2"]);
  });
  it("도달 불가면 빈 배열", () => {
    expect(getFlowPathBetween(chain, "C", "A")).toEqual([]);
  });
  it("fromId===toId면 빈 배열", () => {
    expect(getFlowPathBetween(chain, "A", "A")).toEqual([]);
  });
  it("canReachForward는 경로 존재 여부", () => {
    expect(canReachForward(chain, "A", "C")).toBe(true);
    expect(canReachForward(chain, "C", "A")).toBe(false);
  });
  it("사이클에서도 무한루프 없이 종료", () => {
    const cyclic: Edge[] = [
      { id: "e1", source: "A", target: "B" } as Edge,
      { id: "e2", source: "B", target: "A" } as Edge,
    ];
    expect(getFlowPathBetween(cyclic, "A", "B")).toEqual(["e1"]);
    expect(canReachForward(cyclic, "B", "A")).toBe(true);
  });
});

describe("collectIoImportCandidates", () => {
  const edgesChain: Edge[] = [
    { id: "e1", source: "A", target: "B" } as Edge,
    { id: "e2", source: "B", target: "C" } as Edge,
  ];
  const nodesChain: IoNode[] = [
    node("A", { output: "A출력1" }),
    node("B", { output: "B출력1", input: "B입력1" }),
    node("C", { input: "C입력1" }),
  ];

  it("직선 A→B→C에서 C 인풋 후보 = B(hop1)·A(hop2)의 아웃풋, pathEdgeIds는 실제 체인", () => {
    const cands = collectIoImportCandidates({ nodes: nodesChain, edges: edgesChain, spRefs: NO_SP, nodeId: "C", side: "input" });
    expect(cands.map((c) => c.nodeId)).toEqual(["B", "A"]);
    expect(cands[0]).toMatchObject({ nodeId: "B", hop: 1, list: "out", text: "B출력1", pathEdgeIds: ["e2"] });
    expect(cands[1]).toMatchObject({ nodeId: "A", hop: 2, list: "out", text: "A출력1", pathEdgeIds: ["e1", "e2"] });
  });

  it("아웃풋 후보 = 다운스트림 인풋", () => {
    const cands = collectIoImportCandidates({ nodes: nodesChain, edges: edgesChain, spRefs: NO_SP, nodeId: "A", side: "output" });
    expect(cands.map((c) => c.nodeId)).toEqual(["B", "C"]);
    expect(cands[0]).toMatchObject({ nodeId: "B", hop: 1, list: "in", text: "B입력1", pathEdgeIds: ["e1"] });
    expect(cands[1]).toMatchObject({ nodeId: "C", hop: 2, list: "in", text: "C입력1", pathEdgeIds: ["e1", "e2"] });
  });

  it("자기 노드는 후보에서 제외", () => {
    const cands = collectIoImportCandidates({ nodes: nodesChain, edges: edgesChain, spRefs: NO_SP, nodeId: "B", side: "input" });
    expect(cands.some((c) => c.nodeId === "B")).toBe(false);
  });

  it("이미 같은 그룹에 연결된 항목은 제외(alreadyLinked)", () => {
    const originA = node("A", { output: "공유출력", output_ids: "itm_1" });
    const consumer = node("X", { input: "이미연결", input_links: "itm_1" });
    const edges: Edge[] = [{ id: "e1", source: "A", target: "X" } as Edge];
    const cands = collectIoImportCandidates({ nodes: [originA, consumer], edges, spRefs: NO_SP, nodeId: "X", side: "input" });
    expect(cands).toEqual([]);
  });

  it("자기 그룹 재수입 제외(원본이 요청 노드인 미러 후보)", () => {
    // A가 원본(공유출력), 다운스트림 D의 인풋이 이미 그 그룹의 미러(input_links=itm_1) — A가 자신의
    // 아웃풋 후보를 조회할 때 D는 groupId가 자기 자신(A)으로 해소되므로 alreadyLinked와 무관하게 제외돼야 함.
    const originA = node("A", { output: "공유출력", output_ids: "itm_1" });
    const downstreamD = node("D", { input: "공유출력", input_links: "itm_1" });
    const edges: Edge[] = [{ id: "e1", source: "A", target: "D" } as Edge];
    const cands = collectIoImportCandidates({ nodes: [originA, downstreamD], edges, spRefs: NO_SP, nodeId: "A", side: "output" });
    expect(cands.some((c) => c.nodeId === "D")).toBe(false);
  });

  it("미지정 SP는 제외, 지정 SP는 spout/spin으로 등장", () => {
    const spNode = node("S", { nodeType: "subprocess", linkedMapId: 7 });
    const edges: Edge[] = [{ id: "e1", source: "S", target: "X" } as Edge];
    const consumer = node("X", { input: "" });
    const refsDesignated: SpRefMap = new Map([[7, {
      designated: true, output: "SP출력", output_ids: "sp_out1", output_forms: "",
    } as never]]);
    const candsDesignated = collectIoImportCandidates({ nodes: [spNode, consumer], edges, spRefs: refsDesignated, nodeId: "X", side: "input" });
    expect(candsDesignated).toEqual([expect.objectContaining({ nodeId: "S", list: "spout", isSp: true, text: "SP출력" })]);

    // 텍스트·id를 채워야 가드(isSp && !ref?.designated) 제거 시 실패하는 유의미한 케이스가 된다 — 빈 mock은 가드 없이도 통과(공허한 단언).
    const refsUndesignated: SpRefMap = new Map([[7, {
      designated: false, output: "SP출력", output_ids: "sp_out1", output_forms: "",
    } as never]]);
    const candsUndesignated = collectIoImportCandidates({ nodes: [spNode, consumer], edges, spRefs: refsUndesignated, nodeId: "X", side: "input" });
    expect(candsUndesignated).toEqual([]);
  });

  it("사이클 A→B→A에서 무한루프 없이 종료", () => {
    const cyclic: Edge[] = [
      { id: "e1", source: "A", target: "B" } as Edge,
      { id: "e2", source: "B", target: "A" } as Edge,
    ];
    const nodesCyclic: IoNode[] = [
      node("A", { output: "A출력" }),
      node("B", { output: "B출력" }),
    ];
    const cands = collectIoImportCandidates({ nodes: nodesCyclic, edges: cyclic, spRefs: NO_SP, nodeId: "A", side: "input" });
    expect(cands.map((c) => c.nodeId)).toEqual(["B"]);
  });

  it("빈 텍스트 줄은 후보에서 제외", () => {
    const edges: Edge[] = [{ id: "e1", source: "A", target: "B" } as Edge];
    const nodes: IoNode[] = [
      node("A", { output: "\n실출력" }),
      node("B", { input: "" }),
    ];
    const cands = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "B", side: "input" });
    expect(cands).toEqual([expect.objectContaining({ text: "실출력", index: 1 })]);
  });

  it("미러 후보의 groupId는 원본 itemId, 댕글링 링크 후보는 groupId null", () => {
    const originA = node("A", { output: "원본출력", output_ids: "itm_1" });
    const mirrorB = node("B", { output: "원본출력", output_links: "itm_1" });
    const dangling = node("Dd", { output: "끊긴출력", output_links: "itm_ghost" });
    const edges: Edge[] = [
      { id: "e1", source: "B", target: "X" } as Edge,
      { id: "e2", source: "Dd", target: "X" } as Edge,
    ];
    const consumer = node("X", { input: "" });
    const cands = collectIoImportCandidates({ nodes: [originA, mirrorB, dangling, consumer], edges, spRefs: NO_SP, nodeId: "X", side: "input" });
    const mirrorCand = cands.find((c) => c.nodeId === "B");
    const danglingCand = cands.find((c) => c.nodeId === "Dd");
    expect(mirrorCand?.groupId).toBe("itm_1");
    expect(danglingCand?.groupId).toBeNull();
  });
});

describe("applyIoImport", () => {
  it("mirror: 인풋이 일반 아웃풋 불러오기 — 원본에 id 부여, 미러 생성(flag 줄은 추가 안 함)", () => {
    const nodes: IoNode[] = [node("A", { output: "출력1" }), node("B", { input: "" })];
    const edges: Edge[] = [{ id: "e1", source: "A", target: "B" } as Edge];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "B", side: "input" })[0];
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "B", side: "input", candidate });
    expect(result?.action).toBe("mirror");
    const a = result!.nodes.find((n) => n.id === "A")!;
    const b = result!.nodes.find((n) => n.id === "B")!;
    expect(a.data.output_ids).not.toBe(""); // genId 부여
    expect(a.data.output).toBe("출력1"); // 원본 텍스트 불변
    expect(b.data.input).toBe("출력1");
    expect(b.data.input_links).toBe(a.data.output_ids);
    expect(b.data.input_forms ?? "").toBe("");
    expect(b.data.input_flags ?? "").toBe(""); // 플래그 줄 미추가(기본 required)
  });

  it("mirror(기존 그룹): 인풋이 이미 원본인 아웃풋 불러오기 — id 재부여 없이 재사용", () => {
    const nodes: IoNode[] = [node("A", { output: "출력1", output_ids: "itm_1" }), node("B", { input: "" })];
    const edges: Edge[] = [{ id: "e1", source: "A", target: "B" } as Edge];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "B", side: "input" })[0];
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "B", side: "input", candidate })!;
    expect(result.action).toBe("mirror");
    const a = result.nodes.find((n) => n.id === "A")!;
    const b = result.nodes.find((n) => n.id === "B")!;
    expect(a.data.output_ids).toBe("itm_1"); // 재부여 없음 — genId 호출 안 됐음을 값 불변으로 검증
    expect(b.data.input_links).toBe("itm_1");
  });

  it("mirror: 이미 미러인 아웃풋을 불러오면 궁극 원본으로 해소", () => {
    const nodes: IoNode[] = [
      node("A", { output: "공유출력", output_ids: "itm_1" }),
      node("C", { output: "공유출력", output_links: "itm_1" }),
      node("D", { input: "" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "C", target: "D" } as Edge];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "D", side: "input" })[0];
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "D", side: "input", candidate })!;
    const a = result.nodes.find((n) => n.id === "A")!;
    const d = result.nodes.find((n) => n.id === "D")!;
    expect(a.data.output_ids).toBe("itm_1"); // C가 아니라 궁극 원본 A로 링크
    expect(d.data.input_links).toBe("itm_1");
  });

  it("mirror: 기존 인풋 행이 있어도 새 행이 끝(idx>0)에 정렬 추가된다", () => {
    const nodes: IoNode[] = [
      node("A", { output: "출력1" }),
      node("B", { input: "기존입력", input_forms: "PDF" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "A", target: "B" } as Edge];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "B", side: "input" })[0];
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "B", side: "input", candidate })!;
    const a = result.nodes.find((n) => n.id === "A")!;
    const b = result.nodes.find((n) => n.id === "B")!;
    const itemId = a.data.output_ids;
    expect(b.data.input).toBe("기존입력\n출력1");
    expect(b.data.input_forms).toBe("PDF"); // 새 행 form 빈값 → 후행 소거
    expect(b.data.input_links).toBe(`\n${itemId}`); // idx0 링크 없음, idx1만 링크
  });

  it("takeover: 아웃풋이 일반 인풋 불러오기 — 요청측 원본화, 대상 인풋은 텍스트 불변인 채 미러 전환", () => {
    const nodes: IoNode[] = [node("A", { output: "" }), node("B", { input: "입력1" })];
    const edges: Edge[] = [{ id: "e1", source: "A", target: "B" } as Edge];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "A", side: "output" })[0];
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "A", side: "output", candidate })!;
    expect(result.action).toBe("takeover");
    const a = result.nodes.find((n) => n.id === "A")!;
    const b = result.nodes.find((n) => n.id === "B")!;
    expect(a.data.output).toBe("입력1");
    expect(a.data.output_ids).not.toBe("");
    expect(a.data.output_links ?? "").toBe("");
    expect(b.data.input).toBe("입력1"); // 텍스트 불변
    expect(b.data.input_links).toBe(a.data.output_ids);
  });

  it("succession: 상류 A가 하류 D.인풋(원본 B의 미러) 불러오기 → itemId가 A로 이동, B는 미러 강등", () => {
    const nodes: IoNode[] = [
      node("A", { output: "" }),
      node("B", { output: "산출물", output_ids: "itm_b" }),
      node("D", { input: "산출물", input_links: "itm_b" }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "A", target: "B" } as Edge,
      { id: "e2", source: "B", target: "D" } as Edge,
    ];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "A", side: "output" })
      .find((c) => c.nodeId === "D")!;
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "A", side: "output", candidate })!;
    expect(result.action).toBe("succession");
    const a = result.nodes.find((n) => n.id === "A")!;
    const b = result.nodes.find((n) => n.id === "B")!;
    const d = result.nodes.find((n) => n.id === "D")!;
    expect(a.data.output).toBe("산출물");
    expect(a.data.output_ids).toBe("itm_b");
    expect(a.data.output_links ?? "").toBe("");
    expect(b.data.output).toBe("산출물"); // 텍스트 불변
    expect(b.data.output_ids ?? "").toBe(""); // 강등 — 소거
    expect(b.data.output_links).toBe("itm_b"); // 자신의 구 id를 미러로 참조
    expect(d.data.input).toBe("산출물"); // 미러는 링크 줄 불변(자동 재지향)
    expect(d.data.input_links).toBe("itm_b");
  });

  it("join: 병렬 C(원본 B에 비도달)의 아웃풋이 D.인풋(원본 B의 미러) 불러오기 → C가 미러로 합류", () => {
    const nodes: IoNode[] = [
      node("B", { output: "산출물", output_ids: "itm_b" }),
      node("C", { output: "" }),
      node("D", { input: "산출물", input_links: "itm_b" }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "B", target: "D" } as Edge,
      { id: "e2", source: "C", target: "D" } as Edge,
    ];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "C", side: "output" })
      .find((c) => c.nodeId === "D")!;
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "C", side: "output", candidate })!;
    expect(result.action).toBe("join");
    const b = result.nodes.find((n) => n.id === "B")!;
    const c = result.nodes.find((n) => n.id === "C")!;
    const d = result.nodes.find((n) => n.id === "D")!;
    expect(b.data.output_ids).toBe("itm_b"); // 원본 불변
    expect(c.data.output).toBe("산출물");
    expect(c.data.output_links).toBe("itm_b");
    expect(c.data.output_ids ?? "").toBe(""); // C는 원본이 되지 않음
    expect(d.data.input_links).toBe("itm_b"); // 불변
  });

  it("join: 순환 경로가 있으면 상류 조건이 성립해도 승계 대신 합류", () => {
    const nodes: IoNode[] = [
      node("A", { output: "" }),
      node("B", { output: "산출물", output_ids: "itm_b" }),
      node("D", { input: "산출물", input_links: "itm_b" }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "A", target: "B" } as Edge,
      { id: "e2", source: "B", target: "D" } as Edge,
      { id: "e3", source: "D", target: "A" } as Edge, // 순환 — A⇝B(forward)와 B⇝A(D경유) 모두 성립
    ];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "A", side: "output" })
      .find((c) => c.nodeId === "D")!;
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "A", side: "output", candidate })!;
    expect(result.action).toBe("join");
    const a = result.nodes.find((n) => n.id === "A")!;
    const b = result.nodes.find((n) => n.id === "B")!;
    expect(b.data.output_ids).toBe("itm_b"); // 원본 불변 — 승계 없음
    expect(a.data.output_links).toBe("itm_b");
    expect(a.data.output_ids ?? "").toBe("");
  });

  it("join: 기존 아웃풋 행이 있어도 새 미러 행이 끝(idx>0)에 4컬럼 정렬 추가된다", () => {
    const nodes: IoNode[] = [
      node("B", { output: "산출물", output_ids: "itm_b" }),
      node("C", { output: "기존출력", output_forms: "PDF", output_ids: "itm_c" }),
      node("D", { input: "산출물", input_links: "itm_b" }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "B", target: "D" } as Edge,
      { id: "e2", source: "C", target: "D" } as Edge,
    ];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs: NO_SP, nodeId: "C", side: "output" })
      .find((c) => c.nodeId === "D")!;
    const result = applyIoImport({ nodes, edges, spRefs: NO_SP, nodeId: "C", side: "output", candidate })!;
    expect(result.action).toBe("join");
    const c = result.nodes.find((n) => n.id === "C")!;
    expect(c.data.output).toBe("기존출력\n산출물");
    expect(c.data.output_forms).toBe("PDF");
    expect(c.data.output_ids).toBe("itm_c"); // 원본 아님 — idx1 output_ids는 빈 값(후행 소거)
    expect(c.data.output_links).toBe("\nitm_b"); // idx1만 링크
  });

  it("SP join: 원본이 SP 항목이면 상류여도 항상 join(승계 금지)", () => {
    const spRefs: SpRefMap = new Map([[7, {
      designated: true, output: "SP산출물", output_ids: "sp_out1", output_forms: "",
      input: "", input_ids: "", input_forms: "",
    } as never]]);
    const nodes: IoNode[] = [
      node("A", { output: "" }),
      node("S", { nodeType: "subprocess", linkedMapId: 7 }),
      node("D", { input: "SP산출물", input_links: "sp_out1" }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "A", target: "S" } as Edge,
      { id: "e2", source: "S", target: "D" } as Edge,
    ];
    const candidate = collectIoImportCandidates({ nodes, edges, spRefs, nodeId: "A", side: "output" })
      .find((c) => c.nodeId === "D")!;
    const result = applyIoImport({ nodes, edges, spRefs, nodeId: "A", side: "output", candidate })!;
    expect(result.action).toBe("join"); // A는 S의 상류지만 SP 원본이라 승계 불가
    const a = result.nodes.find((n) => n.id === "A")!;
    expect(a.data.output_links).toBe("sp_out1");
    expect(a.data.output_ids ?? "").toBe("");
  });

  it("origin 소실 방어 — 인풋측에서 groupId 있으나 인덱스 미등재(SP 후보 불가 경로)는 null 반환", () => {
    const nodes: IoNode[] = [node("B", { input: "" })];
    const candidate: IoImportCandidate = {
      nodeId: "S", nodeLabel: "S", list: "spout", index: 0, text: "x", form: "",
      groupId: null, isSp: true, hop: 1, pathEdgeIds: [],
    };
    const result = applyIoImport({ nodes, edges: [], spRefs: NO_SP, nodeId: "B", side: "input", candidate });
    expect(result).toBeNull();
  });

  it("origin 소실 방어 — 아웃풋측 SP 인풋 후보(spin)는 null 반환", () => {
    const nodes: IoNode[] = [node("A", { output: "" })];
    const candidate: IoImportCandidate = {
      nodeId: "S", nodeLabel: "S", list: "spin", index: 0, text: "x", form: "",
      groupId: null, isSp: true, hop: 1, pathEdgeIds: [],
    };
    const result = applyIoImport({ nodes, edges: [], spRefs: NO_SP, nodeId: "A", side: "output", candidate });
    expect(result).toBeNull();
  });
});
