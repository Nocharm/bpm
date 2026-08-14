// 범용 CSV 유틸 — 관리자 테이블 내보내기 공용. 빌더는 BOM 없음·CRLF, BOM은 다운로드 시 접두.

// 셀 이스케이프 — 수식 인젝션 가드('=' 등 시작 셀은 ' 접두) 후, 쉼표/따옴표/개행 포함 시에만 인용
export function escapeCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

// BOM(U+FEFF)은 이스케이프로 명시 — 보이지 않는 리터럴은 포매터/편집에서 증발할 수 있다 (Excel/한글 인코딩 픽스)
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
