"use client";

// 하위프로세스 출구 선택 — 끝이 2개 이상인 SP에서 끝을 모르는 경로(우측 출구 드래그·드롭존 앞/뒤·역방향 몸체 드롭)로 엣지가 생길 때
// 어느 끝에서 이어질지 고르는 목록. 크롬은 EdgeSelectModal과 동일(포털·투명 백드롭 z-1200·포인터 위치·Esc·취소 바).
// 대표 끝은 항상 첫 행 + 뱃지 + 틴트 배경. 이미 연결된 끝은 현재 타깃을 흐리게 표시(정보용, 선택은 가능).
// 맨 앞 아이콘은 그 끝의 출구 모드(단일=깃발, 병렬=엇갈린 화살표)이자 전환 버튼 — 눌러도 모달은 닫히지 않는다(사용자 결정 2026-10-02).
// 행 호버는 onHoverEnd로 알려 에디터가 그 끝에 연결된 엣지를 캔버스에서 강조한다(입출력 항목 호버와 같은 언어).

import { useEffect, useEffectEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Flag, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";
import { ParallelExitIcon } from "@/lib/parallel-icon";
import type { SubEnd } from "@/lib/subprocess-embed";

interface EdgeEndModalProps {
  position: { x: number; y: number };
  /** deriveSubEnds 순서(대표 끝 먼저). */
  ends: SubEnd[];
  /** 끝 키 → 현재 연결된 타깃 제목들(있을 때만). 병렬 끝은 여럿. */
  connectedTargets: Record<string, string[]>;
  /** 병렬로 켠 끝 키 — 맨 앞 아이콘과 전환 방향을 정한다. */
  parallelKeys: readonly string[];
  onPick: (endKey: string) => void;
  /** 끝의 병렬/단일 전환 — 모달은 열린 채 유지. 읽기 전용이면 생략(아이콘이 버튼이 아님). */
  onToggleParallel?: (endKey: string) => void;
  /** 행 호버(null=떠남) — 그 끝에 연결된 엣지 강조용. */
  onHoverEnd?: (endKey: string | null) => void;
  onClose: () => void;
  title?: string;
}

const PILL_CLASS =
  "min-w-0 truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink";
// 모달 폭 — 끝 이름·대표 끝 뱃지·연결 타깃이 한 행에 잘리지 않게(종전 256px에서 영문 끝 이름이 말줄임됐다)
const MODAL_WIDTH = 352;

export function EdgeEndModal({
  position,
  ends,
  connectedTargets,
  parallelKeys,
  onPick,
  onToggleParallel,
  onHoverEnd,
  onClose,
  title,
}: EdgeEndModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 닫힐 때 강조 해제 — 모달이 사라지면 행 mouseleave가 오지 않는다. 호출부가 인라인 콜백을 넘겨도
  // 렌더마다 해제되지 않게 effect event로 최신 콜백만 읽고 언마운트에서 한 번만 부른다
  const clearHover = useEffectEvent(() => onHoverEnd?.(null));
  useEffect(() => () => clearHover(), []);

  // 리스트는 최대 3.4행(≈150px)까지, 그 이상은 내부 스크롤 → 팝업 전체 높이 상한.
  const listH = Math.min(ends.length * 40, 150);
  const { left, top } = clampToViewport(position.x, position.y, MODAL_WIDTH, 56 + listH + 40);

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={onClose}>
      <div
        data-id="edge-end-modal"
        className="fixed rounded-md border p-2 glass"
        style={{ left, top, width: MODAL_WIDTH }}
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
        <div className="scrollbar-hidden flex max-h-[150px] flex-col gap-1.5 overflow-y-auto">
          {ends.map((end, i) => {
            const targets = connectedTargets[end.key] ?? [];
            const parallel = parallelKeys.includes(end.key);
            const ModeIcon = parallel ? ParallelExitIcon : Flag;
            const modeLabel = parallel ? t("edge.endParallel") : t("edge.endSingle");
            const pick = () => onPick(end.key);
            return (
              // 행 = 끝 선택, 맨 앞 아이콘 = 모드 전환(중첩 button 금지라 행은 role=button div)
              <div
                key={end.key}
                role="button"
                tabIndex={0}
                data-id={`edge-end-row-${end.key}`}
                className={`edge-row-in grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors hover:border-accent hover:bg-accent-tint active:bg-accent-tint ${
                  end.isPrimary ? "border-accent-tint-border bg-accent-tint/60" : "border-hairline"
                }`}
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={pick}
                onKeyDown={(event: ReactKeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    pick();
                  }
                }}
                onMouseEnter={() => onHoverEnd?.(end.key)}
                onMouseLeave={() => onHoverEnd?.(null)}
              >
                {onToggleParallel ? (
                  <button
                    type="button"
                    data-id={`edge-end-mode-${end.key}`}
                    aria-pressed={parallel}
                    aria-label={`${modeLabel}. ${parallel ? t("edge.endToSingle") : t("edge.endToParallel")}`}
                    title={`${modeLabel} · ${parallel ? t("edge.endToSingle") : t("edge.endToParallel")}`}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-xs transition-colors ${
                      parallel
                        ? "bg-accent-tint text-accent hover:bg-accent-tint-border"
                        : "text-ink-tertiary hover:bg-surface-alt hover:text-ink-secondary"
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleParallel(end.key);
                    }}
                  >
                    <ModeIcon size={15} strokeWidth={1.5} />
                  </button>
                ) : (
                  <span
                    title={modeLabel}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center ${parallel ? "text-accent" : "text-ink-tertiary"}`}
                  >
                    <ModeIcon size={15} strokeWidth={1.5} />
                  </span>
                )}
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={PILL_CLASS} title={end.title || "End"}>
                    {/* 빈 제목 대표 끝(임포트 L6 기본)은 캔버스 표기와 같은 "End" */}
                    {end.title || "End"}
                  </span>
                  {end.isPrimary && (
                    <span className="shrink-0 rounded-full border border-accent-tint-border bg-surface px-1.5 text-[10px] font-semibold text-accent">
                      {t("node.primaryEnd")}
                    </span>
                  )}
                </span>
                {targets.length > 0 ? (
                  <span
                    className="flex min-w-0 max-w-[132px] items-center gap-0.5 text-fine text-ink-tertiary"
                    title={targets.join(", ")}
                  >
                    <ChevronRight size={12} strokeWidth={1.5} className="shrink-0" />
                    <span className="truncate">{targets[0]}</span>
                    {targets.length > 1 && (
                      <span className="shrink-0">{t("edge.endMoreTargets", { count: targets.length - 1 })}</span>
                    )}
                  </span>
                ) : (
                  <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                )}
              </div>
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
