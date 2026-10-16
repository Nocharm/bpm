"use client";

// A4 가이드 스위치 + 세로/가로 — 캔버스 노드 표시 정보 카드(NodeDisplayFloat topSlot) 맨 위에 놓인다. 상태는 에디터가 소유.

import { RectangleHorizontal, RectangleVertical } from "lucide-react";

import { ShimmerPresence } from "@/components/shimmer-presence";
import { PAPER_ORIENTATIONS, type PaperOrientation } from "@/lib/export";
import { useI18n } from "@/lib/i18n";

interface A4GuideControlProps {
  on: boolean;
  paper: PaperOrientation;
  onToggle: () => void;
  onPaperChange: (paper: PaperOrientation) => void;
}

export function A4GuideControl({ on, paper, onToggle, onPaperChange }: A4GuideControlProps) {
  const { t } = useI18n();
  return (
    <div className="mb-2 border-b border-divider pb-2">
      {/* 행 전체가 토글 — 노드 표시 정보 행과 같은 스위치 모양 */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        data-id="canvas-a4-guide-toggle"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-sm px-1 py-1 text-caption text-ink-secondary hover:bg-surface-alt"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <RectangleVertical size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          <span className="truncate">{t("a4Guide.title")}</span>
        </span>
        <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-border-strong"}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-all ${on ? "left-3.5" : "left-0.5"}`} />
        </span>
      </button>
      <ShimmerPresence show={on} dataId="canvas-a4-guide-paper" className="relative mt-1 rounded-sm">
        <div className="flex gap-0.5 rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
          {PAPER_ORIENTATIONS.map((option) => (
            <button
              key={option}
              type="button"
              data-id={`canvas-a4-guide-paper-${option}`}
              aria-pressed={paper === option}
              onClick={() => onPaperChange(option)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-xs py-0.5 ${
                paper === option ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:text-ink-secondary"
              }`}
            >
              {option === "portrait" ? (
                <RectangleVertical size={12} strokeWidth={1.5} />
              ) : (
                <RectangleHorizontal size={12} strokeWidth={1.5} />
              )}
              {t(option === "portrait" ? "pngExport.paperPortrait" : "pngExport.paperLandscape")}
            </button>
          ))}
        </div>
      </ShimmerPresence>
    </div>
  );
}
