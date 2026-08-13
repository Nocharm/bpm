import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyStagedOps, removeStagedOp, upsertStagedOp, type StagedOp } from "./permission-staging";
import { addMapPermission, changeMapPermission, removeMapPermission } from "./api";

// 외부 API만 모킹 — 스택 적립/실행 로직은 실코드 경로로 검증 (self-publish.test.ts 스타일 참고).
vi.mock("./api", () => ({
  addMapPermission: vi.fn(),
  changeMapPermission: vi.fn(),
  removeMapPermission: vi.fn(),
  getApiErrorDetail: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const addMock = vi.mocked(addMapPermission);
const changeMock = vi.mocked(changeMapPermission);
const removeMock = vi.mocked(removeMapPermission);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertStagedOp", () => {
  it("같은 permissionId의 change를 2회 적립하면 최신 값 1개만 남는다", () => {
    const ops: StagedOp[] = [];
    const first = upsertStagedOp(ops, { kind: "change", permissionId: 5, toRole: "editor" });
    const second = upsertStagedOp(first, { kind: "change", permissionId: 5, toRole: "viewer" });

    expect(second).toEqual([{ kind: "change", permissionId: 5, toRole: "viewer" }]);
  });

  it("다른 대상의 op는 별개로 누적된다", () => {
    const ops: StagedOp[] = [{ kind: "add", principalType: "user", principalId: "u1", role: "viewer" }];
    const next = upsertStagedOp(ops, { kind: "remove", permissionId: 9 });

    expect(next).toHaveLength(2);
  });

  it("같은 permissionId에 change 후 remove — remove만 남는다(낡은 change가 얹혀가지 않음)", () => {
    const ops: StagedOp[] = [];
    const first = upsertStagedOp(ops, { kind: "change", permissionId: 5, toRole: "editor" });
    const second = upsertStagedOp(first, { kind: "remove", permissionId: 5 });

    expect(second).toEqual([{ kind: "remove", permissionId: 5 }]);
  });

  it("같은 permissionId에 remove 후 change — change만 남는다", () => {
    const ops: StagedOp[] = [];
    const first = upsertStagedOp(ops, { kind: "remove", permissionId: 5 });
    const second = upsertStagedOp(first, { kind: "change", permissionId: 5, toRole: "viewer" });

    expect(second).toEqual([{ kind: "change", permissionId: 5, toRole: "viewer" }]);
  });
});

describe("removeStagedOp", () => {
  it("행별 개별 취소 — 대상 op만 스택에서 제거", () => {
    const ops: StagedOp[] = [
      { kind: "add", principalType: "user", principalId: "u1", role: "viewer" },
      { kind: "remove", permissionId: 9 },
    ];
    const next = removeStagedOp(ops, { kind: "remove", permissionId: 9 });

    expect(next).toEqual([{ kind: "add", principalType: "user", principalId: "u1", role: "viewer" }]);
  });

  it("add 취소 — 아직 서버에 없는 행이라 스택에서 걷어내는 것만으로 취소된다", () => {
    const ops: StagedOp[] = [
      { kind: "add", principalType: "user", principalId: "u1", role: "viewer" },
      { kind: "remove", permissionId: 9 },
    ];
    const next = removeStagedOp(ops, { kind: "add", principalType: "user", principalId: "u1", role: "viewer" });

    expect(next).toEqual([{ kind: "remove", permissionId: 9 }]);
  });
});

describe("applyStagedOps", () => {
  it("applied/pending/failed을 집계하고 한 op의 실패가 나머지를 막지 않는다", async () => {
    addMock.mockResolvedValue({ id: 1 } as never);
    changeMock.mockResolvedValue({ pending: true } as never);
    removeMock.mockRejectedValue(new Error("grant already exists"));

    const ops: StagedOp[] = [
      { kind: "add", principalType: "user", principalId: "u1", role: "viewer" },
      { kind: "change", permissionId: 2, toRole: "editor" },
      { kind: "remove", permissionId: 3 },
    ];

    const result = await applyStagedOps(42, ops);

    expect(result.applied).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.failed).toEqual([{ op: ops[2], message: "grant already exists" }]);
    expect(addMock).toHaveBeenCalledWith(42, "user", "u1", "viewer");
    expect(changeMock).toHaveBeenCalledWith(42, 2, "editor");
    expect(removeMock).toHaveBeenCalledWith(42, 3);
  });
});
