// Excel 내보내기 형식 선택 모달 — 토글 탭(top-nav 한/영 세그먼트 디자인) + 첫 8행 미리보기 + 다운로드.
// 모델은 탭 활성화 시 lazy 빌드(모달 열려있는 동안 캐시). 설계: 2026-07-17-excel-export-wbs-v2-design.md
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { downloadExcel, type ExcelModel } from "@/lib/excel-export";
import { downloadWbsExcel, type WbsModel } from "@/lib/excel-wbs";
import { useI18n } from "@/lib/i18n";

export type ExcelExportFormat = "map" | "wbs";

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
  const [format, setFormat] = useState<ExcelExportFormat>("map");
  const [mapState, setMapState] = useState<PreviewState<ExcelModel>>({ status: "idle" });
  const [wbsState, setWbsState] = useState<PreviewState<WbsModel>>({ status: "idle" });
  const [downloading, setDownloading] = useState(false);
  // 세대 카운터 — 리셋(닫힘)마다 증가. in-flight 중 닫고 재오픈해도 구 promise의 resolve가
  // 세대 불일치로 무시되어 새 모델을 덮지 못한다.
  const mapGenRef = useRef(0);
  const wbsGenRef = useRef(0);

  // 닫힐 때 캐시 초기화 — 다음 오픈 시 캔버스 최신 상태로 재빌드 (setState는 전부 비동기/이벤트 경로)
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      mapGenRef.current += 1;
      wbsGenRef.current += 1;
      setFormat("map");
      setMapState({ status: "idle" });
      setWbsState({ status: "idle" });
    }, 0);
    return () => clearTimeout(timer);
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

  // Escape로 닫기 — ModalBackdrop의 바깥클릭 닫기와 동일한 종료 경로(onClose)를 공유.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = format === "map" ? mapState : wbsState;

  const handleDownload = async () => {
    if (active.status !== "ready" || downloading) return;
    setDownloading(true);
    try {
      if (format === "map") await downloadExcel((active as { model: ExcelModel }).model, fileNameFor("map"));
      else await downloadWbsExcel((active as { model: WbsModel }).model, fileNameFor("wbs"));
      onClose();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
      onClose={onClose}
    >
      <div
        data-id="excel-export-modal"
        className="relative flex max-h-[80%] w-[560px] flex-col overflow-hidden rounded-sm border border-hairline bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
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
                onClick={() => setFormat(code)}
              >
                {code === "map" ? t("export.formatMap") : t("export.formatWbs")}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Close" className="rounded-sm p-1 text-ink-muted hover:bg-surface-alt" onClick={onClose}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-40 flex-1 overflow-auto px-4 py-3">
          <div className="mb-1.5 text-caption text-ink-secondary">{t("export.previewLabel")}</div>
          {(active.status === "idle" || active.status === "loading") && (
            <div className="text-caption text-ink-tertiary">{t("export.previewLoading")}</div>
          )}
          {active.status === "error" && <div className="text-caption text-error">{t("export.previewError")}</div>}
          {active.status === "ready" && (
            <ExportPreviewTable format={format} model={(active as { model: ExcelModel | WbsModel }).model} emptyText={t("export.previewEmpty")} />
          )}
          {active.status === "ready" && (active as { model: ExcelModel | WbsModel }).model.truncated && (
            <div className="mt-1.5 text-fine text-ink-tertiary">{t("export.truncatedNote")}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-hairline px-4 py-2">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-id="excel-export-download"
            disabled={active.status !== "ready" || downloading}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => void handleDownload()}
          >
            {t("export.download")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/** 행별 스태거 딜레이 — CSS 커스텀 프로퍼티는 React 타입에 없어 헬퍼 한 곳에서만 캐스팅. */
function getRowDelayStyle(index: number): CSSProperties {
  return { "--row-delay": `${index * 45}ms` } as CSSProperties;
}

/** 미리보기 표 — Process Map: No·Name(들여쓰기)·Type·Next / WBS: No·Level 1..N(회색)·Task. */
function ExportPreviewTable({ format, model, emptyText }: { format: ExcelExportFormat; model: ExcelModel | WbsModel; emptyText: string }) {
  const rows = model.rows.slice(0, PREVIEW_ROWS);
  if (rows.length === 0) return <div className="text-caption text-ink-tertiary">{emptyText}</div>;
  const cellCls = "border-b border-hairline px-2 py-1 whitespace-nowrap";
  if (format === "map") {
    const nodeRows = rows as ExcelModel["rows"];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-fine text-ink">
          <thead>
            <tr className="text-left text-ink-secondary">
              <th className={cellCls}>No</th><th className={cellCls}>Name</th><th className={cellCls}>Type</th><th className={cellCls}>Next</th>
            </tr>
          </thead>
          <tbody>
            {nodeRows.map((row, i) => (
              <tr key={i} className="preview-row-in" style={getRowDelayStyle(i)}>
                <td className={cellCls}>{row.kind === "node" ? row.no : ""}</td>
                <td className={cellCls} style={{ paddingLeft: `${8 + row.depth * 14}px` }}>
                  {row.kind === "node" ? row.title : <span className="italic text-ink-tertiary">({row.kind})</span>}
                </td>
                <td className={cellCls}>{row.kind === "node" ? row.type : ""}</td>
                <td className={cellCls}>{row.kind === "node" ? row.next : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const wbs = model as WbsModel;
  const wbsRows = rows as WbsModel["rows"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-fine text-ink">
        <thead>
          <tr className="text-left text-ink-secondary">
            <th className={cellCls}>No</th>
            {Array.from({ length: wbs.maxLevel }, (_, i) => (
              <th key={i} className={cellCls}>{`Level ${i + 1}`}</th>
            ))}
            <th className={cellCls}>Task</th>
          </tr>
        </thead>
        <tbody>
          {wbsRows.map((row, i) => (
            <tr key={i} className="preview-row-in" style={getRowDelayStyle(i)}>
              <td className={cellCls}>{row.kind === "node" ? row.no : ""}</td>
              {Array.from({ length: wbs.maxLevel }, (_, li) => (
                <td key={li} className={`${cellCls} text-ink-tertiary`}>{row.levels[li] ?? ""}</td>
              ))}
              <td className={cellCls}>
                {row.kind === "node" ? row.title : <span className="italic text-ink-tertiary">({row.kind})</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
