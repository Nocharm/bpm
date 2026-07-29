"use client";

// params 표 확정 모달 — 인터뷰 중 수집된 파라미터를 표로 보여주고, 확정 시 결정적 반영(AI 0콜).
// params 스테이지 완료 턴(draw_due="params")에 자동 오픈 + 액션바 Params 버튼으로 재오픈.

import { useEffect } from "react";
import { Table2 } from "lucide-react";

import type { ParamsTableRow } from "@/lib/interview";

// 통화(₩/$)는 노드별 배타 계약 — 열을 'Cost' 하나로 합치고 값에 기호를 붙인다 (P1 #10)
const COLUMNS: Array<{ key: string; label: string; title: string }> = [
  { key: "duration", label: "Duration", title: "Duration per run (H.MM)" },
  { key: "cost", label: "Cost", title: "Cost per run — ₩ or $ (exclusive per activity)" },
  { key: "headcount", label: "People", title: "Headcount per run" },
  { key: "annual_count", label: "Runs/yr", title: "Runs per year" },
  { key: "fte", label: "FTE", title: "Full-time equivalent" },
];

function formatCell(row: ParamsTableRow, key: string): string {
  if (key === "cost") {
    if (row.values.cost_krw) return `₩${row.values.cost_krw}`;
    if (row.values.cost_usd) return `$${row.values.cost_usd}`;
    return "—";
  }
  return row.values[key] ?? "—";
}

interface ParamsTableDialogProps {
  rows: ParamsTableRow[];
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}

export function ParamsTableDialog({ rows, busy, onApply, onClose }: ParamsTableDialogProps) {
  // 모달 컨벤션 — Escape·백드롭 클릭 닫힘 (P1 #10)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30 p-6"
      onClick={onClose}
      data-id="iv-params-dialog"
    >
      <div
        className="iv-pop flex max-h-[80vh] w-[38rem] max-w-full flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Table2 size={16} strokeWidth={1.5} className="text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-body-strong text-ink">Confirm collected parameters</h2>
            <p className="text-fine text-ink-muted">
              Applied instantly to matching activities on the map — nothing is redrawn.
            </p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
          <table className="w-full text-caption">
            <thead>
              <tr className="text-left text-fine text-ink-muted">
                <th className="py-1 pr-2 font-normal">Activity</th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    title={column.title}
                    className="px-1.5 py-1 text-right font-normal"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.activity} className="border-t border-hairline" data-id="iv-params-row">
                  <td className="max-w-48 truncate py-1.5 pr-2 text-ink">{row.activity}</td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-1.5 py-1.5 text-right text-ink-secondary">
                      {formatCell(row, column.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <button
            className="rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
            data-id="iv-params-later"
          >
            Later
          </button>
          <button
            className="rounded-sm bg-accent px-3 py-1.5 text-caption-strong text-on-accent disabled:opacity-40"
            disabled={busy}
            onClick={onApply}
            data-id="iv-params-apply"
          >
            {busy ? "Applying…" : "Apply to map"}
          </button>
        </footer>
      </div>
    </div>
  );
}
