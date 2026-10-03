// 흐름 점 범례 — 엣지 흐름 펄스(병렬 동시·분기 택일)의 뜻을 두 줄로 알려준다. 노드 표시 정보 플로팅 카드(NodeDisplayFloat)가 공유.
// 견본 점은 에디터 펄스(components/edge-pulse-dot)와 같은 색·불투명도·리듬을 줄여 그린다. 모션 축소면 globals.css가
// 움직이는 견본(.bpm-edge-pulse)을 정지 장면(.bpm-edge-pulse-still)으로 바꾸고, still이면 처음부터 정지 장면만(비교 화면).
"use client";

import { resolveNodeStroke } from "@/components/process-node";
import { DECISION_RADIUS, PARALLEL_RADIUS, PULSE_STILL_OPACITY } from "@/lib/edge-pulse";
import { useI18n } from "@/lib/i18n";

interface PulseLegendProps {
  // 비교 화면처럼 펄스가 정지 장면으로만 그려지는 표면
  still?: boolean;
}

// 견본 선 좌표(px) — 폭 40 안에서 병렬은 75% 지점, 분기는 35% 지점에서 멈춘다(에디터 PARALLEL_REACH·멈춤 상한과 같은 비율)
const LINE_START = 2;
const LINE_END = 38;
const Y = 6;
const PARALLEL_STOP = LINE_START + (LINE_END - LINE_START) * 0.75;
const DECISION_STOP = LINE_START + (LINE_END - LINE_START) * 0.35;
const DECISION_WIN = LINE_START + (LINE_END - LINE_START) * 0.6;
// 견본은 노드 색이 없으니 분기 기본 stroke(amber)를 쓴다
const DECISION_COLOR = resolveNodeStroke("", "decision");

export function PulseLegend({ still = false }: PulseLegendProps) {
  const { t } = useI18n();
  const stillClass = still ? undefined : "bpm-edge-pulse-still";
  return (
    <div data-id="pulse-legend" className="flex flex-col gap-1">
      <p className="text-fine font-semibold text-ink">{t("pulseLegend.title")}</p>
      <div className="flex items-center gap-2 text-caption text-ink-secondary">
        <svg width={40} height={12} viewBox="0 0 40 12" aria-hidden className="shrink-0">
          <line x1={LINE_START} y1={Y} x2={LINE_END} y2={Y} stroke="var(--color-border-strong)" strokeWidth={1.5} />
          {still ? null : (
            <circle className="bpm-edge-pulse" cy={Y} r={PARALLEL_RADIUS} fill="var(--color-accent)" opacity={0}>
              <animate attributeName="cx" dur="3s" repeatCount="indefinite" keyTimes="0;0.6;1" values={`${LINE_START};${PARALLEL_STOP};${PARALLEL_STOP}`} />
              <animate attributeName="opacity" dur="3s" repeatCount="indefinite" keyTimes="0;0.1;0.5;0.6;1" values="0;0.5;0.5;0;0" />
            </circle>
          )}
          <circle className={stillClass} cx={PARALLEL_STOP} cy={Y} r={PARALLEL_RADIUS} fill="var(--color-accent)" fillOpacity={PULSE_STILL_OPACITY} />
        </svg>
        <span className="min-w-0">{t("pulseLegend.parallel")}</span>
      </div>
      <div className="flex items-center gap-2 text-caption text-ink-secondary">
        <svg width={40} height={12} viewBox="0 0 40 12" aria-hidden className="shrink-0">
          <line x1={LINE_START} y1={Y} x2={LINE_END} y2={Y} stroke="var(--color-border-strong)" strokeWidth={1.5} />
          {still ? null : (
            <circle className="bpm-edge-pulse" cy={Y} r={DECISION_RADIUS} fill={DECISION_COLOR} opacity={0}>
              <animate attributeName="cx" dur="3.6s" repeatCount="indefinite" keyTimes="0;0.25;0.6;0.85;1" values={`${LINE_START};${DECISION_STOP};${DECISION_STOP};${DECISION_WIN};${LINE_START}`} />
              <animate attributeName="opacity" dur="3.6s" repeatCount="indefinite" keyTimes="0;0.08;0.35;0.4;0.45;0.75;0.85;1" values="0;0.75;0.75;1;0.75;0.75;0;0" />
              <animate attributeName="r" dur="3.6s" repeatCount="indefinite" keyTimes="0;0.35;0.4;0.45;1" values={`${DECISION_RADIUS};${DECISION_RADIUS};${DECISION_RADIUS * 1.4};${DECISION_RADIUS};${DECISION_RADIUS}`} />
            </circle>
          )}
          <circle className={stillClass} cx={DECISION_STOP} cy={Y} r={DECISION_RADIUS} fill={DECISION_COLOR} fillOpacity={PULSE_STILL_OPACITY} />
        </svg>
        <span className="min-w-0">{t("pulseLegend.decision")}</span>
      </div>
    </div>
  );
}
