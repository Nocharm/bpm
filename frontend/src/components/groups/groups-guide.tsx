"use client";

// 유저 그룹 상단 안내 — 목적 + 신청→승인→사용 3단계(아이콘 원) + 관리자 콜아웃(설정·권한)을
// 아이콘/필 중심 SVG로 빠르게 파악하게 한다 (A11-④, 텍스트 최소화). 색은 디자인 토큰만. /
// User Groups guide: icon-driven SVG — 3 steps (request → approve → use) + a manager callout.

import { useI18n } from "@/lib/i18n";

// 단계 아이콘 — 원 중심(0,0) 기준 상대 path (흰색 stroke) / step glyph relative to circle centre.
const STEP_GLYPH: Record<number, string> = {
  1: "M-5 0 H5 M0 -5 V5", // plus — 신청
  2: "M-5 0.5 L-1.5 4 L5.5 -4", // check — 승인
  3: "M-5 0 H5 M1.5 -4.5 L6 0 L1.5 4.5", // arrow — 사용
};
// Lucide star (24x24) — 관리자 마커 / manager marker.
const STAR =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.123 2.123 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

export function GroupsGuide() {
  const { t } = useI18n();
  const steps = [
    { n: 1, label: t("perm.group.guideS1"), cx: 44 },
    { n: 2, label: t("perm.group.guideS2"), cx: 268 },
    { n: 3, label: t("perm.group.guideS3"), cx: 492 },
  ];

  return (
    <svg
      viewBox="0 0 980 186"
      role="img"
      aria-label={t("perm.group.guideTitle")}
      className="h-auto w-full max-w-4xl"
    >
      <defs>
        <marker id="gd-arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="var(--color-ink-tertiary)" />
        </marker>
      </defs>

      <rect
        x="0.75"
        y="0.75"
        width="978.5"
        height="184.5"
        rx="14"
        fill="var(--color-accent-tint)"
        stroke="var(--color-accent-tint-border)"
        strokeWidth="1.5"
      />

      <text x="28" y="38" fill="var(--color-ink)" fontSize="17" fontWeight="600">
        {t("perm.group.guideTitle")}
      </text>
      <text x="28" y="60" fill="var(--color-ink-secondary)" fontSize="12.5">
        {t("perm.group.guidePurpose")}
      </text>

      {/* 3단계 — 아이콘 원 + 라벨 + 화살표 / steps: icon circles + labels + arrows */}
      {steps.map((s, i) => (
        <g key={s.n}>
          <circle cx={s.cx} cy="104" r="17" fill="var(--color-accent)" />
          <path
            d={STEP_GLYPH[s.n]}
            transform={`translate(${s.cx} 104)`}
            stroke="var(--color-on-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <text x={s.cx + 28} y="109" fill="var(--color-ink)" fontSize="14" fontWeight="600">
            {s.label}
          </text>
          {i < steps.length - 1 && (
            <path
              d={`M ${s.cx + 120} 104 H ${steps[i + 1].cx - 22}`}
              stroke="var(--color-ink-tertiary)"
              strokeWidth="1.5"
              fill="none"
              markerEnd="url(#gd-arrow)"
            />
          )}
        </g>
      ))}

      {/* 관리자 콜아웃 — ★ + 설정 방법 + 권한 / manager callout */}
      <rect
        x="24"
        y="142"
        width="932"
        height="30"
        rx="8"
        fill="var(--color-surface)"
        stroke="var(--color-accent-tint-border)"
      />
      <path
        d={STAR}
        transform="translate(36 150) scale(0.6)"
        fill="var(--color-accent)"
      />
      <text x="58" y="161" fontSize="12.5">
        <tspan fill="var(--color-accent)" fontWeight="600">
          {t("perm.group.guideMgr")}
        </tspan>
        <tspan fill="var(--color-ink-tertiary)">{"  ·  "}</tspan>
        <tspan fill="var(--color-ink-secondary)">{t("perm.group.guideMgrSet")}</tspan>
        <tspan fill="var(--color-ink-tertiary)">{"  ·  "}</tspan>
        <tspan fill="var(--color-ink-secondary)">{t("perm.group.guideMgrPerm")}</tspan>
      </text>
    </svg>
  );
}
