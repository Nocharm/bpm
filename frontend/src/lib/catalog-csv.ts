// 카탈로그 CSV 임포트 순수 함수 — 1열 값 목록 파싱·대소문자 무시 병합(설정 Catalogs 탭). 파서는 csv-import
// parseCsvRecords(RFC4180) 재사용. 헤더 "value"(대소문자 무시)는 건너뛰고 각 레코드 첫 셀만 읽는다.

import { parseCsvRecords } from "@/lib/csv-import";

const ITEM_MAX_LEN = 100; // 서버 MANAGED_ITEM_MAX_LEN과 동일

export function parseCatalogCsv(text: string): string[] {
  const values = parseCsvRecords(text)
    .map((record) => (record.cells[0] ?? "").trim())
    .filter((value) => value !== "");
  if (values.length > 0 && values[0].toLocaleLowerCase() === "value") values.shift();
  return values;
}

export function mergeCatalogValues(
  current: readonly string[],
  incoming: readonly string[],
): { next: string[]; added: number; duplicates: number } {
  const next = [...current];
  const seen = new Set(current.map((value) => value.toLocaleLowerCase()));
  let added = 0;
  let duplicates = 0;
  for (const raw of incoming) {
    const value = raw.trim().slice(0, ITEM_MAX_LEN);
    if (value === "") continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    next.push(value);
    added += 1;
  }
  return { next, added, duplicates };
}
