"use client";

// params 표 확정 모달 — 인터뷰 중 수집된 파라미터를 표로 보여주고, 셀 직접 편집 후 결정적
// 반영(AI 0콜). 수동 변경은 서버가 facts에 딥머지해 AI 컨텍스트에도 남는다 (2026-07-30).
// params 스테이지 완료 턴(draw_due="params")에 자동 오픈 + 액션바 Params 버튼으로 재오픈.

import { useEffect, useState } from "react";
import { Table2, Trash2 } from "lucide-react";

import type { ParamsTableRow } from "@/lib/interview";
import { getEditableParamFields, type ParamField } from "@/lib/params";
import { ParamInput } from "@/components/param-input";
import { ModalBackdrop } from "@/components/modal-backdrop";

const PAGE_SIZE = 30; // 청크 렌더 — 노드 많을 때 ParamInput 대량 마운트로 느려지는 것 방지

// 통화(₩/$)는 노드별 배타 계약 — 열을 'Cost' 하나로 합치고 행별 통화 토글 (P1 #10)
const COLUMNS: Array<{ key: string; label: string; title: string }> = [
  { key: "duration", label: "Duration", title: "Duration per run (H.MM)" },
  { key: "cost", label: "Cost", title: "Cost per run - ₩ or $ (exclusive per activity)" },
  { key: "headcount", label: "People", title: "Headcount per run" },
  { key: "annual_count", label: "Runs/yr", title: "Runs per year" },
  { key: "fte", label: "FTE", title: "Full-time equivalent" },
];

const CELL_INPUT =
  "w-full rounded-sm border border-hairline px-1.5 py-0.5 text-right text-caption text-ink " +
  "focus:border-accent focus:outline-none disabled:opacity-40";

type Currency = "krw" | "usd";

interface DraftRow {
  duration: string;
  cost: string;
  currency: Currency;
  headcount: string;
  annual_count: string;
  fte: string;
}

function toDraft(rows: ParamsTableRow[]): Record<string, DraftRow> {
  return Object.fromEntries(
    rows.map((row) => [
      row.activity,
      {
        duration: row.values.duration ?? "",
        cost: row.values.cost_krw ?? row.values.cost_usd ?? "",
        currency: (row.values.cost_usd && !row.values.cost_krw ? "usd" : "krw") as Currency,
        headcount: row.values.headcount ?? "",
        annual_count: row.values.annual_count ?? "",
        fte: row.values.fte ?? "",
      },
    ]),
  );
}

// 서버 전송 표 — 반대 통화는 ""로 함께 보내 facts의 잔존값을 비운다(통화 전환 시 공존 방지)
function toTable(draft: Record<string, DraftRow>): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(draft).map(([activity, row]) => [
      activity,
      {
        duration: row.duration,
        cost_krw: row.currency === "krw" ? row.cost : "",
        cost_usd: row.currency === "usd" ? row.cost : "",
        headcount: row.headcount,
        annual_count: row.annual_count,
        fte: row.fte,
      },
    ]),
  );
}

interface ParamsTableDialogProps {
  rows: ParamsTableRow[];
  busy: boolean;
  onApply: (table: Record<string, Record<string, string>>) => void;
  onClose: () => void;
}

export function ParamsTableDialog({ rows, busy, onApply, onClose }: ParamsTableDialogProps) {
  // 열릴 때의 수집분으로 초기화 — 조건부 마운트라 매 오픈마다 신선 (page가 열림/닫힘 관리)
  const [draft, setDraft] = useState<Record<string, DraftRow>>(() => toDraft(rows));
  // 변경이 있어야 Apply 활성 — 무의미한 재반영 방지
  const [dirty, setDirty] = useState(false);
  // 무한 스크롤 — 스크롤 하단 근접 시 다음 청크 (스크롤 핸들러에서 setState)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleRows = rows.slice(0, visibleCount);

  function patchRow(activity: string, patch: Partial<DraftRow>) {
    // 무변경 blur(포커스만 줬다 뺌)로 dirty 게이트가 뚫리지 않게 실제 변화만 반영 (final review)
    const current: Record<string, string> = { ...(draft[activity] ?? {}) };
    if (Object.entries(patch).every(([key, value]) => current[key] === value)) return;
    setDirty(true);
    setDraft((prev) => ({ ...prev, [activity]: { ...prev[activity], ...patch } }));
  }

  // 행 파라미터 일괄 삭제 — 빈 값은 서버가 facts와 맵 속성 모두에서 제거한다
  function clearRow(activity: string, editable: ReadonlySet<string>) {
    // SP 상속 필드는 건드리지 않는다 — 편집 가능한 필드만 비움 (CLAUDE.md SP 3표면 게이팅)
    const patch: Partial<DraftRow> = {};
    if (editable.has("duration")) patch.duration = "";
    if (editable.has("cost_krw") || editable.has("cost_usd")) patch.cost = "";
    if (editable.has("headcount")) patch.headcount = "";
    if (editable.has("annual_count")) patch.annual_count = "";
    if (editable.has("fte")) patch.fte = "";
    patchRow(activity, patch);
  }

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (visibleCount < rows.length && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      setVisibleCount((count) => Math.min(count + PAGE_SIZE, rows.length));
    }
  }

  // 모달 컨벤션 — Escape·백드롭 클릭 닫힘 (P1 #10)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30 p-6"
      onClose={onClose}
      data-id="iv-params-dialog"
    >
      <div
        className="iv-pop flex max-h-[80vh] w-[42rem] max-w-full flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Table2 size={16} strokeWidth={1.5} className="text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-body-strong text-ink">Confirm collected parameters</h2>
            <p className="text-fine text-ink-muted">
              Edit values directly if needed - applied instantly to matching activities, nothing is redrawn.
            </p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2" onScroll={handleScroll}>
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
                <th className="w-7" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const current = draft[row.activity];
                if (!current) return null;
                // subprocess는 annual_count·fte만 직접 편집 — 나머지는 링크 맵 지정값 상속(읽기전용)
                const editable = new Set<string>(getEditableParamFields(row.nodeType ?? "process"));
                return (
                  <tr key={row.activity} className="group border-t border-hairline" data-id="iv-params-row">
                    <td className="max-w-44 truncate py-1.5 pr-2 text-ink" title={row.activity}>
                      {row.activity}
                    </td>
                    <td className="w-20 px-1.5 py-1">
                      <ParamInput
                        field="duration"
                        value={current.duration}
                        disabled={busy || !editable.has("duration")}
                        className={CELL_INPUT}
                        ariaLabel={`${row.activity} duration`}
                        onCommit={(next) => patchRow(row.activity, { duration: next })}
                      />
                    </td>
                    <td className="w-32 px-1.5 py-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="shrink-0 rounded-sm border border-hairline px-1 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
                          title="Toggle currency (exclusive per activity)"
                          disabled={busy || !editable.has("cost_krw")}
                          onClick={() =>
                            patchRow(row.activity, {
                              currency: current.currency === "krw" ? "usd" : "krw",
                            })
                          }
                          data-id="iv-params-currency"
                        >
                          {current.currency === "krw" ? "₩" : "$"}
                        </button>
                        <ParamInput
                          field={(current.currency === "krw" ? "cost_krw" : "cost_usd") as ParamField}
                          value={current.cost}
                          disabled={busy || !editable.has("cost_krw")}
                          className={CELL_INPUT}
                          ariaLabel={`${row.activity} cost`}
                          onCommit={(next) => patchRow(row.activity, { cost: next })}
                        />
                      </div>
                    </td>
                    <td className="w-16 px-1.5 py-1">
                      <ParamInput
                        field="headcount"
                        value={current.headcount}
                        disabled={busy || !editable.has("headcount")}
                        className={CELL_INPUT}
                        ariaLabel={`${row.activity} headcount`}
                        onCommit={(next) => patchRow(row.activity, { headcount: next })}
                      />
                    </td>
                    <td className="w-16 px-1.5 py-1">
                      <ParamInput
                        field="annual_count"
                        value={current.annual_count}
                        disabled={busy || !editable.has("annual_count")}
                        className={CELL_INPUT}
                        ariaLabel={`${row.activity} runs per year`}
                        onCommit={(next) => patchRow(row.activity, { annual_count: next })}
                      />
                    </td>
                    <td className="w-16 px-1.5 py-1">
                      <ParamInput
                        field="fte"
                        value={current.fte}
                        disabled={busy || !editable.has("fte")}
                        className={CELL_INPUT}
                        ariaLabel={`${row.activity} FTE`}
                        onCommit={(next) => patchRow(row.activity, { fte: next })}
                      />
                    </td>
                    <td className="w-7 px-1 py-1 text-right">
                      <button
                        type="button"
                        className="rounded-xs p-0.5 text-ink-muted opacity-0 transition-opacity duration-150 hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                        title="Clear all parameters for this activity"
                        disabled={busy}
                        onClick={() => clearRow(row.activity, editable)}
                        data-id="iv-params-clear-row"
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibleCount < rows.length ? (
            <div className="py-1.5 text-center text-fine text-ink-muted" data-id="iv-params-more">
              Scroll for {rows.length - visibleCount} more…
            </div>
          ) : null}
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
            disabled={busy || !dirty}
            title={dirty ? undefined : "No changes to apply"}
            onClick={() => onApply(toTable(draft))}
            data-id="iv-params-apply"
          >
            {busy ? "Applying…" : "Apply to map"}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}
