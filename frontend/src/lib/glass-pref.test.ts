import { afterEach, describe, expect, it } from "vitest";

import { GLASS_INIT_SCRIPT, isGlassEnabled, setGlassEnabled } from "./glass-pref";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.glass;
});

describe("glass preference", () => {
  it("defaults to on with no attribute", () => {
    expect(isGlassEnabled()).toBe(true);
    expect(document.documentElement.dataset.glass).toBeUndefined();
  });

  it("turning off persists and marks the root", () => {
    setGlassEnabled(false);

    expect(isGlassEnabled()).toBe(false);
    expect(document.documentElement.dataset.glass).toBe("off");
  });

  it("turning back on clears the key and the attribute", () => {
    setGlassEnabled(false);

    setGlassEnabled(true);

    expect(window.localStorage.getItem("bpm.glass")).toBeNull();
    expect(document.documentElement.dataset.glass).toBeUndefined();
  });

  it("init script applies a stored off before hydration", () => {
    window.localStorage.setItem("bpm.glass", "off");

    new Function(GLASS_INIT_SCRIPT)();

    expect(document.documentElement.dataset.glass).toBe("off");
  });
});
