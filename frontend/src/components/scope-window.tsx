// 떠있는 스코프 창 — 타이틀바 드래그 이동·코너 리사이즈·최소/최대/닫기·포커스. 활성 창만 라이브 children.
"use client";

import { Minus, Square, X } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { WindowGeom } from "@/lib/window-store";

const MIN_W = 240;
const MIN_H = 160;

interface ScopeWindowProps {
  title: string;
  geom: WindowGeom;
  active: boolean;
  zIndex: number;
  canClose: boolean;
  chromeless?: boolean; // 최상위(루트) 프로세스 — 항상 최대화, 타이틀바/리사이즈 없이 제목 칩만
  bounds: { w: number; h: number };
  onFocus: () => void;
  onGeomChange: (geom: WindowGeom) => void;
  onClose: () => void;
  children: ReactNode;
}

export function ScopeWindow({
  title,
  geom,
  active,
  zIndex,
  canClose,
  chromeless = false,
  bounds,
  onFocus,
  onGeomChange,
  onClose,
  children,
}: ScopeWindowProps) {
  const { t } = useI18n();
  // 드래그/리사이즈 시작 시점의 포인터·기하 스냅샷
  const dragRef = useRef<{ px: number; py: number; geom: WindowGeom } | null>(null);

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
  const resizeWindow = (event: ReactPointerEvent) => {
    const start = dragRef.current;
    if (!start) {
      return;
    }
    onGeomChange(
      clamp({
        ...start.geom,
        w: start.geom.w + (event.clientX - start.px),
        h: start.geom.h + (event.clientY - start.py),
      }),
    );
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
        <div className="relative flex-1">
          {children}
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-caption text-ink-tertiary">
              {t("window.clickToEdit")}
            </div>
          )}
          <span className="pointer-events-none absolute left-2 top-2 z-10 max-w-[60%] truncate rounded-sm border border-hairline bg-surface px-2 py-0.5 text-fine font-medium text-ink-secondary shadow-sm">
            {title}
          </span>
        </div>
      </div>
    );
  }

  const rect = geom.maximized
    ? { left: 0, top: 0, width: bounds.w, height: bounds.h }
    : {
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.minimized ? undefined : geom.h,
      };

  return (
    <div
      className={`window-open absolute flex flex-col overflow-hidden rounded-sm border bg-surface shadow-md ${
        active ? "border-hairline" : "border-divider"
      }`}
      style={{ ...rect, zIndex }}
      onPointerDown={onFocus}
    >
      <div
        className="flex shrink-0 select-none items-center gap-1 border-b border-hairline bg-surface-alt px-2 py-1 text-fine text-ink-secondary"
        style={{ cursor: geom.maximized ? "default" : "move" }}
        onPointerDown={startDrag}
        onPointerMove={moveWindow}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={toggleMax}
      >
        <span className="flex-1 truncate font-medium">{title}</span>
        <button
          type="button"
          title={t("window.minimize")}
          className="rounded-xs p-0.5 hover:bg-surface-pearl"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggleMin();
          }}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title={t("window.maximize")}
          className="rounded-xs p-0.5 hover:bg-surface-pearl"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggleMax();
          }}
        >
          <Square size={12} strokeWidth={1.5} />
        </button>
        {canClose && (
          <button
            type="button"
            title={t("window.close")}
            className="rounded-xs p-0.5 hover:bg-error/10 hover:text-error"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {!geom.minimized && (
        <div className="relative flex-1">
          {children}
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-caption text-ink-tertiary">
              {t("window.clickToEdit")}
            </div>
          )}
        </div>
      )}

      {!geom.minimized && !geom.maximized && (
        <div
          className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize"
          onPointerDown={startDrag}
          onPointerMove={resizeWindow}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
    </div>
  );
}
