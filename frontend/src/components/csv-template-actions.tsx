"use client";

// CSV 준비 액션 — 템플릿 다운로드 + AI 프롬프트 복사. 새 맵 다이얼로그와 CsvImportSection이 공용.
// 외부 AI 왕복: [AI 프롬프트 복사]→외부 AI에 문서와 함께 붙여넣기→받은 CSV를 에디터에서 임포트.
import { useState } from "react";

import { Check, Download, Sparkles } from "lucide-react";

import { buildAiPromptText, buildTemplateCsv } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

export const CSV_OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

export function CsvTemplateActions({ disabled }: { disabled?: boolean }) {
  const { t } = useI18n();
  // AI 프롬프트 복사 피드백 — 토스트 의존 없이 버튼 라벨을 잠깐 전환
  const [promptCopied, setPromptCopied] = useState(false);

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

  const handleCopyPrompt = () => {
    void navigator.clipboard?.writeText(buildAiPromptText());
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1200);
  };

  return (
    <>
      <button
        type="button"
        data-id="csv-template-download"
        className={CSV_OUTLINE_BTN}
        onClick={handleDownloadTemplate}
        disabled={disabled}
      >
        <Download size={14} strokeWidth={1.5} />
        {t("csvImport.template")}
      </button>
      <button
        type="button"
        data-id="csv-copy-ai-prompt"
        className={CSV_OUTLINE_BTN}
        onClick={handleCopyPrompt}
        disabled={disabled}
        title={t("csvImport.copyPromptHint")}
      >
        {promptCopied ? (
          <Check size={14} strokeWidth={1.5} className="text-accent" />
        ) : (
          <Sparkles size={14} strokeWidth={1.5} />
        )}
        {promptCopied ? t("csvImport.promptCopied") : t("csvImport.copyPrompt")}
      </button>
    </>
  );
}
