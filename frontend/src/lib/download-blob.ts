// 브라우저 파일 내려받기 단일 헬퍼 — 에디터 CSV·CSV 템플릿·관리자 CSV(lib/csv)·인터뷰 JSON·백업 파일이 같이 쓴다.
// 객체 URL은 클릭 직후가 아니라 다음 틱에 해제한다: 동기 해제는 일부 브라우저(Safari·구형 Firefox)에서 내려받기를 취소시킨다.

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
