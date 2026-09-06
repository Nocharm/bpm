// ApiError → 사람이 읽는 문구. 알려진 서버 detail은 i18n으로, 미지는 detail 원문(코드 프리픽스 제거)으로.
import { ApiError, getApiErrorDetail } from "./api";
import type { MessageKey } from "./i18n-messages";

type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

// checkout/submit 2종 모두 이 문구로 시작 (backend app/routers/versions.py:289,565).
// 체크아웃 폴 effect(page.tsx)가 이 특정 409를 감지해 폴링을 중지하는 데도 재사용 — 문자열은 이 한 곳뿐.
export const PERMISSION_PENDING_DETAIL_PREFIX = "your permission change is pending approval";

// 슬롯 변경이 서버에서 이 캔버스를 재결착한 뒤, 옛 체크아웃을 들고 있던 편집자의 다음 PUT /graph가 막히는
// 데드엔드 감지용 (backend app/routers/graph.py:314-317). page.tsx 저장 에러 경로에서 배너 대신 새로고침 토스트로 분기.
export const CANVAS_REPOINTED_DETAIL_PREFIX = "contained L6 nodes cannot be removed from the canvas";

export function isCanvasRepointedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 422 && getApiErrorDetail(err).startsWith(CANVAS_REPOINTED_DETAIL_PREFIX);
}

// 슬롯 변경 재시도 데드엔드 감지용 — 이 맵에 fw_slot 요청이 이미 대기 중이면 이 detail로 409
// (backend app/routers/slot_changes.py:73, self_apply 여부와 무관). 복사+은퇴(create-map-dialog.tsx)가
// 실제 응답을 못 받고 재시도할 때, 직전 시도가 서버엔 이미 반영됐을 가능성을 "이미 처리됨"으로 구분한다.
export const SLOT_CHANGE_PENDING_DETAIL_PREFIX = "a slot change is already pending";

export function isSlotChangePendingError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && getApiErrorDetail(err).startsWith(SLOT_CHANGE_PENDING_DETAIL_PREFIX);
}

// 서버 detail 원문(영어, 고정 프리픽스) → i18n 시맨틱 키. 전방일치이므로 접미사가 붙는 detail도 커버.
// ⚠️ 401/403을 낼 수 있는 detail을 여기 추가하면 settings 페이지의 토스트 억제 필터(maps/[mapId]/settings/page.tsx showToast)와 어긋난다 — 매핑 히트는 '(HTTP 40x)' 꼬리표가 없어 필터를 우회한다. 추가 시 그 필터를 함께 점검할 것.
const DETAIL_PREFIX_MAP: [string, MessageKey][] = [
  ["a visibility change request is already pending", "apiError.visibilityPending"],
  ["a change request for this grant is already pending", "apiError.grantPending"],
  ["map has no approvers", "apiError.noApprovers"],
  ["visibility unchanged", "apiError.visibilityUnchanged"],
  ["grant already exists", "apiError.grantExists"],
  // decide/withdraw 2종 모두 이 문구로 시작 (backend app/routers/permissions.py:569,605)
  ["bundled with a version submission", "apiError.bundledWithVersion"],
  ["collaborator is in an active version workflow", "apiError.activeWorkflow"],
  [PERMISSION_PENDING_DETAIL_PREFIX, "apiError.permissionPending"],
  ["sync throttled", "apiError.syncThrottled"],
  ["only the owner can bundle", "apiError.ownerOnlyBundle"],
  ["a designation request is already pending", "apiError.spDesignationPending"],
];

export function humanizeApiError(err: unknown, t: TFunc): string {
  const detail = getApiErrorDetail(err);
  const hit = DETAIL_PREFIX_MAP.find(([prefix]) => detail.startsWith(prefix));
  if (hit) return t(hit[1]);
  if (err instanceof ApiError) {
    // 미매핑 폴백 — 현장 제보용 상태코드 꼬리표. detail 파싱 실패(비 JSON 응답)면 원문 대신 일반 문구.
    return detail !== err.message
      ? `${detail} (HTTP ${err.status})`
      : t("apiError.requestFailed", { status: err.status });
  }
  return detail;
}
