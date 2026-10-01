"use client";

// 스왑(드롭존 가운데) 시 출력 자리 바꾸기 — 두 노드의 출력 엣지를 두 열로 놓고 짝을 지어 "가는 곳"만 서로 바꾼다.
// 왼쪽 행 → 오른쪽 행 순으로 누르면 짝, 다시 누르면 해제. 짝 없는 출력은 지금 타깃에 남는다(남김).
// 가운데 열 연결선은 행 DOM 중심을 측정해 S자 곡선으로 잇고, 새 짝은 왼→오로 그려지며 점 하나가 흐른다(시선 유도).
// 확인을 눌러야 onConfirm(pairs) — 취소/Esc/바깥은 스왑 자체 취소. 행 hover 시 onHoverEdge로 캔버스 엣지 강조.
// 설계: 2026-10-01-subprocess-ends-design.md §3.4a(폐기, git history)

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Link2, X } from "lucide-react";

import { BranchGlyph } from "@/components/branch-icon";
import { ModalBackdrop } from "@/components/modal-backdrop";
import type { BranchKind, ProcessNodeType } from "@/lib/canvas";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

export interface SwapOutput {
  edgeId: string;
  /** 표시 라벨 — 직접 쓴 라벨 또는 미러(끝 제목). 빈 문자열이면 라벨 알약 생략(분기는 "기타"). */
  label: string;
  /** 미러 라벨(저장 안 됨) — 점선 알약 + 링크 아이콘으로 구분. */
  mirrored: boolean;
  /** 하위프로세스 대표 끝에서 나가는 출력 — 배지 표시. */
  isPrimary: boolean;
  targetLabel: string;
  branchKind?: BranchKind;
}

export interface SwapSide {
  nodeLabel: string;
  nodeType: ProcessNodeType;
  outputs: SwapOutput[];
}

export type SwapPair = [string, string];

interface SwapOutputsModalProps {
  position: { x: number; y: number };
  left: SwapSide;
  right: SwapSide;
  /** 열릴 때 적용된 짝(순서대로 짝짓기 결과). */
  initialPairs: SwapPair[];
  onConfirm: (pairs: SwapPair[]) => void;
  onClose: () => void;
  onHoverEdge?: (edgeId: string | null) => void;
}

const MODAL_W = 560;
const MID_W = 56;
const ROW_H = 34;
const ROW_GAP = 6;
const STAGGER_MS = 60;
const FADE_MS = 150;

const PILL_CLASS =
  "min-w-0 truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink";
const MIRROR_PILL_CLASS =
  "inline-flex min-w-0 items-center gap-1 truncate rounded-xs border border-dashed border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary";

/** 짝 1건 — delay는 등장 모션 지연(순서대로 짝짓기 묶음은 순차 등장, 수동 짝은 0). */
interface PairEntry {
  left: string;
  right: string;
  key: string;
  delay: number;
}

/** 해제된 짝의 잔상 — 측정된 위치로 150ms 페이드 후 제거. */
interface Ghost {
  key: string;
  y1: number;
  y2: number;
}

/** 순서대로 짝짓기 — 왼쪽 i번째와 오른쪽 i번째(짧은 쪽 길이만큼). */
export function pairInOrder(left: SwapOutput[], right: SwapOutput[]): SwapPair[] {
  const n = Math.min(left.length, right.length);
  const pairs: SwapPair[] = [];
  for (let i = 0; i < n; i += 1) {
    pairs.push([left[i].edgeId, right[i].edgeId]);
  }
  return pairs;
}

function toEntries(pairs: SwapPair[], stagger: boolean, keyPrefix: string): PairEntry[] {
  return pairs.map(([left, right], i) => ({
    left,
    right,
    key: `${keyPrefix}:${left}>${right}`,
    delay: stagger ? i * STAGGER_MS : 0,
  }));
}

export function SwapOutputsModal({
  position,
  left,
  right,
  initialPairs,
  onConfirm,
  onClose,
  onHoverEdge,
}: SwapOutputsModalProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<PairEntry[]>(() => toEntries(initialPairs, true, "init"));
  // 왼쪽에서 누른(짝 대기) 행
  const [armed, setArmed] = useState<string | null>(null);
  // 행 중심 측정값(열 컨테이너 기준 y). 레이아웃 뒤 rAF로 측정(set-state-in-effect 회피).
  const [centers, setCenters] = useState<Map<string, number>>(new Map());
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  // 수동 짝 키 유일성 — 같은 짝을 풀었다 다시 지어도 모션이 다시 돌도록 매번 새 키
  const manualSeqRef = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rowCount = Math.max(left.outputs.length, right.outputs.length, 1);
  const colsH = rowCount * ROW_H + (rowCount - 1) * ROW_GAP;

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const host = colsRef.current;
      if (!host) return;
      const top = host.getBoundingClientRect().top;
      const next = new Map<string, number>();
      for (const [id, el] of rowRefs.current) {
        const rect = el.getBoundingClientRect();
        next.set(id, rect.top - top + rect.height / 2);
      }
      setCenters(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [left, right]);

  const closeAndClear = () => {
    onHoverEdge?.(null);
    onClose();
  };

  const partnerOfLeft = new Map(entries.map((e) => [e.left, e.right]));
  const partnerOfRight = new Map(entries.map((e) => [e.right, e.left]));
  const badgeOf = (edgeId: string): number | null => {
    const idx = entries.findIndex((e) => e.left === edgeId || e.right === edgeId);
    return idx >= 0 ? idx + 1 : null;
  };

  const fadeOut = (removed: PairEntry[]) => {
    if (removed.length === 0) return;
    const next: Ghost[] = removed.map((e) => ({
      key: `ghost:${e.key}:${manualSeqRef.current}`,
      y1: centers.get(e.left) ?? 0,
      y2: centers.get(e.right) ?? 0,
    }));
    setGhosts((cur) => [...cur, ...next]);
    window.setTimeout(() => {
      setGhosts((cur) => cur.filter((g) => !next.some((n) => n.key === g.key)));
    }, FADE_MS + 30);
  };

  const unpair = (edgeId: string) => {
    const removed = entries.filter((e) => e.left === edgeId || e.right === edgeId);
    fadeOut(removed);
    setEntries((cur) => cur.filter((e) => e.left !== edgeId && e.right !== edgeId));
  };
  const clickLeft = (edgeId: string) => {
    if (partnerOfLeft.has(edgeId)) {
      unpair(edgeId);
      setArmed(null);
      return;
    }
    setArmed((cur) => (cur === edgeId ? null : edgeId));
  };
  const clickRight = (edgeId: string) => {
    if (partnerOfRight.has(edgeId)) {
      unpair(edgeId);
      return;
    }
    if (!armed) return;
    const leftId = armed;
    manualSeqRef.current += 1;
    const fresh = toEntries([[leftId, edgeId]], false, `m${manualSeqRef.current}`)[0];
    // 왼쪽 행이 이미 다른 짝이면 그 짝은 풀린다(한 행은 한 짝)
    fadeOut(entries.filter((e) => e.left === leftId));
    setEntries((cur) => [...cur.filter((e) => e.left !== leftId && e.right !== edgeId), fresh]);
    setArmed(null);
  };
  const applyInOrder = () => {
    setArmed(null);
    manualSeqRef.current += 1;
    fadeOut(entries);
    setEntries(toEntries(pairInOrder(left.outputs, right.outputs), true, `o${manualSeqRef.current}`));
  };

  const { left: modalLeft, top: modalTop } = clampToViewport(
    position.x,
    position.y,
    MODAL_W,
    140 + colsH + 52,
  );

  const renderRow = (side: "left" | "right", output: SwapOutput) => {
    const paired = side === "left" ? partnerOfLeft.has(output.edgeId) : partnerOfRight.has(output.edgeId);
    const isArmed = side === "left" && armed === output.edgeId;
    const badge = badgeOf(output.edgeId);
    const entry = entries.find((e) => e.left === output.edgeId || e.right === output.edgeId);
    const label = output.label || (output.branchKind ? t("inspector.branchOther") : "");
    return (
      <button
        key={output.edgeId}
        ref={(el) => {
          if (el) rowRefs.current.set(output.edgeId, el);
          else rowRefs.current.delete(output.edgeId);
        }}
        type="button"
        data-id={`swap-outputs-row-${side}-${output.edgeId}`}
        data-paired={paired ? "true" : undefined}
        className={`relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-sm border px-2 text-left transition-colors ${
          paired
            ? "border-accent bg-accent-tint"
            : isArmed
              ? "border-accent bg-surface ring-2 ring-accent/40"
              : "border-hairline bg-surface hover:border-accent hover:bg-accent-tint"
        }`}
        style={{ height: ROW_H }}
        onMouseEnter={() => onHoverEdge?.(output.edgeId)}
        onMouseLeave={() => onHoverEdge?.(null)}
        onClick={() => (side === "left" ? clickLeft(output.edgeId) : clickRight(output.edgeId))}
      >
        {badge !== null && entry && (
          <span
            key={entry.key}
            className="edge-tile-pop absolute -left-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-surface"
            style={{ animationDelay: `${entry.delay}ms` }}
          >
            {badge}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1.5">
          {output.branchKind && (
            <span className="flex shrink-0">
              <BranchGlyph kind={output.branchKind} size={16} animate={false} />
            </span>
          )}
          {label &&
            (output.mirrored ? (
              <span className={MIRROR_PILL_CLASS} title={label}>
                <Link2 size={11} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{label}</span>
              </span>
            ) : (
              <span className={PILL_CLASS} title={label}>
                {label}
              </span>
            ))}
          {output.isPrimary && (
            <span className="shrink-0 rounded-full border border-accent-tint-border bg-accent-tint px-1.5 text-[10px] font-semibold text-accent">
              {t("swap.primaryEnd")}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <span className="truncate text-fine text-ink" title={output.targetLabel}>
            {output.targetLabel}
          </span>
        </span>
        {!paired && (
          <span className="shrink-0 rounded-full border border-dashed border-divider px-1.5 text-[10px] text-ink-tertiary">
            {t("swap.keep")}
          </span>
        )}
      </button>
    );
  };

  const renderColumn = (side: "left" | "right", data: SwapSide) => (
    <div className="min-w-0">
      <div className="mb-1.5 flex h-6 items-center gap-1.5 px-1 text-caption font-semibold text-ink">
        <span className="truncate" title={data.nodeLabel}>
          {data.nodeLabel}
        </span>
        <span className="shrink-0 rounded-full border border-hairline px-1.5 text-[10px] font-semibold text-ink-tertiary">
          {t(`nodeType.${data.nodeType}`)}
        </span>
      </div>
      <div className="flex flex-col" style={{ gap: ROW_GAP }}>
        {data.outputs.map((output) => renderRow(side, output))}
        {data.outputs.length === 0 && (
          <div
            className="flex items-center justify-center rounded-sm border border-dashed border-hairline text-fine text-ink-tertiary"
            style={{ height: ROW_H }}
          >
            {t("swap.noOutputs")}
          </div>
        )}
      </div>
    </div>
  );

  const connectorPath = (y1: number, y2: number) =>
    `M0,${y1} C${MID_W / 2},${y1} ${MID_W / 2},${y2} ${MID_W},${y2}`;
  const connectors = entries.filter((e) => centers.has(e.left) && centers.has(e.right));

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={closeAndClear}>
      <div
        data-id="swap-outputs-modal"
        className="fixed rounded-md border border-hairline bg-surface p-3 shadow-lg"
        style={{ left: modalLeft, top: modalTop, width: MODAL_W }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("swap.outputsTitle")}
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
        <p className="px-1 pb-2.5 text-fine leading-snug text-ink-tertiary">
          {armed ? t("swap.armedHint") : t("swap.outputsHint")}
        </p>
        <div ref={colsRef} className="grid items-start" style={{ gridTemplateColumns: `1fr ${MID_W}px 1fr` }}>
          {renderColumn("left", left)}
          {/* 가운데 연결선 — 열 컨테이너 상단(헤더 포함) 기준 좌표. 헤더 높이는 양쪽 동일. */}
          <div className="relative self-stretch">
            <svg
              data-id="swap-outputs-connectors"
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox={`0 0 ${MID_W} ${colsH + 30}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              {ghosts.map((g) => (
                <path
                  key={g.key}
                  d={connectorPath(g.y1, g.y2)}
                  className="swap-pair-fade"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  fill="none"
                />
              ))}
              {connectors.map((e) => {
                const y1 = centers.get(e.left) ?? 0;
                const y2 = centers.get(e.right) ?? 0;
                return (
                  <g key={e.key}>
                    <path
                      d={connectorPath(y1, y2)}
                      className="swap-pair-line"
                      pathLength={1}
                      stroke="var(--color-accent)"
                      strokeWidth={2}
                      fill="none"
                      style={{ animationDelay: `${e.delay}ms` }}
                    />
                    <path
                      d={connectorPath(y1, y2)}
                      className="swap-pair-dot"
                      pathLength={1}
                      stroke="var(--color-surface)"
                      strokeWidth={4}
                      strokeLinecap="round"
                      fill="none"
                      style={{ animationDelay: `${e.delay + 200}ms` }}
                    />
                    <circle cx={0} cy={y1} r={3} fill="var(--color-accent)" className="swap-pair-end" style={{ animationDelay: `${e.delay}ms` }} />
                    <circle cx={MID_W} cy={y2} r={3} fill="var(--color-accent)" className="swap-pair-end" style={{ animationDelay: `${e.delay + 300}ms` }} />
                  </g>
                );
              })}
            </svg>
          </div>
          {renderColumn("right", right)}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5">
          <button
            type="button"
            data-id="swap-outputs-pair-in-order"
            className="rounded-sm px-1.5 py-1 text-caption text-accent hover:bg-accent-tint"
            onClick={applyInOrder}
          >
            {t("swap.pairInOrder")}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-id="swap-outputs-cancel"
              className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface-alt"
              onClick={closeAndClear}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              data-id="swap-outputs-confirm"
              className="rounded-sm bg-accent px-2.5 py-1 text-caption font-semibold text-surface hover:opacity-90"
              onClick={() => {
                onHoverEdge?.(null);
                onConfirm(entries.map((e) => [e.left, e.right]));
              }}
            >
              {t("swap.confirm")}
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
