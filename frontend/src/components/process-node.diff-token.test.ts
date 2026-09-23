// diff 변경 톤은 전용 토큰(--color-diff-changed)만 쓴다 — 경고용 --color-changed와 섞이면 분기 노드 앰버와 다시 겹친다 (spec 2026-09-23 §1 C2).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("diff changed token", () => {
  it("globals.css defines --color-diff-changed inside @theme", () => {
    const css = read("../app/globals.css");
    expect(css).toMatch(/--color-diff-changed:\s*#0f766e;/);
  });
  it("ProcessNode diff maps use the diff token, not the warning token", () => {
    const src = read("./process-node.tsx");
    expect(src).toContain('changed: "var(--color-diff-changed)"');
    expect(src).toContain('changed: "bg-diff-changed"');
    expect(src).not.toContain('changed: "var(--color-changed)"');
  });
  it("compare page keeps the warning token only for the pending version dot", () => {
    const src = read("../app/maps/[mapId]/compare/page.tsx");
    const warningUses = src.match(/(?<![a-z-])(?:bg|text|border)-changed(?![a-z-])|var\(--color-changed\)/g) ?? [];
    // STATUS_DOT.pending 한 곳만 허용
    expect(warningUses).toEqual(["bg-changed"]);
  });
});
