"use client";

// 매뉴얼 슬라이드 PDF 언어 선택 다이얼로그 — 매뉴얼 뷰어 "한눈에 보기" 메뉴에서 사용자/관리자 덱을 고른 뒤 한국어·English 중 하나를 눌러 내려받는다(/manual 전용).
// 링크는 public/ 정적 파일이라 <a download> — 인증 헤더 불필요. 다운로드 시작과 함께 닫힌다.
// 현재 UI 언어를 앞에 두고 표시하며, 열 때 HEAD로 파일을 확인해 없으면 링크 대신 오류를 보인다(404 HTML이 .pdf로 저장되던 문제).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";
import {
  MANUAL_PDF_LANGS,
  formatManualPdfSize,
  getManualPdfHref,
  orderManualPdfLangs,
  probeManualPdf,
  type ManualPdfKind,
  type ManualPdfLang,
  type ManualPdfProbe,
} from "@/lib/manual-pdf";

interface ManualPdfDialogProps {
  kind: ManualPdfKind;
  onClose: () => void;
}

export function ManualPdfDialog({ kind, onClose }: ManualPdfDialogProps) {
  const { t, lang: uiLang } = useI18n();
  // 언어별 HEAD 확인 결과 — 없으면 확인 중
  const [probes, setProbes] = useState<Partial<Record<ManualPdfLang, ManualPdfProbe>>>({});

  useEffect(() => {
    let alive = true;
    for (const lang of MANUAL_PDF_LANGS) {
      void probeManualPdf(getManualPdfHref(kind, lang)).then((probe) => {
        if (alive) setProbes((prev) => ({ ...prev, [lang]: probe }));
      });
    }
    return () => {
      alive = false;
    };
  }, [kind]);

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="manual-pdf-dialog"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-md p-6 text-center border glass glass-dense"
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
          {orderManualPdfLangs(uiLang).map((lang) => {
            const probe = probes[lang];
            const isCurrent = lang === uiLang;
            const label = (
              <>
                <span>{lang === "ko" ? "한국어" : "English"}</span>
                {isCurrent && (
                  <span data-id={`manual-pdf-current-${lang}`} className="rounded-full bg-accent-tint px-1.5 text-fine text-accent">
                    {t("manual.pdfCurrentLang")}
                  </span>
                )}
              </>
            );
            const box = `flex flex-col items-center gap-1 rounded-sm border px-3 py-3 text-body ${
              isCurrent ? "border-accent" : "border-hairline"
            }`;
            if (probe?.status === "missing" || probe?.status === "error") {
              return (
                <div key={lang} data-id={`manual-pdf-lang-${lang}`} aria-disabled className={`${box} text-ink-tertiary`}>
                  {label}
                  <span data-id={`manual-pdf-error-${lang}`} className="text-fine text-error">
                    {t(probe.status === "missing" ? "manual.pdfMissing" : "manual.pdfCheckFailed")}
                  </span>
                </div>
              );
            }
            if (!probe) {
              return (
                <div key={lang} data-id={`manual-pdf-lang-${lang}`} aria-busy className={`${box} text-ink-secondary`}>
                  {label}
                  <span className="text-fine text-ink-tertiary">PDF</span>
                </div>
              );
            }
            return (
              <a
                key={lang}
                data-id={`manual-pdf-lang-${lang}`}
                href={getManualPdfHref(kind, lang)}
                download
                className={`${box} text-ink hover:border-accent hover:bg-accent-tint`}
                onClick={onClose}
              >
                {label}
                <span className="text-fine text-ink-tertiary">
                  {probe.size === null ? "PDF" : `PDF · ${formatManualPdfSize(probe.size)}`}
                </span>
              </a>
            );
          })}
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
