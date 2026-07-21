// ApiError 단위 테스트 — request()가 비정상 응답에서 status를 담아 던지는지 (fetch 스텁).
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getApiErrorDetail, listMaps } from "@/lib/api";

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

describe("getApiErrorDetail", () => {
  it("JSON 본문의 detail 문자열만 추출한다", () => {
    const body = '{"detail":"a rename request is already pending"}';
    const err = new ApiError(`API POST /maps/7/rename-requests failed: 409 — ${body}`, 409, body);
    expect(getApiErrorDetail(err)).toBe("a rename request is already pending");
  });

  it("request() 실패 경로에서도 detail을 추출한다 (fetch 스텁 왕복)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"detail":"map name already in use"}', { status: 409 })),
    );
    const err = await listMaps().catch((e: unknown) => e);
    expect(getApiErrorDetail(err)).toBe("map name already in use");
  });

  it("JSON이 아닌 본문은 전체 메시지로 폴백한다", () => {
    const err = new ApiError("API GET /maps failed: 502 — Bad Gateway", 502, "Bad Gateway");
    expect(getApiErrorDetail(err)).toBe("API GET /maps failed: 502 — Bad Gateway");
  });

  it("detail이 문자열이 아니면(FastAPI 422 배열) 전체 메시지로 폴백한다", () => {
    const body = '{"detail":[{"loc":["body","to_name"],"msg":"field required"}]}';
    const err = new ApiError(`API POST /x failed: 422 — ${body}`, 422, body);
    expect(getApiErrorDetail(err)).toBe(`API POST /x failed: 422 — ${body}`);
  });

  it("본문 없는 ApiError·일반 Error·비Error 값은 각각 메시지/String으로 폴백한다", () => {
    expect(getApiErrorDetail(new ApiError("API DELETE /x failed: 500", 500))).toBe(
      "API DELETE /x failed: 500",
    );
    expect(getApiErrorDetail(new Error("boom"))).toBe("boom");
    expect(getApiErrorDetail("weird")).toBe("weird");
  });
});
