// auth-return 단위 테스트 — vitest node 환경이라 window/sessionStorage를 스텁한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAutoLoginSkip,
  consumeAutoLoginSkip,
  consumeReturnTo,
  isSafeReturnPath,
  peekReturnTo,
  saveReturnTo,
  setAutoLoginSkip,
} from "@/lib/auth-return";

function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

let storage: Storage;

beforeEach(() => {
  storage = makeFakeStorage();
  vi.stubGlobal("window", { sessionStorage: storage });
});

describe("isSafeReturnPath", () => {
  it("허용: 내부 경로(쿼리 포함)", () => {
    expect(isSafeReturnPath("/maps/12")).toBe(true);
    expect(isSafeReturnPath("/maps/12?v=3")).toBe(true);
  });
  it("거부: 외부/프로토콜/로그인/루트", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("/login")).toBe(false);
    expect(isSafeReturnPath("/login?next=1")).toBe(false);
    expect(isSafeReturnPath("/")).toBe(false);
  });
});

describe("returnTo save/peek/consume", () => {
  it("save 후 consume은 값을 돌려주고 제거한다", () => {
    saveReturnTo("/maps/12?v=3");
    expect(peekReturnTo()).toBe("/maps/12?v=3"); // peek은 제거하지 않음
    expect(consumeReturnTo()).toBe("/maps/12?v=3");
    expect(consumeReturnTo()).toBeNull();
  });
  it("unsafe 경로는 저장하지 않는다", () => {
    saveReturnTo("//evil.com");
    expect(consumeReturnTo()).toBeNull();
  });
  it("저장소가 오염돼도 consume은 unsafe 값을 돌려주지 않는다", () => {
    storage.setItem("bpm.returnTo", "https://evil.com");
    expect(consumeReturnTo()).toBeNull();
    expect(storage.getItem("bpm.returnTo")).toBeNull(); // 오염 값도 제거
  });
});

describe("autoLoginSkip flag", () => {
  it("consume은 1회만 true — 이후 재방문은 자동 로그인 재개", () => {
    expect(consumeAutoLoginSkip()).toBe(false);
    setAutoLoginSkip();
    expect(consumeAutoLoginSkip()).toBe(true);
    expect(consumeAutoLoginSkip()).toBe(false); // 소비됨
  });
  it("clear는 대기 중인 억제를 취소한다", () => {
    setAutoLoginSkip();
    clearAutoLoginSkip();
    expect(consumeAutoLoginSkip()).toBe(false);
  });
});

describe("window 없음(SSR)·storage 접근 불가", () => {
  it("window가 없으면 조용히 no-op", () => {
    vi.stubGlobal("window", undefined);
    expect(() => saveReturnTo("/maps/1")).not.toThrow();
    expect(consumeReturnTo()).toBeNull();
    expect(consumeAutoLoginSkip()).toBe(false);
  });
});
