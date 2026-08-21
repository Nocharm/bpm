// GMP 분류 픽커 팝업 — 캔버스 필·인스펙터 GMP 행 공용. 옵션 클릭 즉시 적용(원 동작),
// 적용 후 안내는 GmpNoticePopover(#6·#7)가 담당. Esc·바깥 클릭 닫힘.
"use client";

import { CircleDashed, Shield, ShieldCheck, ShieldOff, type LucideIcon } from "lucide-react";
import { useEffect } from "react";

import { GMP_NODE_COLORS, GMP_OPTIONS, type GmpValue } from "@/lib/gmp";
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

// 빈 색 = 타입 기본색 — 점선 스와치로 "기본"을 표현 (안내 팝오버와 공유)
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
  onPick: (value: string) => void;
  onClose: () => void;
}

export function GmpPickerPopup({ x, y, onPick, onClose }: GmpPickerPopupProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = [{ value: "", label: t("perm.processFields.gmpUnset") }, ...GMP_OPTIONS];

  return (
    <>
      <div className="fixed inset-0 z-[1340]" onMouseDown={onClose} />
      <div
        data-id="node-gmp-picker"
        className="fixed z-[1350] w-[190px] rounded-md border border-hairline bg-surface p-1.5 shadow-lg"
        style={{
          left: Math.min(x, window.innerWidth - 198),
          top: Math.min(y + 6, window.innerHeight - 150),
        }}
      >
        {options.map((option) => {
          const Icon = OPTION_ICONS[option.value];
          return (
            <button
              key={option.value || "unset"}
              type="button"
              data-id={`node-gmp-picker-${option.value || "unset"}`}
              className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-caption text-ink hover:bg-surface-alt"
              onClick={() => onPick(option.value)}
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
            </button>
          );
        })}
      </div>
    </>
  );
}
