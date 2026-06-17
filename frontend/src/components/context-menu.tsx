"use client";

// 마우스 커서 위치에 뜨는 컨텍스트 메뉴 — 캔버스/노드/엣지 우클릭 공용 (spec §7 Phase A).

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { HandleSide } from "@/lib/canvas";

// 액션 항목 / 구분선 / 색 스와치 행 / 십자 패드 / 하위 메뉴 (icon = 선택적 Lucide 아이콘)
export type ContextMenuItem =
  | { divider: true }
  | { colors: string[]; current: string; onPick: (color: string) => void; moreLabel?: string }
  | { pad: true; label: string; current: HandleSide; onPick: (side: HandleSide) => void }
  | { divider?: false; label: string; icon?: LucideIcon; accel?: string; shortcut?: string; submenu: ContextMenuItem[]; disabled?: boolean }
  | { divider?: false; label: string; icon?: LucideIcon; accel?: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

// 화면 가장자리 잘림 보정용 추정치 — w-48(192px), 항목 높이 32px
const MENU_WIDTH = 192;
const ITEM_HEIGHT = 32;
const EDGE_MARGIN = 10;
const PANEL_CLASS = "w-48 rounded border border-hairline bg-surface py-1 text-caption shadow-lg";
// 단축키 힌트 — 숏컷 레전드(shortcut-legend.tsx)의 kbd와 동일한 디자인
const KBD_CLASS =
  "rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary";

// 우측/하단 잘림 보정, 바깥 클릭·ESC로 닫힘.
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // 키보드로 펼친 하위 메뉴(날개)의 상위 인덱스 — 메뉴 가속기 경로(예: A → 정렬, 그 뒤 T)
  const [kbSub, setKbSub] = useState<number | null>(null);

  // 메뉴 가속기 — 메뉴가 떠 있을 때만 단일 키로 항목 실행/하위 메뉴 진입. 전역 조합(Alt/Ctrl)은 제외.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (kbSub !== null) {
          setKbSub(null);
        } else {
          onClose();
        }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return; // 전역 단축키(Alt+키 등)는 메뉴 가속기가 아니라 전역 핸들러 담당
      }
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      ) {
        return;
      }
      // 물리 키(event.code)로 판정 — 한글(ㅁ/ㅊ) 등 IME·레이아웃 무관하게 가속기 인식
      let key = "";
      const letter = event.code.match(/^Key([A-Z])$/);
      if (letter) {
        key = letter[1].toLowerCase();
      } else {
        const digit = event.code.match(/^(?:Digit|Numpad)([0-9])$/);
        if (digit) {
          key = digit[1];
        }
      }
      if (!key) {
        return;
      }
      const parent = kbSub !== null ? items[kbSub] : null;
      const active: ContextMenuItem[] = parent && "submenu" in parent ? parent.submenu : items;
      const match = active.find(
        (it) =>
          "accel" in it &&
          it.accel !== undefined &&
          it.accel.toLowerCase() === key &&
          !("disabled" in it && it.disabled),
      );
      if (!match) {
        return;
      }
      event.preventDefault();
      if ("submenu" in match && match.submenu) {
        const idx = items.indexOf(match);
        if (idx !== -1) {
          setKbSub(idx);
        }
      } else if ("onSelect" in match) {
        match.onSelect();
        onClose();
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && !menuRef.current?.contains(event.target)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, [items, kbSub, onClose]);

  const menuHeight = items.length * ITEM_HEIGHT + 8;
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - EDGE_MARGIN);
  const top = Math.min(y, window.innerHeight - menuHeight - EDGE_MARGIN);

  return (
    <div ref={menuRef} className={`fixed z-[1200] ${PANEL_CLASS}`} style={{ left, top }}>
      <MenuList items={items} onClose={onClose} kbSub={kbSub} />
    </div>
  );
}

// 항목 목록 렌더 — 하위 메뉴를 위해 재귀 구조.
function MenuList({
  items,
  onClose,
  kbSub,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
  kbSub?: number | null;
}) {
  return (
    <>
      {items.map((item, index) =>
        "divider" in item && item.divider ? (
          <hr key={`divider-${index}`} className="my-1 border-t border-divider" />
        ) : "colors" in item ? (
          <ColorRow key={`colors-${index}`} item={item} onClose={onClose} />
        ) : "pad" in item ? (
          <CrossPad key={`pad-${index}`} item={item} />
        ) : "submenu" in item ? (
          <SubmenuItem
            key={item.label}
            item={item}
            onClose={onClose}
            keyboardOpen={kbSub === index}
          />
        ) : (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            className={`flex h-8 w-full items-center justify-between gap-3 px-3 ${
              item.disabled
                ? "cursor-not-allowed text-ink-tertiary"
                : `hover:bg-surface-alt ${item.danger ? "text-error" : "text-ink"}`
            }`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              {item.icon && <item.icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
              {item.label}
            </span>
            {item.shortcut && <kbd className={KBD_CLASS}>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </>
  );
}

// 색 스와치 행 — 기본 1줄(5개)만 노출하고 "더보기"로 전체 팔레트 펼침.
const COLOR_COLLAPSED = 5;
function ColorRow({
  item,
  onClose,
}: {
  item: { colors: string[]; current: string; onPick: (color: string) => void; moreLabel?: string };
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = item.colors.length > COLOR_COLLAPSED;
  const shown = expanded || !hasMore ? item.colors : item.colors.slice(0, COLOR_COLLAPSED);
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
      {shown.map((color) => (
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
      {hasMore && !expanded && (
        <button
          type="button"
          className="px-1 text-fine text-ink-tertiary hover:text-ink"
          onClick={() => setExpanded(true)}
        >
          {item.moreLabel ?? "…"}
        </button>
      )}
    </div>
  );
}

// 십자 방향 패드 — 버튼 위치가 실제 노드 변에 매핑. 클릭해도 메뉴는 닫지 않음(연속 조정).
const PAD_BUTTONS: { side: HandleSide; icon: LucideIcon; col: string; row: string }[] = [
  { side: "top", icon: ArrowUp, col: "col-start-2", row: "row-start-1" },
  { side: "left", icon: ArrowLeft, col: "col-start-1", row: "row-start-2" },
  { side: "right", icon: ArrowRight, col: "col-start-3", row: "row-start-2" },
  { side: "bottom", icon: ArrowDown, col: "col-start-2", row: "row-start-3" },
];

function CrossPad({
  item,
}: {
  item: { label: string; current: HandleSide; onPick: (side: HandleSide) => void };
}) {
  return (
    <div className="px-3 py-1.5">
      <p className="mb-1 text-fine text-ink-tertiary">{item.label}</p>
      <div className="grid w-[84px] grid-cols-3 grid-rows-3 gap-0.5">
        {PAD_BUTTONS.map(({ side, icon: Icon, col, row }) => (
          <button
            key={side}
            type="button"
            // 메뉴 유지 — onClose 호출하지 않음. 바깥 클릭(mousedown 가드)·Esc로만 닫힘.
            onClick={() => item.onPick(side)}
            aria-label={side}
            className={`flex h-6 w-6 items-center justify-center rounded-xs border ${col} ${row} ${
              item.current === side
                ? "border-accent bg-accent-tint text-accent"
                : "border-hairline text-ink-tertiary hover:bg-surface-alt"
            }`}
          >
            <Icon size={13} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}

// 하위 메뉴 항목 — hover 시 우측(공간 부족하면 좌측) 플라이아웃.
function SubmenuItem({
  item,
  onClose,
  keyboardOpen = false,
}: {
  item: { label: string; icon?: LucideIcon; shortcut?: string; submenu: ContextMenuItem[]; disabled?: boolean };
  onClose: () => void;
  keyboardOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [toLeft, setToLeft] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleEnter = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setToLeft(rect.right + MENU_WIDTH + EDGE_MARGIN > window.innerWidth);
    }
    setOpen(true);
  };

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={() => setOpen(false)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={item.disabled}
        className={`flex h-8 w-full items-center justify-between gap-3 px-3 ${
          item.disabled ? "cursor-not-allowed text-ink-tertiary" : "hover:bg-surface-alt text-ink"
        }`}
      >
        <span className="flex items-center gap-2">
          {item.icon && <item.icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
          {item.label}
        </span>
        <span className="flex items-center gap-1.5">
          {item.shortcut && <kbd className={KBD_CLASS}>{item.shortcut}</kbd>}
          <ChevronRight size={14} strokeWidth={1.5} className="text-ink-tertiary" />
        </span>
      </button>
      {(open || keyboardOpen) && !item.disabled && (
        <div
          className={`absolute top-0 z-[1200] ${PANEL_CLASS}`}
          style={toLeft ? { right: "100%" } : { left: "100%" }}
        >
          <MenuList items={item.submenu} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
