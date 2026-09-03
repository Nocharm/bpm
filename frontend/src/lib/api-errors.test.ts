import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { humanizeApiError } from "./api-errors";

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
