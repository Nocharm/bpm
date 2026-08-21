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
  // 버튼 호버 → 캔버스 노드에도 결과값 미리 반영(렌더 전용) — null=해제 (사용자 요청 2026-08-21)
  onHoverAction?: (action: "color" | "all" | "confirm" | null) => void;
}

export function GmpNoticePopover({
  x, y, prevGmp, nextGmp, prevColor, nextColor, onRevertColor, onRevertAll, onClose, onHoverAction,
}: GmpNoticePopoverProps) {
  const { t } = useI18n();
  // 호버 중인 동작 — color=색만 복원, all=분류+색 복원, confirm=현행 유지(되돌릴 값 없음 → 전부 딤)
  const [hovered, setHovered] = useState<"color" | "all" | "confirm" | null>(null);
  // 팝오버 내 강조와 캔버스 노드 미리보기를 한 번에 — 호버 진입/이탈 공용
  const hoverAction = (action: "color" | "all" | "confirm" | null) => {
    setHovered(action);
    onHoverAction?.(action);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const colorChanged = nextColor !== prevColor;
  // 호버 미리보기 — 액션 실행 후 "남을 쪽"만 남기고 반대쪽+화살표는 폭이 접히며 사라진다
  // (색만 복원: 분류=next 유지·색=prev 복원 / 언도: 둘 다 prev / 확인: 둘 다 next) (사용자 요청 2026-08-21)
  const survivor = (row: "gmp" | "color"): "prev" | "next" | null => {
    if (hovered === null) return null; // 미리보기 없음 — 전체 표시
    if (hovered === "confirm") return "next";
    if (hovered === "all") return "prev";
    return row === "color" ? "prev" : "next";
  };
  const segClass = (row: "gmp" | "color", seg: "prev" | "arrow" | "next") => {
    const keep = survivor(row);
    const visible = keep === null || seg === keep;
    // gap 대신 mr — 접힌 세그먼트가 간격까지 회수해 남는 요소가 자연스럽게 밀려온다
    return `inline-flex items-center overflow-hidden transition-all duration-350 ease-smooth ${
      visible ? "mr-2 max-w-40 opacity-100" : "mr-0 max-w-0 opacity-0"
    }`;
  };
  const rowClass = "mt-2 flex items-center text-caption text-ink-secondary";
  const actionButton =
    "flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-alt";

  return (
    <>
      {/* 바깥 클릭 닫힘(#7) — 정보성 안내라 투명 백드롭으로 캔버스 시야 유지 */}
      <div className="fixed inset-0 z-[1355]" onMouseDown={onClose} />
      <div
        data-id="node-gmp-notice"
        className="fixed z-[1360] w-[440px] rounded-md border border-hairline bg-surface px-5 py-3 shadow-lg"
        style={{
          left: Math.max(8, Math.min(x - 440 + 24, window.innerWidth - 448)),
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
        <div className={rowClass} data-id="node-gmp-notice-row-gmp">
          <span className="mr-2 w-20 shrink-0 text-fine text-ink-tertiary">{t("gmpNotice.classification")}</span>
          <span className={segClass("gmp", "prev")}>
            <span className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(prevGmp) ?? undefined}>
              {formatGmp(prevGmp) || t("gmpNotice.unset")}
            </span>
          </span>
          <span className={segClass("gmp", "arrow")}>
            <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          </span>
          <span className={segClass("gmp", "next")}>
            <span className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(nextGmp) ?? undefined}>
              {formatGmp(nextGmp) || t("gmpNotice.unset")}
            </span>
          </span>
        </div>
        {colorChanged && (
          <div className={rowClass} data-id="node-gmp-notice-row-color">
            <span className="mr-2 w-20 shrink-0 text-fine text-ink-tertiary">{t("gmpNotice.nodeColor")}</span>
            <span className={segClass("color", "prev")}>
              <GmpColorSwatch color={prevColor} />
            </span>
            <span className={segClass("color", "arrow")}>
              <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
            </span>
            <span className={segClass("color", "next")}>
              {/* 빈 색 = 타입 기본색(미분류 리셋) — 점선 스와치 (#7) */}
              <GmpColorSwatch color={nextColor} />
            </span>
          </div>
        )}
        <div className="mt-2.5 flex flex-nowrap items-center justify-end gap-1.5">
          {colorChanged && (
            <button
              type="button"
              data-id="node-gmp-notice-revert-color"
              className={actionButton}
              onMouseEnter={() => hoverAction("color")}
              onMouseLeave={() => hoverAction(null)}
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
            onMouseEnter={() => hoverAction("all")}
            onMouseLeave={() => hoverAction(null)}
            onClick={onRevertAll}
          >
            <Undo2 size={12} strokeWidth={1.5} />
            {t("gmpNotice.revertAll")}
          </button>
          <button
            type="button"
            data-id="node-gmp-notice-confirm"
            className="flex items-center gap-1 whitespace-nowrap rounded-sm bg-accent px-2.5 py-0.5 text-caption text-on-accent hover:bg-accent-focus"
            onMouseEnter={() => hoverAction("confirm")}
            onMouseLeave={() => hoverAction(null)}
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
