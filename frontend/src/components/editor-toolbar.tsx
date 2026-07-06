"use client";

// 편집 툴바 — 메인 상단바 아래 두 번째 바. 편집 모드(!readOnly)일 때만 노출(page.tsx에서 게이팅).
// 편집 기능 위주: ＋노드 메뉴 · 자동 정렬(가로/세로 드롭다운) · 정렬/분배. 핸들러는 page.tsx로 위임.
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ChevronDown,
  MoveHorizontal,
  MoveVertical,
  Network,
} from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import { type FlowDir } from "@/lib/flow-layout";

import { AddNodeMenu } from "@/components/add-node-menu";
import { type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import { type MessageKey } from "@/lib/i18n-messages";

type AlignAxis = "left" | "centerX" | "top" | "centerY";
type DistributeAxis = "x" | "y";
type IconType = ComponentType<{ size?: number; strokeWidth?: number }>;

const ALIGNS: { axis: AlignAxis; icon: IconType; labelKey: MessageKey }[] = [
  { axis: "left", icon: AlignStartVertical, labelKey: "editor.alignLeft" },
  { axis: "centerX", icon: AlignCenterVertical, labelKey: "editor.alignCenterX" },
  { axis: "top", icon: AlignStartHorizontal, labelKey: "editor.alignTop" },
  { axis: "centerY", icon: AlignCenterHorizontal, labelKey: "editor.alignCenterY" },
];
const DISTRIBUTES: { axis: DistributeAxis; icon: IconType; labelKey: MessageKey }[] = [
  { axis: "x", icon: AlignHorizontalDistributeCenter, labelKey: "editor.distributeX" },
  { axis: "y", icon: AlignVerticalDistributeCenter, labelKey: "editor.distributeY" },
];

const LAYOUT_DIRS: { dir: FlowDir; icon: IconType; labelKey: MessageKey }[] = [
  { dir: "LR", icon: MoveHorizontal, labelKey: "ctx.autoLayoutH" },
  { dir: "TB", icon: MoveVertical, labelKey: "ctx.autoLayoutV" },
];

interface EditorToolbarProps {
  onAddNode: (type: ProcessNodeType) => void;
  onOpenLibrary: () => void;
  onAutoLayout: (dir: FlowDir) => void;
  onAlign: (axis: AlignAxis) => void;
  onDistribute: (axis: DistributeAxis) => void;
}

export function EditorToolbar({
  onAddNode,
  onOpenLibrary,
  onAutoLayout,
  onAlign,
  onDistribute,
}: EditorToolbarProps) {
  const { t } = useI18n();
  // 자동정렬 드롭다운(가로/세로) — AddNodeMenu와 같은 패턴(백드롭 클릭·Esc 닫기)
  const [layoutOpen, setLayoutOpen] = useState(false);
  useEffect(() => {
    if (!layoutOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLayoutOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layoutOpen]);
  const iconBtn =
    "inline-flex items-center justify-center rounded-sm p-1.5 text-ink-secondary hover:bg-surface-alt";
  const divider = <span className="mx-0.5 h-5 w-px bg-divider" />;

  return (
    <div className="flex items-center gap-1.5 border-b border-hairline bg-surface px-3 py-1.5">
      <AddNodeMenu onAdd={onAddNode} onOpenLibrary={onOpenLibrary} />
      {divider}
      <div className="relative">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
          onClick={() => setLayoutOpen((v) => !v)}
          title={t("ctx.autoLayout")}
        >
          <Network size={16} strokeWidth={1.5} />
          {t("ctx.autoLayout")}
          <ChevronDown size={14} strokeWidth={1.5} />
        </button>
        {layoutOpen && (
          <>
            <div className="fixed inset-0 z-[1000]" onClick={() => setLayoutOpen(false)} />
            <div className="absolute left-0 z-[1001] mt-1 w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg">
              {LAYOUT_DIRS.map(({ dir, icon: Icon, labelKey }) => (
                <button
                  key={dir}
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-caption font-medium text-ink hover:bg-surface-alt"
                  onClick={() => {
                    setLayoutOpen(false);
                    onAutoLayout(dir);
                  }}
                >
                  <Icon size={16} strokeWidth={1.5} />
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {divider}
      {ALIGNS.map(({ axis, icon: Icon, labelKey }) => (
        <button
          key={axis}
          type="button"
          className={iconBtn}
          onClick={() => onAlign(axis)}
          title={t(labelKey)}
          aria-label={t(labelKey)}
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      ))}
      {divider}
      {DISTRIBUTES.map(({ axis, icon: Icon, labelKey }) => (
        <button
          key={axis}
          type="button"
          className={iconBtn}
          onClick={() => onDistribute(axis)}
          title={t(labelKey)}
          aria-label={t(labelKey)}
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}
