// 제출 시 변경 사유 AI 초안 — 최신 게시본 대비 diff를 비교 보고서와 같은 페이로드로 만들어 초안을 받는다 (2026-09-21).
// 에디터 승인 요청 다이얼로그와 설정>버전 패널이 공유. 결재자 보고서(compare)와 한 쌍 — 제출 코멘트가 "왜"의 근거가 된다.

import { aiSubmitNoteDraft, getFullGraph, type VersionGraph, type VersionSummary } from "@/lib/api";
import { buildCompareSummaryPayload } from "@/lib/compare-summary-payload";
import { buildMergedGraph } from "@/lib/merge-diff";

// 초안의 base — 제출할 버전을 제외한 최신 게시본(번호 우선, 없으면 id). 없으면 null=첫 제출(전체 신규).
export function findLatestPublishedVersion(versions: VersionSummary[], excludeId: number): VersionSummary | null {
  const published = versions.filter((v) => v.status === "published" && v.id !== excludeId);
  if (published.length === 0) return null;
  return published.reduce((best, v) => {
    const bestKey = best.version_number ?? -1;
    const key = v.version_number ?? -1;
    if (key !== bestKey) return key > bestKey ? v : best;
    return v.id > best.id ? v : best;
  });
}

const EMPTY_GRAPH: VersionGraph = { nodes: [], edges: [] };

export async function draftSubmitNote(opts: {
  mapId: number;
  versionId: number;
  versions: VersionSummary[];
  lang: "ko" | "en";
}): Promise<string> {
  const base = findLatestPublishedVersion(opts.versions, opts.versionId);
  const [baseGraph, targetGraph] = await Promise.all([
    base ? getFullGraph(base.id) : Promise.resolve(EMPTY_GRAPH),
    getFullGraph(opts.versionId),
  ]);
  const merged = buildMergedGraph(baseGraph, targetGraph);
  const { payload } = buildCompareSummaryPayload(merged, { base: baseGraph, target: targetGraph });
  const { note } = await aiSubmitNoteDraft(opts.mapId, base?.id ?? null, opts.versionId, payload, opts.lang);
  return note;
}
