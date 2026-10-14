"use client";

// 연결선 전달물 개수 점 + 호버 카드 — 에디터 엣지(multiline-edge)가 라벨 옆(라벨이 없으면 라벨 앵커)에 붙인다.
// 무엇이 어디서 왔는지는 호버해야 보여 캔버스가 거의 그대로다 (사용자 결정 2026-10-13 J안).
// 카드는 body 포털(z 1400 호버 카드 단) — 엣지 라벨 층은 노드 층 아래라 그 안에 두면 이웃 노드에 가려진다.
// 줌 PULSE_MIN_ZOOM(0.5) 미만이면 숨긴다 — 흐름 펄스와 같은 기준(축소 화면에선 점이 노이즈, 사용자 결정 2026-10-13).

import { useStore } from "@xyflow/react";
import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { EdgeCarryItem } from "@/lib/edge-carry";
import { PULSE_MIN_ZOOM } from "@/lib/edge-pulse";
import { useI18n } from "@/lib/i18n";

// 점 → 카드로 커서를 옮기는 동안 닫히지 않게 주는 유예(ms)
const CLOSE_DELAY_MS = 120;

interface EdgeCarryBadgeProps {
  items: EdgeCarryItem[];
}

export function EdgeCarryBadge({ items }: EdgeCarryBadgeProps) {
  const { t } = useI18n();
  const dotRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const isZoomedOut = useStore((state) => state.transform[2] < PULSE_MIN_ZOOM);

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const openCard = () => {
    cancelClose();
    const rect = dotRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom + 4 });
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setAnchor(null), CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);

  if (isZoomedOut) return null;
  return (
    <>
      <span
        ref={dotRef}
        data-id="edge-carry-dot"
        onMouseEnter={openCard}
        onMouseLeave={scheduleClose}
        className="nodrag nopan pointer-events-auto inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-[1.5px] border-accent bg-surface px-1 text-[10px] font-semibold leading-none text-accent tabular-nums"
      >
        {items.length}
      </span>
      {anchor &&
        createPortal(
          <div
            data-id="edge-carry-card"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="glass glass-dense fixed z-[1400] w-56 -translate-x-1/2 rounded-sm border px-2 py-1.5 text-left text-xs text-ink-secondary"
            style={{ left: anchor.x, top: anchor.y }}
          >
            <div className="text-[10px] text-ink-muted">{t("edge.carryTitle", { count: items.length })}</div>
            {items.map((item) => (
              <div key={item.key} className="mt-1 flex items-start gap-1.5">
                <FileText size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-tertiary" />
                <div className="min-w-0">
                  <div className="break-words text-ink">{item.text}</div>
                  {/* 출처 = "From" + 노드 이름 필(가벼운 회색 필) — 앞에서 받아 넘기는 항목엔 "경유" 꼬리표 */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-ink-tertiary">
                    <span>{t("edge.carryFrom")}</span>
                    <span
                      data-id="edge-carry-origin"
                      className="inline-flex max-w-full items-center rounded-full border border-hairline bg-surface-alt px-1.5 leading-4 text-ink-secondary"
                    >
                      <span className="truncate">{item.originLabel}</span>
                    </span>
                    {item.via && <span className="text-ink-muted">· {t("edge.carryVia")}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
