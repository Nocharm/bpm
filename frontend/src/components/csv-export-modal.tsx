// CSV 내보내기 창 — 에디터 맵 탭 Export CSV 버튼이 연다. 열 피커(ExportColumnPicker)로 고른 열만 내려받고,
// 선택은 다음 내보내기를 위해 기억한다. 고른 열의 앞 몇 행 미리보기(열은 쉬머로 생기고 사라짐)·내려받기 전 경고 목록·
// 파일 이름을 함께 보여 준다(PNG 내보내기 창과 같은 결). 설계: export-column-picker-design(2026-10-02)
"use client";

import { useMemo, useState } from "react";
import { CircleCheck, FileText, TriangleAlert, X } from "lucide-react";

import { ExportColumnPicker } from "@/components/export-column-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { ShimmerPresence } from "@/components/shimmer-presence";
import type { Graph } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import {
  buildCsvFromGraph,
  buildCsvTable,
  getCsvCellValue,
  type CsvExportWarning,
  type CsvExportWarningKind,
  type CsvExportWarningNote,
} from "@/lib/csv-export";
import { CSV_COLUMNS, loadExportColumns, normalizeExportColumns, saveExportColumns } from "@/lib/export-columns";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

// 미리보기 행 수 — 열 모양을 가늠할 만큼만(창이 650px 화면에서도 피커·버튼을 남기게)
const PREVIEW_ROWS = 4;

const WARNING_KEY: Record<CsvExportWarningKind, MessageKey> = {
  secondaryEnd: "export.csvWarn.secondaryEnd",
  duplicateTitle: "export.csvWarn.duplicateTitle",
  endEdge: "export.csvWarn.endEdge",
  endEdgeLabeled: "export.csvWarn.endEdgeLabeled",
  secondaryEndEdge: "export.csvWarn.secondaryEndEdge",
  secondaryEndEdgeLabeled: "export.csvWarn.secondaryEndEdgeLabeled",
  spExitEnd: "export.csvWarn.spExitEnd",
  repeatedTarget: "export.csvWarn.repeatedTarget",
  nextTitleSeparator: "export.csvWarn.nextTitleSeparator",
  labelSemicolon: "export.csvWarn.labelSemicolon",
  decisionFewBranches: "export.csvWarn.decisionFewBranches",
  untitledStep: "export.csvWarn.untitledStep",
  spParallelEnd: "export.csvWarn.spParallelEnd",
  startMismatch: "export.csvWarn.startMismatch",
};

const WARNING_NOTE_KEY: Record<CsvExportWarningNote, MessageKey> = {
  connectsPrimaryEnd: "export.csvWarnNote.connectsPrimaryEnd",
  parallelFewTargets: "export.csvWarnNote.parallelFewTargets",
};

// 미리보기 셀 — 여러 줄 값(Input 등)은 한 줄로 이어 보인다
const toPreviewText = (value: string): string => value.replace(/\r?\n/g, " / ");

interface CsvExportModalProps {
  // 창을 연 순간의 맵 그래프(미저장 편집분 포함) — null이면 닫힘. 창이 떠 있는 동안 캔버스는 편집되지 않는다
  graph: Graph | null;
  // 내려받을 파일 이름(buildDownloadName, 창을 연 시각) — 하단에 그대로 보여 준다
  fileName: string;
  onClose: () => void;
}

export function CsvExportModal({ graph, fileName, onClose }: CsvExportModalProps) {
  const { t } = useI18n();
  // 저장된 선택(제외 키)으로 시작 — localStorage 실패·SSR이면 전부 선택
  const [selected, setSelected] = useState<string[]>(() => loadExportColumns("csv"));
  const table = useMemo(() => (graph ? buildCsvTable(graph) : null), [graph]);

  if (!graph || !table) return null;

  // 잠금·짝 열까지 포함한 실제 내보낼 열 — 미리보기와 내려받기가 같은 집합을 본다
  const shown = new Set<string>(normalizeExportColumns(CSV_COLUMNS, selected));
  const previewRows = table.rows.slice(0, PREVIEW_ROWS);

  const handleChange = (keys: string[]) => {
    setSelected(keys);
    saveExportColumns("csv", keys);
  };

  const handleDownload = () => {
    const columns = CSV_COLUMNS.filter((column) => selected.includes(column.key)).map((column) => column.key);
    downloadCsv(fileName, buildCsvFromGraph(graph, { columns }).csv);
    onClose();
  };

  const formatWarning = (warning: CsvExportWarning): string =>
    [t(WARNING_KEY[warning.kind], warning.params), ...warning.notes.map((note) => t(WARNING_NOTE_KEY[note]))].join(". ");

  return (
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
      onClose={onClose}
    >
      <div
        data-id="csv-export-modal"
        className="relative flex max-h-[calc(100%-32px)] w-[640px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-sm border glass glass-dense"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="text-body-strong text-ink">{t("export.csvModalTitle")}</span>
          <button
            type="button"
            data-id="csv-export-close"
            aria-label="Close"
            className="ml-auto rounded-sm p-1 text-ink-muted hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="shrink-0 px-4 pt-3">
          <div className="mb-1.5 text-caption text-ink-secondary">
            {t("export.csvPreviewLabel", { count: Math.min(PREVIEW_ROWS, table.rows.length) })}
          </div>
          {previewRows.length === 0 ? (
            <div data-id="csv-export-preview-empty" className="text-caption text-ink-tertiary">{t("export.previewEmpty")}</div>
          ) : (
            <div
              data-id="csv-export-preview"
              className="flex overflow-x-auto rounded-sm border border-hairline bg-surface text-fine text-ink"
            >
              {CSV_COLUMNS.map((column) => (
                <ShimmerPresence
                  key={column.key}
                  show={shown.has(column.key)}
                  dataId={`csv-export-preview-col-${column.key}`}
                  className="relative w-[120px] shrink-0 border-r border-hairline last:border-r-0"
                >
                  <div className="h-6 truncate border-b border-hairline bg-surface-alt px-2 leading-6 font-semibold text-ink-secondary">
                    {column.header}
                  </div>
                  {previewRows.map((row) => {
                    const value = toPreviewText(getCsvCellValue(row, column.key));
                    return (
                      <div key={row.node.id} className="h-6 truncate border-b border-hairline px-2 leading-6 last:border-b-0" title={value}>
                        {value}
                      </div>
                    );
                  })}
                </ShimmerPresence>
              ))}
            </div>
          )}
        </div>

        {/* 열 피커는 줄어드는 플렉스 자식 — 650px 화면에서도 미리보기·경고·하단 버튼을 남기고 안에서 스크롤한다 */}
        <div data-id="csv-export-columns-scroll" className="min-h-28 flex-1 overflow-y-auto px-4 py-3">
          <ExportColumnPicker
            kind="csv"
            defs={CSV_COLUMNS}
            selected={selected}
            onChange={handleChange}
            lockedHintKey="export.csvColumnsHint"
          />
          <p className="mt-2 text-fine text-ink-tertiary">{t("export.csvOmittedHint")}</p>
        </div>

        <div className="shrink-0 border-t border-hairline px-4 py-2">
          {table.warnings.length === 0 ? (
            <div data-id="csv-export-no-warnings" className="flex items-center gap-1.5 text-caption text-ink-tertiary">
              <CircleCheck size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
              {t("export.csvNoWarnings")}
            </div>
          ) : (
            <div data-id="csv-export-warnings" className="rounded-sm border border-notice-border bg-notice px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-caption font-semibold text-warn">
                <TriangleAlert size={16} strokeWidth={1.5} className="shrink-0" />
                {t("export.csvWarnTitle", { count: table.warnings.length })}
              </div>
              <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-6 text-fine text-ink-secondary">
                {table.warnings.map((warning, index) => (
                  <li key={index} data-id={`csv-export-warning-${warning.kind}`}>
                    {formatWarning(warning)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-hairline px-4 py-2">
          <span
            data-id="csv-export-file-name"
            className="mr-auto flex min-w-0 items-center gap-1 text-fine text-ink-tertiary"
            title={fileName}
          >
            <FileText size={14} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{fileName}</span>
          </span>
          <button
            type="button"
            data-id="csv-export-cancel"
            className="shrink-0 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-id="csv-export-download"
            className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus"
            onClick={handleDownload}
          >
            {t("export.download")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
