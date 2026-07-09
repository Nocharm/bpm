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
});

describe("parseKoreanNamesJson", () => {
  it("parses object map, trims values, drops blanks", () => {
    const res = parseKoreanNamesJson('{"a.b": " 홍길동 ", "c.d": "  ", "e.f": "김철수"}');
    expect(res).toEqual({ entries: { "a.b": "홍길동", "e.f": "김철수" } });
  });

  it("rejects invalid JSON", () => {
    expect(parseKoreanNamesJson("{oops")).toHaveProperty("error");
  });

  it("rejects arrays and non-objects", () => {
    expect(parseKoreanNamesJson('["a.b"]')).toHaveProperty("error");
    expect(parseKoreanNamesJson('"str"')).toHaveProperty("error");
    expect(parseKoreanNamesJson("null")).toHaveProperty("error");
  });

  it("rejects non-string values with the offending key", () => {
    const res = parseKoreanNamesJson('{"a.b": 3}');
    expect("error" in res && res.error).toContain("a.b");
  });
});

describe("classifyKoreanNames", () => {
  it("splits fresh / conflicts / unknown", () => {
    const rows = [row("new.user", ""), row("has.name", "기존이름")];
    const res = classifyKoreanNames(
      { "new.user": "신규", "has.name": "교체", "no.user": "유령" },
      rows,
    );
    expect(res.fresh).toEqual({ "new.user": "신규" });
    expect(res.conflicts).toEqual([
      { loginId: "has.name", current: "기존이름", next: "교체" },
    ]);
    expect(res.unknownIds).toEqual(["no.user"]);
    expect(res.entries).toEqual({ "new.user": "신규", "has.name": "교체", "no.user": "유령" });
  });
});

describe("buildMissingIdsJson", () => {
  it("lists only ids without korean_name as a JSON array", () => {
    const rows = [row("miss.one", ""), row("has.one", "홍길동"), row("miss.two", "")];
    expect(JSON.parse(buildMissingIdsJson(rows))).toEqual(["miss.one", "miss.two"]);
  });
});
