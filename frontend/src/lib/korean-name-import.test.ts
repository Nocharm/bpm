import { describe, expect, it } from "vitest";

import type { EmployeeRow } from "./api";
import {
  buildMissingIdsJson,
  classifyKoreanNames,
  parseKoreanNamesJson,
} from "./korean-name-import";

const row = (login_id: string, korean_name: string): EmployeeRow => ({
  login_id,
  name: "",
  title: "",
  source: "ad",
  role: "user",
  department: "",
  korean_name,
  korean_dept: "",
});

describe("parseKoreanNamesJson — object map", () => {
  it("parses object map, trims values, drops blanks", () => {
    const res = parseKoreanNamesJson('{"a.b": " 홍길동 ", "c.d": "  ", "e.f": "김철수"}');
    expect(res).toEqual({
      entries: {
        "a.b": { name: "홍길동", dept: "" },
        "e.f": { name: "김철수", dept: "" },
      },
    });
  });

  it("rejects invalid JSON", () => {
    expect(parseKoreanNamesJson("{oops")).toHaveProperty("error");
  });

  it("rejects non-object roots", () => {
    expect(parseKoreanNamesJson('"str"')).toHaveProperty("error");
    expect(parseKoreanNamesJson("null")).toHaveProperty("error");
  });

  it("rejects non-string values with the offending key", () => {
    const res = parseKoreanNamesJson('{"a.b": 3}');
    expect("error" in res && res.error).toContain("a.b");
  });
});

describe("parseKoreanNamesJson — lookup response array", () => {
  it("parses found items with name/dept trimmed, ignores extra fields", () => {
    const res = parseKoreanNamesJson(
      JSON.stringify([
        {
          userId: "h_jin.jang",
          status: "found",
          name: " 장현진 ",
          enName: "Hyeonjin Jang",
          dept: " AI Operations그룹 ",
          email: "x@y.z",
        },
        { userId: "no.dept", status: "found", name: "김철수" },
      ]),
    );
    expect(res).toEqual({
      entries: {
        "h_jin.jang": { name: "장현진", dept: "AI Operations그룹" },
        "no.dept": { name: "김철수", dept: "" },
      },
    });
  });

  it("skips not_found and error statuses", () => {
    const res = parseKoreanNamesJson(
      JSON.stringify([
        { userId: "a.b", status: "not_found" },
        { userId: "c.d", status: "error", name: "무시" },
        { userId: "e.f", status: "found", name: "홍길동" },
      ]),
    );
    expect(res).toEqual({ entries: { "e.f": { name: "홍길동", dept: "" } } });
  });

  it("skips found items with blank names", () => {
    const res = parseKoreanNamesJson(
      JSON.stringify([{ userId: "a.b", status: "found", name: "  ", dept: "그룹" }]),
    );
    expect(res).toEqual({ entries: {} });
  });

  it("rejects malformed items with the offending position", () => {
    expect(parseKoreanNamesJson('["str"]')).toHaveProperty("error");
    const noId = parseKoreanNamesJson(JSON.stringify([{ status: "found", name: "홍길동" }]));
    expect("error" in noId && noId.error).toContain("0");
    const badName = parseKoreanNamesJson(
      JSON.stringify([{ userId: "a.b", status: "found", name: 3 }]),
    );
    expect("error" in badName && badName.error).toContain("a.b");
  });
});

describe("classifyKoreanNames", () => {
  it("splits fresh / conflicts / unknown", () => {
    const rows = [row("new.user", ""), row("has.name", "기존이름")];
    const res = classifyKoreanNames(
      {
        "new.user": { name: "신규", dept: "그룹A" },
        "has.name": { name: "교체", dept: "" },
        "no.user": { name: "유령", dept: "" },
      },
      rows,
    );
    expect(res.fresh).toEqual({ "new.user": { name: "신규", dept: "그룹A" } });
    expect(res.conflicts).toEqual([
      { loginId: "has.name", current: "기존이름", next: "교체" },
    ]);
    expect(res.unknownIds).toEqual(["no.user"]);
    expect(Object.keys(res.entries)).toHaveLength(3);
  });
});

describe("buildMissingIdsJson", () => {
  it("lists only ids without korean_name as a JSON array", () => {
    const rows = [row("miss.one", ""), row("has.one", "홍길동"), row("miss.two", "")];
    expect(JSON.parse(buildMissingIdsJson(rows))).toEqual(["miss.one", "miss.two"]);
  });
});
