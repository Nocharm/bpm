// 실행 범례 — 맵 화면 실행 모드에서 캔버스 오른쪽 위 칩. 펼치면 아래로 노드 상태 6종과 연결선 5종의 뜻, 키보드 이동을 보인다.
// 실행 모드에선 흐름 펄스 범례(PulseLegend) 대신 나온다. React Flow `Panel`이라 <ReactFlow> 안에서만 쓴다(에디터 page.tsx).
"use client";

import { Panel } from "@xyflow/react";
import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";

import { runNodeStyle } from "@/components/process-node";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { RunEdgeKind, RunNodeStatus } from "@/lib/run-graph";
import { RUN_EDGE_LOOK } from "@/lib/run-view";

interface RunLegendProps {
  open: boolean;
  onToggle: () => void;
}

const STATUS_ORDER: readonly RunNodeStatus[] = ["waiting", "ready", "active", "done", "problem", "skipped"];
const EDGE_ORDER: readonly RunEdgeKind[] = ["past", "now", "prob", "fut", "skip"];
// 실행 모드 캔버스 키(page.tsx 실행 키보드 이동·Tab 흐름 이동, 버튼 줄 run-action-bar) — 키 표기는 언어와 무관하다
const KEY_ROWS: readonly { keys: string; label: MessageKey }[] = [
  { keys: "← ↑ → ↓", label: "run.legend.key.arrows" },
  { keys: "Tab ⇧Tab", label: "run.legend.key.tab" },
  { keys: "N ⇧N", label: "run.legend.key.todo" },
  { keys: "Enter", label: "run.legend.key.enter" },
  { keys: "Esc", label: "run.legend.key.esc" },
];

export function RunLegend({ open, onToggle }: RunLegendProps) {
  const { t } = useI18n();
  return (
    <Panel position="top-right" className="select-none" style={{ zIndex: 20 }}>
      <div data-id="run-legend" className="relative">
        {open && (
          <div
            role="dialog"
            aria-label={t("run.legend.title")}
            data-id="run-legend-card"
            className="absolute right-0 top-full mt-2 w-72 rounded-md border p-3 glass glass-dense"
          >
            <p className="mb-1.5 text-fine font-semibold text-ink-tertiary">{t("run.legend.statusHeading")}</p>
            <ul className="flex flex-col gap-1.5">
              {STATUS_ORDER.map((status) => (
                <li key={status} data-id={`run-legend-status-${status}`} className="flex items-start gap-2 text-caption">
                  <span aria-hidden className="mt-0.5 h-3.5 w-5 shrink-0 rounded-xs" style={runNodeStyle(status)} />
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{t(`run.status.${status}`)}</span>{" "}
                    <span className="text-ink-tertiary">{t(`run.legend.desc.${status}`)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mb-1.5 mt-3 border-t border-divider pt-2 text-fine font-semibold text-ink-tertiary">
              {t("run.legend.edgeHeading")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {EDGE_ORDER.map((kind) => (
                <li key={kind} data-id={`run-legend-edge-${kind}`} className="flex items-start gap-2 text-caption">
                  <svg width={26} height={14} viewBox="0 0 26 14" aria-hidden className="mt-0.5 shrink-0 overflow-visible">
                    <line
                      x1={1}
                      y1={7}
                      x2={25}
                      y2={7}
                      stroke={RUN_EDGE_LOOK[kind].stroke}
                      strokeWidth={2}
                      strokeDasharray={kind === "skip" ? "4 4" : undefined}
                      opacity={kind === "skip" ? 0.5 : undefined}
                    />
                    {kind === "now" ? <line className="bpm-run-flow" x1={1} y1={7} x2={25} y2={7} /> : null}
                  </svg>
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{t(`run.legend.edge.${kind}`)}</span>{" "}
                    <span className="text-ink-tertiary">{t(`run.legend.edgeDesc.${kind}`)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mb-1.5 mt-3 border-t border-divider pt-2 text-fine font-semibold text-ink-tertiary">
              {t("run.legend.keyHeading")}
            </p>
            <ul data-id="run-legend-keys" className="flex flex-col gap-1">
              {KEY_ROWS.map((row) => (
                <li key={row.keys} className="flex items-start justify-between gap-3 text-caption">
                  <span className="min-w-0 text-ink-secondary">{t(row.label)}</span>
                  <kbd className="shrink-0 rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary">
                    {row.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          data-id="run-legend-toggle"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={onToggle}
          className="flex h-8 items-center gap-1.5 rounded-full border px-3 text-caption text-ink-secondary glass hover:bg-surface-alt"
        >
          <ListChecks size={16} strokeWidth={1.5} className="text-accent" />
          <span>{t("run.legend.title")}</span>
          {open ? <ChevronUp size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
        </button>
      </div>
    </Panel>
  );
}
