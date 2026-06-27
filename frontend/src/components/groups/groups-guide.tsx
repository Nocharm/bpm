"use client";

// 유저 그룹 상단 안내 — 라이프사이클(신청→승인→활성→비활성→삭제)을 상태 아이콘 원 + 전이 화살표로
// 한눈에. 화살표 위=전진 동작, 아래=되돌리는 동작(↺ 철회/재신청/재활성/복구). 관리자 콜아웃 유지.
// 색은 상태 배지와 동일 시맨틱 토큰만 (L3). / User Groups lifecycle guide.

import { useI18n } from "@/lib/i18n";

// 상태 아이콘 — 원 중심(0,0) 기준 상대 path / state glyph relative to circle centre.
const GLYPH = {
  request: "M-5 0 H5 M0 -5 V5", // plus
  approval: "M-5 0.5 L-1.5 4 L5.5 -4", // check
  active: "M-3.5 -5 L5 0 L-3.5 5 Z", // play (fill)
  inactive: "M-3.5 -5 V5 M3.5 -5 V5", // pause
  trash: "M-5 -3.5 H5 M-1.5 -3.5 V-6 H1.5 V-3.5 M-3.5 -3 L-3 6 H3 L3.5 -3 M-1.5 0 V4 M1.5 0 V4", // bin
} as const;
const STAR =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.123 2.123 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

const CY = 110;
const R = 18;

export function GroupsGuide() {
  const { t } = useI18n();

  // 상태 노드 — 상태 배지와 동일 시맨틱 색 / state nodes, colors mirror the status badges.
  const states = [
    { cx: 90, color: "var(--color-changed)", glyph: GLYPH.request, fill: false, label: t("perm.group.lcRequest") },
    { cx: 290, color: "var(--color-accent)", glyph: GLYPH.approval, fill: false, label: t("perm.group.lcApproval") },
    { cx: 490, color: "var(--color-added)", glyph: GLYPH.active, fill: true, label: t("perm.group.lcActive") },
    { cx: 690, color: "var(--color-ink-tertiary)", glyph: GLYPH.inactive, fill: false, label: t("perm.group.lcInactive") },
    { cx: 890, color: "var(--color-error)", glyph: GLYPH.trash, fill: false, label: t("perm.group.lcDeleted") },
  ];
  // 전이 — 위=전진 동작, 아래=되돌리기(↺) / transitions: forward verb above, reverse below.
  const gaps = [
    { fwd: t("perm.group.lcFwdPending"), rev: t("perm.group.lcRevWithdraw") },
    { fwd: t("perm.group.lcFwdApprove"), rev: t("perm.group.lcRevReject") },
    { fwd: t("perm.group.lcFwdDeactivate"), rev: t("perm.group.lcRevReactivate") },
    { fwd: t("perm.group.lcFwdDelete"), rev: t("perm.group.lcRevRestore") },
  ];

  return (
    <svg
      viewBox="0 0 980 250"
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
        height="248.5"
        rx="14"
        fill="var(--color-accent-tint)"
        stroke="var(--color-accent-tint-border)"
        strokeWidth="1.5"
      />

      <text x="28" y="36" fill="var(--color-ink)" fontSize="17" fontWeight="600">
        {t("perm.group.guideTitle")}
      </text>
      <text x="28" y="58" fill="var(--color-ink-secondary)" fontSize="12.5">
        {t("perm.group.guidePurpose")}
      </text>

      {/* 전이 화살표 + 전진/되돌리기 라벨 / transition arrows with forward + reverse labels */}
      {gaps.map((g, i) => {
        const center = (states[i].cx + states[i + 1].cx) / 2;
        return (
          <g key={i}>
            <path
              d={`M ${states[i].cx + R + 6} ${CY} H ${states[i + 1].cx - R - 6}`}
              stroke="var(--color-ink-tertiary)"
              strokeWidth="1.5"
              fill="none"
              markerEnd="url(#gd-arrow)"
            />
            <text
              x={center}
              y={CY - 12}
              textAnchor="middle"
              fill="var(--color-ink-secondary)"
              fontSize="11.5"
              fontWeight="600"
            >
              {g.fwd}
            </text>
            <text x={center} y={CY + 22} textAnchor="middle" fill="var(--color-ink-tertiary)" fontSize="11">
              {"↺ "}
              {g.rev}
            </text>
          </g>
        );
      })}

      {/* 상태 노드 — 아이콘 원 + 라벨 / state nodes: icon circle + label */}
      {states.map((s) => (
        <g key={s.cx}>
          <circle cx={s.cx} cy={CY} r={R} fill={s.color} />
          <path
            d={s.glyph}
            transform={`translate(${s.cx} ${CY})`}
            stroke={s.fill ? "none" : "var(--color-on-accent)"}
            fill={s.fill ? "var(--color-on-accent)" : "none"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x={s.cx}
            y={CY + 46}
            textAnchor="middle"
            fill="var(--color-ink)"
            fontSize="13"
            fontWeight="600"
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* 관리자 콜아웃 — ★ + 설정 방법 + 권한 / manager callout */}
      <rect
        x="24"
        y="200"
        width="932"
        height="32"
        rx="8"
        fill="var(--color-surface)"
        stroke="var(--color-accent-tint-border)"
      />
      <path d={STAR} transform="translate(36 209) scale(0.6)" fill="var(--color-accent)" />
      <text x="58" y="220" fontSize="12.5">
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
