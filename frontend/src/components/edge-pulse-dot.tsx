"use client";

// 엣지 흐름 펄스 점 — 병렬 출구(동시 75% 건너기)·분기(동시 출발→반짝임→한 갈래) 렌더. 에디터 엣지(multiline-edge)가 공유.
// SMIL animateMotion/animate라 JS 타이머가 없다. RF는 엣지마다 <svg>를 따로 그려 SMIL 시계도 엣지별이므로,
// 마운트 때 그 svg 시계를 페이지 시계(performance.now)에 맞춰 나중에 생긴 갈래도 형제와 박자가 맞게 한다.
// 판정·타임라인은 lib/edge-pulse.
// 모션 축소 설정이면 globals.css `.bpm-edge-pulse`가 숨긴다.

import { useEffect, useRef } from "react";

import { buildPulseTimeline, DECISION_RADIUS, PARALLEL_RADIUS, type EdgePulse } from "@/lib/edge-pulse";

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

export function EdgePulseDot({ path, pulse, travel }: EdgePulseDotProps) {
  const timeline = buildPulseTimeline(pulse, travel);
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
  const radius = pulse.kind === "parallel" ? PARALLEL_RADIUS : DECISION_RADIUS;
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
