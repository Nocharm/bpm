// subprocess-embed 핸들 헬퍼 — 들어오는 문(in) 네 방향 id와 끝 핸들 판정
import { describe, expect, it } from "vitest";

import type { Edge } from "@xyflow/react";

import {
  applyMirroredEndLabels,
  isSubprocessEndHandle,
  isSubprocessInHandle,
  parseSubprocessInHandle,
  PRIMARY_END_HANDLE,
  SUBPROCESS_IN_HANDLE,
  subprocessInHandle,
  type SubEnd,
} from "@/lib/subprocess-embed";

describe("applyMirroredEndLabels (출구 라벨 기본값 = 끝 제목 미러링, 렌더 전용)", () => {
  const ends: SubEnd[] = [
    { key: PRIMARY_END_HANDLE, title: "승인", isPrimary: true, nodeId: "n1" },
    { key: "반려", title: "반려", isPrimary: false, nodeId: "n2" },
  ];
  const endsOf = (nodeId: string) => (nodeId === "S" ? ends : nodeId === "S1" ? [ends[0]] : []);
  const edges = [
    { id: "p", source: "S", target: "A", sourceHandle: PRIMARY_END_HANDLE },
    { id: "r", source: "S", target: "B", sourceHandle: "반려" },
    { id: "own", source: "S", target: "C", sourceHandle: "반려", label: "직접" },
    { id: "legacy", source: "S", target: "D" },
    { id: "single", source: "S1", target: "E", sourceHandle: PRIMARY_END_HANDLE },
    { id: "plain", source: "P", target: "F" },
  ] as Edge[];

  it("끝 ≥ 2인 SP 출구에 직접 라벨이 없으면 끝 제목을 표시 라벨로 넣고 labelMirrored를 켠다(핸들 없음=대표 끝)", () => {
    const out = applyMirroredEndLabels(edges, endsOf);
    expect(out[0]).toMatchObject({ label: "승인", data: { labelMirrored: true } });
    expect(out[1]).toMatchObject({ label: "반려", data: { labelMirrored: true } });
    expect(out[3]).toMatchObject({ label: "승인", data: { labelMirrored: true } });
  });

  it("직접 라벨·끝 1개 SP·일반 노드는 같은 객체 그대로(저장 payload에 미러가 섞이지 않게)", () => {
    const out = applyMirroredEndLabels(edges, endsOf);
    expect(out[2]).toBe(edges[2]);
    expect(out[4]).toBe(edges[4]);
    expect(out[5]).toBe(edges[5]);
  });

  it("모르는 끝 키(링크 맵에서 끝이 사라짐)는 미러 없음", () => {
    const out = applyMirroredEndLabels([{ id: "x", source: "S", target: "A", sourceHandle: "없는끝" }] as Edge[], endsOf);
    expect(out[0].label).toBeUndefined();
  });
});

describe("subprocessInHandle / parseSubprocessInHandle", () => {
  it("좌측은 레거시 id 'in' 그대로, 나머지 변은 'in:<side>'", () => {
    expect(subprocessInHandle("left")).toBe(SUBPROCESS_IN_HANDLE);
    expect(subprocessInHandle("top")).toBe("in:top");
    expect(subprocessInHandle("right")).toBe("in:right");
    expect(subprocessInHandle("bottom")).toBe("in:bottom");
  });

  it("파싱은 역함수 — 'in'은 left, 모르는 id·null은 null", () => {
    expect(parseSubprocessInHandle("in")).toBe("left");
    expect(parseSubprocessInHandle("in:bottom")).toBe("bottom");
    expect(parseSubprocessInHandle("t-left")).toBeNull();
    expect(parseSubprocessInHandle("in:diagonal")).toBeNull();
    expect(parseSubprocessInHandle(null)).toBeNull();
    expect(parseSubprocessInHandle(undefined)).toBeNull();
  });
});

describe("isSubprocessInHandle / isSubprocessEndHandle", () => {
  it("in 변형은 들어오는 문, 변 id·끝 키는 아니다", () => {
    expect(isSubprocessInHandle("in")).toBe(true);
    expect(isSubprocessInHandle("in:top")).toBe(true);
    expect(isSubprocessInHandle("t-left")).toBe(false);
    expect(isSubprocessInHandle(PRIMARY_END_HANDLE)).toBe(false);
  });

  it("끝 핸들 = 변 id(s-*)·in 변형·null이 아닌 문자열(대표 끝 또는 끝 제목)", () => {
    expect(isSubprocessEndHandle(PRIMARY_END_HANDLE)).toBe(true);
    expect(isSubprocessEndHandle("반려")).toBe(true);
    expect(isSubprocessEndHandle("s-right")).toBe(false);
    expect(isSubprocessEndHandle("in")).toBe(false);
    expect(isSubprocessEndHandle(null)).toBe(false);
    expect(isSubprocessEndHandle(undefined)).toBe(false);
    expect(isSubprocessEndHandle("")).toBe(false);
  });
});
