// 범용 CSV 유틸 — 관리자 테이블·에디터 맵 CSV 내보내기 공용. 빌더는 BOM 없음·CRLF, BOM은 다운로드 시 접두.

import { downloadBlob } from "@/lib/download-blob";

// 수식으로 해석되는 첫 글자 — 스프레드시트가 셀을 수식으로 실행하지 않게 ' 접두(수식 인젝션 가드)
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const GUARDED_LEAD = /^'[=+\-@\t\r]/;

// 셀 이스케이프 — 수식 인젝션 가드('=' 등 시작 셀은 ' 접두) 후, 쉼표/따옴표/개행 포함 시에만 인용
export function escapeCsvCell(value: string): string {
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** escapeCsvCell 가드의 역 — 가드 문자 앞의 ' 하나만 뗀다. 임포트가 `- 확인`·`=HYPERLINK(…)`를 원문대로 돌려받게. */
export function unguardCsvCell(value: string): string {
  return GUARDED_LEAD.test(value) ? value.slice(1) : value;
}

export function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

// BOM(U+FEFF)은 이스케이프로 명시 — 보이지 않는 리터럴은 포매터/편집에서 증발할 수 있다 (Excel/한글 인코딩 픽스)
export function downloadCsv(filename: string, csv: string): void {
  downloadBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), filename);
}
