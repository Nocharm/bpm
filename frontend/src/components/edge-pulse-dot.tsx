"use client";

// 엣지 흐름 펄스 점 — 병렬 출구(동시 건너기)·분기(머뭇거린 뒤 한 갈래) 렌더. 에디터 엣지(multiline-edge)가 공유.
// SMIL animateMotion/animate라 JS 타이머가 없다. RF는 엣지마다 <svg>를 따로 그려 SMIL 시계도 엣지별이므로,
// 마운트 때 그 svg 시계를 페이지 시계(performance.now)에 맞춰 나중에 생긴 갈래도 형제와 박자가 맞게 한다.
// 판정·타임라인은 lib/edge-pulse.
// 모션 축소 설정이면 globals.css `.bpm-edge-pulse`가 숨긴다.

import { useEffect, useRef } from "react";

import { buildPulseTimeline, type EdgePulse } from "@/lib/edge-pulse";

interface EdgePulseDotProps {
  path: string;
  pulse: EdgePulse;
  // 분기 점 이동 비율(0..1) — 병렬은 무시
  travel: number;
}

export function EdgePulseDot({ path, pulse, travel }: EdgePulseDotProps) {
  const timeline = buildPulseTimeline(pulse, travel);
  const dotRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    dotRef.current?.ownerSVGElement?.setCurrentTime(performance.now() / 1000);
  }, []);
  const fill = pulse.kind === "parallel" ? "var(--color-accent)" : pulse.color;
  return (
    <circle ref={dotRef} className="bpm-edge-pulse pointer-events-none" r={pulse.kind === "parallel" ? 3.2 : 3.8} fill={fill} opacity={0}>
      <animateMotion
        path={path}
        dur={`${timeline.dur}s`}
        begin={`${timeline.begin}s`}
        repeatCount="indefinite"
        calcMode="spline"
        keyTimes={timeline.motionKeyTimes}
        keyPoints={timeline.motionKeyPoints}
        keySplines={timeline.motionKeySplines}
      />
      <animate
        attributeName="opacity"
        dur={`${timeline.dur}s`}
        begin={`${timeline.begin}s`}
        repeatCount="indefinite"
        keyTimes={timeline.opacityKeyTimes}
        values={timeline.opacityValues}
      />
    </circle>
  );
}
