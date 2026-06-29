// 버전 표시명 — 게시 시 부여된 순차 번호가 있으면 'v{n} · {label}'로 앞에 강제, 미게시(번호 없음)는 라벨만.
import type { VersionSummary } from "@/lib/api";

export function formatVersionName(
  version: Pick<VersionSummary, "label" | "version_number">,
): string {
  const number = version.version_number;
  return number != null ? `v${number} · ${version.label}` : version.label;
}
