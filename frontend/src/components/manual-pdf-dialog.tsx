"use client";

// 매뉴얼 슬라이드 PDF 언어 선택 다이얼로그 — 매뉴얼 뷰어 "한눈에 보기" 메뉴에서 사용자/관리자 덱을 고른 뒤 한국어·English 중 하나를 눌러 내려받는다(/manual 전용).
// 링크는 public/ 정적 파일이라 <a download> — 인증 헤더 불필요. 다운로드 시작과 함께 닫힌다.

import { createPortal } from "react-dom";
import { FileDown } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";
import { MANUAL_PDF_LANGS, getManualPdfHref, type ManualPdfKind } from "@/lib/manual-pdf";

interface ManualPdfDialogProps {
  kind: ManualPdfKind;
  onClose: () => void;
}

export function ManualPdfDialog({ kind, onClose }: ManualPdfDialogProps) {
  const { t } = useI18n();
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="manual-pdf-dialog"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-md bg-surface p-6 text-center shadow-lg"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-tint">
          <FileDown size={28} strokeWidth={1.5} className="text-accent" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">
            {t(kind === "user" ? "manual.pdfUser" : "manual.pdfAdmin")}
          </h2>
          <p className="text-caption text-ink-tertiary">{t("manual.pdfPickLang")}</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          {MANUAL_PDF_LANGS.map((lang) => (
            <a
              key={lang}
              data-id={`manual-pdf-lang-${lang}`}
              href={getManualPdfHref(kind, lang)}
              download
              className="flex flex-col items-center gap-1 rounded-sm border border-hairline px-3 py-3 text-body text-ink hover:border-accent hover:bg-accent-tint"
              onClick={onClose}
            >
              <span>{lang === "ko" ? "한국어" : "English"}</span>
              <span className="text-fine text-ink-tertiary">PDF</span>
            </a>
          ))}
        </div>
        <div className="flex w-full justify-end">
          <button
            type="button"
            data-id="manual-pdf-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
