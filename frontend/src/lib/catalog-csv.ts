// 카탈로그 CSV 임포트 순수 함수 — value,aliases 2열(별칭 | 구분, 헤더 선택) 파싱·값 병합+별칭 합집합·별칭 불변식
// (별칭 하나 → 값 하나, 값 우선)의 FE 미러(설정 Catalogs 탭). 파서는 csv-import parseCsvRecords(RFC4180) 재사용.

import type { CatalogEntry } from "@/lib/api";
import { parseCsvRecords } from "@/lib/csv-import";

const ITEM_MAX_LEN = 100; // 서버 MANAGED_ITEM_MAX_LEN과 동일
const ALIASES_MAX = 20; // 서버 MANAGED_ALIASES_MAX와 동일
const ALIAS_SEPARATOR = "|";

const clean = (raw: string): string => raw.trim().slice(0, ITEM_MAX_LEN);

/** 값·별칭 전역 중복 제거 — 값을 먼저 전부 확보하고, 별칭은 어떤 값·앞선 별칭과 겹치면 버린다 */
export function normalizeAliases(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const taken = new Set<string>();
  const staged: CatalogEntry[] = [];
  for (const entry of entries) {
    const value = clean(entry.value);
    if (value === "" || taken.has(value.toLocaleLowerCase())) continue;
    taken.add(value.toLocaleLowerCase());
    staged.push({ value, aliases: entry.aliases });
  }
  return staged.map((entry) => {
    const aliases: string[] = [];
    for (const raw of entry.aliases) {
      const alias = clean(raw);
      if (alias === "" || taken.has(alias.toLocaleLowerCase())) continue;
      taken.add(alias.toLocaleLowerCase());
      aliases.push(alias);
      if (aliases.length >= ALIASES_MAX) break;
    }
    return { value: entry.value, aliases };
  });
}

export function parseCatalogCsv(text: string): CatalogEntry[] {
  const entries = parseCsvRecords(text)
    .map((record) => ({
      value: (record.cells[0] ?? "").trim(),
      aliases: (record.cells[1] ?? "")
        .split(ALIAS_SEPARATOR)
        .map((alias) => alias.trim())
        .filter((alias) => alias !== ""),
    }))
    .filter((entry) => entry.value !== "");
  if (entries.length > 0 && entries[0].value.toLocaleLowerCase() === "value") entries.shift();
  return normalizeAliases(entries);
}

export function mergeCatalogEntries(
  current: readonly CatalogEntry[],
  incoming: readonly CatalogEntry[],
): { next: CatalogEntry[]; added: number; duplicates: number; aliasesAdded: number } {
  const next = current.map((entry) => ({ value: entry.value, aliases: [...entry.aliases] }));
  const byKey = new Map(next.map((entry) => [entry.value.toLocaleLowerCase(), entry]));
  let added = 0;
  let duplicates = 0;
  for (const raw of incoming) {
    const value = clean(raw.value);
    if (value === "") continue;
    const existing = byKey.get(value.toLocaleLowerCase());
    if (existing) {
      duplicates += 1;
      existing.aliases.push(...raw.aliases);
      continue;
    }
    const entry = { value, aliases: [...raw.aliases] };
    byKey.set(value.toLocaleLowerCase(), entry);
    next.push(entry);
    added += 1;
  }
  const normalized = normalizeAliases(next);
  const before = current.reduce((sum, entry) => sum + entry.aliases.length, 0);
  const after = normalized.reduce((sum, entry) => sum + entry.aliases.length, 0);
  return { next: normalized, added, duplicates, aliasesAdded: Math.max(0, after - before) };
}
