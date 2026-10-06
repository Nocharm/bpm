"use client";

// 엣지 흐름 펄스 점 — 병렬 출구(공통 구간 후 길이별 속도로 75% 동시 도달)·분기(동시 출발→차례 반짝임→한 갈래) 렌더. 에디터 엣지(multiline-edge)·비교 화면 엣지가 공유.
// SMIL animateMotion/animate라 JS 타이머가 없다. RF는 엣지마다 <svg>를 따로 그려 SMIL 시계도 엣지별이므로,
// 마운트 때 그 svg 시계를 페이지 시계(performance.now)에 맞춰 나중에 생긴 갈래도 형제와 박자가 맞게 한다.
// 판정·타임라인은 lib/edge-pulse.
// 움직임이 멈추는 곳(모션 축소 설정·PNG 출력·비교 화면)에선 정지 장면 점 하나가 대신 병렬/분기를 보여준다:
// 평소엔 globals.css가 `.bpm-edge-pulse-still`을 숨기고, 모션 축소면 움직이는 `.bpm-edge-pulse` 대신 이것을 보이며,
// PNG 출력은 lib/export가 같은 교대를 인라인으로 건다. pulse.still(비교 화면)이면 움직이는 점 없이 정지 장면만.
// 줌 PULSE_MIN_ZOOM 미만이면 움직이는 점은 그리지 않는다(정지 장면 점은 PNG 출력용이라 남긴다).

import { useStore } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef } from "react";

import {
  buildPulseTimeline,
  DECISION_RADIUS,
  getPathSpan,
  getPulseStillAt,
  PARALLEL_RADIUS,
  PULSE_MIN_ZOOM,
  PULSE_STILL_OPACITY,
  type EdgePulse,
} from "@/lib/edge-pulse";

interface EdgePulseDotProps {
  path: string;
  pulse: EdgePulse;
  // 분기 점 멈춤 지점 비율(0..1) — 병렬은 무시
  travel: number;
}

// 포커스 강조 — 같은 색을 조금 더 진하게(채도↑)
const FOCUS_FILTER = "saturate(1.6)";

function getPulseFill(pulse: EdgePulse): string {
  if (pulse.kind === "parallel") return pulse.onDark ? "var(--color-accent-sky)" : "var(--color-accent)";
  // 차콜 하늘 위에선 노드 stroke를 흰색 쪽으로 밝혀 읽히게 한다
  return pulse.onDark ? `color-mix(in srgb, ${pulse.color} 40%, white)` : pulse.color;
}

const getPulseRadius = (pulse: EdgePulse): number => (pulse.kind === "parallel" ? PARALLEL_RADIUS : DECISION_RADIUS);

export function EdgePulseDot({ path, pulse, travel }: EdgePulseDotProps) {
  const zoomedOut = useStore((state) => state.transform[2] < PULSE_MIN_ZOOM);
  const still = pulse.still === true;
  return (
    <>
      {still || zoomedOut ? null : <PulseMotionDot path={path} pulse={pulse} travel={travel} />}
      <PulseStillDot path={path} pulse={pulse} at={getPulseStillAt(pulse, travel)} hidden={!still} />
    </>
  );
}

// 정지 장면 점 — 경로 위 한 지점(병렬 도달점·분기 멈춤 지점)에 고정. 좌표는 숨긴 측정용 path로 구해 DOM에 직접 쓴다
// (cx/cy 속성이 있어야 PNG 복제에서도 제자리 — animateMotion 변환은 복제에 안 실린다)
interface PulseStillDotProps {
  path: string;
  pulse: EdgePulse;
  // 경로 비율(0..1)
  at: number;
  // true면 평소엔 숨기고 모션 축소·PNG 출력에서만 보인다(.bpm-edge-pulse-still)
  hidden: boolean;
}

function PulseStillDot({ path, pulse, at, hidden }: PulseStillDotProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  useLayoutEffect(() => {
    const measure = pathRef.current;
    const dot = dotRef.current;
    // jsdom엔 경로 기하 API가 없다
    if (!measure || !dot || typeof measure.getTotalLength !== "function") return;
    const point = measure.getPointAtLength(measure.getTotalLength() * at);
    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
  }, [path, at]);
  return (
    <>
      <path ref={pathRef} d={path} fill="none" stroke="none" />
      <circle
        ref={dotRef}
        className={`pointer-events-none${hidden ? " bpm-edge-pulse-still" : ""}`}
        r={getPulseRadius(pulse)}
        fill={getPulseFill(pulse)}
        fillOpacity={PULSE_STILL_OPACITY}
        stroke={pulse.onDark ? "var(--color-surface)" : undefined}
        strokeWidth={pulse.onDark ? 0.8 : undefined}
        strokeOpacity={pulse.onDark ? 0.7 : undefined}
      />
    </>
  );
}

function PulseMotionDot({ path, pulse, travel }: EdgePulseDotProps) {
  const timeline = buildPulseTimeline(pulse, travel, getPathSpan(path));
  const dotRef = useRef<SVGCircleElement>(null);
  const paused = pulse.paused === true;
  const { dur, cycle } = timeline;
  useEffect(() => {
    const dot = dotRef.current;
    const svg = dot?.ownerSVGElement;
    if (!dot || !svg) return;
    svg.setCurrentTime(performance.now() / 1000);
    if (!paused) return;
    // 형제 한 갈래만 선택 — 진행 중인 회차는 끝까지 보이고 그 뒤 반복만 멈춘다(begin 0, 회차 경계까지 남은 시간)
    const elapsed = svg.getCurrentTime() % dur;
    const remaining = cycle - (elapsed % cycle);
    dot.querySelectorAll<SVGAnimationElement>("animate, animateMotion").forEach((anim) => anim.endElementAt(remaining));
  }, [paused, dur, cycle]);
  const radius = getPulseRadius(pulse);
  return (
    // key — 정지/재개·배속 전환 때 애니메이션을 새로 붙여 마운트 시계 정렬로 형제와 같은 위상에서 다시 시작
    <circle
      key={`${paused ? "paused" : "run"}-${dur}`}
      ref={dotRef}
      className="bpm-edge-pulse pointer-events-none"
      r={radius}
      fill={getPulseFill(pulse)}
      stroke={pulse.onDark ? "var(--color-surface)" : undefined}
      strokeWidth={pulse.onDark ? 0.8 : undefined}
      strokeOpacity={pulse.onDark ? 0.7 : undefined}
      style={pulse.focused ? { filter: FOCUS_FILTER } : undefined}
      opacity={0}
    >
      <animateMotion
        path={path}
        dur={`${dur}s`}
        begin="0s"
        end="indefinite"
        repeatCount="indefinite"
        calcMode="spline"
        keyTimes={timeline.motionKeyTimes}
        keyPoints={timeline.motionKeyPoints}
        keySplines={timeline.motionKeySplines}
      />
      <animate
        attributeName="opacity"
        dur={`${dur}s`}
        begin="0s"
        end="indefinite"
        repeatCount="indefinite"
        keyTimes={timeline.opacityKeyTimes}
        values={timeline.opacityValues}
      />
      {timeline.radiusKeyTimes && timeline.radiusValues ? (
        <animate
          attributeName="r"
          dur={`${dur}s`}
          begin="0s"
          end="indefinite"
          repeatCount="indefinite"
          keyTimes={timeline.radiusKeyTimes}
          values={timeline.radiusValues}
        />
      ) : null}
    </circle>
  );
}
