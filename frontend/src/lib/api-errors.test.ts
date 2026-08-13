// humanizeApiError 단위 테스트 — 알려진 detail 히트/미스/non-ApiError 폴백.
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { messages } from "@/lib/i18n-messages";

// 실 t()와 동일 계약(key → messages.en[key]) — LangProvider 없이 순수 함수로 검증.
const t = (key: keyof typeof messages.en) => messages.en[key];

describe("humanizeApiError", () => {
  it("알려진 detail 전방일치 히트는 i18n 문구로 치환한다", () => {
    const body = '{"detail":"a visibility change request is already pending"}';
    const err = new ApiError(`API POST /x failed: 409 — ${body}`, 409, body);
    expect(humanizeApiError(err, t)).toBe(messages.en["apiError.visibilityPending"]);
  });

  it("접미사가 붙은 detail도 전방일치로 히트한다", () => {
    const body = '{"detail":"map has no approvers — assign approvers first"}';
    const err = new ApiError(`API POST /x failed: 409 — ${body}`, 409, body);
    expect(humanizeApiError(err, t)).toBe(messages.en["apiError.noApprovers"]);
  });

  it("알려지지 않은 detail은 원문을 그대로 반환한다 (미스)", () => {
    const body = '{"detail":"some unmapped server detail"}';
    const err = new ApiError(`API POST /x failed: 409 — ${body}`, 409, body);
    expect(humanizeApiError(err, t)).toBe("some unmapped server detail");
  });

  it("non-ApiError 값은 getApiErrorDetail 폴백을 그대로 반환한다", () => {
    expect(humanizeApiError(new Error("boom"), t)).toBe("boom");
    expect(humanizeApiError("weird", t)).toBe("weird");
  });
});
