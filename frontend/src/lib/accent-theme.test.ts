import { afterEach, describe, expect, it } from "vitest";

import {
  ACCENT_INIT_SCRIPT,
  ACCENT_THEMES,
  DEFAULT_ACCENT,
  getAccentHex,
  getAccentThemeId,
  setAccentTheme,
} from "./accent-theme";

// WCAG 2 상대 휘도·대비비
function getLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrast(a: string, b: string): number {
  const [hi, lo] = [getLuminance(a), getLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// globals.css --color-accent-tint와 같은 공식(srgb, 악센트 11% + 흰색)
function mixWithWhite(hex: string, ratio: number): string {
  const channels = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * ratio + 255 * (1 - ratio)));
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--color-accent");
});

describe("accent presets", () => {
  it.each(ACCENT_THEMES)("$id keeps 4.5:1 for white text and accent text on the selection tint", ({ hex }) => {
    expect(getContrast(hex, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(getContrast(hex, mixWithWhite(hex, 0.11))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("accent preference", () => {
  it("defaults to violet without touching the root", () => {
    expect(getAccentThemeId()).toBe(DEFAULT_ACCENT);
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("");
  });

  it("choosing a preset persists and overrides the accent variable", () => {
    setAccentTheme("ocean");

    expect(getAccentThemeId()).toBe("ocean");
    expect(getAccentHex()).toBe("#0a6a94");
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#0a6a94");
  });

  it("choosing the default clears the stored value and the override", () => {
    setAccentTheme("plum");

    setAccentTheme(DEFAULT_ACCENT);

    expect(window.localStorage.getItem("bpm.accent")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("");
  });

  it("ignores an unknown stored value", () => {
    window.localStorage.setItem("bpm.accent", "constructor");

    new Function(ACCENT_INIT_SCRIPT)();

    expect(getAccentThemeId()).toBe(DEFAULT_ACCENT);
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("");
  });

  it("init script applies a stored preset before hydration", () => {
    window.localStorage.setItem("bpm.accent", "plum");

    new Function(ACCENT_INIT_SCRIPT)();

    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#9b2fae");
  });
});
