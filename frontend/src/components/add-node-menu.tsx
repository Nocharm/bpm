"use client";

// 좌측 사이드바 +노드 메뉴 — 모양 선택(프로세스·판단·시작/끝) + 하위프로세스(라이브러리 연결).
// 노드 생성/라이브러리 열기는 page.tsx 핸들러로 위임(onAdd·onOpenLibrary). 좌표 없는 추가=뷰포트 중앙.
import { ChevronDown, Circle, Diamond, Network, Plus, Square } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import { type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import { type MessageKey } from "@/lib/i18n-messages";

const SHAPES: { type: ProcessNodeType; icon: ComponentType<{ size?: number; strokeWidth?: number }>; labelKey: MessageKey }[] = [
  { type: "process", icon: Square, labelKey: "nodeType.process" },
  { type: "decision", icon: Diamond, labelKey: "nodeType.decision" },
  { type: "start", icon: Circle, labelKey: "nodeType.terminal" },
];

interface AddNodeMenuProps {
  onAdd: (type: ProcessNodeType) => void;
  onOpenLibrary: () => void;
}

export function AddNodeMenu({ onAdd, onOpenLibrary }: AddNodeMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent-tint px-2.5 py-1.5 text-caption font-medium text-accent hover:bg-accent-tint/70"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={16} strokeWidth={1.5} />
        {t("addNode.button")}
        <ChevronDown size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-[1001] mt-1 w-56 rounded-md border border-hairline bg-surface py-2 shadow-lg">
            <div className="px-3 pb-1 text-fine text-ink-tertiary">{t("addNode.pickShape")}</div>
            {SHAPES.map((shape) => {
              const Icon = shape.icon;
              return (
                <button
                  key={shape.type}
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-caption font-medium text-ink hover:bg-surface-alt"
                  onClick={() => {
                    setOpen(false);
                    onAdd(shape.type);
                  }}
                >
                  <Icon size={16} strokeWidth={1.5} />
                  {t(shape.labelKey)}
                </button>
              );
            })}
            <div className="my-1 border-t border-divider" />
            <button
              type="button"
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-alt"
              onClick={() => {
                setOpen(false);
                onOpenLibrary();
              }}
            >
              <Network size={16} strokeWidth={1.5} className="mt-0.5 text-ink" />
              <span className="flex flex-col">
                <span className="text-caption font-medium text-ink">{t("nodeType.subprocess")}</span>
                <span className="text-fine text-accent">{t("addNode.subprocessHint")}</span>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
