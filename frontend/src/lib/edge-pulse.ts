// 엣지 흐름 펄스 — 병렬 출구는 형제 갈래에 점이 같은 박자로 경로의 75%까지 건너고(동시), 분기(decision)는
// 갈래 전부에서 점이 동시에 나와 잠깐 나아가다 함께 멈추고, 함께 한 번·갈래 순서대로 한 번씩 반짝인 뒤
// 무작위 한 갈래만 더 나아가고 나머지는 제자리에서 사라진다(택일).
// 렌더 전용 파생(저장·서명 무관) — 에디터 styledEdges가 edge.data.pulse로 주입, components/edge-pulse-dot.tsx가 SMIL로 그린다.
// SMIL은 문서 타임라인 하나를 공유해 begin/dur이 같으면 엣지끼리 박자가 맞는다.
// (사용자 결정 2026-10-01, 2026-10-02: 병렬 75%·분기 동시 출발→반짝임→랜덤 1갈래·포커스 강조·형제 선택 시 정지·L5 어두운 배경 대비)

import { getOutputGroups, getOutputKey, type OutputRuleEdge, type OutputRuleNode } from "@/lib/output-rules";

// 표면이 엣지마다 얹는 상태 — group: 같은 출구 묶음(형제 판정), focused: 소스 노드 선택(강조+1.25배속),
// paused: 형제 한 갈래만 선택(이번 회차 끝나면 반복 중지), onDark: L5 차콜 하늘 위(밝은 점)
interface PulseState {
  group: string;
  focused?: boolean;
  paused?: boolean;
  onDark?: boolean;
}

export interface ParallelPulse extends PulseState {
  kind: "parallel";
}

// index/count — 분기 노드의 몇 번째 갈래인지, color — 분기 노드 stroke,
// winners — 회차별 이기는 갈래 index(형제가 같은 배열을 공유해 회차마다 정확히 한 갈래만 나아간다)
export interface DecisionPulse extends PulseState {
  kind: "decision";
  index: number;
  count: number;
  color: string;
  winners: number[];
}

export type EdgePulse = ParallelPulse | DecisionPulse;

export interface PulseTimeline {
  // 반복 단위 전체 길이(s) — 분기는 winners 회차 전부를 한 번에 담는다
  dur: number;
  // 한 회차 길이(s) — paused 시 "이번 재생"이 끝나는 경계
  cycle: number;
  motionKeyTimes: string;
  motionKeyPoints: string;
  motionKeySplines: string;
  opacityKeyTimes: string;
  opacityValues: string;
  // 반경 키프레임(분기 반짝임) — 병렬은 없음
  radiusKeyTimes: string | null;
  radiusValues: string | null;
}

// 병렬 한 주기(s) — 이동 + 쉼(재방출 간격). 너무 빠르면 시선을 뺏는다(사용자 요청: 느리게·반투명)
export const PARALLEL_CYCLE_S = 4.2;
// 예전 "끝까지 건너기"가 주기의 70%였다 — 같은 속도로 75%까지만 가므로 이동은 0.7×0.75 지점에서 끝난다
const PARALLEL_FULL_TRAVEL_SHARE = 0.7;
export const PARALLEL_REACH = 0.75;
export const PARALLEL_RADIUS = 3.2;
const PARALLEL_OPACITY = 0.5;
const PARALLEL_OPACITY_DARK = 0.85;

// 분기 이동 속도(px/s) — 직전 설정(56px를 3.4s 회차의 45% 동안 ≈ 36.6px/s) 그대로
export const DECISION_SPEED_PX_S = 56 / (0.45 * 3.4);
// 분기 회차 구간(s): 동시 이동 → 함께 반짝 → 갈래별 반짝(갈래 수만큼) → 승자 진행/패자 페이드 → 쉼
export const DECISION_MOVE_S = 1.0;
const DECISION_FADE_IN_S = 0.25;
const DECISION_TOGETHER_BLINK_S = 0.45;
const DECISION_SEQ_BLINK_S = 0.55;
const DECISION_WIN_MOVE_S = 1.3;
// 승자는 이동 마지막 이 시간 동안 사라진다
const DECISION_WIN_FADE_S = 0.4;
const DECISION_LOSE_FADE_S = 0.6;
const DECISION_REST_S = 0.9;
// 멈춤 지점 상한(경로 비율) — 짧은 엣지에서도 승자가 더 나아갈 여지를 남긴다
const DECISION_STOP_MAX = 0.2;
// 승자가 도달하는 경로 비율
export const DECISION_WINNER_REACH = 0.5;
// 미리 뽑는 회차 수 — 이만큼이 SMIL 반복 단위(형제 공유)라 순수 SMIL로 무작위처럼 보인다
export const DECISION_CYCLES = 8;
export const DECISION_RADIUS = 3.8;
const DECISION_OPACITY = 0.75;
const DECISION_OPACITY_DARK = 0.9;
// 반짝임 반경 배율 — 함께(강) / 갈래별(약)
const TOGETHER_BLINK_SCALE = 1.4;
const SEQ_BLINK_SCALE = 1.2;
// 갈래별 반짝임 불투명도 상승분(기본→1 사이 비율) — "부드럽게"
const SEQ_BLINK_LIFT = 0.6;

// 포커스(소스 노드 선택) 시 배속 — 형제가 모두 같은 소스라 함께 빨라져 박자가 유지된다
export const FOCUS_SPEED = 1.25;

const EASE = "0.42 0 0.58 1";
const EASE_OUT = "0 0 0.58 1";
const LINEAR = "0 0 1 1";

/**
 * 분기 점 멈춤 지점(경로 비율) — 이동 시간 × 분기 속도를 경로 길이로 나눈다.
 * 경로 길이는 끝점 맨해튼 거리로 근사(꺾은선 기본형과 같음), 최대 DECISION_STOP_MAX.
 */
export function getDecisionTravel(sourceX: number, sourceY: number, targetX: number, targetY: number): number {
  const approx = Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY);
  return Math.min(DECISION_STOP_MAX, (DECISION_SPEED_PX_S * DECISION_MOVE_S) / Math.max(1, approx));
}

const fmt = (values: number[]): string => values.map((v) => Number(v.toFixed(4))).join(";");

// 키프레임 트랙 — 같은 시각 키가 겹치면 값만 덮어 keyTimes 중복을 막는다
interface Track {
  times: number[];
  values: number[];
  splines: string[];
}

const createTrack = (): Track => ({ times: [], values: [], splines: [] });

function addKey(track: Track, time: number, value: number, spline: string = LINEAR): void {
  const last = track.times.length - 1;
  if (last >= 0 && Math.abs(track.times[last] - time) < 1e-9) {
    track.values[last] = value;
    return;
  }
  if (last >= 0) track.splines.push(spline);
  track.times.push(time);
  track.values.push(value);
}

const getBaseOpacity = (pulse: EdgePulse): number => {
  if (pulse.focused) return 1;
  if (pulse.kind === "parallel") return pulse.onDark ? PARALLEL_OPACITY_DARK : PARALLEL_OPACITY;
  return pulse.onDark ? DECISION_OPACITY_DARK : DECISION_OPACITY;
};

const getSpeed = (pulse: EdgePulse): number => (pulse.focused ? FOCUS_SPEED : 1);

/** 분기 한 회차 길이(s, 1배속) — 갈래별 반짝임 수만큼 늘어난다. */
export function getDecisionCycle(count: number): number {
  return (
    DECISION_MOVE_S +
    DECISION_TOGETHER_BLINK_S +
    Math.max(1, count) * DECISION_SEQ_BLINK_S +
    DECISION_WIN_MOVE_S +
    DECISION_REST_S
  );
}

/** 병렬 SMIL 타임라인 — 같은 속도로 경로의 PARALLEL_REACH까지 가며 사라지고, 재방출 간격은 그대로. */
function buildParallelTimeline(pulse: ParallelPulse): PulseTimeline {
  const base = getBaseOpacity(pulse);
  const moveEnd = PARALLEL_FULL_TRAVEL_SHARE * PARALLEL_REACH;
  const dur = PARALLEL_CYCLE_S / getSpeed(pulse);
  return {
    dur,
    cycle: dur,
    motionKeyTimes: fmt([0, moveEnd, 1]),
    motionKeyPoints: fmt([0, PARALLEL_REACH, PARALLEL_REACH]),
    motionKeySplines: [EASE, LINEAR].join(";"),
    opacityKeyTimes: fmt([0, 0.12, moveEnd - 0.12, moveEnd, 1]),
    opacityValues: fmt([0, base, base, 0, 0]),
    radiusKeyTimes: null,
    radiusValues: null,
  };
}

/**
 * 분기 SMIL 타임라인 — winners 회차 전부를 하나의 반복 단위(dur)로 펼친다. begin은 0이라 형제가 같은 위상.
 * stop은 멈춤 지점 비율(getDecisionTravel). 패자 회차엔 stop을 넘지 않고, 승자 회차엔 DECISION_WINNER_REACH에 닿는다.
 */
export function buildDecisionTimeline(pulse: DecisionPulse, stop: number): PulseTimeline {
  const count = Math.max(1, pulse.count);
  const winners = pulse.winners.length > 0 ? pulse.winners : [0];
  const base = getBaseOpacity(pulse);
  const seqPeak = base + (1 - base) * SEQ_BLINK_LIFT;
  const cycle = getDecisionCycle(count);
  const total = cycle * winners.length;
  const motion = createTrack();
  const opacity = createTrack();
  const radius = createTrack();
  const blinkStart = DECISION_MOVE_S + DECISION_TOGETHER_BLINK_S;
  const decideAt = blinkStart + count * DECISION_SEQ_BLINK_S;
  winners.forEach((winner, round) => {
    const o = round * cycle;
    const isWinner = winner === pulse.index;
    // 이동 → 멈춤 유지 → (승자) 더 나아감 / (패자) 페이드 동안 제자리. 그 뒤 투명한 쉼 동안 출구로 되돌아간다
    addKey(motion, o, 0);
    addKey(motion, o + DECISION_MOVE_S, stop, EASE_OUT);
    addKey(motion, o + decideAt, stop);
    if (isWinner) addKey(motion, o + decideAt + DECISION_WIN_MOVE_S, DECISION_WINNER_REACH, EASE);
    else addKey(motion, o + decideAt + DECISION_LOSE_FADE_S, stop);

    addKey(opacity, o, 0);
    addKey(opacity, o + DECISION_FADE_IN_S, base);
    addKey(opacity, o + DECISION_MOVE_S, base);
    addKey(opacity, o + DECISION_MOVE_S + DECISION_TOGETHER_BLINK_S / 2, 1);
    addKey(opacity, o + blinkStart, base);
    addKey(radius, o, DECISION_RADIUS);
    addKey(radius, o + DECISION_MOVE_S, DECISION_RADIUS);
    addKey(radius, o + DECISION_MOVE_S + DECISION_TOGETHER_BLINK_S / 2, DECISION_RADIUS * TOGETHER_BLINK_SCALE);
    addKey(radius, o + blinkStart, DECISION_RADIUS);
    // 갈래 순서대로 한 번씩 — 이 갈래 차례에만 키를 둔다(나머지 구간은 기본값 유지)
    const ownBlink = o + blinkStart + pulse.index * DECISION_SEQ_BLINK_S;
    addKey(opacity, ownBlink, base);
    addKey(opacity, ownBlink + DECISION_SEQ_BLINK_S / 2, seqPeak);
    addKey(opacity, ownBlink + DECISION_SEQ_BLINK_S, base);
    addKey(radius, ownBlink, DECISION_RADIUS);
    addKey(radius, ownBlink + DECISION_SEQ_BLINK_S / 2, DECISION_RADIUS * SEQ_BLINK_SCALE);
    addKey(radius, ownBlink + DECISION_SEQ_BLINK_S, DECISION_RADIUS);
    addKey(opacity, o + decideAt, base);
    if (isWinner) {
      addKey(opacity, o + decideAt + DECISION_WIN_MOVE_S - DECISION_WIN_FADE_S, base);
      addKey(opacity, o + decideAt + DECISION_WIN_MOVE_S, 0);
    } else {
      addKey(opacity, o + decideAt + DECISION_LOSE_FADE_S, 0);
    }
  });
  addKey(motion, total, 0);
  addKey(opacity, total, 0);
  addKey(radius, total, DECISION_RADIUS);
  const toKeyTimes = (track: Track): string => fmt(track.times.map((t) => t / total));
  const speed = getSpeed(pulse);
  return {
    dur: total / speed,
    cycle: cycle / speed,
    motionKeyTimes: toKeyTimes(motion),
    motionKeyPoints: fmt(motion.values),
    motionKeySplines: motion.splines.join(";"),
    opacityKeyTimes: toKeyTimes(opacity),
    opacityValues: fmt(opacity.values),
    radiusKeyTimes: toKeyTimes(radius),
    radiusValues: fmt(radius.values),
  };
}

/** SMIL 타임라인(animateMotion keyPoints + opacity·반경 키프레임). travel은 분기 멈춤 지점 비율(0..1). */
export function buildPulseTimeline(pulse: EdgePulse, travel: number): PulseTimeline {
  return pulse.kind === "parallel" ? buildParallelTimeline(pulse) : buildDecisionTimeline(pulse, travel);
}

/**
 * 분기 노드별 회차 승자 수열 — 노드 id 시드 PRNG(FNV-1a → mulberry32)라 렌더마다 같고(순수),
 * 형제 갈래가 같은 수열을 받아 회차마다 정확히 한 갈래만 나아간다.
 */
export function buildDecisionWinners(seed: string, count: number, cycles: number = DECISION_CYCLES): number[] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: cycles }, () => Math.floor(next() * Math.max(1, count)));
}

export interface PulseNode extends OutputRuleNode {
  color: string;
}

/**
 * 엣지별 펄스 배정 — 병렬 출구 그룹(엣지 ≥2)의 갈래 전부 parallel, 분기 노드에서 나가는 갈래(≥2)는
 * 나가는 순서대로 index + 노드 공유 승자 수열. hidden 엣지는 제외(펼침으로 숨긴 진출 등).
 * group은 형제 묶음 키(소스 노드 + 출구) — 표면의 포커스·정지 판정용.
 */
export function assignEdgePulses(
  nodes: readonly PulseNode[],
  edges: readonly (OutputRuleEdge & { id: string; hidden?: boolean })[],
): Map<string, EdgePulse> {
  const out = new Map<string, EdgePulse>();
  // 소스별 1회 그룹화 — 노드×엣지 필터는 큰 맵에서 styledEdges 재계산마다 비싸다
  const bySource = new Map<string, (OutputRuleEdge & { id: string })[]>();
  for (const edge of edges) {
    if (edge.hidden) continue;
    const list = bySource.get(edge.source);
    if (list) list.push(edge);
    else bySource.set(edge.source, [edge]);
  }
  for (const node of nodes) {
    const outgoing = bySource.get(node.id) ?? [];
    if (outgoing.length < 2) continue;
    if (node.nodeType === "decision") {
      const winners = buildDecisionWinners(node.id, outgoing.length);
      outgoing.forEach((edge, index) => {
        out.set(edge.id, { kind: "decision", group: node.id, index, count: outgoing.length, color: node.color, winners });
      });
      continue;
    }
    const parallelKeys = new Set(
      getOutputGroups(node, outgoing)
        .filter((group) => group.parallel && group.count >= 2)
        .map((group) => group.key),
    );
    for (const edge of outgoing) {
      const key = getOutputKey(node.nodeType, edge.sourceHandle);
      if (parallelKeys.has(key)) {
        out.set(edge.id, { kind: "parallel", group: `${node.id}::${key}` });
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
