"use client";

// 유저 그룹 상단 안내 — 가시성 우선 간소화(L3). 라이프사이클은 5상태 아이콘 흐름(SVG, 전진만)으로,
// 되돌리기 동작과 그룹 매니저 권한은 아이콘+키워드 칩(HTML, Lucide)으로 PPT처럼 한눈에. 색은 시맨틱 토큰만.

import {
  PauseCircle,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";

// 상태 아이콘 — 원 중심(0,0) 기준 상대 path / state glyph relative to circle centre.
const GLYPH = {
  request: "M-5 0 H5 M0 -5 V5", // plus
  approval: "M-5 0.5 L-1.5 4 L5.5 -4", // check
  active: "M-3.5 -5 L5 0 L-3.5 5 Z", // play (fill)
  inactive: "M-3.5 -5 V5 M3.5 -5 V5", // pause
  trash: "M-5 -3.5 H5 M-1.5 -3.5 V-6 H1.5 V-3.5 M-3.5 -3 L-3 6 H3 L3.5 -3 M-1.5 0 V4 M1.5 0 V4", // bin
} as const;

const CY = 38;
const R = 16;

export function GroupsGuide() {
  const { t } = useI18n();

  // 상태 노드 — 상태 배지와 동일 시맨틱 색 / state nodes, colors mirror the status badges.
  const states = [
    { cx: 70, color: "var(--color-changed)", glyph: GLYPH.request, fill: false, label: t("perm.group.lcRequest") },
    { cx: 270, color: "var(--color-accent)", glyph: GLYPH.approval, fill: false, label: t("perm.group.lcApproval") },
    { cx: 470, color: "var(--color-added)", glyph: GLYPH.active, fill: true, label: t("perm.group.lcActive") },
    { cx: 670, color: "var(--color-ink-tertiary)", glyph: GLYPH.inactive, fill: false, label: t("perm.group.lcInactive") },
    { cx: 870, color: "var(--color-error)", glyph: GLYPH.trash, fill: false, label: t("perm.group.lcDeleted") },
  ];
  const forwards = [
    t("perm.group.lcFwdPending"),
    t("perm.group.lcFwdApprove"),
    t("perm.group.lcFwdDeactivate"),
    t("perm.group.lcFwdDelete"),
  ];
  // 되돌리기 동작 — 칩 / reversible actions as chips.
  const reversible = [
    { icon: Undo2, label: t("perm.group.lcRevWithdraw") },
    { icon: RotateCcw, label: t("perm.group.resubmit") },
    { icon: PauseCircle, label: t("perm.group.lcRevReactivate") },
    { icon: RotateCcw, label: t("trash.restore") },
  ];
  // 그룹 매니저 권한 — 아이콘+키워드 칩(PPT식) / manager permissions as icon+keyword chips.
  const perms = [
    { icon: Users, label: t("perm.group.lcPermMembers") },
    { icon: Star, label: t("perm.group.lcPermManagers") },
    { icon: Pencil, label: t("perm.group.lcPermRename") },
    { icon: PauseCircle, label: t("perm.group.lcPermDeactivate") },
    { icon: Trash2, label: t("perm.group.lcPermDelete") },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-3 rounded-md border border-accent-tint-border bg-accent-tint px-5 py-4">
      <div>
        <h3 className="text-body-strong text-ink">{t("perm.group.guideTitle")}</h3>
        <p className="text-caption text-ink-secondary">{t("perm.group.guidePurpose")}</p>
      </div>

      {/* 라이프사이클 — 5상태 아이콘 흐름(전진만) / lifecycle: 5 state icons, forward flow */}
      <svg viewBox="0 0 940 70" role="img" aria-label={t("perm.group.guideTitle")} className="h-auto w-full">
        <defs>
          <marker id="gd-arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6 Z" fill="var(--color-ink-tertiary)" />
          </marker>
        </defs>
        {states.slice(0, -1).map((s, i) => {
          const center = (s.cx + states[i + 1].cx) / 2;
          return (
            <g key={`arrow-${i}`}>
              <path
                d={`M ${s.cx + R + 5} ${CY} H ${states[i + 1].cx - R - 5}`}
                stroke="var(--color-ink-tertiary)"
                strokeWidth="1.5"
                fill="none"
                markerEnd="url(#gd-arrow)"
              />
              <text x={center} y={CY - 8} textAnchor="middle" fill="var(--color-ink-secondary)" fontSize="11" fontWeight="600">
                {forwards[i]}
              </text>
            </g>
          );
        })}
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
            <text x={s.cx} y={CY + 30} textAnchor="middle" fill="var(--color-ink)" fontSize="12.5" fontWeight="600">
              {s.label}
            </text>
          </g>
        ))}
      </svg>

      {/* 되돌리기 동작 — 칩 / reversible-action chips */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-accent-tint-border pt-3">
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-ink-secondary">
          <RotateCcw size={13} strokeWidth={1.5} className="text-ink-tertiary" />
          {t("perm.group.lcReversible")}
        </span>
        {reversible.map((r) => (
          <span
            key={r.label}
            className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-2 py-0.5 text-fine text-ink"
          >
            <r.icon size={12} strokeWidth={1.5} className="text-ink-tertiary" />
            {r.label}
          </span>
        ))}
      </div>

      {/* 그룹 매니저 권한 — PPT식 아이콘+키워드 칩 / manager permissions as icon+keyword chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-accent">
          <Star size={13} strokeWidth={1.5} className="fill-current" />
          {t("perm.group.lcMgrCan")}
        </span>
        {perms.map((p) => (
          <span
            key={p.label}
            className="inline-flex items-center gap-1 rounded-full border border-accent-tint-border bg-surface px-2 py-0.5 text-fine text-ink"
          >
            <p.icon size={12} strokeWidth={1.5} className="text-accent" />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
