// 권한 편집 스택 — 협업자 패널·맵 상세 카드 공용. 화면에 쌓인 변경은 Save를 눌러야 일괄 적용되고
// Cancel이면 그대로 폐기된다(R2 QA 피드백: 즉시 적용 금지). 서버 진실 pending 마커(perm.pending_change)와는
// 별개 — 이 스택은 아직 서버에 보내지 않은 로컬 의도만 담는다.

import {
  addMapPermission,
  changeMapPermission,
  getApiErrorDetail,
  removeMapPermission,
  type PrincipalType,
} from "@/lib/api";

export type StagedOp =
  | { kind: "add"; principalType: PrincipalType; principalId: string; role: "viewer" | "editor" }
  | { kind: "change"; permissionId: number; toRole: "viewer" | "editor" }
  | { kind: "remove"; permissionId: number };

// 같은 대상을 가리키는 op의 식별 키 — add는 principal, change/remove는 kind 무관 permissionId
// (같은 grant에 대한 change 이후 remove — 또는 그 반대 — 는 최신이 이전을 대체해야 함: 두 mutation을
// 모두 Save에서 실행하면 낡은 change가 얹혀 R1 상호배제 409나 유령 pending을 남길 수 있다).
function getStagedOpKey(op: StagedOp): string {
  return op.kind === "add" ? `add:${op.principalType}:${op.principalId}` : `perm:${op.permissionId}`;
}

// 같은 대상에 대한 새 op를 적립 — 최신 값이 이전 값을 대체한다(예: change→change 재선택).
export function upsertStagedOp(ops: StagedOp[], next: StagedOp): StagedOp[] {
  const key = getStagedOpKey(next);
  return [...ops.filter((op) => getStagedOpKey(op) !== key), next];
}

// 행별 개별 취소 — 스택에서 해당 op만 제거(add 취소도 이 경로: 아직 서버에 없는 행이라 되돌릴 상태가 없음).
export function removeStagedOp(ops: StagedOp[], target: StagedOp): StagedOp[] {
  const key = getStagedOpKey(target);
  return ops.filter((op) => getStagedOpKey(op) !== key);
}

// 현재 role을 다시 선택하면 그 행의 staged op를 지운다(no-op change를 쌓지 않음 — R2 최종 리뷰 후속).
// change 후 원복뿐 아니라 staged remove 후 원래 role 재선택도 "원상 유지" 의도이므로 같은 키로 소거된다.
export function stageRoleChange(
  ops: StagedOp[],
  permissionId: number,
  toRole: "viewer" | "editor",
  currentRole: string,
): StagedOp[] {
  if (toRole === currentRole) {
    return removeStagedOp(ops, { kind: "change", permissionId, toRole });
  }
  return upsertStagedOp(ops, { kind: "change", permissionId, toRole });
}

export interface StagedResult {
  applied: number;
  pending: number;
  failed: { op: StagedOp; message: string }[];
}

// 스택을 순차 실행 — 한 op의 실패가 나머지를 막지 않는다(R1 상호배제 409 등은 개별 실패로만 남음).
// 실패 메시지는 서버 detail 원문(getApiErrorDetail) — 호출측이 humanizeApiError로 사람이 읽는 문구로 변환한다.
export async function applyStagedOps(mapId: number, ops: StagedOp[]): Promise<StagedResult> {
  const result: StagedResult = { applied: 0, pending: 0, failed: [] };
  for (const op of ops) {
    try {
      if (op.kind === "add") {
        await addMapPermission(mapId, op.principalType, op.principalId, op.role);
        result.applied += 1;
      } else if (op.kind === "change") {
        const mutation = await changeMapPermission(mapId, op.permissionId, op.toRole);
        if (mutation.pending) result.pending += 1;
        else result.applied += 1;
      } else {
        const mutation = await removeMapPermission(mapId, op.permissionId);
        if (mutation.pending) result.pending += 1;
        else result.applied += 1;
      }
    } catch (err) {
      result.failed.push({ op, message: getApiErrorDetail(err) });
    }
  }
  return result;
}

// 이 op가 저장 시 즉시 적용될지 승인 대기로 갈지 예측 — BE 판정의 FE 미러.
// ⚠️ backend/app/permissions/logic.py requires_downgrade_approval + routers/permissions.py의
// actor_role=owner 즉시 적용 규칙과 동치 유지(양쪽 수정 시 동기화). 어긋나도 표시만 틀리고
// 실동작 진실은 서버 응답(mutation.pending)이다.
export function forecastStagedOp(
  op: StagedOp,
  grantRole: string | undefined,
  actorIsOwner: boolean,
): "instant" | "approval" {
  if (actorIsOwner || op.kind === "add") return "instant";
  if (grantRole !== "editor") return "instant";
  if (op.kind === "remove") return "approval";
  return op.toRole === "viewer" ? "approval" : "instant";
}
