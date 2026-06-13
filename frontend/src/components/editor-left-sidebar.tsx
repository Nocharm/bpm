"use client";

// 에디터 좌측 사이드바 — Insert(타입별 추가)·Arrange(정렬/배치)·Outline(현재 스코프 트리).

import {
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ChevronLeft,
  Circle,
  CircleDot,
  Diamond,
  LayoutGrid,
  PanelsTopLeft,
  Square,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { ComponentType } from "react";

import { NODE_TYPE_OPTIONS, type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

export interface OutlineItem {
  id: string;
  label: string;
  nodeType: ProcessNodeType;
  hasChildren: boolean;
}

interface EditorLeftSidebarProps {
  readOnly: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  colorPresets: string[];
  selectedId: string | null;
  onAddType: (type: ProcessNodeType) => void;
  onRecolor: (color: string) => void;
  onAutoLayout: () => void;
  onAlign: (axis: "left" | "top") => void;
  onDistribute: (axis: "x" | "y") => void;
  outline: OutlineItem[];
  onSelectNode: (id: string) => void;
  onDrill: (id: string) => void;
}

const TYPE_ICONS: Record<ProcessNodeType, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  start: Circle,
  process: Square,
  decision: Diamond,
  end: CircleDot,
};

const sectionTitle = "px-1 pb-1 text-fine font-semibold uppercase tracking-wide text-ink-tertiary";
const rowButton =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40";

export function EditorLeftSidebar({
  readOnly,
  collapsed,
  onToggleCollapse,
  colorPresets,
  selectedId,
  onAddType,
  onRecolor,
  onAutoLayout,
  onAlign,
  onDistribute,
  outline,
  onSelectNode,
  onDrill,
}: EditorLeftSidebarProps) {
  const { t } = useI18n();

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-hairline bg-surface py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          title={t("sidebar.expand")}
          aria-label={t("sidebar.expand")}
        >
          <PanelsTopLeft size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r border-hairline bg-surface p-2">
      <div className="flex items-center justify-between">
        <span className="px-1 text-caption-strong text-ink">{t("sidebar.title")}</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          title={t("sidebar.collapse")}
          aria-label={t("sidebar.collapse")}
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Insert — 타입별 노드 추가 + 선택 노드 색 변경 */}
      <section>
        <div className={sectionTitle}>{t("sidebar.insert")}</div>
        <div className="flex flex-col gap-0.5">
          {NODE_TYPE_OPTIONS.map((option) => {
            const Icon = TYPE_ICONS[option.value];
            return (
              <button
                key={option.value}
                type="button"
                className={rowButton}
                disabled={readOnly}
                onClick={() => onAddType(option.value)}
              >
                <Icon size={14} strokeWidth={1.5} />
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 px-1">
          {colorPresets.map((preset) => (
            <button
              key={preset || "default"}
              type="button"
              disabled={readOnly || !selectedId}
              onClick={() => onRecolor(preset)}
              title={preset || t("sidebar.colorDefault")}
              aria-label={preset || t("sidebar.colorDefault")}
              className="h-4 w-4 rounded-full border border-hairline disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: preset || "var(--color-surface-alt)" }}
            />
          ))}
        </div>
      </section>

      {/* Arrange — 자동배치/정렬/분배 */}
      <section>
        <div className={sectionTitle}>{t("sidebar.arrange")}</div>
        <div className="flex flex-col gap-0.5">
          <button type="button" className={rowButton} disabled={readOnly} onClick={onAutoLayout}>
            <LayoutGrid size={14} strokeWidth={1.5} />
            {t("editor.autoLayout")}
          </button>
          <button type="button" className={rowButton} disabled={readOnly} onClick={() => onAlign("left")}>
            <AlignStartVertical size={14} strokeWidth={1.5} />
            {t("editor.alignLeft")}
          </button>
          <button type="button" className={rowButton} disabled={readOnly} onClick={() => onAlign("top")}>
            <AlignStartHorizontal size={14} strokeWidth={1.5} />
            {t("editor.alignTop")}
          </button>
          <button type="button" className={rowButton} disabled={readOnly} onClick={() => onDistribute("x")}>
            <AlignHorizontalDistributeCenter size={14} strokeWidth={1.5} />
            {t("editor.distributeX")}
          </button>
          <button type="button" className={rowButton} disabled={readOnly} onClick={() => onDistribute("y")}>
            <AlignVerticalDistributeCenter size={14} strokeWidth={1.5} />
            {t("editor.distributeY")}
          </button>
        </div>
      </section>

      {/* Outline — 현재 스코프 노드 목록 */}
      <section className="min-h-0 flex-1">
        <div className={sectionTitle}>{t("sidebar.outline")}</div>
        {outline.length === 0 ? (
          <p className="px-2 text-fine text-ink-tertiary">{t("sidebar.outlineEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {outline.map((item) => {
              const Icon = TYPE_ICONS[item.nodeType];
              return (
                <li key={item.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelectNode(item.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1 text-caption hover:bg-surface-alt ${
                      item.id === selectedId ? "bg-accent-tint text-accent" : "text-ink-secondary"
                    }`}
                  >
                    <Icon size={13} strokeWidth={1.5} />
                    <span className="truncate">{item.label || t("sidebar.untitled")}</span>
                  </button>
                  {item.hasChildren && (
                    <button
                      type="button"
                      onClick={() => onDrill(item.id)}
                      className="rounded-sm p-1 text-ink-tertiary opacity-0 hover:bg-surface-alt hover:text-ink group-hover:opacity-100"
                      title={t("node.openChildTitle")}
                      aria-label={t("node.openChildTitle")}
                    >
                      <SquareArrowOutUpRight size={13} strokeWidth={1.5} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
