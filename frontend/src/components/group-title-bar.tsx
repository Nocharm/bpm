"use client";

// 그룹 박스 타이틀바 — 이름 편집·색 지정·그룹 전체 이동(드래그 핸들)·선택 멤버 그룹 나가기.
// ViewportPortal 안 flow 좌표로 박스 상단에 렌더(노드 위, pointer-events 활성).

import { GripVertical, SlidersHorizontal, SquarePen } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";

interface GroupTitleBarProps {
  id: string;
  label: string;
  color: string;
  width: number;
  readOnly: boolean;
  // 갓 생성된 그룹 or 컨텍스트 메뉴 "이름 변경" 시 true — 이름 편집모드로 진입(무명 그룹 방지)
  autoEdit?: boolean;
  // autoEdit 신호를 편집 진입에 소비한 뒤 부모가 신호를 해제하도록 알림(다음 트리거 재사용 위해)
  onAutoEditConsumed?: () => void;
  colorPresets: string[];
  onRename: (id: string, label: string) => void;
  onRecolor: (id: string, color: string) => void;
  onMoveStart: (id: string, event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }) => void;
  onBulkEdit?: (id: string) => void;
}

export function GroupTitleBar({
  id,
  label,
  color,
  width,
  readOnly,
  autoEdit,
  onAutoEditConsumed,
  colorPresets,
  onRename,
  onRecolor,
  onMoveStart,
  onBulkEdit,
}: GroupTitleBarProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(autoEdit ?? false);
  const [prevAutoEdit, setPrevAutoEdit] = useState(autoEdit);
  const [showColors, setShowColors] = useState(false);
  const stroke = color || "var(--color-border-strong)";

  // autoEdit가 false→true로 바뀌면(생성 직후 or 컨텍스트 메뉴 "이름 변경") 편집 진입 — 렌더 중 상태 조정(effect 아님).
  // 마운트 전용 useState로는 이미 뜬 그룹의 재호출을 못 받으므로. 신호 해제는 편집 종료 시(onAutoEditConsumed).
  if (autoEdit !== prevAutoEdit) {
    setPrevAutoEdit(autoEdit);
    if (autoEdit) {
      setEditing(true);
    }
  }

  return (
    // 목업 pill — 그룹 색 배경 + 밝은 콘텐츠(이동 그립·색 점·이름·연필 리네임·일괄편집)
    <div
      className="pointer-events-auto relative flex items-center gap-1.5 rounded-md px-1.5 py-1 shadow-sm"
      style={{ background: stroke, maxWidth: Math.max(80, width) }}
    >
      {!readOnly && (
        <button
          type="button"
          className="cursor-grab text-white/70 hover:text-white active:cursor-grabbing"
          title={t("group.move")}
          aria-label={t("group.move")}
          onPointerDown={(event) => onMoveStart(id, event)}
        >
          <GripVertical size={12} strokeWidth={1.5} />
        </button>
      )}
      {/* 색 점 — 색상 팔레트 토글(colored pill 위라 밝은 점) */}
      <button
        type="button"
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/85 ring-1 ring-white/40 disabled:opacity-70"
        title={t("group.color")}
        aria-label={t("group.color")}
        disabled={readOnly}
        onClick={() => setShowColors((value) => !value)}
      />
      {editing && !readOnly ? (
        <input
          autoFocus
          defaultValue={label}
          className="w-24 rounded-xs border border-white/40 bg-white/95 px-1 text-fine text-ink"
          placeholder={t("group.untitled")}
          onBlur={(event) => {
            onRename(id, event.target.value);
            setEditing(false);
            onAutoEditConsumed?.(); // 편집 종료 → 신호 해제(다음 메뉴 이름변경 재트리거 위해)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setEditing(false);
              onAutoEditConsumed?.();
            }
          }}
        />
      ) : (
        <span
          className="cursor-text truncate text-fine font-medium text-white"
          title={t("group.rename")}
          onDoubleClick={() => !readOnly && setEditing(true)}
        >
          {label || t("group.untitled")}
        </span>
      )}
      {!readOnly && (
        <button
          type="button"
          className="shrink-0 rounded-xs bg-white/15 p-0.5 text-white/90 hover:bg-white/25"
          title={t("group.rename")}
          aria-label={t("group.rename")}
          onClick={() => setEditing(true)}
        >
          <SquarePen size={12} strokeWidth={1.5} />
        </button>
      )}
      {!readOnly && onBulkEdit && (
        <button
          type="button"
          className="shrink-0 text-white/70 hover:text-white"
          title={t("group.bulkEdit")}
          aria-label={t("group.bulkEdit")}
          onClick={() => onBulkEdit(id)}
        >
          <SlidersHorizontal size={12} strokeWidth={1.5} />
        </button>
      )}
      {showColors && !readOnly && (
        <div className="absolute left-0 top-full z-10 mt-1 flex w-28 flex-wrap gap-1 rounded-sm border border-hairline bg-surface p-1.5 shadow-lg">
          {colorPresets
            .filter((preset) => preset)
            .map((preset) => (
              <button
                key={preset}
                type="button"
                className={`h-4 w-4 rounded-full border ${
                  preset === color ? "ring-2 ring-accent" : "border-hairline"
                }`}
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
