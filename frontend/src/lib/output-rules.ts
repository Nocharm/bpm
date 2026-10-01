// 노드 출력 규칙 — 일반 맵·L5 연계 캔버스 공통, 저장 체크리스트·SP 끝 개수 배지가 같은 판정을 쓴다.
// 출구(출력 그룹)마다 엣지 1개, 병렬 출구는 2개 이상. 분기(decision)는 다중 출력이 정상이라 규칙 밖.
// 백엔드 확정 게이트 6(`backend/app/subprocess.py` plain_fanout)과 동치 — 한쪽을 고치면 양쪽+테스트를 같이 옮긴다.
// 계획: docs/superpowers/plans/2026-10-01-output-rules.md

import { endKeyOfEdge, PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

export interface OutputRuleNode {
  id: string;
  nodeType: string;
  // 병렬로 켠 출구 키 — 일반 노드는 `__primary__` 하나, SP는 끝 키별
  parallelOutputs?: readonly string[];
}

export interface OutputRuleEdge {
  source: string;
  sourceHandle?: string | null;
  // 임포트 출처 게이트웨이 — 전부 "parallel"인 출구는 속성 없이도 병렬로 읽는다(레거시 도출)
  gateway?: string | null;
}

export interface OutputGroup {
  key: string;
  count: number;
  parallel: boolean;
}

export interface OutputViolation {
  nodeId: string;
  // 비병렬 출구의 초과 엣지 수 합 (배지 `+N`)
  excess: number;
  // 엣지가 1개뿐인 병렬 출구 수
  shortParallel: number;
}

/** 엣지가 나가는 출구 키 — SP는 끝 키(레거시 변 id는 대표 끝), 그 외 노드는 출구가 하나. */
export function getOutputKey(nodeType: string, sourceHandle: string | null | undefined): string {
  return nodeType === "subprocess" ? endKeyOfEdge({ sourceHandle }) : PRIMARY_END_HANDLE;
}

/** 한 노드의 출구별 엣지 수와 병렬 여부. 병렬 = 속성에 켜짐 ∪ (엣지 ≥2이고 전부 gateway="parallel"). */
export function getOutputGroups(node: OutputRuleNode, edges: readonly OutputRuleEdge[]): OutputGroup[] {
  const groups = new Map<string, { count: number; allParallel: boolean }>();
  for (const edge of edges) {
    if (edge.source !== node.id) continue;
    const key = getOutputKey(node.nodeType, edge.sourceHandle);
    const group = groups.get(key) ?? { count: 0, allParallel: true };
    group.count += 1;
    group.allParallel = group.allParallel && edge.gateway === "parallel";
    groups.set(key, group);
  }
  const flagged = new Set(node.parallelOutputs ?? []);
  return [...groups].map(([key, group]) => ({
    key,
    count: group.count,
    parallel: flagged.has(key) || (group.count >= 2 && group.allParallel),
  }));
}

/** 출력 규칙 위반 노드 — 비병렬 출구에 엣지 2개 이상, 또는 병렬 출구에 엣지 1개. 출력 0개 출구는 미연결일 뿐 위반 아님. */
export function getOutputViolations(
  nodes: readonly OutputRuleNode[],
  edges: readonly OutputRuleEdge[],
): OutputViolation[] {
  const violations: OutputViolation[] = [];
  for (const node of nodes) {
    if (node.nodeType === "decision") continue;
    let excess = 0;
    let shortParallel = 0;
    for (const group of getOutputGroups(node, edges)) {
      if (group.parallel) {
        if (group.count === 1) shortParallel += 1;
      } else if (group.count > 1) {
        excess += group.count - 1;
      }
    }
    if (excess > 0 || shortParallel > 0) {
      violations.push({ nodeId: node.id, excess, shortParallel });
    }
  }
  return violations;
}

/**
 * AI·CSV의 병렬 플래그 → parallel_outputs. 플래그는 노드 기본 출구(`__primary__`)만 다룬다 — SP 끝별
 * 병렬은 에디터 우클릭 전용. null/undefined=기존 유지(undefined 반환), true=켬, false=끔(다른 끝 키는 보존).
 */
export function applyParallelFlag(
  current: readonly string[] | undefined,
  flag: boolean | null | undefined,
): string[] | undefined {
  if (flag == null) return undefined;
  const rest = (current ?? []).filter((key) => key !== PRIMARY_END_HANDLE);
  return flag ? [...rest, PRIMARY_END_HANDLE] : rest;
}
