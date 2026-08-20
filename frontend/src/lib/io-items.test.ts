// io-items 단위 테스트 — 줄 정렬·판정·인덱스·SP id 부여. 설계: docs/superpowers/specs/2026-08-21-io-linking-design.md

import { describe, expect, it } from "vitest";

import {
  assignSpIoIds, buildIoIndex, buildIoMirrorIndex, countIoLines, getIoItemState, getIoLine, setIoLine,
  type IoNode, type SpRefMap,
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
    const refsUndesignated: SpRefMap = new Map([[8, { designated: false } as never]]);
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
