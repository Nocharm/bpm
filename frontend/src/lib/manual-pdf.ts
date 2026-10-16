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

/** 현재 UI 언어를 맨 앞에 — 다이얼로그가 지금 쓰는 언어부터 보여 준다. */
export function orderManualPdfLangs(current: ManualPdfLang): ManualPdfLang[] {
  return [current, ...MANUAL_PDF_LANGS.filter((lang) => lang !== current)];
}

export type ManualPdfProbe =
  | { status: "ok"; size: number | null }
  | { status: "missing" }
  | { status: "error" };

/** HEAD로 PDF가 실제로 있는지 확인 — 없는 정적 파일은 404 HTML이라 그대로 <a download>하면 HTML이 .pdf로 저장된다.
 *  응답이 PDF가 아니면(개발 서버 폴백 페이지 등) missing, 요청 자체가 실패하면 error. */
export async function probeManualPdf(href: string, fetchImpl: typeof fetch = fetch): Promise<ManualPdfProbe> {
  let response: Response;
  try {
    response = await fetchImpl(href, { method: "HEAD", cache: "no-store" });
  } catch {
    return { status: "error" };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("pdf")) return { status: "missing" };
  const length = Number(response.headers.get("content-length"));
  return { status: "ok", size: Number.isFinite(length) && length > 0 ? length : null };
}

/** 파일 크기 표기 — 1 MB 이상은 소수 한 자리 MB, 그 밑은 KB. */
export function formatManualPdfSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
