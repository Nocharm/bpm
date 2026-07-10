"use client";

// CSV 임포트 공용 섹션 — 템플릿 다운로드 + AI 프롬프트 복사 + 파일 선택/텍스트 붙여넣기 + 파싱 요약/행 에러.
// 에디터 임포트 모달만 쓴다 — 새 맵 다이얼로그는 CsvTemplateActions만 사용 (design 2026-07-06).
// 외부 AI 왕복: [AI 프롬프트 복사]→외부 AI에 문서와 함께 붙여넣기→받은 CSV를 [붙여넣기]로 입력.
import { useRef, useState } from "react";

import { ClipboardPaste, Upload, X } from "lucide-react";

import {
  buildGraphFromCsv,
  decodeCsvBuffer,
  stripCsvFences,
  type CsvImportContext,
  type CsvImportOutcome,
} from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";
import { CSV_OUTLINE_BTN, CsvTemplateActions } from "@/components/csv-template-actions";

interface CsvImportSectionProps {
  outcome: CsvImportOutcome | null;
  fileName: string | null;
  onChange: (outcome: CsvImportOutcome | null, fileName: string | null) => void;
  disabled?: boolean;
  // 머지 base + 담당자/부서 해석 디렉터리. 없으면 전량 신규·해석 없음.
  context?: CsvImportContext;
}

export function CsvImportSection({ outcome, fileName, onChange, disabled, context }: CsvImportSectionProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  // 붙여넣기 입력 — 파일 선택과 상호 배타. 텍스트 변경 즉시 파싱(≤500행이라 디바운스 불필요).
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // 같은 파일 재선택을 허용하기 위해 input value 리셋 (manual-manage-panel 패턴)
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPasteOpen(false);
    setPasteText("");
    const text = decodeCsvBuffer(await file.arrayBuffer());
    onChange(buildGraphFromCsv(text, context), file.name);
  };

  const handlePasteText = (text: string) => {
    setPasteText(text);
    if (text.trim() === "") {
      onChange(null, null);
      return;
    }
    // 외부 AI 답변 관용 처리 — ```csv 코드펜스 제거 후 파싱
    onChange(buildGraphFromCsv(stripCsvFences(text), context), t("csvImport.pastedName"));
  };

  const handleClear = () => {
    setPasteText("");
    onChange(null, null);
  };

  return (
    <div data-id="csv-import-section" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <CsvTemplateActions disabled={disabled} />
        <button type="button" data-id="csv-file-pick" className={CSV_OUTLINE_BTN} onClick={() => fileRef.current?.click()} disabled={disabled}>
          <Upload size={14} strokeWidth={1.5} />
          {t("csvImport.chooseFile")}
        </button>
        <button
          type="button"
          data-id="csv-paste-toggle"
          className={`${CSV_OUTLINE_BTN} ${pasteOpen ? "border-accent bg-accent-tint text-accent" : ""}`}
          onClick={() => setPasteOpen((open) => !open)}
          disabled={disabled}
          aria-expanded={pasteOpen}
        >
          <ClipboardPaste size={14} strokeWidth={1.5} />
          {t("csvImport.pasteToggle")}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void handleFile(event)} />
      </div>
      {pasteOpen && (
        <textarea
          data-id="csv-paste-input"
          value={pasteText}
          onChange={(event) => handlePasteText(event.target.value)}
          placeholder={t("csvImport.pastePlaceholder")}
          disabled={disabled}
          rows={5}
          className="w-full resize-y rounded-sm border border-hairline bg-surface px-2 py-1.5 font-mono text-fine text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
        />
      )}
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
              onClick={handleClear}
              disabled={disabled}
              aria-label={t("common.cancel")}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          {outcome.errors.length === 0 ? (
            <>
              <p className="text-caption text-ink-secondary">
                {t("csvImport.mergeSummary", {
                  added: outcome.merge.addedNodeIds.length,
                  updated: outcome.merge.matchedCount,
                  removed: outcome.merge.removedNodes.length,
                })}
              </p>
              {outcome.ignoredLabelCount > 0 && (
                <p className="text-caption text-ink-tertiary">
                  {t("csvImport.ignoredLabels", { n: outcome.ignoredLabelCount })}
                </p>
              )}
              {outcome.warnings.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {outcome.warnings.slice(0, 5).map((warn) => (
                    <li key={`${warn.line}-${warn.message}`} className="text-caption text-ink-tertiary">
                      {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
                    </li>
                  ))}
                  {outcome.warnings.length > 5 && (
                    <li className="text-caption text-ink-tertiary">
                      {t("csvImport.moreWarnings", { n: outcome.warnings.length - 5 })}
                    </li>
                  )}
                </ul>
              )}
            </>
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
