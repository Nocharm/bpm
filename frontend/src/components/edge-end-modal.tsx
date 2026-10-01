"use client";

// 하위프로세스 출구 선택 — 끝이 2개 이상인 SP에서 끝을 모르는 경로(드롭존 앞/뒤·역방향 몸체 드롭)로 엣지가 생길 때
// 어느 끝에서 이어질지 고르는 목록. 크롬은 EdgeSelectModal과 동일(포털·투명 백드롭 z-1200·포인터 위치·Esc·취소 바).
// 대표 끝은 항상 첫 행 + 뱃지 + 틴트 배경. 이미 연결된 끝은 현재 타깃을 흐리게 표시(정보용, 선택은 가능).
// 설계: 2026-10-01-subprocess-ends-design.md §3.3(폐기, git history)

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Flag, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";
import type { SubEnd } from "@/lib/subprocess-embed";

interface EdgeEndModalProps {
  position: { x: number; y: number };
  /** deriveSubEnds 순서(대표 끝 먼저). */
  ends: SubEnd[];
  /** 끝 키 → 현재 연결된 타깃 제목(있을 때만). */
  connectedTargets: Record<string, string>;
  onPick: (endKey: string) => void;
  onClose: () => void;
  title?: string;
}

const PILL_CLASS =
  "min-w-0 truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink";

export function EdgeEndModal({ position, ends, connectedTargets, onPick, onClose, title }: EdgeEndModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 리스트는 최대 3.4행(≈132px)까지, 그 이상은 내부 스크롤 → 팝업 전체 높이 상한.
  const listH = Math.min(ends.length * 34, 132);
  const { left, top } = clampToViewport(position.x, position.y, 256, 56 + listH + 40);

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={onClose}>
      <div
        data-id="edge-end-modal"
        className="fixed w-64 rounded-md border border-hairline bg-surface p-2 shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
            {title ?? t("edge.selectEnd")}
          </span>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="scrollbar-hidden flex max-h-[132px] flex-col gap-1.5 overflow-y-auto">
          {ends.map((end, i) => {
            const connected = connectedTargets[end.key];
            return (
              <button
                key={end.key}
                type="button"
                data-id={`edge-end-row-${end.key}`}
                className={`edge-row-in grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-sm border px-2 py-1.5 text-left transition-colors hover:border-accent hover:bg-accent-tint active:bg-accent-tint ${
                  end.isPrimary ? "border-accent-tint-border bg-accent-tint/60" : "border-hairline"
                }`}
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => onPick(end.key)}
              >
                <Flag size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={PILL_CLASS} title={end.title}>
                    {end.title}
                  </span>
                  {end.isPrimary && (
                    <span className="shrink-0 rounded-full border border-accent-tint-border bg-surface px-1.5 text-[10px] font-semibold text-accent">
                      {t("node.primaryEnd")}
                    </span>
                  )}
                </span>
                {connected ? (
                  <span className="flex min-w-0 max-w-[88px] items-center gap-0.5 text-fine text-ink-tertiary" title={connected}>
                    <ChevronRight size={12} strokeWidth={1.5} className="shrink-0" />
                    <span className="truncate">{connected}</span>
                  </span>
                ) : (
                  <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-1.5 flex h-8 w-full items-center justify-center rounded-sm text-caption text-ink-tertiary hover:bg-surface-alt"
          onClick={onClose}
        >
          {t("common.cancel")}
        </button>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
