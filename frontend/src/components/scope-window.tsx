// 떠있는 스코프 창 — 타이틀바 드래그 이동·코너 리사이즈·최소/최대/닫기·포커스. 활성 창만 라이브 children.
"use client";

import { Minimize2, Square, X } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { WindowGeom } from "@/lib/window-store";

const MIN_W = 360; // 채팅/표 가독성 위해 상향 (기존 240 × 1.5)
const MIN_H = 160;

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// 8방향 리사이즈 핸들 — 변(한 축)은 코너 사이, 코너(두 축)는 변 위에 오도록 뒤에 배치.
const RESIZE_HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: "n", className: "left-2 right-2 top-0 h-1.5 cursor-ns-resize" },
  { dir: "s", className: "bottom-0 left-2 right-2 h-1.5 cursor-ns-resize" },
  { dir: "w", className: "bottom-2 left-0 top-2 w-1.5 cursor-ew-resize" },
  { dir: "e", className: "bottom-2 right-0 top-2 w-1.5 cursor-ew-resize" },
  { dir: "nw", className: "left-0 top-0 h-2.5 w-2.5 cursor-nwse-resize" },
  { dir: "ne", className: "right-0 top-0 h-2.5 w-2.5 cursor-nesw-resize" },
  { dir: "sw", className: "bottom-0 left-0 h-2.5 w-2.5 cursor-nesw-resize" },
  { dir: "se", className: "bottom-0 right-0 h-2.5 w-2.5 cursor-nwse-resize" },
];

interface ScopeWindowProps {
  title: string;
  geom: WindowGeom;
  active: boolean;
  zIndex: number;
  canClose: boolean;
  canMaximize?: boolean; // 최대화 버튼 노출(기본 true) — AI 창은 헤더 간소화로 숨김
  chromeless?: boolean; // 최상위(루트) 프로세스 — 항상 최대화, 타이틀바/리사이즈 없이 제목 칩만
  bounds: { w: number; h: number };
  onFocus: () => void;
  onGeomChange: (geom: WindowGeom) => void;
  onClose: () => void;
  onMinimize?: (clientX: number, clientY: number) => void; // 최소화 시점의 포인터 위치 전달
  headerLeft?: ReactNode; // 타이틀 대체 커스텀 헤더(배지·타이틀·서브타이틀 등) — flex-1 min-w-0 포함할 것
  headerActions?: ReactNode; // 최소/최대/닫기 앞 추가 버튼(폰트 조절·추출 등)
  titleSlot?: ReactNode; // chromeless(루트) 좌상단 제목 칩 대체 — 스스로 위치(absolute left-2 top-2)를 잡을 것
  children: ReactNode;
}

export function ScopeWindow({
  title,
  geom,
  active,
  zIndex,
  canClose,
  canMaximize = true,
  chromeless = false,
  bounds,
  onFocus,
  onGeomChange,
  onClose,
  onMinimize,
  headerLeft,
  headerActions,
  titleSlot,
  children,
}: ScopeWindowProps) {
  const { t } = useI18n();
  // 드래그/리사이즈 시작 시점의 포인터·기하 스냅샷
  const dragRef = useRef<{ px: number; py: number; geom: WindowGeom; dir?: ResizeDir } | null>(null);

  const clamp = (g: WindowGeom): WindowGeom => {
    const w = Math.min(Math.max(g.w, MIN_W), Math.max(MIN_W, bounds.w));
    const h = Math.min(Math.max(g.h, MIN_H), Math.max(MIN_H, bounds.h));
    const x = Math.min(Math.max(g.x, 0), Math.max(0, bounds.w - w));
    const y = Math.min(Math.max(g.y, 0), Math.max(0, bounds.h - h));
    return { ...g, x, y, w, h };
  };

  const startDrag = (event: ReactPointerEvent) => {
    if (geom.maximized) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { px: event.clientX, py: event.clientY, geom };
  };
  const moveWindow = (event: ReactPointerEvent) => {
    const start = dragRef.current;
    if (!start) {
      return;
    }
    onGeomChange(
      clamp({
        ...start.geom,
        x: start.geom.x + (event.clientX - start.px),
        y: start.geom.y + (event.clientY - start.py),
      }),
    );
  };
  const startResize = (event: ReactPointerEvent, dir: ResizeDir) => {
    if (geom.maximized) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { px: event.clientX, py: event.clientY, geom, dir };
  };
  // 잡은 모서리 반대쪽을 고정하고 드래그한 방향으로만 크기 변경. 마우스가 화면(bounds)을
  // 벗어나도 반대 모서리는 움직이지 않고 그 지점에서 멈춘다. 최대 폭은 캔버스 폭의 절반.
  const resizeWindow = (event: ReactPointerEvent) => {
    const start = dragRef.current;
    if (!start || !start.dir) {
      return;
    }
    const g = start.geom;
    const dx = event.clientX - start.px;
    const dy = event.clientY - start.py;
    const maxW = Math.max(MIN_W, Math.floor(bounds.w / 2));
    const dir = start.dir;
    let { x, y, w, h } = g;
    if (dir.includes("e")) {
      // 오른쪽 끝을 마우스로, 왼쪽(x) 고정 — 화면·maxW 넘으면 정지
      w = Math.min(Math.max(g.w + dx, MIN_W), Math.min(maxW, bounds.w - g.x));
    }
    if (dir.includes("w")) {
      // 왼쪽 끝을 마우스로, 오른쪽(x+w) 고정
      const right = g.x + g.w;
      x = Math.min(Math.max(g.x + dx, Math.max(0, right - maxW)), right - MIN_W);
      w = right - x;
    }
    if (dir.includes("s")) {
      h = Math.min(Math.max(g.h + dy, MIN_H), bounds.h - g.y);
    }
    if (dir.includes("n")) {
      const bottom = g.y + g.h;
      y = Math.min(Math.max(g.y + dy, 0), bottom - MIN_H);
      h = bottom - y;
    }
    onGeomChange({ ...g, x, y, w, h });
  };
  const endDrag = (event: ReactPointerEvent) => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  };

  const toggleMax = () => onGeomChange({ ...geom, maximized: !geom.maximized });
  const toggleMin = () => onGeomChange({ ...geom, minimized: !geom.minimized });

  // 루트 프로세스 — 항상 캔버스를 가득 채우고, 타이틀바 대신 좌상단에 제목 칩만(그룹 UI와 동일 톤)
  if (chromeless) {
    return (
      <div
        className="absolute inset-0 flex flex-col overflow-hidden bg-surface"
        style={{ zIndex }}
        onPointerDown={onFocus}
      >
        <div className="relative flex-1 min-h-0">
          {children}
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-caption text-ink-tertiary">
              {t("window.clickToEdit")}
            </div>
          )}
          {titleSlot ?? (
            <span className="pointer-events-none absolute left-2 top-2 z-10 max-w-[60%] truncate rounded-sm border border-hairline bg-surface px-2 py-0.5 text-fine font-medium text-ink-secondary shadow-sm">
              {title}
            </span>
          )}
        </div>
      </div>
    );
  }

  const rect = geom.maximized
    ? { left: 0, top: 0, width: bounds.w, height: bounds.h }
    : { left: geom.x, top: geom.y, width: geom.w, height: geom.h };

  return (
    <div
      className={`window-open absolute flex flex-col overflow-hidden rounded-sm border bg-surface shadow-md ${
        active ? "border-ink-tertiary/30" : "border-hairline"
      }`}
      style={{ ...rect, zIndex }}
      onPointerDown={onFocus}
    >
      <div
        className={`flex shrink-0 select-none items-center border-b border-hairline text-fine text-ink-secondary ${
          headerLeft ? "gap-2 bg-surface px-3 py-2.5" : "gap-1 bg-surface-alt px-2 py-1"
        }`}
        style={{ cursor: geom.maximized ? "default" : "move" }}
        onPointerDown={startDrag}
        onPointerMove={moveWindow}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {headerLeft ?? <span className="flex-1 truncate font-medium">{title}</span>}
        {headerActions}
        <button
          type="button"
          title={t("window.minimize")}
          className="rounded-xs p-1 hover:bg-surface-pearl"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (!geom.minimized) onMinimize?.(event.clientX, event.clientY);
            toggleMin();
          }}
        >
          <Minimize2 size={15} strokeWidth={1.6} />
        </button>
        {canMaximize && (
          <button
            type="button"
            title={t("window.maximize")}
            className="rounded-xs p-1 hover:bg-surface-pearl"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              toggleMax();
            }}
          >
            <Square size={14} strokeWidth={1.5} />
          </button>
        )}
        {canClose && (
          <button
            type="button"
            title={t("window.close")}
            className="rounded-xs p-1 hover:bg-error/10 hover:text-error"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
        {children}
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-caption text-ink-tertiary">
            {t("window.clickToEdit")}
          </div>
        )}
      </div>

      {!geom.maximized &&
        RESIZE_HANDLES.map((handle) => (
          <div
            key={handle.dir}
            className={`absolute ${handle.className}`}
            onPointerDown={(event) => startResize(event, handle.dir)}
            onPointerMove={resizeWindow}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        ))}
    </div>
  );
}
