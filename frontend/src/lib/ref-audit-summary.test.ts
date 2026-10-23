// 고아 참조 빨간 점 요약 구독 — 마운트 즉시 조회·창 이벤트 재조회·실패 0·해제 후 무반응 (design 2026-10-23 §9)
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRefAuditSummary = vi.fn<() => Promise<{ actionable: number }>>();
vi.mock("@/lib/api", () => ({ getRefAuditSummary: () => getRefAuditSummary() }));

import {
  REF_AUDIT_CHANGED_EVENT,
  notifyRefAuditChanged,
  subscribeRefAuditSummary,
  useRefAuditSummary,
} from "@/lib/ref-audit-summary";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("subscribeRefAuditSummary", () => {
  beforeEach(() => {
    getRefAuditSummary.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches immediately and reports the actionable count", async () => {
    getRefAuditSummary.mockResolvedValue({ actionable: 3 });
    const onValue = vi.fn();
    const stop = subscribeRefAuditSummary(onValue);
    await flush();
    expect(getRefAuditSummary).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(3);
    stop();
  });

  it("refetches when the changed event fires (apply finished)", async () => {
    getRefAuditSummary.mockResolvedValueOnce({ actionable: 2 }).mockResolvedValueOnce({ actionable: 0 });
    const onValue = vi.fn();
    const stop = subscribeRefAuditSummary(onValue);
    await flush();
    notifyRefAuditChanged();
    await flush();
    expect(getRefAuditSummary).toHaveBeenCalledTimes(2);
    expect(onValue.mock.calls.map((c) => c[0])).toEqual([2, 0]);
    stop();
  });

  it("reports 0 and warns once per failed fetch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getRefAuditSummary.mockRejectedValue(new Error("boom"));
    const onValue = vi.fn();
    const stop = subscribeRefAuditSummary(onValue);
    await flush();
    expect(onValue).toHaveBeenCalledWith(0);
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores events and in-flight results after unsubscribe", async () => {
    let resolveFirst: (v: { actionable: number }) => void = () => {};
    getRefAuditSummary.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    const onValue = vi.fn();
    const stop = subscribeRefAuditSummary(onValue);
    stop();
    resolveFirst({ actionable: 5 });
    await flush();
    window.dispatchEvent(new Event(REF_AUDIT_CHANGED_EVENT));
    await flush();
    expect(onValue).not.toHaveBeenCalled();
    expect(getRefAuditSummary).toHaveBeenCalledTimes(1);
  });

  it("applies only the latest response when fetches resolve out of order", async () => {
    const resolvers: ((v: { actionable: number }) => void)[] = [];
    getRefAuditSummary.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    );
    const onValue = vi.fn();
    const stop = subscribeRefAuditSummary(onValue);
    notifyRefAuditChanged();
    resolvers[1]({ actionable: 0 });
    await flush();
    resolvers[0]({ actionable: 4 });
    await flush();
    expect(onValue.mock.calls.map((c) => c[0])).toEqual([0]);
    stop();
  });
});

describe("useRefAuditSummary", () => {
  beforeEach(() => {
    getRefAuditSummary.mockReset();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("does not flash the previous user's count when re-enabled after a logout", async () => {
    getRefAuditSummary.mockResolvedValue({ actionable: 4 });
    const rendered: number[] = [];
    function Probe({ enabled }: { enabled: boolean }) {
      rendered.push(useRefAuditSummary(enabled));
      return null;
    }
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(createElement(Probe, { enabled: true }));
      await flush();
    });
    expect(rendered.at(-1)).toBe(4);

    await act(async () => {
      root.render(createElement(Probe, { enabled: false }));
    });
    expect(rendered.at(-1)).toBe(0);

    // 다음 사용자의 첫 응답이 오기 전 렌더 - 이전 값 4가 비치면 안 된다
    getRefAuditSummary.mockReturnValue(new Promise(() => {}));
    rendered.length = 0;
    await act(async () => {
      root.render(createElement(Probe, { enabled: true }));
    });
    expect(rendered).not.toContain(4);
    expect(rendered.at(-1)).toBe(0);

    await act(async () => {
      root.unmount();
    });
  });
});
