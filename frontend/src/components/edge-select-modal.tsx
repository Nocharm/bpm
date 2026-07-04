"use client";

// 다중 출력 노드에 삽입 시 — 어느 출력선으로 들어갈지 선택 (F1). 마우스 위치 컨텍스트 팝업.
// 각 행: 분기 글리프(Yes/No만 체크/엑스, 그 외 기타 점) + 엣지라벨 필 + 쉐브론 + 대상노드 필(균일 폭·ellipsis).
// 헤더 캡션+우상단 X, 하단 Cancel — 다른 팝업과 크롬 통일. 최대 3.4행 + 내부 스크롤(스크롤바 숨김).
// 행 hover 시 onHoverOption(edgeId)로 캔버스의 해당 실제 엣지도 하이라이트(page.tsx styledEdges).

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, X } from "lucide-react";

import { BranchGlyph } from "@/components/branch-icon";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import type { BranchKind } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

interface SelectOption {
  edgeId: string;
  branchKind: BranchKind;
  edgeLabel: string;
  targetLabel: string;
}

const PILL_CLASS =
  "min-w-0 truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink";

export function EdgeSelectModal({
  position,
  options,
  onPick,
  onClose,
  onHoverOption,
}: {
  position: { x: number; y: number };
  options: SelectOption[];
  onPick: (edgeId: string) => void;
  onClose: () => void;
  /** 행 hover 시 캔버스의 대응 엣지를 하이라이트하도록 알림(빈값이면 해제). */
  onHoverOption?: (edgeId: string | null) => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 닫힐 땐 hover 하이라이트도 해제.
  const closeAndClear = () => {
    onHoverOption?.(null);
    onClose();
  };

  // 리스트는 최대 3.4행(≈132px)까지, 그 이상은 내부 스크롤 → 팝업 전체 높이 상한.
  const listH = Math.min(options.length * 34, 132);
  const { left, top } = clampToViewport(position.x, position.y, 256, 56 + listH + 40);

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={closeAndClear}>
      <div
        data-id="edge-select-modal"
        className="fixed w-64 rounded-md border border-hairline bg-surface p-2 shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("edge.selectOutput")}
          </span>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={closeAndClear}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        {/* 그리드: [글리프+엣지필 40%] [쉐브론 ~40%고정] [대상필 60% 균일폭] */}
        <div className="scrollbar-hidden flex max-h-[132px] flex-col gap-1.5 overflow-y-auto">
          {options.map((option, i) => {
            const edgeLabel = option.edgeLabel || t("inspector.branchOther");
            return (
              <button
                key={option.edgeId}
                type="button"
                className="edge-row-in grid w-full grid-cols-[2fr_auto_3fr] items-center gap-1.5 rounded-sm border border-hairline px-2 py-1.5 text-left transition-colors hover:border-accent hover:bg-accent-tint active:bg-accent-tint"
                style={{ animationDelay: `${i * 50}ms` }}
                onMouseEnter={() => onHoverOption?.(option.edgeId)}
                onMouseLeave={() => onHoverOption?.(null)}
                onClick={() => {
                  onHoverOption?.(null);
                  onPick(option.edgeId);
                }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="flex shrink-0">
                    <BranchGlyph kind={option.branchKind} size={16} animate={false} />
                  </span>
                  <span className={PILL_CLASS} title={edgeLabel}>
                    {edgeLabel}
                  </span>
                </span>
                <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <span className={PILL_CLASS} title={option.targetLabel}>
                  {option.targetLabel}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-1.5 flex h-8 w-full items-center justify-center rounded-sm text-caption text-ink-tertiary hover:bg-surface-alt"
          onClick={closeAndClear}
        >
          {t("common.cancel")}
        </button>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
