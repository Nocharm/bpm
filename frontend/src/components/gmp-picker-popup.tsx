// GMP 분류 픽커 팝업 — 캔버스 필·인스펙터 GMP 행 공용. 옵션은 스테이징, 우하단 Confirm으로 적용.
// 옵션 호버 시 미리보기(분류·노드 색)에서 바뀌는 값만 남게 강조 — 안 바뀌는 값은 딤 (사용자 요청 2026-08-21 #6)
"use client";

import {
  ArrowRight,
  Check,
  CircleDashed,
  Shield,
  ShieldCheck,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { GMP_NODE_COLORS, GMP_OPTIONS, formatGmp, getGmpBadgeStyle, type GmpValue } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";

const OPTION_ICONS: Record<string, LucideIcon> = {
  "": CircleDashed,
  direct: ShieldCheck,
  indirect: Shield,
  non_gmp: ShieldOff,
};

/** 분류 → 확정될 노드 색. ""(미분류)는 타입 기본색으로 리셋 (사용자 요청 2026-08-21 #7) */
export function getGmpTargetColor(value: string): string {
  return value ? GMP_NODE_COLORS[value as GmpValue] : "";
}

// 빈 색 = 타입 기본색 — 점선 스와치로 "기본"을 표현 (안내 토스트와 공유)
export function GmpColorSwatch({ color }: { color: string }) {
  return color ? (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border"
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 18%, white)` }}
    />
  ) : (
    <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-dashed border-border-strong" />
  );
}

interface GmpPickerPopupProps {
  x: number;
  y: number;
  /** 현재 노드 값 — 미리보기의 "이전" 쪽 */
  current: { gmp: string; color: string };
  onConfirm: (value: string) => void;
  onClose: () => void;
}

export function GmpPickerPopup({ x, y, current, onConfirm, onClose }: GmpPickerPopupProps) {
  const { t } = useI18n();
  const [staged, setStaged] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 미리보기 대상 — 호버 우선, 없으면 스테이징 값
  const target = hovered ?? staged;
  const targetColor = target === null ? current.color : getGmpTargetColor(target);
  const gmpChanges = target !== null && target !== current.gmp;
  const colorChanges = target !== null && targetColor !== current.color;
  // 강조 규칙 — 미리보기 중 바뀌는 줄만 남고(살짝 확대) 안 바뀌는 줄은 딤
  const previewRow = (changes: boolean) =>
    `flex items-center gap-1.5 text-caption text-ink-secondary transition-all duration-150 ${
      target === null ? "" : changes ? "opacity-100" : "opacity-35"
    }`;

  const options = [{ value: "", label: t("perm.processFields.gmpUnset") }, ...GMP_OPTIONS];
  const canConfirm = staged !== null && staged !== current.gmp;

  return (
    <>
      <div className="fixed inset-0 z-[1340]" onMouseDown={onClose} />
      <div
        data-id="node-gmp-picker"
        className="fixed z-[1350] w-[224px] rounded-md border border-hairline bg-surface p-1.5 shadow-lg"
        style={{
          left: Math.min(x, window.innerWidth - 232),
          top: Math.min(y + 6, window.innerHeight - 252),
        }}
      >
        {options.map((option) => {
          const Icon = OPTION_ICONS[option.value];
          const isStaged = staged === option.value;
          return (
            <button
              key={option.value || "unset"}
              type="button"
              data-id={`node-gmp-picker-${option.value || "unset"}`}
              aria-pressed={isStaged}
              className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-caption text-ink hover:bg-surface-alt ${
                isStaged ? "bg-accent-tint" : ""
              }`}
              onMouseEnter={() => setHovered(option.value)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setStaged(option.value)}
            >
              <Icon
                size={12}
                strokeWidth={1.5}
                className={`shrink-0 ${option.value ? "" : "text-ink-muted"}`}
                style={
                  option.value
                    ? { color: `var(${GMP_OPTIONS.find((o) => o.value === option.value)?.colorVar})` }
                    : undefined
                }
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isStaged && <Check size={12} strokeWidth={1.5} className="shrink-0 text-accent" />}
            </button>
          );
        })}
        {/* 미리보기 — 분류·노드 색의 현재→선택 */}
        <div data-id="node-gmp-picker-preview" className="mt-1.5 flex flex-col gap-1 border-t border-divider pt-1.5">
          <div className={previewRow(gmpChanges)}>
            <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t("gmpNotice.classification")}</span>
            <span className="rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(current.gmp)}>
              {formatGmp(current.gmp) || t("gmpNotice.unset")}
            </span>
            {gmpChanges && (
              <>
                <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                <span className="rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(target ?? "")}>
                  {formatGmp(target) || t("gmpNotice.unset")}
                </span>
              </>
            )}
          </div>
          <div className={previewRow(colorChanges)}>
            <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t("gmpNotice.nodeColor")}</span>
            <GmpColorSwatch color={current.color} />
            {colorChanges && (
              <>
                <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                <GmpColorSwatch color={targetColor} />
              </>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex justify-end border-t border-divider pt-1.5">
          <button
            type="button"
            data-id="node-gmp-picker-confirm"
            disabled={!canConfirm}
            className="rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => {
              if (staged !== null) onConfirm(staged);
            }}
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </>
  );
}
