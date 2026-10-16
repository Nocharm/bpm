// Excel 내보내기 형식 선택 모달 — 토글 탭(top-nav 한/영 세그먼트 디자인, 마지막 형식 기억) + 열 선택(접이식, 두 형식 공유) +
// 실제 파일 모양의 미리보기(메타 블록·선택 열·첫 8행, 열은 켜고 끌 때 쉬머로 들고 난다) + 다운로드.
// 모델은 탭 활성화 시 lazy 빌드(모달 열려있는 동안 캐시). 에디터(maps/[mapId]/page.tsx) Excel 내보내기 진입점이 쓴다.
// 설계: 2026-07-17-excel-export-wbs-v2-design.md, 열 선택 export-column-picker-design(2026-10-02)
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Loader2, RotateCw, X } from "lucide-react";

import { ExportColumnPicker } from "@/components/export-column-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { ShimmerPresence } from "@/components/shimmer-presence";
import {
  COLUMNS,
  downloadExcel,
  EXCEL_DURATION_NUMFMT,
  loadExcelExportFormat,
  NOTE_TEXT,
  saveExcelExportFormat,
  type ExcelColumnSpec,
  type ExcelExportFormat,
  type ExcelModel,
  type ExcelRowFields,
} from "@/lib/excel-export";
import { downloadWbsExcel, getWbsLevelCells, type WbsModel, type WbsRow } from "@/lib/excel-wbs";
import { EXCEL_COLUMNS, loadExportColumns, saveExportColumns } from "@/lib/export-columns";
import { useI18n } from "@/lib/i18n";

export type { ExcelExportFormat } from "@/lib/excel-export";

interface ExcelExportModalProps {
  open: boolean;
  onClose: () => void;
  buildMap: () => Promise<ExcelModel>;
  buildWbs: () => Promise<WbsModel>;
  fileNameFor: (format: ExcelExportFormat) => string;
}

type PreviewState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; model: T }
  | { status: "error" };

const PREVIEW_ROWS = 8;

export function ExcelExportModal({ open, onClose, buildMap, buildWbs, fileNameFor }: ExcelExportModalProps) {
  const { t } = useI18n();
  const [format, setFormat] = useState<ExcelExportFormat>(() => loadExcelExportFormat());
  const [mapState, setMapState] = useState<PreviewState<ExcelModel>>({ status: "idle" });
  const [wbsState, setWbsState] = useState<PreviewState<WbsModel>>({ status: "idle" });
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  // 열 선택 — 저장된 제외 키로 시작(실패·SSR이면 전부), 섹션은 기본 접힘(미리보기가 주 내용)
  const [columns, setColumns] = useState<string[]>(() => loadExportColumns("excel"));
  const [columnsOpen, setColumnsOpen] = useState(false);
  // 세대 카운터 — 리셋(닫힘)마다 증가. in-flight 중 닫고 재오픈해도 구 promise의 resolve가
  // 세대 불일치로 무시되어 새 모델을 덮지 못한다.
  const mapGenRef = useRef(0);
  const wbsGenRef = useRef(0);

  // 닫힐 때 캐시 초기화 — 다음 오픈 시 캔버스 최신 상태로 재빌드, 형식은 마지막 선택으로 (setState는 전부 비동기/이벤트 경로)
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      mapGenRef.current += 1;
      wbsGenRef.current += 1;
      setFormat(loadExcelExportFormat());
      setMapState({ status: "idle" });
      setWbsState({ status: "idle" });
      setDownloadFailed(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  // 창이 열리면 exceljs 청크를 미리 받아 둔다 — Download 첫 클릭의 대기를 줄인다.
  // 실패는 여기서 다루지 않는다: 같은 import를 다시 하는 다운로드 경로가 오류를 창에 보여 준다
  useEffect(() => {
    if (!open) return;
    import("exceljs").catch(() => undefined);
  }, [open]);

  // 활성 탭 모델 lazy 빌드 — idle일 때만 킥. loading 전환은 setTimeout(0) 콜백 안에서 수행해
  // (동기 setState-in-effect 금지 룰 준수 + 기존 리셋 effect와 동일 경로) 탭 왕복 중 같은
  // 빌더가 중복 발화하지 않도록 idle→loading 천이를 effect 재실행 전에 반영한다.
  useEffect(() => {
    if (!open) return;
    if (format === "map" && mapState.status === "idle") {
      const gen = mapGenRef.current;
      const timer = setTimeout(() => {
        setMapState({ status: "loading" });
        buildMap()
          .then((model) => {
            if (mapGenRef.current === gen) setMapState({ status: "ready", model });
          })
          .catch(() => {
            if (mapGenRef.current === gen) setMapState({ status: "error" });
          });
      }, 0);
      return () => clearTimeout(timer);
    }
    if (format === "wbs" && wbsState.status === "idle") {
      const gen = wbsGenRef.current;
      const timer = setTimeout(() => {
        setWbsState({ status: "loading" });
        buildWbs()
          .then((model) => {
            if (wbsGenRef.current === gen) setWbsState({ status: "ready", model });
          })
          .catch(() => {
            if (wbsGenRef.current === gen) setWbsState({ status: "error" });
          });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open, format, mapState.status, wbsState.status, buildMap, buildWbs]);

  if (!open) return null;

  const active = format === "map" ? mapState : wbsState;
  const activeModel = active.status === "ready" ? active.model : null;
  const isEmpty = activeModel !== null && activeModel.rows.length === 0;
  const columnKeys = EXCEL_COLUMNS.filter((column) => columns.includes(column.key)).map((column) => column.key);

  const handleFormatChange = (next: ExcelExportFormat) => {
    setFormat(next);
    setDownloadFailed(false);
    saveExcelExportFormat(next);
  };

  const handleColumnsChange = (keys: string[]) => {
    setColumns(keys);
    saveExportColumns("excel", keys);
  };

  // 오류 상태에서 다시 빌드 — idle로 되돌리면 lazy 빌드 effect가 다시 킥한다
  const handleRetry = () => {
    if (format === "map") setMapState({ status: "idle" });
    else setWbsState({ status: "idle" });
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      if (mapState.status === "ready" && format === "map") {
        await downloadExcel(mapState.model, fileNameFor("map"), columnKeys);
      } else if (wbsState.status === "ready" && format === "wbs") {
        await downloadWbsExcel(wbsState.model, fileNameFor("wbs"), columnKeys);
      } else {
        return;
      }
      onClose();
    } catch (err) {
      console.error("Excel export failed", { format, err });
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
      onClose={onClose}
    >
      <div
        data-id="excel-export-modal"
        className="relative flex max-h-[80%] w-[560px] max-w-full flex-col overflow-hidden rounded-sm border glass glass-dense"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="text-body-strong text-ink">{t("export.modalTitle")}</span>
          <div className="ml-auto inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
            {(["map", "wbs"] as const).map((code) => (
              <button
                key={code}
                type="button"
                data-id={`excel-format-${code}`}
                aria-pressed={format === code}
                className={
                  "rounded-xs px-1.5 py-0.5 " +
                  (format === code
                    ? "bg-accent-tint font-semibold text-accent"
                    : "text-ink-tertiary hover:text-ink-secondary")
                }
                onClick={() => handleFormatChange(code)}
              >
                {code === "map" ? t("export.formatMap") : t("export.formatWbs")}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-id="excel-export-close"
            aria-label="Close"
            className="rounded-sm p-1 text-ink-muted hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* 열 섹션은 줄어들 수 있는 플렉스 자식 — 낮은 화면에서 모달(max-h 80%) 안에 머리·미리보기 최소·하단 버튼을
            남기고 나머지만 차지해 안에서 스크롤한다(고정 vh 상한은 650px대 노트북 화면에서 Download를 잘랐다, 리뷰 2026-10-02) */}
        <div className="flex min-h-0 flex-col border-b border-hairline px-4 py-2">
          <button
            type="button"
            data-id="excel-export-columns-toggle"
            aria-expanded={columnsOpen}
            className="flex items-center gap-1 text-caption text-ink-secondary hover:text-ink"
            onClick={() => setColumnsOpen((value) => !value)}
          >
            {columnsOpen ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
            {t("export.columnsLabel")} ({columns.length}/{EXCEL_COLUMNS.length})
          </button>
          {columnsOpen && (
            <div data-id="excel-export-columns-scroll" className="mt-2 min-h-0 overflow-y-auto">
              <ExportColumnPicker
                kind="excel"
                defs={EXCEL_COLUMNS}
                selected={columns}
                onChange={handleColumnsChange}
                showLabel={false}
                lockedHintKey="export.excelColumnsHint"
              />
            </div>
          )}
        </div>

        <div className="min-h-40 flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-1.5 text-caption text-ink-secondary">{t("export.previewLabel")}</div>
          {(active.status === "idle" || active.status === "loading") && (
            <div data-id="excel-export-preview-loading" className="text-caption text-ink-tertiary">
              {t("export.previewLoading")}
            </div>
          )}
          {active.status === "error" && (
            <div data-id="excel-export-preview-error" className="flex items-center gap-2 text-caption text-error">
              {t("export.previewError")}
              <button
                type="button"
                data-id="excel-export-preview-retry"
                className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
                onClick={handleRetry}
              >
                <RotateCw size={14} strokeWidth={1.5} />
                {t("export.excelPreviewRetry")}
              </button>
            </div>
          )}
          {activeModel !== null && (
            <ExportPreview format={format} model={activeModel} selected={columns} emptyText={t("export.previewEmpty")} />
          )}
          {activeModel?.truncated && (
            <div data-id="excel-export-truncated" className="mt-1.5 text-fine text-ink-tertiary">
              {t("export.truncatedNote")}
            </div>
          )}
          {activeModel !== null && !isEmpty && (
            <div className="mt-1.5 text-fine text-ink-tertiary">{t("export.excelPrintNote")}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-hairline px-4 py-2">
          {downloadFailed && (
            <div data-id="excel-export-download-error" role="alert" className="mr-auto text-caption text-error">
              {t("export.excelDownloadError")}
            </div>
          )}
          <button
            type="button"
            data-id="excel-export-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-id="excel-export-download"
            aria-busy={downloading}
            disabled={activeModel === null || isEmpty || downloading}
            className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => void handleDownload()}
          >
            {downloading && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            {t("export.download")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}

/** 행별 스태거 딜레이 — CSS 커스텀 프로퍼티는 React 타입에 없어 헬퍼 한 곳에서만 캐스팅. */
function getRowDelayStyle(index: number): CSSProperties {
  return { "--row-delay": `${index * 45}ms` } as CSSProperties;
}

// 미리보기 열 폭(px) — 시트 열 폭(문자 수)에 비례하되 창 안에서 읽히도록 상·하한
function getPreviewColumnWidth(sheetWidth: number): number {
  return Math.min(200, Math.max(44, Math.round(sheetWidth * 6)));
}

// 미리보기 셀 표기 — 시트 서식과 같은 모양(시간 [h]:mm·천 단위 쉼표·링크는 라벨)
function formatPreviewCell(column: ExcelColumnSpec, row: ExcelRowFields): string {
  if (column.key === "url") return row.urlLabel || row.url;
  const value = column.cell(row);
  if (typeof value !== "number") return value;
  if (column.numFmt === EXCEL_DURATION_NUMFMT) {
    const minutes = Math.round(value * 1440);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  }
  if (column.numFmt?.startsWith("#,##0")) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(value);
}

interface PreviewColumn {
  key: string;
  header: string;
  width: number;
  show: boolean;
  // note=노트 행 문구(이탤릭), muted=레벨 경로 회색, indent=하위프로세스 깊이
  cell: (row: ExcelModel["rows"][number] | WbsRow, index: number) => { text: string; note?: boolean; muted?: boolean; indent?: number };
}

/** 시트 열 → 미리보기 열 목록. 선택 안 된 열도 show=false로 남겨 끄는 순간 쉬머로 빠져나가게 한다. */
function buildPreviewColumns(format: ExcelExportFormat, model: ExcelModel | WbsModel, selected: ReadonlySet<string>): PreviewColumn[] {
  const fromSpec = (column: ExcelColumnSpec): PreviewColumn => ({
    key: column.key,
    header: column.header,
    width: getPreviewColumnWidth(column.width),
    show: column.required === true || selected.has(column.key),
    cell: (row) => (row.kind === "node" ? { text: formatPreviewCell(column, row) } : { text: "" }),
  });
  if (format === "map") {
    return COLUMNS.map((column) => {
      if (column.key !== "name") return fromSpec(column);
      return {
        ...fromSpec(column),
        cell: (row) => {
          const depth = "depth" in row ? row.depth : 0;
          return row.kind === "node"
            ? { text: row.title, indent: depth }
            : { text: NOTE_TEXT[row.kind], note: true, indent: depth };
        },
      };
    });
  }
  const wbs = model as WbsModel;
  const structure: PreviewColumn[] = [
    {
      key: "wbs-no",
      header: "No",
      width: getPreviewColumnWidth(6),
      show: true,
      cell: (row) => ({ text: row.kind === "node" ? String(row.no) : "" }),
    },
    ...Array.from({ length: wbs.maxLevel }, (_, level): PreviewColumn => ({
      key: `wbs-level-${level}`,
      header: `Level ${level + 1}`,
      width: getPreviewColumnWidth(18),
      show: true,
      cell: (row, index) => ({ text: "levels" in row ? getWbsLevelCells(row, index, wbs.maxLevel)[level] : "", muted: true }),
    })),
    {
      key: "wbs-task",
      header: "Task",
      width: getPreviewColumnWidth(32),
      show: true,
      cell: (row) => (row.kind === "node" ? { text: row.title } : { text: NOTE_TEXT[row.kind], note: true }),
    },
  ];
  return [...structure, ...COLUMNS.filter((column) => column.key !== "no" && column.key !== "name").map(fromSpec)];
}

/** 미리보기 — 시트와 같은 순서로 메타 블록, 헤더(회색), 첫 8행. 열은 세로 묶음이라 켜고 끌 때 통째로 들고 난다. */
function ExportPreview({
  format,
  model,
  selected,
  emptyText,
}: {
  format: ExcelExportFormat;
  model: ExcelModel | WbsModel;
  selected: readonly string[];
  emptyText: string;
}) {
  const rows = model.rows.slice(0, PREVIEW_ROWS);
  if (rows.length === 0) {
    return (
      <div data-id="excel-export-preview-empty" className="text-caption text-ink-tertiary">
        {emptyText}
      </div>
    );
  }
  const columns = buildPreviewColumns(format, model, new Set(selected));
  const cellCls = "h-6 truncate whitespace-nowrap border-b border-hairline px-2 leading-6";
  return (
    <div data-id="excel-export-preview" className="overflow-x-auto rounded-sm border border-hairline bg-surface">
      <div data-id="excel-export-preview-meta" className="grid w-max grid-cols-[auto_auto] gap-x-3 gap-y-1 px-2 py-2 text-fine leading-5">
        {model.meta.map((meta, index) => (
          <div key={index} className="contents">
            <span className="text-ink-tertiary">{meta.label}</span>
            <span className={index === 0 ? "font-semibold text-ink" : "text-ink-secondary"}>{meta.value}</span>
          </div>
        ))}
      </div>
      <div className="flex w-max text-fine text-ink">
        {columns.map((column) => (
          <ShimmerPresence
            key={`${format}-${column.key}`}
            show={column.show}
            dataId={`excel-export-preview-col-${column.key}`}
            className="relative shrink-0"
            style={{ width: column.width }}
          >
            <div className={`${cellCls} bg-surface-alt font-semibold text-ink-secondary`}>{column.header}</div>
            {rows.map((row, index) => {
              const { text, note, muted, indent } = column.cell(row, index);
              return (
                <div
                  key={index}
                  className={`${cellCls} preview-row-in ${note ? "italic text-ink-tertiary" : muted ? "text-ink-tertiary" : ""}`}
                  style={{ ...getRowDelayStyle(index), paddingLeft: indent ? 8 + indent * 14 : undefined }}
                >
                  {text}
                </div>
              );
            })}
          </ShimmerPresence>
        ))}
      </div>
    </div>
  );
}
