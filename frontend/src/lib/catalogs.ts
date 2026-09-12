"use client";

// 관리 목록(카탈로그) — 역할·시스템 자동완성 옵션의 단일 소스 + 시스템 정규화 순수 함수.
// 모듈 캐시(세션당 1회 fetch, lib/directory.ts 패턴). 관리자 저장 후 invalidateCatalogs()로 재조회.
// 설계: docs/design/2026-09-11-assignee-role-catalog-design.md §3.2·§4.2

import { useEffect, useState } from "react";

import { getCatalogs, type CatalogEntry, type Catalogs } from "@/lib/api";

// 시스템 예약 항목 — 목록 밖 자유값은 Other로 분류하고 원문을 system_fallback에 남긴다 (저장값 고정, 표시는 i18n)
export const OTHER_SYSTEM = "Other";

const EMPTY: Catalogs = { assignee_roles: [], systems: [{ value: OTHER_SYSTEM, aliases: [] }] };

let cache: Catalogs | null = null;
let inflight: Promise<Catalogs> | null = null;
const listeners = new Set<() => void>();

function loadCatalogs(): Promise<Catalogs> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getCatalogs()
      .then((data) => {
        cache = data;
        return data;
      })
      .catch((err) => {
        inflight = null; // 실패 약속을 캐시에 남기면 이후 마운트가 전부 같은 실패를 물려받는다
        throw err;
      });
  }
  return inflight;
}

/** 관리자 저장 후 호출 — 캐시를 비우고 마운트된 훅들을 재조회시킨다 */
export function invalidateCatalogs(): void {
  cache = null;
  inflight = null;
  for (const listener of listeners) listener();
}

/** 카탈로그 2종. 도착 전엔 캐시(있으면) 또는 빈 목록(시스템은 Other만). */
export function useCatalogs(): Catalogs {
  const [data, setData] = useState<Catalogs>(cache ?? EMPTY);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      loadCatalogs()
        .then((next) => {
          if (alive) setData(next);
        })
        .catch(() => {
          // 조회 실패 — 자동완성 없이 자유입력만 남는다
        });
    };
    refresh();
    listeners.add(refresh);
    return () => {
      alive = false;
      listeners.delete(refresh);
    };
  }, []);
  return data;
}

/** 값 또는 별칭이 대소문자 무시로 일치하는 항목 — 없으면 null */
export function findCatalogEntry(value: string, entries: readonly CatalogEntry[]): CatalogEntry | null {
  const key = value.trim().toLocaleLowerCase();
  if (key === "") return null;
  return (
    entries.find(
      (entry) =>
        entry.value.toLocaleLowerCase() === key || entry.aliases.some((alias) => alias.toLocaleLowerCase() === key),
    ) ?? null
  );
}

/** trim 후 값·별칭 대소문자 무시 일치 → 정식 표기(value). 빈값·불일치는 null. */
export function normalizeToCatalog(value: string, entries: readonly CatalogEntry[]): string | null {
  return findCatalogEntry(value, entries)?.value ?? null;
}

export interface SystemCommit {
  system: string;
  system_fallback: string;
  // 자유값인데 기존 원문 메모가 다른 내용이라 유지했다 — 호출부가 확인/안내를 띄운다
  keptNote: boolean;
}

/** 시스템 커밋 규칙 — 4 표면(인스펙터·노드 모달·SP 지정·적용) 공용.
 *  빈값=시스템 비움 · 목록 일치=표기 저장 · 불일치=Other + 원문 메모(비어 있을 때만 채움) */
export function commitSystem(raw: string, systems: readonly CatalogEntry[], currentFallback: string): SystemCommit {
  const trimmed = raw.trim();
  if (trimmed === "") return { system: "", system_fallback: currentFallback, keptNote: false };
  const matched = normalizeToCatalog(trimmed, systems);
  if (matched !== null) return { system: matched, system_fallback: currentFallback, keptNote: false };
  const note = currentFallback.trim();
  if (note === "" || note === trimmed) return { system: OTHER_SYSTEM, system_fallback: trimmed, keptNote: false };
  return { system: OTHER_SYSTEM, system_fallback: currentFallback, keptNote: true };
}

/** 역할 커밋 규칙 — 목록 일치(별칭 포함)면 정식 표기, 아니면 trim한 자유값(역할엔 Other 폴백이 없다).
 *  CSV·AI 변환단 공용. BE `app_settings.commit_role`과 동치 (design 2026-09-12). */
export function commitRole(raw: string, roles: readonly CatalogEntry[]): string {
  const trimmed = raw.trim();
  return normalizeToCatalog(trimmed, roles) ?? trimmed;
}

/** 원문 메모에 새 자유값을 이어붙인다 — 기존이 비면 raw만, 아니면 줄바꿈 후 raw */
export function appendSystemNote(existing: string, raw: string): string {
  const trimmedExisting = existing.trimEnd();
  const trimmedRaw = raw.trim();
  return trimmedExisting === "" ? trimmedRaw : `${trimmedExisting}\n${trimmedRaw}`;
}

/** 표시용 — 저장값 Other만 i18n 라벨로, 나머지는 그대로 */
export function formatSystem(value: string | null | undefined, otherLabel: string): string {
  const system = value ?? "";
  return system === OTHER_SYSTEM ? otherLabel : system;
}
