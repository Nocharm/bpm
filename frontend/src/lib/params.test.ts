import { describe, expect, it } from "vitest";

import {
  dropConflictingCurrency,
  dropUneditableParams,
  formatParamValue,
  getEditableParamFields,
  getInheritedParams,
  isCostFieldDisabled,
  PARAM_FIELDS,
  resolveAiParamPatch,
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

describe("dropConflictingCurrency", () => {
  it("둘 다 값이 있으면 위반 — 둘 다 키 자체를 뺀다(''가 아님, 기존 값 보존을 위해)", () => {
    const { values, conflict } = dropConflictingCurrency({ cost_krw: "1000", cost_usd: "10" });
    expect(conflict).toBe(true);
    expect("cost_krw" in values).toBe(false);
    expect("cost_usd" in values).toBe(false);
  });

  it("한쪽만 값이 있으면 위반 아님 — 그대로 통과", () => {
    const { values, conflict } = dropConflictingCurrency({ cost_krw: "1000", cost_usd: "" });
    expect(conflict).toBe(false);
    expect(values.cost_krw).toBe("1000");
    expect(values.cost_usd).toBe("");
  });

  it("둘 다 비었거나 미제공이면 위반 아님", () => {
    expect(dropConflictingCurrency({}).conflict).toBe(false);
    expect(dropConflictingCurrency({ cost_krw: "", cost_usd: "" }).conflict).toBe(false);
  });

  it("비용 외 필드는 그대로 보존한다", () => {
    const { values } = dropConflictingCurrency({
      cost_krw: "1000", cost_usd: "10", headcount: "3", fte: "0.5",
    });
    expect(values.headcount).toBe("3");
    expect(values.fte).toBe("0.5");
  });
});

// AI ops set_attr(page.tsx)가 쓰는 파라미터 부분 갱신 결정 — buildGraphFromAiProposal(csv-import.ts)과
// 같은 두 규칙(dropConflictingCurrency·dropUneditableParams)을 재사용하는지 여기서 검증한다.
describe("resolveAiParamPatch", () => {
  it("건드리지 않은 필드는 결과에 없다 (부분 갱신)", () => {
    const patch = resolveAiParamPatch("process", { headcount: "3" });
    expect(patch).toEqual({ headcount: "3" });
  });

  it("일반 노드는 유효 필드는 정규화 반영, 무효 에코(숫자아님)는 키 자체를 뺀다 — 기존 값 보존", () => {
    const patch = resolveAiParamPatch("process", {
      duration: "1.30", cost_krw: "1,000", headcount: "숫자아님", annual_count: "50", fte: "0.5",
    });
    expect(patch).toEqual({
      duration: "1.30", cost_krw: "1000", annual_count: "50", fte: "0.5",
    });
    expect("headcount" in patch).toBe(false);
  });

  it("서브프로세스는 annual_count·fte만 통과 — 나머지는 값이 있어도 드롭", () => {
    const patch = resolveAiParamPatch("subprocess", {
      duration: "9", cost_krw: "999", headcount: "9", annual_count: "1200", fte: "0.8",
    });
    expect(patch).toEqual({ annual_count: "1200", fte: "0.8" });
  });

  // finding: 무효 duration 에코("2일")가 과거엔 ""로 정규화돼 patch에 들어가 기존 값을 지웠다.
  // 이제는 키 자체가 생략되어 ops set_attr(page.tsx)가 스프레드해도 기존 duration이 살아남는다.
  it("무효 duration 에코('2일')는 키를 생략한다(기존 값을 지우지 않음)", () => {
    const patch = resolveAiParamPatch("process", { duration: "2일" });
    expect("duration" in patch).toBe(false);
  });

  it("무효 숫자 에코('abc')는 키를 생략한다", () => {
    const patch = resolveAiParamPatch("process", { cost_krw: "abc" });
    expect("cost_krw" in patch).toBe(false);
  });

  it("명시적 빈 문자열 에코는 '지움' 의도이므로 ''를 그대로 patch에 남긴다", () => {
    const patch = resolveAiParamPatch("process", { duration: "", cost_krw: "" });
    expect(patch).toEqual({ duration: "", cost_krw: "" });
  });

  // finding: 통화 배타 위반 시 과거엔 둘 다 ""가 patch에 들어가 기존 값을 지웠다.
  it("통화를 둘 다 채우면 위반 — 둘 다 키를 생략한다(기존 값을 지우지 않음)", () => {
    const patch = resolveAiParamPatch("process", { cost_krw: "1000", cost_usd: "10" });
    expect("cost_krw" in patch).toBe(false);
    expect("cost_usd" in patch).toBe(false);
  });

  it("subprocess에서 통화 충돌 필드는 위반 단계에서 이미 생략돼 SP 드롭과 이중으로 겹치지 않는다", () => {
    const sub = resolveAiParamPatch("subprocess", { cost_krw: "1000", cost_usd: "10", fte: "0.5" });
    expect(sub).toEqual({ fte: "0.5" });
  });

  it("천단위 콤마 에코('1,250,000')는 콤마를 벗겨 patch에 담는다", () => {
    const patch = resolveAiParamPatch("process", { cost_krw: "1,250,000" });
    expect(patch).toEqual({ cost_krw: "1250000" });
  });

  it("서브프로세스는 annual_count·fte만 patch에 담긴다(나머지는 값이 있어도 생략)", () => {
    const patch = resolveAiParamPatch("subprocess", {
      duration: "1.30", cost_krw: "1000", headcount: "3", annual_count: "50", fte: "0.5",
    });
    expect(Object.keys(patch).sort()).toEqual(["annual_count", "fte"]);
  });
});
