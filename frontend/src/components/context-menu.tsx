"use client";

// 마우스 커서 위치에 뜨는 컨텍스트 메뉴 — 캔버스/노드/엣지 우클릭 공용 (spec §7 Phase A).

import { useEffect, useRef } from "react";

// 액션 항목 / 구분선 / 색 스와치 행
export type ContextMenuItem =
  | { divider: true }
  | { colors: string[]; current: string; onPick: (color: string) => void }
  | { divider?: false; label: string; shortcut?: string; danger?: boolean; onSelect: () => void };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

// 화면 가장자리 잘림 보정용 추정치 — w-44(176px), 항목 높이 32px
const MENU_WIDTH = 176;
const ITEM_HEIGHT = 32;
const EDGE_MARGIN = 10;

// 우측/하단 잘림 보정, 바깥 클릭·ESC로 닫힘.
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        !menuRef.current?.contains(event.target)
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onClose]);

  const menuHeight = items.length * ITEM_HEIGHT + 8;
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - EDGE_MARGIN);
  const top = Math.min(y, window.innerHeight - menuHeight - EDGE_MARGIN);

  return (
    <div
      ref={menuRef}
      className="fixed z-[1200] w-44 rounded border border-hairline bg-surface py-1 text-caption shadow-lg"
      style={{ left, top }}
    >
      {items.map((item, index) =>
        "divider" in item ? (
          <hr key={`divider-${index}`} className="my-1 border-t border-divider" />
        ) : "colors" in item ? (
          <div key={`colors-${index}`} className="flex flex-wrap gap-1 px-3 py-1.5">
            {item.colors.map((color) => (
              <button
                key={color || "default"}
                type="button"
                onClick={() => {
                  item.onPick(color);
                  onClose();
                }}
                title={color || "default"}
                aria-label={color || "default"}
                className={`h-4 w-4 rounded-full border ${
                  item.current === color ? "ring-2 ring-accent" : "border-hairline"
                }`}
                style={{ background: color || "var(--color-surface-alt)" }}
              />
            ))}
          </div>
        ) : (
          <button
            key={item.label}
            className={`flex h-8 w-full items-center justify-between px-3 hover:bg-surface-alt ${
              item.danger ? "text-error" : "text-ink"
            }`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-caption text-ink-tertiary">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
