// 되돌리기 플랜 — 직전 저장(records)의 역방향을 조립·실행. 스냅샷 기반이라 타인이 먼저 바꾼
// grant는 개별 실패로만 남는다(정합 복원 시도 없음 — 설계 §5 리스크 수용).

import {
  addMapPermission,
  changeMapPermission,
  getApiErrorDetail,
  removeMapPermission,
  withdrawApprovalRequest,
  type PrincipalType,
} from "./api";
import { forecastStagedOp, type AppliedOpRecord } from "./permission-staging";

export interface UndoPlanItem {
  action: "remove-added" | "restore-role" | "re-add" | "withdraw";
  principalType: PrincipalType;
  principalId: string;
  fromRole?: string;
  toRole?: string;
  forecast: "instant" | "approval";
  permissionId?: number;
  role?: "viewer" | "editor";
  requestId?: number;
}

export function buildUndoPlan(records: AppliedOpRecord[], actorIsOwner: boolean): UndoPlanItem[] {
  const items: UndoPlanItem[] = [];
  for (const r of records) {
    if (r.outcome === "failed") continue;
    if (r.outcome === "pending") {
      if (r.approvalRequest && r.prev) {
        items.push({
          action: "withdraw",
          principalType: r.prev.principalType,
          principalId: r.prev.principalId,
          fromRole: r.prev.role,
          forecast: "instant",
          requestId: r.approvalRequest.id,
        });
      }
      continue;
    }
    if (r.op.kind === "add" && r.createdPermission) {
      items.push({
        action: "remove-added",
        principalType: r.op.principalType,
        principalId: r.op.principalId,
        fromRole: r.op.role,
        forecast: forecastStagedOp(
          { kind: "remove", permissionId: r.createdPermission.id },
          r.op.role,
          actorIsOwner,
        ),
        permissionId: r.createdPermission.id,
      });
    } else if (r.op.kind === "change" && r.prev) {
      const restored = r.prev.role as "viewer" | "editor";
      items.push({
        action: "restore-role",
        principalType: r.prev.principalType,
        principalId: r.prev.principalId,
        fromRole: r.op.toRole,
        toRole: restored,
        forecast: forecastStagedOp(
          { kind: "change", permissionId: r.op.permissionId, toRole: restored },
          r.op.toRole,
          actorIsOwner,
        ),
        permissionId: r.op.permissionId,
        role: restored,
      });
    } else if (r.op.kind === "remove" && r.prev) {
      items.push({
        action: "re-add",
        principalType: r.prev.principalType,
        principalId: r.prev.principalId,
        toRole: r.prev.role,
        forecast: "instant",
        role: r.prev.role as "viewer" | "editor",
      });
    }
  }
  return items;
}

// 순차 실행 — 저장(applyStagedOps)과 동일한 개별 실패 비차단 정책.
export async function executeUndoPlan(
  mapId: number,
  items: UndoPlanItem[],
): Promise<{ done: number; pending: number; failed: { message: string }[] }> {
  const summary = { done: 0, pending: 0, failed: [] as { message: string }[] };
  for (const item of items) {
    try {
      if (item.action === "withdraw" && item.requestId !== undefined) {
        await withdrawApprovalRequest(item.requestId);
        summary.done += 1;
      } else if (item.action === "re-add" && item.role) {
        await addMapPermission(mapId, item.principalType, item.principalId, item.role);
        summary.done += 1;
      } else if (item.action === "remove-added" && item.permissionId !== undefined) {
        const res = await removeMapPermission(mapId, item.permissionId);
        if (res.pending) summary.pending += 1;
        else summary.done += 1;
      } else if (item.action === "restore-role" && item.permissionId !== undefined && item.role) {
        const res = await changeMapPermission(mapId, item.permissionId, item.role);
        if (res.pending) summary.pending += 1;
        else summary.done += 1;
      }
    } catch (err) {
      summary.failed.push({ message: getApiErrorDetail(err) });
    }
  }
  return summary;
}
