import { beforeEach, describe, expect, it } from "vitest";

import type { LibraryProcess } from "./api";
import { buildDeptPathIndex } from "./library-dept-options";
import {
  applyLibraryFilters,
  countActiveFilters,
  EMPTY_LIBRARY_FILTERS,
  type LibraryFilters,
  readLibraryFilters,
  writeLibraryFilters,
} from "./library-filters";

function makeRow(overrides: Partial<LibraryProcess> = {}): LibraryProcess {
  return {
    map_id: 1,
    name: "Row",
    latest_version_id: 1,
    latest_published_version_id: 1,
    refs: [],
    designated: true,
    my_role: "viewer",
    department: "Division A/Team 1",
    assignee: null,
    system: null,
    duration: null,
    touch_time: null,
    cost_krw: null,
    cost_usd: null,
    headcount: null,
    ...overrides,
  };
}

describe("applyLibraryFilters — department", () => {
  it("빈 필터는 전체 통과", () => {
    const rows = [makeRow(), makeRow({ map_id: 2, department: null })];
    expect(applyLibraryFilters(rows, EMPTY_LIBRARY_FILTERS)).toHaveLength(2);
  });

  it("전체경로 선택 - 정확히 같은 department만 매치", () => {
    const target = makeRow({ map_id: 1, department: "Division A/Team 1" });
    const other = makeRow({ map_id: 2, department: "Division B/Team 2" });
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Division A/Team 1"] };
    const result = applyLibraryFilters([target, other], filters);
    expect(result.map((r) => r.map_id)).toEqual([1]);
  });

  it("리프 선택 - 전체경로 끝 세그먼트가 일치하면 매치", () => {
    const row = makeRow({ map_id: 1, department: "Division A/Team 1" });
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Team 1"] };
    expect(applyLibraryFilters([row], filters)).toHaveLength(1);
  });

  it("리프만 같고 상위경로가 다르면 교차 매치하지 않는다", () => {
    // 선택값은 원문 비교 대상 - 다른 전체경로("Division B/Team 1")를 골랐다면
    // 리프가 같은 "Division A/Team 1" 행까지 새어 들어오면 안 된다.
    const row = makeRow({ map_id: 1, department: "Division A/Team 1" });
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Division B/Team 1"] };
    expect(applyLibraryFilters([row], filters)).toHaveLength(0);
  });

  it("department가 null인 행(미등록 마스킹)은 부서 필터가 걸리면 제외", () => {
    const row = makeRow({ map_id: 1, department: null });
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Team 1"] };
    expect(applyLibraryFilters([row], filters)).toHaveLength(0);
  });

  it("선택 경로의 하위 부서 전체가 매치(트리 선택)", () => {
    const rows = [
      makeRow({ map_id: 1, department: "Growth Center/Marketing Office/Brand Team/Brand Part 1" }),
      makeRow({ map_id: 2, department: "Growth Center/Strategy Office" }),
      makeRow({ map_id: 3, department: "Operations Center/Delivery Office" }),
      makeRow({ map_id: 4, department: null }),
    ];
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Growth Center"] };
    expect(applyLibraryFilters(rows, filters).map((r) => r.map_id)).toEqual([1, 2]);
  });

  it("문자열 접두만 같은 형제 부서는 매치하지 않는다", () => {
    const rows = [
      makeRow({ map_id: 1, department: "Growth Center 2/Team" }),
      makeRow({ map_id: 2, department: "Growth Center/Team" }),
    ];
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Growth Center"] };
    expect(applyLibraryFilters(rows, filters).map((r) => r.map_id)).toEqual([2]);
  });

  it("레거시 리프명 저장값은 리프 일치로 계속 매치", () => {
    const rows = [makeRow({ map_id: 1, department: "Growth Center/Marketing Office/Growth Team" })];
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Growth Team"] };
    expect(applyLibraryFilters(rows, filters).map((r) => r.map_id)).toEqual([1]);
  });
});

// 행의 department(sp_department)는 실무상 리프명만 담기는 일이 많다 — 조직도 인덱스로 경로를 복원해
// 상위 부서 선택이 먹히게 한다. 인덱스를 안 넘기면 예전 동작(정확/리프 일치)이 그대로여야 한다.
describe("applyLibraryFilters — department (조직도 인덱스)", () => {
  const dir = [
    { id: "Growth Center", name: "Growth Center", korean_name: "" },
    {
      id: "Growth Center/Marketing Office/Brand Team/Brand Part 1",
      name: "Brand Part 1",
      korean_name: "",
    },
    { id: "Operations Center", name: "Operations Center", korean_name: "" },
    { id: "Operations Center/QC Office/Sample Team", name: "Sample Team", korean_name: "" },
  ];
  const index = buildDeptPathIndex(dir);

  it("리프명만 저장된 행도 상위 부서 선택에 매치(다른 상위에는 안 걸림)", () => {
    const row = makeRow({ map_id: 1, department: "Brand Part 1" });
    const growth: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Growth Center"] };
    const ops: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Operations Center"] };
    expect(applyLibraryFilters([row], growth, index)).toHaveLength(1);
    expect(applyLibraryFilters([row], ops, index)).toHaveLength(0);
  });

  it("같은 리프가 두 상위에 있으면 어느 쪽 선택으로도 매치(중의성 허용)", () => {
    const ambiguous = buildDeptPathIndex([
      ...dir,
      { id: "Growth Center/Sample Team", name: "Sample Team", korean_name: "" },
    ]);
    const row = makeRow({ map_id: 1, department: "Sample Team" });
    const growth: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Growth Center"] };
    const ops: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Operations Center"] };
    expect(applyLibraryFilters([row], growth, ambiguous)).toHaveLength(1);
    expect(applyLibraryFilters([row], ops, ambiguous)).toHaveLength(1);
  });

  it("인덱스 없이는 기존 동작 — 리프명 행은 정확/리프 일치로만", () => {
    const row = makeRow({ map_id: 1, department: "Brand Part 1" });
    const parent: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Growth Center"] };
    const exact: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, departments: ["Brand Part 1"] };
    expect(applyLibraryFilters([row], parent)).toHaveLength(0);
    expect(applyLibraryFilters([row], exact)).toHaveLength(1);
  });
});

describe("applyLibraryFilters — role", () => {
  it("roles any-of - 선택된 역할 중 하나라도 일치하면 매치", () => {
    const owner = makeRow({ map_id: 1, my_role: "owner" });
    const editor = makeRow({ map_id: 2, my_role: "editor" });
    const viewer = makeRow({ map_id: 3, my_role: "viewer" });
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, roles: ["owner", "viewer"] };
    const result = applyLibraryFilters([owner, editor, viewer], filters);
    expect(result.map((r) => r.map_id)).toEqual([1, 3]);
  });

  it("my_role null(권한 없음)은 역할 필터가 걸리면 제외", () => {
    const row = makeRow({ map_id: 1, my_role: null });
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, roles: ["owner"] };
    expect(applyLibraryFilters([row], filters)).toHaveLength(0);
  });

  it("빈 roles는 필터 없음 - null도 통과", () => {
    const row = makeRow({ map_id: 1, my_role: null });
    expect(applyLibraryFilters([row], EMPTY_LIBRARY_FILTERS)).toHaveLength(1);
  });
});

describe("applyLibraryFilters — 조합", () => {
  it("부서·역할 동시 지정은 AND - 둘 다 만족해야 통과", () => {
    const match = makeRow({ map_id: 1, department: "Division A/Team 1", my_role: "owner" });
    const wrongRole = makeRow({ map_id: 2, department: "Division A/Team 1", my_role: "viewer" });
    const wrongDept = makeRow({ map_id: 3, department: "Division B/Team 2", my_role: "owner" });
    const filters: LibraryFilters = {
      departments: ["Division A/Team 1"],
      roles: ["owner"],
      showUnregistered: false,
    };
    const result = applyLibraryFilters([match, wrongRole, wrongDept], filters);
    expect(result.map((r) => r.map_id)).toEqual([1]);
  });

  it("showUnregistered는 행 필터에 관여하지 않는다(fetch 플래그)", () => {
    const row = makeRow({ map_id: 1, designated: false });
    const filters: LibraryFilters = { ...EMPTY_LIBRARY_FILTERS, showUnregistered: true };
    expect(applyLibraryFilters([row], filters)).toHaveLength(1);
  });
});

describe("countActiveFilters", () => {
  it("부서+역할+미등록 개수를 합산", () => {
    const filters: LibraryFilters = {
      departments: ["A", "B"],
      roles: ["owner"],
      showUnregistered: true,
    };
    expect(countActiveFilters(filters)).toBe(4);
  });

  it("빈 필터는 0", () => {
    expect(countActiveFilters(EMPTY_LIBRARY_FILTERS)).toBe(0);
  });
});

describe("라이브러리 필터 영속", () => {
  beforeEach(() => {
    window.localStorage.removeItem("bpm.library.filters");
  });

  it("write→read 라운드트립", () => {
    const filters: LibraryFilters = {
      departments: ["Division A/Team 1"],
      roles: ["owner", "viewer"],
      showUnregistered: true,
    };
    writeLibraryFilters(filters);
    expect(readLibraryFilters()).toEqual(filters);
  });

  it("저장값 없음 - 기본값", () => {
    expect(readLibraryFilters()).toEqual(EMPTY_LIBRARY_FILTERS);
  });

  it("손상 JSON은 기본값으로 무해하게 무시", () => {
    window.localStorage.setItem("bpm.library.filters", "{broken");
    expect(readLibraryFilters()).toEqual(EMPTY_LIBRARY_FILTERS);
  });

  it("타입 오염(잘못된 role·비배열 department)은 걸러내고 유효분만 복원", () => {
    window.localStorage.setItem(
      "bpm.library.filters",
      JSON.stringify({ departments: ["A", 5, null], roles: ["owner", "sysadmin", 3], showUnregistered: "yes" }),
    );
    expect(readLibraryFilters()).toEqual({
      departments: ["A"],
      roles: ["owner"],
      showUnregistered: false,
    });
  });
});
