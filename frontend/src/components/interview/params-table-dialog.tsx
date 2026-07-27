"use client";

// params 표 확정 모달 — 인터뷰 중 수집된 파라미터를 표로 보여주고, 확정 시 결정적 반영(AI 0콜).
// params 스테이지 완료 턴(draw_due="params")에 자동 오픈 + 액션바 Params 버튼으로 재오픈.

import { Table2 } from "lucide-react";

import type { ParamsTableRow } from "@/lib/interview";

const COLUMNS: [string, string][] = [
  ["duration", "Dur"],
  ["cost_krw", "₩"],
  ["cost_usd", "$"],
  ["headcount", "HC"],
  ["annual_count", "/yr"],
  ["fte", "FTE"],
];

interface ParamsTableDialogProps {
  rows: ParamsTableRow[];
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}

export function ParamsTableDialog({ rows, busy, onApply, onClose }: ParamsTableDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30 p-6"
      data-id="iv-params-dialog"
    >
      <div className="flex max-h-[80vh] w-[38rem] max-w-full flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg">
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
                {COLUMNS.map(([key, label]) => (
                  <th key={key} className="px-1.5 py-1 text-right font-normal">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.activity} className="border-t border-hairline" data-id="iv-params-row">
                  <td className="max-w-48 truncate py-1.5 pr-2 text-ink">{row.activity}</td>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className="px-1.5 py-1.5 text-right text-ink-secondary">
                      {row.values[key] ?? "—"}
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
