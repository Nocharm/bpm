// 앱 안 이동 가드 — 링크 판정·가로채기·버튼 이동 감싸기 (리뷰 2026-10-19 W-1)
import { afterEach, describe, expect, it, vi } from "vitest";

import { findInAppLink, runGuardedNavigation, setNavigationGuard } from "@/lib/navigation-guard";

function mountLink(attrs: Record<string, string>): HTMLAnchorElement {
  const anchor = document.createElement("a");
  for (const [key, value] of Object.entries(attrs)) anchor.setAttribute(key, value);
  anchor.textContent = "go";
  document.body.appendChild(anchor);
  return anchor;
}

function clickOn(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("findInAppLink", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function hrefFor(attrs: Record<string, string>, init: MouseEventInit = {}): string | null {
    const anchor = mountLink(attrs);
    let result: string | null = "unset";
    anchor.addEventListener("click", (event) => {
      result = findInAppLink(event, window.location)?.href ?? null;
      event.preventDefault();
    });
    clickOn(anchor, init);
    return result;
  }

  it("returns the in-app path for a plain click on another screen", () => {
    expect(hrefFor({ href: "/maps/7/settings?tab=general#top" })).toBe("/maps/7/settings?tab=general#top");
  });

  it("finds the anchor from a nested child (icon inside a link)", () => {
    const anchor = mountLink({ href: "/inbox" });
    const icon = document.createElement("span");
    anchor.appendChild(icon);
    let result: string | null = null;
    window.addEventListener("click", (event) => { result = findInAppLink(event, window.location)?.href ?? null; event.preventDefault(); }, { once: true });
    clickOn(icon);
    expect(result).toBe("/inbox");
  });

  it("lets new-tab, download, external and same-screen links through", () => {
    expect(hrefFor({ href: "/inbox" }, { metaKey: true })).toBeNull();
    expect(hrefFor({ href: "/inbox" }, { ctrlKey: true })).toBeNull();
    expect(hrefFor({ href: "/inbox", target: "_blank" })).toBeNull();
    expect(hrefFor({ href: "/report.csv", download: "" })).toBeNull();
    expect(hrefFor({ href: "https://example.com/maps/1" })).toBeNull();
    const here = window.location.pathname + window.location.search;
    expect(hrefFor({ href: `${here}#section` })).toBeNull();
  });
});

describe("setNavigationGuard", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("stops a link click while held, then replays the link's own handler on proceed", () => {
    const pageHandler = vi.fn((event: Event) => event.preventDefault());
    const navigate = vi.fn();
    let held: (() => void) | null = null;
    const release = setNavigationGuard((proceed) => {
      held = proceed;
      return true;
    }, navigate);
    const anchor = mountLink({ href: "/maps/9" });
    anchor.addEventListener("click", pageHandler);

    const event = clickOn(anchor);

    expect(event.defaultPrevented).toBe(true);
    expect(pageHandler).not.toHaveBeenCalled();
    held!();
    expect(pageHandler).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    release();
  });

  it("falls back to navigate when the held link left the page", () => {
    const navigate = vi.fn();
    let held: (() => void) | null = null;
    const release = setNavigationGuard((proceed) => {
      held = proceed;
      return true;
    }, navigate);
    const anchor = mountLink({ href: "/maps/9?version=3" });

    clickOn(anchor);
    anchor.remove();
    held!();

    expect(navigate).toHaveBeenCalledWith("/maps/9?version=3");
    release();
  });

  it("leaves the click alone when the guard has nothing to hold", () => {
    const pageHandler = vi.fn((event: Event) => event.preventDefault());
    const release = setNavigationGuard(() => false, vi.fn());
    const anchor = mountLink({ href: "/maps/9" });
    anchor.addEventListener("click", pageHandler);

    clickOn(anchor);

    expect(pageHandler).toHaveBeenCalledTimes(1);
    release();
  });

  it("routes button navigation through the guard and stops after release", () => {
    const proceed = vi.fn();
    const release = setNavigationGuard(() => true, vi.fn());
    runGuardedNavigation(proceed);
    expect(proceed).not.toHaveBeenCalled();

    release();
    runGuardedNavigation(proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer guard when an older one is released", () => {
    const releaseOld = setNavigationGuard(() => false, vi.fn());
    const releaseNew = setNavigationGuard(() => true, vi.fn());
    releaseOld();
    const proceed = vi.fn();
    runGuardedNavigation(proceed);
    expect(proceed).not.toHaveBeenCalled();
    releaseNew();
  });
});
