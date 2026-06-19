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
import { Fragment, type ComponentType, type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";

import type { OutlineRow, ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { NODE_DISPLAY_FIELDS, type NodeDisplayField } from "@/lib/node-actions";

const FIELD_LABEL_KEY: Record<NodeDisplayField, MessageKey> = {
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
  nodeType: "field.type",
};

interface EditorLeftSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  selectedId: string | null;
  outline: OutlineRow[];
  onSelectNode: (id: string) => void;
  onToggleExpand: (id: string) => void;
  displayFields: NodeDisplayField[];
  onToggleDisplayField: (field: NodeDisplayField) => void;
  // 행 우클릭 = 캔버스 노드와 동일 컨텍스트 메뉴, 더블클릭 = 이름 인라인 편집
  readOnly: boolean;
  onRowContextMenu: (event: MouseEvent, id: string) => void;
  onRenameNode: (id: string, label: string) => void;
  // Tab 네비게이션 — 다음 노드 선택(하위 프로세스 있으면 하위로 진입). 페이지가 트리로 계산.
  onSelectNext: (id: string) => void;
  // Shift+Tab/↑ — 아웃라인의 이전(위) 노드 선택.
  onSelectPrev: (id: string) => void;
  // 방향키 →/← 및 F — 펼치기 / 하위프로세스 닫기 / 스마트 토글.
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onFold: (id: string) => void;
}

// 사이드바 카드 접힘 상태 — 새로고침해도 세션 동안 유지(sessionStorage).
const SIDEBAR_NODE_INFO_KEY = "bpm.sidebar.nodeInfoOpen";
const SIDEBAR_NAV_KEYS_KEY = "bpm.sidebar.navKeysOpen";

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
  displayFields,
  onToggleDisplayField,
  readOnly,
  onRowContextMenu,
  onRenameNode,
  onSelectNext,
  onSelectPrev,
  onExpand,
  onCollapse,
  onFold,
}: EditorLeftSidebarProps) {
  const { t } = useI18n();
  // 카드 접힘 — 기본 펼침으로 초기화 후 마운트 시 sessionStorage 복원(초기 SSR 렌더와 일치).
  const [nodeInfoOpen, setNodeInfoOpen] = useState(true);
  const [navKeysOpen, setNavKeysOpen] = useState(true);
  useEffect(() => {
    const ni = window.sessionStorage.getItem(SIDEBAR_NODE_INFO_KEY);
    const nk = window.sessionStorage.getItem(SIDEBAR_NAV_KEYS_KEY);
    if (ni !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNodeInfoOpen(ni === "1"); // one-time hydration restore from sessionStorage
    }
    if (nk !== null) {
      setNavKeysOpen(nk === "1"); // one-time hydration restore from sessionStorage
    }
  }, []);
  const toggleNodeInfo = () => {
    const next = !nodeInfoOpen;
    window.sessionStorage.setItem(SIDEBAR_NODE_INFO_KEY, next ? "1" : "0");
    setNodeInfoOpen(next);
  };
  const toggleNavKeys = () => {
    const next = !navKeysOpen;
    window.sessionStorage.setItem(SIDEBAR_NAV_KEYS_KEY, next ? "1" : "0");
    setNavKeysOpen(next);
  };
  // 인라인 이름 편집 중인 행 — Esc 취소 시 blur 커밋 방지 가드
  const [editingId, setEditingId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  // 편집 중 Tab/Shift+Tab → 저장 후 이동할 노드·방향(blur에서 소비). 리스트 ref는 편집 종료 후 키 포커스 복귀용.
  const pendingNavRef = useRef<{ id: string; dir: "next" | "prev" } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // 선택된 아웃라인 행 — 선택 변경 시 보이도록 스크롤(키보드 이동으로 스크롤 영역 밖 이탈 방지).
  const selectedRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  // 선택 상태 키맵 — Enter=편집, Tab/↓=다음, Shift+Tab/↑=이전, →=펼치기, ←=닫기, F=스마트 토글.
  // 편집 중에는 input이 키를 처리하므로 무시. 방향키·F는 stopPropagation으로 캔버스/전역 단축키와 분리.
  const handleListKey = (event: KeyboardEvent) => {
    if (editingId !== null || !selectedId) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!readOnly) {
        setEditingId(selectedId);
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        onSelectPrev(selectedId);
      } else {
        onSelectNext(selectedId);
      }
      listRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onSelectNext(selectedId);
      listRef.current?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      onSelectPrev(selectedId);
      listRef.current?.focus();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      onExpand(selectedId);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      onCollapse(selectedId);
    } else if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey) {
      // 단축키 F만 가로채고 Ctrl/Cmd+F(브라우저 찾기)는 통과
      event.preventDefault();
      event.stopPropagation();
      onFold(selectedId);
      listRef.current?.focus();
    }
  };

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

  // 아웃라인 이동 단축키 안내 — 선택 노드 상태로 각 행 활성/비활성(고정 목록).
  const selIdx = selectedId ? outline.findIndex((row) => row.id === selectedId) : -1;
  const selRow = selIdx >= 0 ? outline[selIdx] : null;
  const navShortcuts: { keys: string[]; label: string; active: boolean }[] = [
    { keys: ["↑", "⇧Tab"], label: t("outlineNav.prev"), active: selIdx > 0 },
    {
      keys: ["↓", "Tab"],
      label: t("outlineNav.next"),
      active: selIdx >= 0 && selIdx < outline.length - 1,
    },
    { keys: ["→"], label: t("outlineNav.expand"), active: !!selRow?.hasChildren && !selRow.expanded },
    {
      keys: ["←"],
      label: t("outlineNav.collapse"),
      active: !!selRow && ((selRow.hasChildren && selRow.expanded) || selRow.hierarchy),
    },
    {
      keys: ["F"],
      label: t("outlineNav.fold"),
      active: !!selRow && (selRow.hasChildren || selRow.hierarchy),
    },
  ];
  // 둘 다 접히면 위아래가 아닌 같은 줄에 나눠 배치.
  const bothCollapsed = !nodeInfoOpen && !navKeysOpen;

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-hairline bg-surface p-2">
      {/* 노드 정보 · 아웃라인 단축키 — 둘 다 접히면 한 줄에 나눠, 아니면 세로 스택(contents) */}
      <div className={bothCollapsed ? "mb-2 flex items-start gap-2" : "contents"}>
        {/* 노드에 표시할 정보 — 접기/펼치기, 상태 sessionStorage 영속 */}
        <div
          className={`rounded-sm border border-hairline bg-surface-alt ${
            bothCollapsed ? "min-w-0 flex-1" : "mb-2"
          }`}
        >
          <button
            type="button"
            className="flex w-full min-w-0 items-center justify-between gap-1 p-2 text-fine text-ink-tertiary"
            onClick={toggleNodeInfo}
            aria-expanded={nodeInfoOpen}
          >
            <span className="truncate">{t("sidebar.nodeInfo")}</span>
            {nodeInfoOpen ? (
              <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
            )}
          </button>
          {nodeInfoOpen && (
            <div className="flex flex-col gap-1 px-2 pb-2">
              {NODE_DISPLAY_FIELDS.map((field) => {
                const on = displayFields.includes(field);
                return (
                  <div
                    key={field}
                    className="flex items-center justify-between text-fine text-ink-secondary"
                  >
                    <span>{t(FIELD_LABEL_KEY[field])}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={t(FIELD_LABEL_KEY[field])}
                      onClick={() => onToggleDisplayField(field)}
                      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                        on ? "bg-accent" : "bg-border-strong"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-all ${
                          on ? "left-3.5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 아웃라인 이동 단축키 — 접기/펼치기(노드인포 카드와 동일), 선택 노드 상태로 행별 활성/흐림 */}
        <div
          className={`rounded-sm border border-hairline bg-surface-alt ${
            bothCollapsed ? "min-w-0 flex-1" : "mb-2"
          }`}
        >
          <button
            type="button"
            className="flex w-full min-w-0 items-center justify-between gap-1 p-2 text-fine text-ink-tertiary"
            onClick={toggleNavKeys}
            aria-expanded={navKeysOpen}
          >
            <span className="truncate">{t("outlineNav.title")}</span>
            {navKeysOpen ? (
              <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
            )}
          </button>
          {navKeysOpen && (
            <ul className="flex flex-col gap-0.5 px-2 pb-2">
              {navShortcuts.map((shortcut) => (
                <li
                  key={shortcut.label}
                  className={`flex items-center justify-between gap-2 px-1 text-fine transition-opacity ${
                    shortcut.active ? "text-ink-secondary" : "opacity-40"
                  }`}
                >
                  <span className="truncate">{shortcut.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

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
        <ul
          ref={listRef}
          tabIndex={-1}
          onKeyDown={handleListKey}
          className="flex flex-col gap-0.5 outline-none"
        >
          {outline.map((item, index) => {
            const Icon = TYPE_ICONS[item.nodeType];
            const newBlock = index > 0 && item.blockIndex !== outline[index - 1].blockIndex;
            return (
              <Fragment key={item.id}>
                {newBlock && <li role="separator" className="my-1 border-t border-divider" />}
                <li
                  ref={item.id === selectedId ? selectedRowRef : null}
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
                  {editingId === item.id ? (
                    <input
                      autoFocus
                      defaultValue={item.label}
                      className="min-w-0 flex-1 rounded-sm border border-accent px-1.5 py-1 text-caption"
                      onBlur={(event) => {
                        const value = event.target.value;
                        setEditingId(null);
                        if (cancelledRef.current) {
                          cancelledRef.current = false; // Esc 취소 — 저장 안 함
                        } else {
                          onRenameNode(item.id, value);
                        }
                        const nav = pendingNavRef.current;
                        pendingNavRef.current = null;
                        if (nav) {
                          // Tab 저장 후 이동 — 방향에 따라 다음/이전 노드
                          (nav.dir === "prev" ? onSelectPrev : onSelectNext)(nav.id);
                        }
                        listRef.current?.focus(); // 키 포커스 복귀(연속 편집/이동)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur(); // 한번 더 Enter = 저장
                        } else if (event.key === "Tab") {
                          event.preventDefault();
                          // 저장 후 이동할 노드·방향 기록(Shift+Tab=이전)
                          pendingNavRef.current = {
                            id: item.id,
                            dir: event.shiftKey ? "prev" : "next",
                          };
                          event.currentTarget.blur();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelledRef.current = true; // 변경 취소
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectNode(item.id)}
                      onDoubleClick={() => !readOnly && setEditingId(item.id)}
                      onContextMenu={(event) => onRowContextMenu(event, item.id)}
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
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
