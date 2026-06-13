"use client";

// 그룹 박스 타이틀바 — 이름 편집·색 지정·그룹 전체 이동(드래그 핸들)·선택 멤버 그룹 나가기.
// ViewportPortal 안 flow 좌표로 박스 상단에 렌더(노드 위, pointer-events 활성).

import { GripVertical, LogOut } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";

interface GroupTitleBarProps {
  id: string;
  label: string;
  color: string;
  width: number;
  readOnly: boolean;
  colorPresets: string[];
  canLeave: boolean;
  onRename: (id: string, label: string) => void;
  onRecolor: (id: string, color: string) => void;
  onLeave: (id: string) => void;
  onMoveStart: (id: string, event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }) => void;
}

export function GroupTitleBar({
  id,
  label,
  color,
  width,
  readOnly,
  colorPresets,
  canLeave,
  onRename,
  onRecolor,
  onLeave,
  onMoveStart,
}: GroupTitleBarProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const stroke = color || "var(--color-border-strong)";

  return (
    <div
      className="pointer-events-auto relative flex items-center gap-1 rounded-sm border bg-surface px-1 py-0.5 shadow-sm"
      style={{ borderColor: stroke, maxWidth: Math.max(80, width) }}
    >
      {!readOnly && (
        <button
          type="button"
          className="cursor-grab text-ink-tertiary hover:text-ink active:cursor-grabbing"
          title={t("group.move")}
          aria-label={t("group.move")}
          onPointerDown={(event) => onMoveStart(id, event)}
        >
          <GripVertical size={12} strokeWidth={1.5} />
        </button>
      )}
      <button
        type="button"
        className="h-3 w-3 shrink-0 rounded-full border border-hairline"
        style={{ background: stroke }}
        title={t("group.color")}
        aria-label={t("group.color")}
        disabled={readOnly}
        onClick={() => setShowColors((value) => !value)}
      />
      {editing && !readOnly ? (
        <input
          autoFocus
          defaultValue={label}
          className="w-24 rounded-xs border border-hairline px-1 text-fine"
          placeholder={t("group.untitled")}
          onBlur={(event) => {
            onRename(id, event.target.value);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="cursor-text truncate text-fine font-medium"
          style={{ color: stroke }}
          title={t("group.rename")}
          onDoubleClick={() => !readOnly && setEditing(true)}
        >
          {label || t("group.untitled")}
        </span>
      )}
      {canLeave && !readOnly && (
        <button
          type="button"
          className="ml-auto shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-error/10 hover:text-error"
          title={t("group.leave")}
          aria-label={t("group.leave")}
          onClick={() => onLeave(id)}
        >
          <LogOut size={12} strokeWidth={1.5} />
        </button>
      )}
      {showColors && !readOnly && (
        <div className="absolute left-0 top-full z-10 mt-1 flex w-24 flex-wrap gap-1 rounded-sm border border-hairline bg-surface p-1 shadow-lg">
          {colorPresets
            .filter((preset) => preset)
            .map((preset) => (
              <button
                key={preset}
                type="button"
                className="h-3.5 w-3.5 rounded-full border border-hairline"
                style={{ background: preset }}
                title={preset}
                aria-label={preset}
                onClick={() => {
                  onRecolor(id, preset);
                  setShowColors(false);
                }}
              />
            ))}
        </div>
      )}
    </div>
  );
}
