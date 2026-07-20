import { beforeEach, describe, expect, it, vi } from "vitest";

import { isSoleSelfApprover, runSelfPublishChain } from "./self-publish";
import { approveVersion, publishVersion, submitVersion } from "./api";

// 외부 API만 모킹 — 체인 순서·전파는 실코드 경로로 검증.
vi.mock("./api", () => ({
  submitVersion: vi.fn(),
  approveVersion: vi.fn(),
  publishVersion: vi.fn(),
}));

const submitMock = vi.mocked(submitVersion);
const approveMock = vi.mocked(approveVersion);
const publishMock = vi.mocked(publishVersion);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isSoleSelfApprover", () => {
  it("승인자가 정확히 본인 1명이면 true", () => {
    expect(isSoleSelfApprover(["me"], "me")).toBe(true);
  });

  it("승인자가 없거나 타인이 섞이면 false", () => {
    expect(isSoleSelfApprover([], "me")).toBe(false);
    expect(isSoleSelfApprover(["other"], "me")).toBe(false);
    expect(isSoleSelfApprover(["me", "other"], "me")).toBe(false);
  });
});

describe("runSelfPublishChain", () => {
  it("submit→approve→publish 순서로 호출하고 publish 결과를 반환", async () => {
    const calls: string[] = [];
    const published = { id: 7, status: "published" };
    submitMock.mockImplementation(async () => {
      calls.push("submit");
      return { id: 7, status: "pending" } as never;
    });
    approveMock.mockImplementation(async () => {
      calls.push("approve");
      return { id: 7, status: "approved" } as never;
    });
    publishMock.mockImplementation(async () => {
      calls.push("publish");
      return published as never;
    });

    const result = await runSelfPublishChain(7);

    expect(calls).toEqual(["submit", "approve", "publish"]);
    expect(submitMock).toHaveBeenCalledWith(7);
    expect(approveMock).toHaveBeenCalledWith(7);
    expect(publishMock).toHaveBeenCalledWith(7);
    expect(result).toBe(published);
  });

  it("중간 단계 실패 시 이후 단계를 호출하지 않고 에러 전파", async () => {
    submitMock.mockResolvedValue({ id: 7, status: "pending" } as never);
    approveMock.mockRejectedValue(new Error("409 already approved"));

    await expect(runSelfPublishChain(7)).rejects.toThrow("409 already approved");
    expect(publishMock).not.toHaveBeenCalled();
  });
});
