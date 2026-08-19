import { beforeEach, describe, expect, it } from "vitest";

import { clearLdapToken, getStoredLdapToken, storeLdapToken } from "./ldap-session";

const KEY = "bpm.ldapToken";
const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

beforeEach(() => {
  window.localStorage.clear();
});

describe("ldap session storage", () => {
  it("returns null before any login", () => {
    expect(getStoredLdapToken()).toBeNull();
  });

  it("round-trips a stored token", () => {
    storeLdapToken("token-abc", future());
    expect(getStoredLdapToken()).toBe("token-abc");
  });

  it("clears the token on logout", () => {
    storeLdapToken("token-abc", future());
    clearLdapToken();
    expect(getStoredLdapToken()).toBeNull();
  });

  it("treats an expired token as absent and clears the stored value", () => {
    storeLdapToken("token-abc", past());
    expect(getStoredLdapToken()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
