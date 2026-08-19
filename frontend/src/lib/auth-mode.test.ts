import { describe, expect, it, vi, afterEach } from "vitest";

import { fetchAuthMode } from "./auth-mode";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAuthMode", () => {
  it("returns the mode reported by the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "ldap",
          keycloakIssuer: "http://kc/realms/x",
          keycloakClientId: "bpm-frontend",
        }),
      }),
    );
    const info = await fetchAuthMode();
    expect(info.mode).toBe("ldap");
    expect(info.keycloakClientId).toBe("bpm-frontend");
  });

  it("falls back to keycloak when the endpoint fails", async () => {
    // 모드를 못 읽었다고 인증을 통째로 열면 안 된다 — 가장 엄격한 모드로 떨어진다.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const info = await fetchAuthMode();
    expect(info.mode).toBe("keycloak");
  });

  it("rejects an unknown mode string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: "bogus" }) }),
    );
    const info = await fetchAuthMode();
    expect(info.mode).toBe("keycloak");
  });
});
