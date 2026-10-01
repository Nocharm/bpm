// 엣지 흐름 펄스 — 병렬 출구는 형제 갈래에 점이 같은 박자로 끝까지 건너고(동시), 분기(decision)는
// 출구에서 점이 천천히 나타나 머문 뒤 한 갈래로 조금만 나아가며 사라진다(회차마다 다음 갈래 = 택일).
// 렌더 전용 파생(저장·서명 무관) — 에디터 styledEdges가 edge.data.pulse로 주입, components/edge-pulse-dot.tsx가 SMIL로 그린다.
// SMIL은 문서 타임라인 하나를 공유해 begin/dur이 같으면 엣지끼리 박자가 맞는다. (사용자 결정 2026-10-01)

import { getOutputGroups, getOutputKey, type OutputRuleEdge, type OutputRuleNode } from "@/lib/output-rules";

export type EdgePulse =
  | { kind: "parallel" }
  // index/count — 분기 노드의 몇 번째 갈래인지(회차 배정), color — 분기 노드 stroke
  | { kind: "decision"; index: number; count: number; color: string };

export interface PulseTimeline {
  dur: number;
  begin: number;
  motionKeyTimes: string;
  motionKeyPoints: string;
  motionKeySplines: string;
  opacityKeyTimes: string;
  opacityValues: string;
}

// 병렬 한 주기(s) — 건너기 70% + 쉼 30%. 너무 빠르면 시선을 뺏는다(사용자 요청: 느리게·반투명)
export const PARALLEL_CYCLE_S = 4.2;
const PARALLEL_OPACITY = 0.5;
// 분기 한 회차(s) — 머뭇거림(페이드인) 40% → 이동 45%(뒤쪽 절반 페이드아웃) → 쉼
export const DECISION_SLOT_S = 3.4;
const DECISION_OPACITY = 0.75;
// 분기 점이 출구에서 나아가는 거리(px) — 엣지가 길어도 끝까지 건너지 않는다
export const DECISION_TRAVEL_PX = 56;

const EASE = "0.42 0 0.58 1";
const LINEAR = "0 0 1 1";

/** 분기 점 이동 비율 — 경로 길이를 끝점 맨해튼 거리로 근사(꺾은선 기본형과 같음), 최대 절반. */
export function getDecisionTravel(sourceX: number, sourceY: number, targetX: number, targetY: number): number {
  const approx = Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY);
  return Math.min(0.5, DECISION_TRAVEL_PX / Math.max(1, approx));
}

const fmt = (values: number[]): string => values.map((v) => Number(v.toFixed(4))).join(";");

/** SMIL 타임라인(animateMotion keyPoints + opacity 키프레임). travel은 분기 점 이동 비율(0..1). */
export function buildPulseTimeline(pulse: EdgePulse, travel: number): PulseTimeline {
  if (pulse.kind === "parallel") {
    return {
      dur: PARALLEL_CYCLE_S,
      begin: 0,
      motionKeyTimes: fmt([0, 0.7, 1]),
      motionKeyPoints: fmt([0, 1, 1]),
      motionKeySplines: [EASE, LINEAR].join(";"),
      opacityKeyTimes: fmt([0, 0.12, 0.56, 0.7, 1]),
      opacityValues: fmt([0, PARALLEL_OPACITY, PARALLEL_OPACITY, 0, 0]),
    };
  }
  // 갈래 N개 = 전체 주기 N회차, 이 갈래는 index번째 회차에만 보인다(나머지는 투명)
  const count = Math.max(1, pulse.count);
  const scale = (t: number): number => t / count;
  return {
    dur: DECISION_SLOT_S * count,
    begin: DECISION_SLOT_S * pulse.index,
    motionKeyTimes: fmt([0, scale(0.4), scale(0.85), 1]),
    motionKeyPoints: fmt([0, 0, travel, travel]),
    motionKeySplines: [LINEAR, EASE, LINEAR].join(";"),
    opacityKeyTimes: fmt([0, scale(0.4), scale(0.6), scale(0.85), 1]),
    opacityValues: fmt([0, DECISION_OPACITY, DECISION_OPACITY, 0, 0]),
  };
}

export interface PulseNode extends OutputRuleNode {
  color: string;
}

/**
 * 엣지별 펄스 배정 — 병렬 출구 그룹(엣지 ≥2)의 갈래 전부 parallel, 분기 노드에서 나가는 갈래(≥2)는
 * 나가는 순서대로 회차 index. hidden 엣지는 제외(펼침으로 숨긴 진출 등).
 */
export function assignEdgePulses(
  nodes: readonly PulseNode[],
  edges: readonly (OutputRuleEdge & { id: string; hidden?: boolean })[],
): Map<string, EdgePulse> {
  const out = new Map<string, EdgePulse>();
  const visible = edges.filter((edge) => !edge.hidden);
  for (const node of nodes) {
    const outgoing = visible.filter((edge) => edge.source === node.id);
    if (outgoing.length < 2) continue;
    if (node.nodeType === "decision") {
      outgoing.forEach((edge, index) => {
        out.set(edge.id, { kind: "decision", index, count: outgoing.length, color: node.color });
      });
      continue;
    }
    const parallelKeys = new Set(
      getOutputGroups(node, outgoing)
        .filter((group) => group.parallel && group.count >= 2)
        .map((group) => group.key),
    );
    for (const edge of outgoing) {
      if (parallelKeys.has(getOutputKey(node.nodeType, edge.sourceHandle))) {
        out.set(edge.id, { kind: "parallel" });
      }
    }
  }
  return out;
}

/** edge.data.pulse 판별 — 엣지 컴포넌트가 unknown data에서 안전하게 꺼낸다. */
export function isEdgePulse(value: unknown): value is EdgePulse {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "parallel" || kind === "decision";
}
