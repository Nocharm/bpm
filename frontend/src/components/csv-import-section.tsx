"use client";

// CSV 임포트 공용 섹션 — 템플릿 다운로드 + 파일 선택 + 파싱 요약/행 에러.
// 새 맵 다이얼로그와 에디터 임포트 모달이 함께 쓴다 (design 2026-07-06).
import { useRef } from "react";

import { Download, Upload, X } from "lucide-react";

import {
  buildGraphFromCsv,
  buildTemplateCsv,
  decodeCsvBuffer,
  type CsvImportOutcome,
} from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

const OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

interface CsvImportSectionProps {
  outcome: CsvImportOutcome | null;
  fileName: string | null;
  onChange: (outcome: CsvImportOutcome | null, fileName: string | null) => void;
  disabled?: boolean;
}

export function CsvImportSection({ outcome, fileName, onChange, disabled }: CsvImportSectionProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = () => {
    // UTF-8 BOM 접두 — Excel이 한글을 올바른 인코딩으로 열도록
    const blob = new Blob(["﻿" + buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bpm-map-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // 같은 파일 재선택을 허용하기 위해 input value 리셋 (manual-manage-panel 패턴)
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = decodeCsvBuffer(await file.arrayBuffer());
    onChange(buildGraphFromCsv(text), file.name);
  };

  return (
    <div data-id="csv-import-section" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-id="csv-template-download"
          className={OUTLINE_BTN}
          onClick={handleDownloadTemplate}
          disabled={disabled}
        >
          <Download size={14} strokeWidth={1.5} />
          {t("csvImport.template")}
        </button>
        <button
          type="button"
          data-id="csv-file-pick"
          className={OUTLINE_BTN}
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <Upload size={14} strokeWidth={1.5} />
          {t("csvImport.chooseFile")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => void handleFile(event)}
        />
      </div>
      {fileName !== null && outcome !== null && (
        <div className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-caption text-ink" title={fileName}>
              {fileName}
            </span>
            <button
              type="button"
              data-id="csv-clear"
              className="shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface hover:text-ink"
              onClick={() => onChange(null, null)}
              disabled={disabled}
              aria-label={t("common.cancel")}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          {outcome.errors.length === 0 ? (
            <p className="text-caption text-ink-secondary">
              {t("csvImport.summary", { nodes: outcome.nodeCount, edges: outcome.edgeCount })}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {outcome.errors.slice(0, 10).map((err) => (
                <li key={`${err.line}-${err.message}`} className="text-caption text-error">
                  {t("csvImport.rowError", { line: err.line, message: err.message })}
                </li>
              ))}
              {outcome.errors.length > 10 && (
                <li className="text-caption text-ink-tertiary">
                  {t("csvImport.moreErrors", { n: outcome.errors.length - 10 })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
