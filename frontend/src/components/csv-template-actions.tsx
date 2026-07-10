"use client";

// CSV 준비 액션 — 템플릿 다운로드 + AI 프롬프트 복사. 새 맵 다이얼로그와 CsvImportSection이 공용.
// 외부 AI 왕복: [AI 프롬프트 복사]→외부 AI에 문서와 함께 붙여넣기→받은 CSV를 에디터에서 임포트.
import { useState } from "react";

import { AlertTriangle, Check, Download, Sparkles } from "lucide-react";

import { copyText } from "@/lib/clipboard";
import { buildAiPromptText, buildTemplateCsv } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

export const CSV_OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

export function CsvTemplateActions({ disabled }: { disabled?: boolean }) {
  const { t } = useI18n();
  // 복사 결과 — idle | copied | failed. 서버(평문 HTTP)에선 실패할 수 있으므로 성공을 가정하지 않는다.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

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

  const handleCopyPrompt = async () => {
    const ok = await copyText(buildAiPromptText());
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), ok ? 1200 : 1600);
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
        onClick={() => void handleCopyPrompt()}
        disabled={disabled}
        title={t("csvImport.copyPromptHint")}
      >
        {copyState === "copied" ? (
          <Check size={14} strokeWidth={1.5} className="text-accent" />
        ) : copyState === "failed" ? (
          <AlertTriangle size={14} strokeWidth={1.5} className="text-error" />
        ) : (
          <Sparkles size={14} strokeWidth={1.5} />
        )}
        <span className={copyState === "failed" ? "text-error" : undefined}>
          {copyState === "copied"
            ? t("csvImport.promptCopied")
            : copyState === "failed"
              ? t("csvImport.promptCopyFailed")
              : t("csvImport.copyPrompt")}
        </span>
      </button>
    </>
  );
}
