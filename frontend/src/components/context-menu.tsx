"use client";

// 마우스 커서 위치에 뜨는 컨텍스트 메뉴 — 캔버스/노드/엣지 우클릭 공용 (spec §7 Phase A).

import { ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { HandleSide } from "@/lib/canvas";

// 액션 항목 / 구분선 / 색 스와치 행 / 십자 패드 / 하위 메뉴 (icon = 선택적 Lucide 아이콘)
export type ContextMenuItem =
  | { divider: true }
  // 섹션 캡션 — 클릭 불가 그룹 라벨(예: 정렬/분배). 엣지 메뉴 "연결 면"과 같은 톤
  | { caption: string }
  | { colors: string[]; current: string; onPick: (color: string) => void; moreLabel?: string }
  | {
      edgeSides: true;
      sourceLabel: string;
      targetLabel: string;
      sourceSide: HandleSide;
      targetSide: HandleSide;
      // 하위프로세스(라이브러리) 끝점은 입력=좌/출력=우 고정 — 면 선택을 잠근다
      sourceLocked?: boolean;
      targetLocked?: boolean;
      onPickSource: (side: HandleSide) => void;
      onPickTarget: (side: HandleSide) => void;
    }
  | { divider?: false; label: string; icon?: LucideIcon; accel?: string; shortcut?: string; submenu: ContextMenuItem[]; disabled?: boolean }
  | { divider?: false; label: string; icon?: LucideIcon; accel?: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** 넓은 패널 — Start/End 면 선택 위젯처럼 폭이 필요한 메뉴(엣지)용 */
  wide?: boolean;
}

// 화면 가장자리 잘림 보정용 추정치 — w-48(192px), 항목 높이 32px
const MENU_WIDTH = 192;
const WIDE_MENU_WIDTH = 256;
const ITEM_HEIGHT = 32;
const EDGE_MARGIN = 10;
const PANEL_CLASS = "w-48 rounded-md border border-hairline bg-surface py-1.5 text-caption shadow-lg";
const WIDE_PANEL_CLASS = "w-64 rounded-md border border-hairline bg-surface py-1.5 text-caption shadow-lg";
// 단축키 힌트 — 숏컷 레전드(shortcut-legend.tsx)의 kbd와 동일한 디자인
const KBD_CLASS =
  "rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary";
// danger(삭제) 항목의 칩 — error 토큰의 옅은 틴트로 파괴적 동작을 강조 (목업 Del 빨간 칩)
const KBD_DANGER_CLASS =
  "rounded-xs border border-error/30 bg-error/10 px-1.5 py-0.5 text-fine text-error";

// 우측/하단 잘림 보정, 바깥 클릭·ESC로 닫힘.
export function ContextMenu({ x, y, items, onClose, wide = false }: ContextMenuProps) {
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

  const menuHeight = items.length * ITEM_HEIGHT + 12;
  const width = wide ? WIDE_MENU_WIDTH : MENU_WIDTH;
  const left = Math.min(x, window.innerWidth - width - EDGE_MARGIN);
  const top = Math.min(y, window.innerHeight - menuHeight - EDGE_MARGIN);

  return (
    <div
      ref={menuRef}
      className={`fixed z-[1200] ${wide ? WIDE_PANEL_CLASS : PANEL_CLASS}`}
      style={{ left, top }}
    >
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
        ) : "caption" in item ? (
          <div
            key={`caption-${index}`}
            className="px-3 pb-0.5 pt-1.5 text-fine font-semibold uppercase tracking-wide text-ink-tertiary"
          >
            {item.caption}
          </div>
        ) : "colors" in item ? (
          <ColorRow key={`colors-${index}`} item={item} onClose={onClose} />
        ) : "edgeSides" in item ? (
          <EdgeSidesPad key={`edgesides-${index}`} item={item} />
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
            className={`flex h-8 w-full items-center justify-between gap-3 whitespace-nowrap px-3 ${
              item.disabled
                ? "cursor-not-allowed text-ink-tertiary opacity-45"
                : `hover:bg-surface-alt ${item.danger ? "text-error" : "text-ink"}`
            }`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              {item.icon && (
                <item.icon
                  size={14}
                  strokeWidth={1.5}
                  className={`shrink-0 ${item.danger ? "text-error" : "text-ink-tertiary"}`}
                />
              )}
              {item.label}
            </span>
            {item.shortcut && (
              <kbd className={item.danger ? KBD_DANGER_CLASS : KBD_CLASS}>{item.shortcut}</kbd>
            )}
          </button>
        ),
      )}
    </>
  );
}

// 색 스와치 행 — 타입별 세트(≤6)를 한 번에 노출(접기/더보기 없음, #8).
const COLOR_COLLAPSED = 6;
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

// 엣지 끝점 면 선택 — 박스 테두리(상/우/하/좌)를 클릭해 그 변을 선택. 선택 변은 악센트.
// 메뉴 유지 — onClose 호출하지 않음(연속 조정). 박스 사이 커넥터가 선택한 면을 실제 캔버스 엣지처럼 꺾은선으로 반영.
const BOX_W = 64;
const BOX_H = 28;
const GAP = 52;
const VPAD = 10; // 박스 위/아래 여백 — 라벨을 박스 안으로 넣어 확보한 공간에 꺾은선 커넥터가 상/하로 라우팅
const STUB = 7; // 커넥터가 선택 변에서 수직으로 빠져나오는 짧은 구간
const PAD_W = BOX_W * 2 + GAP;
const PAD_H = BOX_H + VPAD * 2;

// 히트박스 키움 — 변 strip 두께 8px(클릭 쉬움)
const SIDE_BORDERS: { side: HandleSide; cls: string }[] = [
  { side: "top", cls: "left-2 right-2 top-0 h-2" },
  { side: "bottom", cls: "left-2 right-2 bottom-0 h-2" },
  { side: "left", cls: "top-2 bottom-2 left-0 w-2" },
  { side: "right", cls: "top-2 bottom-2 right-0 w-2" },
];

// 선택한 면의 박스 경계 앵커 좌표(pad 좌표계, 박스는 top=VPAD에 배치) — 커넥터 끝점.
function sideAnchor(side: HandleSide, x0: number): { x: number; y: number } {
  const cx = x0 + BOX_W / 2;
  const cy = VPAD + BOX_H / 2;
  if (side === "top") return { x: cx, y: VPAD };
  if (side === "bottom") return { x: cx, y: VPAD + BOX_H };
  if (side === "left") return { x: x0, y: cy };
  return { x: x0 + BOX_W, y: cy }; // right
}

// 변에서 바깥으로 나가는 단위 방향 — 커넥터가 변에 수직으로 빠져나오는 stub 방향.
function sideDir(side: HandleSide): { dx: number; dy: number } {
  if (side === "top") return { dx: 0, dy: -1 };
  if (side === "bottom") return { dx: 0, dy: 1 };
  if (side === "left") return { dx: -1, dy: 0 };
  return { dx: 1, dy: 0 }; // right
}

// 두 앵커를 실제 캔버스 엣지처럼 직각 꺾은선으로 잇는 path — 각 끝에서 변 방향 stub 후 중간에서 꺾음.
function orthConnector(
  from: { x: number; y: number },
  to: { x: number; y: number },
  sourceSide: HandleSide,
  targetSide: HandleSide,
): string {
  const s = sideDir(sourceSide);
  const t = sideDir(targetSide);
  const p1 = { x: from.x + s.dx * STUB, y: from.y + s.dy * STUB };
  const p2 = { x: to.x + t.dx * STUB, y: to.y + t.dy * STUB };
  const pts =
    s.dx !== 0
      ? // 수평으로 빠져나오면 가로→세로→가로(중간 x에서 꺾음)
        [from, p1, { x: (p1.x + p2.x) / 2, y: p1.y }, { x: (p1.x + p2.x) / 2, y: p2.y }, p2, to]
      : // 수직으로 빠져나오면 세로→가로→세로(중간 y에서 꺾음)
        [from, p1, { x: p1.x, y: (p1.y + p2.y) / 2 }, { x: p2.x, y: (p1.y + p2.y) / 2 }, p2, to];
  return "M " + pts.map((p) => `${p.x} ${p.y}`).join(" L ");
}

function SideBox({
  current,
  onPick,
  locked = false,
  label,
}: {
  current: HandleSide;
  onPick: (side: HandleSide) => void;
  locked?: boolean;
  label: string;
}) {
  return (
    <div
      className={`group relative rounded-sm border bg-surface-alt transition-colors ${
        locked ? "border-hairline opacity-60" : "border-hairline hover:border-accent/50"
      }`}
      style={{ width: BOX_W, height: BOX_H }}
      title={locked ? "Subprocess: fixed side" : undefined}
    >
      {/* 박스 안 라벨(작게·중앙) — 클릭은 변 strip으로 통과(pointer-events-none) */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-1 text-[10px] leading-none text-ink-tertiary">
        {label}
      </span>
      {SIDE_BORDERS.map(({ side, cls }) => (
        <button
          key={side}
          type="button"
          aria-label={side}
          disabled={locked}
          onClick={locked ? undefined : () => onPick(side)}
          // 박스 hover 시 4변 strip을 tint로 드러내 클릭 가능 영역을 인지시키고(group-hover), 직접 hover는 accent.
          className={`absolute ${cls} rounded-sm transition-colors ${
            current === side
              ? "bg-accent"
              : locked
                ? "bg-divider"
                : "bg-divider/40 group-hover:bg-accent-tint hover:bg-accent"
          } ${locked ? "cursor-default" : ""}`}
        />
      ))}
    </div>
  );
}

function EdgeSidesPad({
  item,
}: {
  item: {
    sourceLabel: string;
    targetLabel: string;
    sourceSide: HandleSide;
    targetSide: HandleSide;
    sourceLocked?: boolean;
    targetLocked?: boolean;
    onPickSource: (side: HandleSide) => void;
    onPickTarget: (side: HandleSide) => void;
  };
}) {
  const srcX0 = 0;
  const tgtX0 = BOX_W + GAP;
  const from = sideAnchor(item.sourceSide, srcX0);
  const to = sideAnchor(item.targetSide, tgtX0);
  return (
    <div className="px-3 py-2">
      <div className="relative mx-auto" style={{ width: PAD_W, height: PAD_H }}>
        {/* 선택한 면을 잇는 커넥터 — 실제 캔버스 엣지처럼 직각 꺾은선(점선+화살촉), 면 변경 시 함께 바뀜 */}
        <svg
          className="pointer-events-none absolute inset-0 text-ink-tertiary"
          width={PAD_W}
          height={PAD_H}
          aria-hidden
        >
          <defs>
            <marker id="edgeSidesArrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
            </marker>
          </defs>
          <path
            d={orthConnector(from, to, item.sourceSide, item.targetSide)}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            fill="none"
            markerEnd="url(#edgeSidesArrow)"
          />
        </svg>
        {/* 박스(커넥터 위) — 라벨은 박스 안 */}
        <div className="absolute" style={{ left: srcX0, top: VPAD }}>
          <SideBox
            current={item.sourceSide}
            onPick={item.onPickSource}
            locked={item.sourceLocked}
            label={item.sourceLabel}
          />
        </div>
        <div className="absolute" style={{ left: tgtX0, top: VPAD }}>
          <SideBox
            current={item.targetSide}
            onPick={item.onPickTarget}
            locked={item.targetLocked}
            label={item.targetLabel}
          />
        </div>
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
  // 하위 메뉴가 아래로 넘칠 때 위로 펼침(트리거 하단 기준). 좌우 뒤집기(toLeft)와 동일 패턴.
  const [toUp, setToUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleEnter = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setToLeft(rect.right + MENU_WIDTH + EDGE_MARGIN > window.innerWidth);
      // 하위 메뉴 높이 추정(항목당 ITEM_HEIGHT). 아래로 넘치고 위에 공간이 있으면 위로 펼침.
      const subHeight = item.submenu.length * ITEM_HEIGHT + 12;
      const overflowsBelow = rect.top + subHeight + EDGE_MARGIN > window.innerHeight;
      setToUp(overflowsBelow && subHeight <= rect.bottom - EDGE_MARGIN);
    }
    setOpen(true);
  };

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={() => setOpen(false)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={item.disabled}
        className={`flex h-8 w-full items-center justify-between gap-3 whitespace-nowrap px-3 ${
          item.disabled ? "cursor-not-allowed text-ink-tertiary opacity-45" : "hover:bg-surface-alt text-ink"
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
          className={`absolute z-[1200] ${PANEL_CLASS}`}
          style={{
            ...(toLeft ? { right: "100%" } : { left: "100%" }),
            ...(toUp ? { bottom: 0 } : { top: 0 }),
          }}
        >
          <MenuList items={item.submenu} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
