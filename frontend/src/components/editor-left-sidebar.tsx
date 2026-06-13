"use client";

// 에디터 좌측 사이드바 — 아웃라인 전용. 분기 흐름 들여쓰기 + 하위 프로세스 접기/펼치기(계층 색 구분).
// 노드 추가·정렬·색 변경은 우클릭 컨텍스트 메뉴로 이동.

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Diamond,
  PanelsTopLeft,
  Square,
} from "lucide-react";
import { Fragment, type ComponentType } from "react";

import type { OutlineRow, ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

interface EditorLeftSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  selectedId: string | null;
  outline: OutlineRow[];
  onSelectNode: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

const TYPE_ICONS: Record<ProcessNodeType, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  start: Circle,
  process: Square,
  decision: Diamond,
  end: CircleDot,
};

export function EditorLeftSidebar({
  collapsed,
  onToggleCollapse,
  selectedId,
  outline,
  onSelectNode,
  onToggleExpand,
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
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-hairline bg-surface p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="px-1 text-caption-strong text-ink">{t("sidebar.outline")}</span>
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

      {outline.length === 0 ? (
        <p className="px-2 text-fine text-ink-tertiary">{t("sidebar.outlineEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {outline.map((item, index) => {
            const Icon = TYPE_ICONS[item.nodeType];
            const newBlock = index > 0 && item.blockIndex !== outline[index - 1].blockIndex;
            return (
              <Fragment key={item.id}>
                {newBlock && <li role="separator" className="my-1 border-t border-divider" />}
                <li
                  className={`group flex items-center ${
                    item.hierarchy ? "border-l-2 border-accent-tint-border" : ""
                  }`}
                  style={{ paddingLeft: item.depth * 12 }}
                >
                  {item.hasChildren ? (
                    <button
                      type="button"
                      onClick={() => onToggleExpand(item.id)}
                      className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                      aria-label={item.expanded ? t("sidebar.collapseNode") : t("sidebar.expandNode")}
                    >
                      {item.expanded ? (
                        <ChevronDown size={13} strokeWidth={1.5} />
                      ) : (
                        <ChevronRight size={13} strokeWidth={1.5} />
                      )}
                    </button>
                  ) : (
                    <span className="w-[18px] shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectNode(item.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-caption hover:bg-surface-alt ${
                      item.id === selectedId
                        ? "bg-accent-tint text-accent"
                        : item.hierarchy
                          ? "text-ink-tertiary"
                          : "text-ink-secondary"
                    }`}
                  >
                    <Icon size={13} strokeWidth={1.5} />
                    <span className="truncate">{item.label || t("sidebar.untitled")}</span>
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
