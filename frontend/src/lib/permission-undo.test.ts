import { describe, expect, it, vi, beforeEach } from "vitest";

import { buildUndoPlan, executeUndoPlan } from "./permission-undo";
import type { AppliedOpRecord } from "./permission-staging";
import {
  addMapPermission,
  changeMapPermission,
  removeMapPermission,
  withdrawApprovalRequest,
} from "./api";

vi.mock("./api", () => ({
  addMapPermission: vi.fn(),
  changeMapPermission: vi.fn(),
  removeMapPermission: vi.fn(),
  withdrawApprovalRequest: vi.fn(),
  getApiErrorDetail: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

beforeEach(() => vi.clearAllMocks());

const rec = (partial: Partial<AppliedOpRecord>): AppliedOpRecord => partial as AppliedOpRecord;

describe("buildUndoPlan", () => {
  it("applied add → remove-added(에디터 actor의 editor 추가 역방향은 approval)", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "add", principalType: "user", principalId: "u1", role: "editor" },
          outcome: "applied",
          createdPermission: { id: 9, principal_type: "user", principal_id: "u1", role: "editor", granted_by: "me" },
        }),
      ],
      false,
    );
    expect(plan).toEqual([
      {
        action: "remove-added",
        principalType: "user",
        principalId: "u1",
        fromRole: "editor",
        forecast: "approval",
        permissionId: 9,
      },
    ]);
  });

  it("applied change → restore-role(원래 역할 복원)", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "change", permissionId: 3, toRole: "editor" },
          outcome: "applied",
          prev: { principalType: "user", principalId: "v1", role: "viewer" },
        }),
      ],
      false,
    );
    expect(plan[0]).toMatchObject({
      action: "restore-role",
      permissionId: 3,
      role: "viewer",
      fromRole: "editor",
      toRole: "viewer",
      forecast: "approval", // editor→viewer 복원은 다운그레이드
    });
  });

  it("applied remove → re-add(instant)", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "remove", permissionId: 4 },
          outcome: "applied",
          prev: { principalType: "department", principalId: "A/B", role: "viewer" },
        }),
      ],
      false,
    );
    expect(plan[0]).toMatchObject({ action: "re-add", principalId: "A/B", role: "viewer", forecast: "instant" });
  });

  it("pending → withdraw(instant), failed → 제외", () => {
    const plan = buildUndoPlan(
      [
        rec({
          op: { kind: "remove", permissionId: 5 },
          outcome: "pending",
          approvalRequest: { id: 77 } as never,
          prev: { principalType: "user", principalId: "e2", role: "editor" },
        }),
        rec({ op: { kind: "remove", permissionId: 6 }, outcome: "failed", message: "409" }),
      ],
      false,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: "withdraw", requestId: 77, forecast: "instant" });
  });
});

describe("executeUndoPlan", () => {
  it("액션별 API 호출·pending 집계·실패 비차단", async () => {
    vi.mocked(removeMapPermission).mockResolvedValue({ pending: true } as never);
    vi.mocked(changeMapPermission).mockResolvedValue({ pending: false } as never);
    vi.mocked(addMapPermission).mockRejectedValue(new Error("boom"));
    vi.mocked(withdrawApprovalRequest).mockResolvedValue(undefined as never);

    const summary = await executeUndoPlan(7, [
      { action: "remove-added", principalType: "user", principalId: "u1", forecast: "approval", permissionId: 9 },
      { action: "restore-role", principalType: "user", principalId: "v1", forecast: "instant", permissionId: 3, role: "viewer" },
      { action: "re-add", principalType: "user", principalId: "x", forecast: "instant", role: "viewer" },
      { action: "withdraw", principalType: "user", principalId: "e2", forecast: "instant", requestId: 77 },
    ]);

    expect(summary).toEqual({ done: 2, pending: 1, failed: [{ message: "boom" }] });
    expect(removeMapPermission).toHaveBeenCalledWith(7, 9);
    expect(changeMapPermission).toHaveBeenCalledWith(7, 3, "viewer");
    expect(withdrawApprovalRequest).toHaveBeenCalledWith(77);
  });
});
