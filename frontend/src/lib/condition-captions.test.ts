// 조건 캡션 표시 판정·예약 높이 계약 (토글 conditions · 시작/끝 노드 제외 · SP 지정값)
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";
import {
  CONDITION_CAPTION_H,
  getConditionCaptionExtents,
  getConditionCaptions,
} from "@/lib/condition-captions";

function makeNode(nodeType: string, data: Record<string, unknown> = {}): AppNode {
  return {
    id: "n",
    type: "process",
    position: { x: 0, y: 0 },
    data: { label: "n", nodeType, color: "", groupIds: [], hasChildren: false, ...data },
  } as unknown as AppNode;
}

describe("getConditionCaptions", () => {
  it("Conditions 토글이 꺼져 있으면 null", () => {
    const node = makeNode("process", { start_condition: "요청 접수" });
    expect(getConditionCaptions(node.data, ["assignee"])).toBeNull();
  });

  it("시작·끝 노드는 조건을 그리지 않는다", () => {
    const node = makeNode("start", { start_condition: "x" });
    expect(getConditionCaptions(node.data, ["conditions"])).toBeNull();
  });

  it("서브프로세스는 링크 맵 지정값(sp*)을 쓴다", () => {
    const node = makeNode("subprocess", {
      start_condition: "로컬",
      spStartCondition: "지정 시작",
      spEndCondition: "",
    });
    expect(getConditionCaptions(node.data, ["conditions"])).toEqual({ start: "지정 시작", end: "" });
  });

  it("여러 줄 조건은 한 줄로 잇는다", () => {
    const node = makeNode("decision", { end_condition: "판정 기록\n\n 결재 완료 " });
    expect(getConditionCaptions(node.data, ["conditions"])?.end).toBe("판정 기록 / 결재 완료");
  });
});

describe("getConditionCaptionExtents", () => {
  it("캡션이 있는 변만 높이를 예약한다", () => {
    const node = makeNode("process", { start_condition: "", end_condition: "완료" });
    expect(getConditionCaptionExtents(node, ["conditions"])).toEqual({
      above: 0,
      below: CONDITION_CAPTION_H,
    });
  });

  it("조건이 비어 있으면 0", () => {
    expect(getConditionCaptionExtents(makeNode("process"), ["conditions"])).toEqual({
      above: 0,
      below: 0,
    });
  });
});
