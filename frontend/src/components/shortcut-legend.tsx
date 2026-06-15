"use client";

// 반투명 단축키 안내 — 우하단 ? 버튼 또는 '?' 키로 토글 (에디터 캔버스 우하단 고정).

import { HelpCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";

export function ShortcutLegend() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // '?'(Shift+/)로 토글, Esc로 닫기. 입력 필드 포커스 중에는 무시.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "?" && !inField) {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const shortcuts: { keys: string; label: string }[] = [
    { keys: "Ctrl+Z", label: t("legend.undo") },
    { keys: "Ctrl+⇧Z", label: t("legend.redo") },
    { keys: "Ctrl+K", label: t("legend.search") },
    { keys: "Space+Drag", label: t("legend.pan") },
    { keys: "Drag", label: t("legend.boxSelect") },
    { keys: t("legend.dblClick"), label: t("legend.connect") },
    { keys: t("legend.hover"), label: t("legend.dropZones") },
    { keys: "Del", label: t("legend.delete") },
    { keys: "Esc", label: t("legend.cancel") },
    { keys: "1–4", label: t("legend.addNode") },
    { keys: "E", label: t("legend.editInfo") },
    { keys: "L C T M", label: t("legend.align") },
    { keys: "H V", label: t("legend.distribute") },
    { keys: "Ctrl+G", label: t("legend.createGroup") },
    { keys: "Ctrl+⇧E", label: t("legend.exportPng") },
  ];

  return (
    <div className="absolute bottom-3 right-3 z-[1050] flex flex-col items-end gap-2">
      {open && (
        <div className="w-64 rounded-md border border-hairline bg-surface/85 p-3 text-caption shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-ink">{t("legend.title")}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-ink-tertiary hover:text-ink"
              aria-label={t("legend.close")}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.label} className="flex items-center justify-between gap-3">
                <span className="text-ink-secondary">{shortcut.label}</span>
                <kbd className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">
                  {shortcut.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-surface/85 text-ink-secondary shadow-md backdrop-blur hover:text-accent"
        title={t("legend.toggle")}
        aria-label={t("legend.toggle")}
      >
        <HelpCircle size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
