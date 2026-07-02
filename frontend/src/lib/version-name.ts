// 버전 표시명 — 게시 시 부여된 순차 번호가 있으면 'v{n} · {label}'로 앞에 강제, 미게시(번호 없음)는 라벨만.
import type { VersionSummary } from "@/lib/api";

export function formatVersionName(
  version: Pick<VersionSummary, "label" | "version_number">,
): string {
  const number = version.version_number;
  return number != null ? `v${number} · ${version.label}` : version.label;
}

// 게시 시 받을 다음 순차 번호 — 현재 최대 version_number + 1, 없으면 1. (드래프트 예측 번호)
export function nextVersionNumber(
  versions: Pick<VersionSummary, "version_number">[],
): number {
  const max = versions.reduce(
    (m, v) => (v.version_number != null && v.version_number > m ? v.version_number : m),
    0,
  );
  return max + 1;
}

// 버전 마커 — 번호가 있으면(승인·게시·만료) 'v{n}'(long이면 'version {n}'),
// 드래프트(번호 없음)는 게시 시 받을 번호로 '(Draft)v.{다음번호}'.
export function formatVersionMarker(
  version: Pick<VersionSummary, "version_number">,
  versions: Pick<VersionSummary, "version_number">[],
  opts?: { long?: boolean },
): string {
  const number = version.version_number;
  if (number != null) {
    return opts?.long ? `version ${number}` : `v${number}`;
  }
  return `(Draft)v.${nextVersionNumber(versions)}`;
}
