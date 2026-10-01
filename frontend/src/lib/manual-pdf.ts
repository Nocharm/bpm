// 매뉴얼 슬라이드 PDF 정적 경로 — frontend/public/manuals/ 에 두어 로컬(next dev)·서버(standalone+nginx) 모두 추가 설정 없이 서빙.
// 파일명은 docs/manual/slides/export-pdf.mjs 가 만드는 이름과 일치해야 한다(bpm-manual-{user|admin}-{ko|en}.pdf).

export type ManualPdfKind = "user" | "admin";
export type ManualPdfLang = "ko" | "en";

export const MANUAL_PDF_KINDS: readonly ManualPdfKind[] = ["user", "admin"];
export const MANUAL_PDF_LANGS: readonly ManualPdfLang[] = ["ko", "en"];

export function getManualPdfFileName(kind: ManualPdfKind, lang: ManualPdfLang): string {
  return `bpm-manual-${kind}-${lang}.pdf`;
}

export function getManualPdfHref(kind: ManualPdfKind, lang: ManualPdfLang): string {
  return `/manuals/${getManualPdfFileName(kind, lang)}`;
}
