import { describe, expect, it } from "vitest";

import {
  dropUneditableParams,
  formatParamValue,
  getEditableParamFields,
  getInheritedParams,
  isCostFieldDisabled,
  PARAM_FIELDS,
  SP_PARAM_FIELDS,
} from "./params";

describe("PARAM_FIELDS", () => {
  it("표시 순서는 소요시간 → 비용(원/달러) → 인원 → 연간 건수 → FTE", () => {
    expect([...PARAM_FIELDS]).toEqual([
      "duration",
      "cost_krw",
      "cost_usd",
      "headcount",
      "annual_count",
      "fte",
    ]);
  });
});

describe("getEditableParamFields", () => {
  it("일반 노드는 6필드 전부 편집 가능", () => {
    expect([...getEditableParamFields("process")]).toEqual([...PARAM_FIELDS]);
    expect([...getEditableParamFields("decision")]).toEqual([...PARAM_FIELDS]);
  });

  it("서브프로세스 노드는 연간 건수·FTE만 편집 가능 — 나머지는 링크 맵 지정값", () => {
    expect([...getEditableParamFields("subprocess")]).toEqual(["annual_count", "fte"]);
  });

  it("start/end는 파라미터 없음", () => {
    expect(getEditableParamFields("start")).toHaveLength(0);
    expect(getEditableParamFields("end")).toHaveLength(0);
  });

  it("SP 지정 파라미터는 3종(비용 2필드 포함)", () => {
    expect([...SP_PARAM_FIELDS]).toEqual(["duration", "cost_krw", "cost_usd", "headcount"]);
  });
});

describe("isCostFieldDisabled", () => {
  it("반대쪽 비용에 값이 있으면 비활성", () => {
    expect(isCostFieldDisabled("cost_krw", "", "10")).toBe(true);
    expect(isCostFieldDisabled("cost_usd", "10", "")).toBe(true);
  });

  it("양쪽 다 비었거나 자기 쪽만 값이 있으면 활성", () => {
    expect(isCostFieldDisabled("cost_krw", "", "")).toBe(false);
    expect(isCostFieldDisabled("cost_krw", "10", "")).toBe(false);
  });

  it("비용 아닌 필드는 항상 활성", () => {
    expect(isCostFieldDisabled("duration", "10", "10")).toBe(false);
  });
});

describe("formatParamValue", () => {
  it("duration은 1h30m 표시형", () => {
    expect(formatParamValue("duration", "1.30")).toBe("1h30m");
    expect(formatParamValue("duration", "2")).toBe("2h");
  });

  it("비용은 통화기호 + 천단위 콤마", () => {
    expect(formatParamValue("cost_krw", "1250000")).toBe("₩1,250,000");
    expect(formatParamValue("cost_usd", "1200.5")).toBe("$1,200.5");
  });

  it("나머지 필드는 원문 숫자", () => {
    expect(formatParamValue("headcount", "3")).toBe("3");
    expect(formatParamValue("annual_count", "120")).toBe("120");
    expect(formatParamValue("fte", "0.5")).toBe("0.5");
  });

  it("빈값·무효값·null은 빈 문자열 — 통화기호만 남지 않음", () => {
    expect(formatParamValue("cost_krw", "")).toBe("");
    expect(formatParamValue("cost_krw", "약 100만원")).toBe("");
    expect(formatParamValue("duration", "half a day")).toBe("");
    expect(formatParamValue("headcount", null)).toBe("");
    expect(formatParamValue("fte", undefined)).toBe("");
  });
});

describe("getInheritedParams", () => {
  it("지정된 링크 맵의 회당 4필드를 그대로 상속", () => {
    expect(
      getInheritedParams({
        designated: true,
        duration: "1.30",
        cost_krw: "1000",
        cost_usd: null,
        headcount: "2",
      }),
    ).toEqual({ duration: "1.30", cost_krw: "1000", cost_usd: "", headcount: "2" });
  });

  it("미지정·참조 없음은 전부 빈 값 — 표시는 호출부가 —로", () => {
    const empty = { duration: "", cost_krw: "", cost_usd: "", headcount: "" };
    expect(
      getInheritedParams({
        designated: false,
        duration: "9",
        cost_krw: "9",
        cost_usd: "9",
        headcount: "9",
      }),
    ).toEqual(empty);
    expect(getInheritedParams(undefined)).toEqual(empty);
    expect(getInheritedParams(null)).toEqual(empty);
  });

  it("키 집합은 SP_PARAM_FIELDS와 일치", () => {
    expect(Object.keys(getInheritedParams(null)).sort()).toEqual([...SP_PARAM_FIELDS].sort());
  });
});

describe("dropUneditableParams", () => {
  const full = { duration: "1", cost_krw: "1000", cost_usd: "", headcount: "2", annual_count: "5", fte: "0.5" };

  it("일반 노드는 아무것도 드롭하지 않는다", () => {
    const { allowed, droppedFields } = dropUneditableParams("process", full);
    expect(droppedFields).toEqual([]);
    expect(allowed).toEqual(full);
  });

  it("서브프로세스는 annual_count·fte만 통과시키고 값 있는 나머지는 드롭 보고", () => {
    const { allowed, droppedFields } = dropUneditableParams("subprocess", full);
    expect(allowed).toEqual({ annual_count: "5", fte: "0.5" });
    expect(droppedFields).toEqual(["duration", "cost_krw", "headcount"]);
  });

  it("서브프로세스라도 원래 빈 값이던 필드는 드롭 보고하지 않는다", () => {
    const { droppedFields } = dropUneditableParams("subprocess", {
      duration: "", cost_krw: "", cost_usd: "", annual_count: "5", fte: "0.5",
    });
    expect(droppedFields).toEqual([]);
  });

  it("candidate에 없는 키는 결과에도 없다", () => {
    const { allowed, droppedFields } = dropUneditableParams("subprocess", { headcount: "3" });
    expect(allowed).toEqual({});
    expect(droppedFields).toEqual(["headcount"]);
  });
});
