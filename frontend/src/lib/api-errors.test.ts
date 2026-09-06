import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { humanizeApiError, isCanvasRepointedError, isSlotChangePendingError } from "./api-errors";

const t = (key: string, vars?: Record<string, string | number>) =>
  `${key}${vars?.status != null ? `:${vars.status}` : ""}`;

describe("humanizeApiError", () => {
  it("maps known detail prefixes to i18n keys", () => {
    const err = new ApiError("API POST /x failed: 409", 409, JSON.stringify({ detail: "map has no approvers - assign approvers first" }));
    expect(humanizeApiError(err, t as never)).toBe("apiError.noApprovers");
  });

  it("appends HTTP status to unmapped details", () => {
    const err = new ApiError("API POST /x failed: 403", 403, JSON.stringify({ detail: "only the submitter can publish" }));
    expect(humanizeApiError(err, t as never)).toBe("only the submitter can publish (HTTP 403)");
  });

  it("falls back to generic key when body is not JSON detail", () => {
    const err = new ApiError("API GET /x failed: 502 - <html>bad gateway</html>", 502, "<html>bad gateway</html>");
    expect(humanizeApiError(err, t as never)).toBe("apiError.requestFailed:502");
  });

  it("passes through non-ApiError messages unchanged", () => {
    expect(humanizeApiError(new Error("boom"), t as never)).toBe("boom");
  });
});

describe("isCanvasRepointedError", () => {
  it("detects the checkout-holder dead end (422 + exact detail prefix)", () => {
    const err = new ApiError(
      "API PUT /versions/1/graph failed: 422",
      422,
      JSON.stringify({ detail: "contained L6 nodes cannot be removed from the canvas: [3]" }),
    );
    expect(isCanvasRepointedError(err)).toBe(true);
  });

  it("rejects the same detail on a different status", () => {
    const err = new ApiError(
      "API PUT /versions/1/graph failed: 409",
      409,
      JSON.stringify({ detail: "contained L6 nodes cannot be removed from the canvas: [3]" }),
    );
    expect(isCanvasRepointedError(err)).toBe(false);
  });

  it("rejects unrelated 422s and non-ApiError values", () => {
    const err = new ApiError("API PUT /x failed: 422", 422, JSON.stringify({ detail: "some other validation error" }));
    expect(isCanvasRepointedError(err)).toBe(false);
    expect(isCanvasRepointedError(new Error("boom"))).toBe(false);
  });
});

describe("isSlotChangePendingError", () => {
  it("detects the retry dead end (409 + exact detail prefix)", () => {
    const err = new ApiError(
      "API POST /maps/1/slot-changes failed: 409",
      409,
      JSON.stringify({ detail: "a slot change is already pending" }),
    );
    expect(isSlotChangePendingError(err)).toBe(true);
  });

  it("rejects a non-matching detail on the same status", () => {
    const err = new ApiError(
      "API POST /maps/1/slot-changes failed: 409",
      409,
      JSON.stringify({ detail: "map has no approvers - assign approvers first" }),
    );
    expect(isSlotChangePendingError(err)).toBe(false);
  });

  it("rejects non-API errors", () => {
    expect(isSlotChangePendingError(new Error("boom"))).toBe(false);
  });
});
