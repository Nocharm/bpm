// 셀프 게시 — 승인자가 본인 1인일 때 승인요청→승인→게시를 한 번에 진행하는 체인.

import { approveVersion, publishVersion, submitVersion } from "./api";
import type { VersionSummary } from "./api";

// 승인자 목록이 정확히 현재 유저 1명인지 — 셀프 게시 제안 조건.
export function isSoleSelfApprover(approvers: string[], userId: string): boolean {
  return approvers.length === 1 && approvers[0] === userId;
}

// submit→approve→publish 순차 실행 — 마지막 publish 결과 반환(runTransition 계약과 동일).
// 중간 실패는 그대로 전파해 호출부 토스트/재조회 경로를 태운다.
export async function runSelfPublishChain(versionId: number): Promise<VersionSummary> {
  await submitVersion(versionId);
  await approveVersion(versionId);
  return publishVersion(versionId);
}
