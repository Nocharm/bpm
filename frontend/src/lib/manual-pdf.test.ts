import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MANUAL_PDF_KINDS, MANUAL_PDF_LANGS, getManualPdfFileName, getManualPdfHref } from "./manual-pdf";

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
