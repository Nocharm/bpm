import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MANUAL_PDF_KINDS,
  MANUAL_PDF_LANGS,
  formatManualPdfSize,
  getManualPdfFileName,
  getManualPdfHref,
  orderManualPdfLangs,
  probeManualPdf,
} from "./manual-pdf";

describe("manual-pdf", () => {
  it("builds the public href from kind and language", () => {
    expect(getManualPdfHref("user", "ko")).toBe("/manuals/bpm-manual-user-ko.pdf");
    expect(getManualPdfHref("admin", "en")).toBe("/manuals/bpm-manual-admin-en.pdf");
  });

  // 링크가 가리키는 파일이 실제로 public/에 있어야 한다 — 이름 드리프트(export-pdf.mjs 출력명 변경)를 잡는다.
  it("every kind/language PDF exists under frontend/public/manuals", () => {
    const publicDir = path.resolve(__dirname, "../../public/manuals");
    for (const kind of MANUAL_PDF_KINDS) {
      for (const lang of MANUAL_PDF_LANGS) {
        expect(existsSync(path.join(publicDir, getManualPdfFileName(kind, lang)))).toBe(true);
      }
    }
  });
});

describe("manual-pdf dialog helpers", () => {
  it("lists the current UI language first", () => {
    expect(orderManualPdfLangs("en")).toEqual(["en", "ko"]);
    expect(orderManualPdfLangs("ko")).toEqual(["ko", "en"]);
  });

  const respond = (status: number, headers: Record<string, string>) =>
    (async () => new Response(null, { status, headers })) as unknown as typeof fetch;

  it("reports a PDF with its size", async () => {
    await expect(probeManualPdf("/m.pdf", respond(200, { "content-type": "application/pdf", "content-length": "4639591" }))).resolves.toEqual({
      status: "ok",
      size: 4639591,
    });
  });

  it("treats a 404 or an HTML fallback page as missing", async () => {
    await expect(probeManualPdf("/m.pdf", respond(404, { "content-type": "text/html" }))).resolves.toEqual({ status: "missing" });
    await expect(probeManualPdf("/m.pdf", respond(200, { "content-type": "text/html" }))).resolves.toEqual({ status: "missing" });
  });

  it("reports a failed request as an error", async () => {
    const failing = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    await expect(probeManualPdf("/m.pdf", failing)).resolves.toEqual({ status: "error" });
  });

  it("formats sizes", () => {
    expect(formatManualPdfSize(4639591)).toBe("4.4 MB");
    expect(formatManualPdfSize(20480)).toBe("20 KB");
  });
});
