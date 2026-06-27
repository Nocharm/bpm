"use client";

// 유저 그룹 상단 안내 — 목적 + 신청→승인→사용 3단계 SVG 일러스트 가이드 (A11-④) /
// User Groups header guide: purpose + a 3-step (request → approve → use) SVG illustration.
// 색은 디자인 토큰(var(--color-*))만 사용 — raw hex 금지.

import { useI18n } from "@/lib/i18n";

export function GroupsGuide() {
  const { t } = useI18n();
  const steps = [
    { n: "1", label: t("perm.group.guideS1"), sub: t("perm.group.guideS1Sub"), x: 40 },
    { n: "2", label: t("perm.group.guideS2"), sub: t("perm.group.guideS2Sub"), x: 360 },
    { n: "3", label: t("perm.group.guideS3"), sub: t("perm.group.guideS3Sub"), x: 680 },
  ];

  return (
    <svg
      viewBox="0 0 980 150"
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
        height="148.5"
        rx="14"
        fill="var(--color-accent-tint)"
        stroke="var(--color-accent-tint-border)"
        strokeWidth="1.5"
      />

      <text x="28" y="40" fill="var(--color-ink)" fontSize="17" fontWeight="600">
        {t("perm.group.guideTitle")}
      </text>
      <text x="28" y="62" fill="var(--color-ink-secondary)" fontSize="12.5">
        {t("perm.group.guidePurpose")}
      </text>

      {steps.map((s, i) => (
        <g key={s.n}>
          <circle cx={s.x + 16} cy="106" r="15" fill="var(--color-accent)" />
          <text
            x={s.x + 16}
            y="111"
            textAnchor="middle"
            fill="var(--color-on-accent)"
            fontSize="13"
            fontWeight="600"
          >
            {s.n}
          </text>
          <text x={s.x + 42} y="102" fill="var(--color-ink)" fontSize="13.5" fontWeight="600">
            {s.label}
          </text>
          <text x={s.x + 42} y="119" fill="var(--color-ink-tertiary)" fontSize="11">
            {s.sub}
          </text>
          {i < steps.length - 1 && (
            <path
              d={`M ${s.x + 250} 106 H ${steps[i + 1].x + 2}`}
              stroke="var(--color-ink-tertiary)"
              strokeWidth="1.5"
              fill="none"
              markerEnd="url(#gd-arrow)"
            />
          )}
        </g>
      ))}
    </svg>
  );
}
