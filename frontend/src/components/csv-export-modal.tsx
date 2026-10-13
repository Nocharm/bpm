// CSV 내보내기 열 선택 모달 — 에디터 맵 탭 Export CSV 버튼이 연다. 열 피커(ExportColumnPicker)로 고른 열만
// 내려받고, 선택은 다음 내보내기를 위해 기억한다. 설계: export-column-picker-design(2026-10-02)
"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { ExportColumnPicker } from "@/components/export-column-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { CSV_COLUMNS, type CsvColumnKey, loadExportColumns, saveExportColumns } from "@/lib/export-columns";
import { useI18n } from "@/lib/i18n";

interface CsvExportModalProps {
  open: boolean;
  onClose: () => void;
  // 선택 열(정식 순서)로 내려받기 — 그래프 조립·BOM 다운로드·경고 토스트는 호출부(에디터) 몫
  onDownload: (columns: CsvColumnKey[]) => void;
}

export function CsvExportModal({ open, onClose, onDownload }: CsvExportModalProps) {
  const { t } = useI18n();
  // 저장된 선택(제외 키)으로 시작 — localStorage 실패·SSR이면 전부 선택
  const [selected, setSelected] = useState<string[]>(() => loadExportColumns("csv"));

  if (!open) return null;

  const handleChange = (keys: string[]) => {
    setSelected(keys);
    saveExportColumns("csv", keys);
  };

  const handleDownload = () => {
    onDownload(CSV_COLUMNS.filter((column) => selected.includes(column.key)).map((column) => column.key));
    onClose();
  };

  return (
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
      onClose={onClose}
    >
      <div
        data-id="csv-export-modal"
        className="relative flex max-h-[80%] w-[560px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-sm border glass glass-dense"
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

        <div className="flex-1 overflow-auto px-4 py-3">
          <ExportColumnPicker
            kind="csv"
            defs={CSV_COLUMNS}
            selected={selected}
            onChange={handleChange}
            lockedHintKey="export.csvColumnsHint"
          />
          <p className="mt-2 text-fine text-ink-tertiary">{t("export.csvOmittedHint")}</p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-hairline px-4 py-2">
          <button
            type="button"
            data-id="csv-export-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-id="csv-export-download"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus"
            onClick={handleDownload}
          >
            {t("export.download")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
