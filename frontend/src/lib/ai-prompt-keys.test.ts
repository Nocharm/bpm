// AI 프롬프트 key 미러 — 백엔드 PROMPT_KEYS와 집합·순서, 라벨·i18n 완비를 고정한다.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_PROMPT_KEYS, AI_PROMPT_LABELS, getAiPromptLabel } from "@/lib/ai-prompt-keys";
import { messages } from "@/lib/i18n-messages";

// 진실원: backend/app/prompt_registry.py의 PROMPT_KEYS 튜플(UI 노출 순서 그대로)
function readBackendPromptKeys(): string[] {
  const source = readFileSync(
    resolve(__dirname, "../../../backend/app/prompt_registry.py"),
    "utf-8",
  );
  const tuple = /PROMPT_KEYS[^=]*=\s*\(([\s\S]*?)\n\)/.exec(source)?.[1] ?? "";
  return [...tuple.matchAll(/^\s*"([a-z0-9_]+)",/gm)].map((match) => match[1]);
}

describe("AI_PROMPT_KEYS", () => {
  it("mirrors the backend PROMPT_KEYS in the same order", () => {
    const backendKeys = readBackendPromptKeys();

    expect(backendKeys).toHaveLength(13);
    expect([...AI_PROMPT_KEYS]).toEqual(backendKeys);
  });

  it("gives every key a label whose name and hint exist in both languages", () => {
    expect(Object.keys(AI_PROMPT_LABELS)).toEqual([...AI_PROMPT_KEYS]);
    for (const key of AI_PROMPT_KEYS) {
      const { name, hint } = AI_PROMPT_LABELS[key];
      for (const lang of ["en", "ko"] as const) {
        expect(messages[lang][name], `${lang} ${name}`).toBeTruthy();
        expect(messages[lang][hint], `${lang} ${hint}`).toBeTruthy();
      }
    }
  });

  it("keeps em dashes out of the label copy", () => {
    for (const key of AI_PROMPT_KEYS) {
      const { name, hint } = AI_PROMPT_LABELS[key];
      for (const lang of ["en", "ko"] as const) {
        expect(messages[lang][name]).not.toContain("—");
        expect(messages[lang][hint]).not.toContain("—");
      }
    }
  });
});

describe("getAiPromptLabel", () => {
  it("returns undefined for a key the frontend does not know yet", () => {
    expect(getAiPromptLabel("l5_plan_contract")?.name).toBe("aiPrompts.name.l5_plan_contract");
    expect(getAiPromptLabel("future_contract")).toBeUndefined();
  });
});
