// ApiError 단위 테스트 — request()가 비정상 응답에서 status를 담아 던지는지 (fetch 스텁).
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, listMaps } from "@/lib/api";

describe("ApiError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("비정상 응답은 status를 담은 ApiError로 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );
    const err = await listMaps().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toContain("403"); // 기존 메시지 형식 유지
  });
});
