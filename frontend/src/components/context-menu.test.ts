// 메뉴 가속기가 처리한 키는 전역 단축키(창 버블 리스너)로 새지 않는다 — 정렬 하위 메뉴 S가 SP 목록까지 열던 버그
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenu } from "@/components/context-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pressKey = (code: string) => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { code, key: code.slice(3).toLowerCase(), bubbles: true }));
};

describe("ContextMenu accelerators", () => {
  let container: HTMLDivElement;
  let root: Root;
  const globalHandler = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    globalHandler.mockReset();
    window.addEventListener("keydown", globalHandler);
  });
  afterEach(() => {
    window.removeEventListener("keydown", globalHandler);
    act(() => root.unmount());
    container.remove();
  });

  it("keeps a consumed submenu accelerator away from global shortcuts", () => {
    const onVertical = vi.fn();
    const items = [
      {
        label: "Align",
        accel: "a",
        submenu: [{ label: "Vertical", accel: "s", onSelect: onVertical }],
      },
    ];
    act(() => root.render(createElement(ContextMenu, { x: 0, y: 0, items, onClose: () => {} })));

    act(() => pressKey("KeyA"));
    act(() => pressKey("KeyS"));

    expect(onVertical).toHaveBeenCalledTimes(1);
    expect(globalHandler).not.toHaveBeenCalled();
  });

  it("lets keys without a matching accelerator reach global shortcuts", () => {
    const items = [{ label: "Open", accel: "o", onSelect: () => {} }];
    act(() => root.render(createElement(ContextMenu, { x: 0, y: 0, items, onClose: () => {} })));

    act(() => pressKey("KeyQ"));

    expect(globalHandler).toHaveBeenCalledTimes(1);
  });
});
