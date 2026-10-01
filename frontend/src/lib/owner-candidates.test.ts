import { describe, expect, it } from "vitest";

import type { DirectoryUser, MapPermission } from "@/lib/api";
import { belongsToDepartment, buildOwnerCandidates } from "./owner-candidates";

const perm = (id: string, role: string): MapPermission => ({
  id: Math.floor(Math.random() * 1e6),
  principal_type: "user",
  principal_id: id,
  role,
  granted_by: "seed",
});
const user = (id: string, org_path: string, name = id): DirectoryUser => ({
  id,
  name,
  department: org_path.split("/").pop() ?? "",
  org_path,
});

describe("belongsToDepartment", () => {
  it("matches exact and slash-bounded prefix only", () => {
    expect(belongsToDepartment("A/B", "A/B")).toBe(true);
    expect(belongsToDepartment("A/B/C", "A/B")).toBe(true);
    expect(belongsToDepartment("A/BC", "A/B")).toBe(false);
    expect(belongsToDepartment("A/B", "")).toBe(false);
  });
});

describe("buildOwnerCandidates", () => {
  const users = [
    user("owner.u", "X/Y", "Owner"),
    user("ed", "Z", "Ed"),
    user("mem1", "A/B/C", "Mem One"),
    user("mem2", "A/B", "Mem Two"),
    user("outsider", "Q", "Out"),
  ];

  it("unions explicit editor+ grants with owning-department members, excluding self", () => {
    const perms = [perm("owner.u", "owner"), perm("ed", "editor"), perm("vw", "viewer")];
    const out = buildOwnerCandidates(perms, users, "A/B", "owner.u");
    expect(out.map((c) => [c.userId, c.source])).toEqual([
      ["ed", "explicit"],
      ["mem1", "derived"],
      ["mem2", "derived"],
    ]);
    expect(out[0].name).toBe("Ed");
    expect(out.map((c) => c.role)).toEqual(["editor", "editor", "editor"]);
  });

  it("keeps a grant holder as explicit even when they are also a department member", () => {
    const perms = [perm("mem1", "editor")];
    const out = buildOwnerCandidates(perms, users, "A/B", "owner.u");
    expect(out.filter((c) => c.userId === "mem1")).toHaveLength(1);
    expect(out.find((c) => c.userId === "mem1")?.source).toBe("explicit");
  });

  it("falls back to login id when the grant holder is not in the directory", () => {
    const out = buildOwnerCandidates([perm("ghost", "editor")], users, null, "owner.u");
    expect(out).toEqual([{ userId: "ghost", name: "ghost", user: undefined, source: "explicit", role: "editor" }]);
  });
});
