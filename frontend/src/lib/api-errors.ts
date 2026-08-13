// ApiError → 사람이 읽는 문구. 알려진 서버 detail은 i18n으로, 미지는 detail 원문(코드 프리픽스 제거)으로.
import { getApiErrorDetail } from "./api";
import type { MessageKey } from "./i18n-messages";

type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

// 서버 detail 원문(영어, 고정 프리픽스) → i18n 시맨틱 키. 전방일치이므로 접미사가 붙는 detail도 커버.
const DETAIL_PREFIX_MAP: [string, MessageKey][] = [
  ["a visibility change request is already pending", "apiError.visibilityPending"],
  ["a change request for this grant is already pending", "apiError.grantPending"],
  ["map has no approvers", "apiError.noApprovers"],
  ["visibility unchanged", "apiError.visibilityUnchanged"],
  ["grant already exists", "apiError.grantExists"],
  // decide/withdraw 2종 모두 이 문구로 시작 (backend app/routers/permissions.py:569,605)
  ["bundled with a version submission", "apiError.bundledWithVersion"],
  ["collaborator is in an active version workflow", "apiError.activeWorkflow"],
  // checkout/submit 2종 모두 이 문구로 시작 (backend app/routers/versions.py:289,565)
  ["your permission change is pending approval", "apiError.permissionPending"],
  ["sync throttled", "apiError.syncThrottled"],
  ["only the owner can bundle", "apiError.ownerOnlyBundle"],
];

export function humanizeApiError(err: unknown, t: TFunc): string {
  const detail = getApiErrorDetail(err);
  const hit = DETAIL_PREFIX_MAP.find(([prefix]) => detail.startsWith(prefix));
  return hit ? t(hit[1]) : detail;
}
