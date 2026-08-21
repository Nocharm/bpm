// GMP 분류 확정 안내 팝오버 — 픽 직후 마우스 지점 노출(#6·#7). 하단 버튼 아이콘 + 우하단 확인,
// 버튼 호버 시 그 동작이 되돌릴 값만 남게 강조(안 바뀌는 줄 딤). 바깥 클릭·Esc·X·확인으로 닫힘.
"use client";

import { ArrowRight, Check, Palette, ShieldCheck, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { GmpColorSwatch } from "@/components/gmp-picker-popup";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";

interface GmpNoticePopoverProps {
  x: number;
  y: number;
  prevGmp: string;
  nextGmp: string;
  prevColor: string;
  nextColor: string;
  onRevertColor: () => void;
  onRevertAll: () => void;
  onClose: () => void;
}

export function GmpNoticePopover({
  x, y, prevGmp, nextGmp, prevColor, nextColor, onRevertColor, onRevertAll, onClose,
}: GmpNoticePopoverProps) {
  const { t } = useI18n();
  // 호버 중인 동작 — color=색만 복원, all=분류+색 복원, confirm=현행 유지(되돌릴 값 없음 → 전부 딤)
  const [hovered, setHovered] = useState<"color" | "all" | "confirm" | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const colorChanged = nextColor !== prevColor;
  // 호버한 동작이 이 줄을 바꾸는가 — all=둘 다, color=색 줄만, confirm=없음
  const affects = (row: "gmp" | "color"): boolean =>
    hovered === "all" ? true : hovered === "color" ? row === "color" : false;
  const rowClass = (affected: boolean) =>
    `mt-2 flex items-center gap-2 text-caption text-ink-secondary transition-all duration-150 ${
      hovered === null ? "" : affected ? "opacity-100" : "opacity-35"
    }`;
  const actionButton =
    "flex items-center gap-1 rounded-sm px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-alt";

  return (
    <>
      {/* 바깥 클릭 닫힘(#7) — 정보성 안내라 투명 백드롭으로 캔버스 시야 유지 */}
      <div className="fixed inset-0 z-[1355]" onMouseDown={onClose} />
      <div
        data-id="node-gmp-notice"
        className="fixed z-[1360] w-[300px] rounded-md border border-hairline bg-surface p-3 shadow-lg"
        style={{
          left: Math.max(8, Math.min(x - 300 + 24, window.innerWidth - 308)),
          top: Math.max(8, y - 24),
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-caption-strong text-ink">
            <ShieldCheck size={14} strokeWidth={1.5} className="text-accent" />
            {t("gmpNotice.title")}
          </div>
          <button
            type="button"
            data-id="node-gmp-notice-close"
            aria-label="Dismiss"
            className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className={rowClass(affects("gmp"))} data-id="node-gmp-notice-row-gmp">
          <span className="w-20 shrink-0 text-fine text-ink-tertiary">{t("gmpNotice.classification")}</span>
          <span className="rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(prevGmp) ?? undefined}>
            {formatGmp(prevGmp) || t("gmpNotice.unset")}
          </span>
          <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          <span className="rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(nextGmp) ?? undefined}>
            {formatGmp(nextGmp) || t("gmpNotice.unset")}
          </span>
        </div>
        {colorChanged && (
          <div className={rowClass(affects("color"))} data-id="node-gmp-notice-row-color">
            <span className="w-20 shrink-0 text-fine text-ink-tertiary">{t("gmpNotice.nodeColor")}</span>
            <GmpColorSwatch color={prevColor} />
            <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
            {/* 빈 색 = 타입 기본색(미분류 리셋) — 점선 스와치 (#7) */}
            <GmpColorSwatch color={nextColor} />
          </div>
        )}
        <div className="mt-2.5 flex items-center justify-end gap-1.5">
          {colorChanged && (
            <button
              type="button"
              data-id="node-gmp-notice-revert-color"
              className={actionButton}
              onMouseEnter={() => setHovered("color")}
              onMouseLeave={() => setHovered(null)}
              onClick={onRevertColor}
            >
              <Palette size={12} strokeWidth={1.5} />
              {t("gmpNotice.revertColor")}
            </button>
          )}
          <button
            type="button"
            data-id="node-gmp-notice-revert-all"
            className={actionButton}
            onMouseEnter={() => setHovered("all")}
            onMouseLeave={() => setHovered(null)}
            onClick={onRevertAll}
          >
            <Undo2 size={12} strokeWidth={1.5} />
            {t("gmpNotice.revertAll")}
          </button>
          <button
            type="button"
            data-id="node-gmp-notice-confirm"
            className="flex items-center gap-1 rounded-sm bg-accent px-2.5 py-0.5 text-caption text-on-accent hover:bg-accent-focus"
            onMouseEnter={() => setHovered("confirm")}
            onMouseLeave={() => setHovered(null)}
            onClick={onClose}
          >
            <Check size={12} strokeWidth={1.5} />
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </>
  );
}
