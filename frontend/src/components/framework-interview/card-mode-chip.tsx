"use client";

// 캠페인 카드 상태 칩 — 기존·유지(중립 회색) / 기존·정정(변경 앰버) / 외부(L5 하늘 남색), 계획 타일과 보드 행이 같은 톤을 쓴다(2026-09-29).
// 상태별 톤은 여기 한 곳에서만 정한다 — 타일·행·인스펙터가 제각각 색을 고르면 같은 상태가 다르게 읽힌다.

import { useI18n } from "@/lib/i18n";

export type CardModeChipMode = "keep" | "revise" | "external";

const TONE: Record<CardModeChipMode, string> = {
  keep: "border-border-strong bg-surface-alt text-ink-secondary",
  // 변경 예정 — diff의 changed 토큰(앰버)을 옅게. 선택 액센트와 겹치지 않는다
  revise: "border-[color-mix(in_srgb,var(--color-changed)_45%,white)] bg-[color-mix(in_srgb,var(--color-changed)_12%,white)] text-[var(--color-changed)]",
  // 다른 L5의 업무 — 업무 체계 L5 하늘 남색을 옅게(외부 타일 본체와 같은 계열)
  external: "border-[color-mix(in_srgb,var(--color-canvas-l5-sky)_55%,white)] bg-[color-mix(in_srgb,var(--color-canvas-l5-sky)_8%,white)] text-[var(--color-canvas-l5-sky)]",
};
const SIZE = {
  tile: "px-1.5 py-0.5 text-[10px] leading-3",
  row: "px-1.5 py-[2px] text-[11px] leading-none",
} as const;

export function CardModeChip({ mode, size = "tile", dataId, title, color }: {
  mode: CardModeChipMode;
  size?: keyof typeof SIZE;
  dataId?: string;
  title?: string;
  // 외부 칩의 소속 L5 색(캔버스 팔레트) — 주면 남색 대신 그 색으로 물든다
  color?: string;
}) {
  const { t } = useI18n();
  const label = mode === "external"
    ? t("fwConsult.externalChip")
    : `${t("fwConsult.existing")} · ${t(mode === "keep" ? "fwConsult.keep" : "fwConsult.revise")}`;
  const tint = color
    ? { borderColor: `color-mix(in srgb, ${color} 60%, white)`, background: `color-mix(in srgb, ${color} 16%, white)`, color: `color-mix(in srgb, ${color} 72%, black)` }
    : undefined;
  return (
    <span className={`shrink-0 rounded-full border font-semibold ${SIZE[size]} ${TONE[mode]}`} style={tint} data-id={dataId} data-mode={mode} title={title}>
      {label}
    </span>
  );
}
