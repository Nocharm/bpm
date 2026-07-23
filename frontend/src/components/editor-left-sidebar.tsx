"use client";

// 에디터 좌측 사이드바 — 아웃라인 전용. 분기 흐름 들여쓰기 + 하위 프로세스 접기/펼치기(계층 색 구분).
// 노드 추가·정렬·색 변경은 우클릭 컨텍스트 메뉴로 이동.

import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Diamond,
  PanelsTopLeft,
  Settings,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { Fragment, type ComponentType, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { terminalDisplayLabel, type OutlineRow, type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
interface EditorLeftSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  // 하단 설정 버튼이 가리키는 맵 — /maps/{mapId}/settings
  mapId: number;
  selectedId: string | null;
  outline: OutlineRow[];
  onSelectNode: (id: string) => void;
  onToggleExpand: (id: string) => void;
  // 행 우클릭 = 캔버스 노드와 동일 컨텍스트 메뉴, 더블클릭 = 이름 인라인 편집
  readOnly: boolean;
  // 노드 검색 — page.tsx가 <NodeSearch>를 만들어 주입(검색 상태·결과 계산은 page.tsx 소유)
  searchSlot: ReactNode;
  onRowContextMenu: (event: MouseEvent, id: string) => void;
  onRenameNode: (id: string, label: string) => void;
  // 하위 스코프(임베드) 행 이름편집 시도 — 편집 UI 대신 읽기전용 안내 토스트
  onReadOnlyRowNotice: () => void;
  // Del/Backspace(아웃라인 포커스) — 선택 노드 삭제
  onDeleteNode: (id: string) => void;
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
const SIDEBAR_NAV_KEYS_KEY = "bpm.sidebar.navKeysOpen";

const TYPE_ICONS: Record<ProcessNodeType, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  start: Circle,
  process: Square,
  decision: Diamond,
  end: CircleDot,
  subprocess: Square,
  section: Square,
};

export function EditorLeftSidebar({
  collapsed,
  onToggleCollapse,
  mapId,
  selectedId,
  outline,
  onSelectNode,
  onToggleExpand,
  readOnly,
  searchSlot,
  onRowContextMenu,
  onRenameNode,
  onReadOnlyRowNotice,
  onDeleteNode,
  onSelectNext,
  onSelectPrev,
  onExpand,
  onCollapse,
  onFold,
}: EditorLeftSidebarProps) {
  const { t } = useI18n();
  // 카드 접힘 — 기본 펼침으로 초기화 후 마운트 시 sessionStorage 복원(초기 SSR 렌더와 일치).
  const [navKeysOpen, setNavKeysOpen] = useState(true);
  useEffect(() => {
    const nk = window.sessionStorage.getItem(SIDEBAR_NAV_KEYS_KEY);
    if (nk !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNavKeysOpen(nk === "1"); // one-time hydration restore from sessionStorage
    }
  }, []);
  const toggleNavKeys = () => {
    const next = !navKeysOpen;
    window.sessionStorage.setItem(SIDEBAR_NAV_KEYS_KEY, next ? "1" : "0");
    setNavKeysOpen(next);
  };
  // 단축키 더보기(전역 단축키) — 버튼 옆 플로팅 패널(구 우하단 레전드 디자인). 위치는 클릭 시 버튼 rect 기준.
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);
  // 인라인 이름 편집 중인 행 — Esc 취소 시 blur 커밋 방지 가드
  const [editingId, setEditingId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  // 편집 중 Tab/Shift+Tab → 저장 후 이동할 노드·방향(blur에서 소비). 리스트 ref는 편집 종료 후 키 포커스 복귀용.
  const pendingNavRef = useRef<{ id: string; dir: "next" | "prev" } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // 선택된 아웃라인 행 — 선택 변경 시 가운데로 부드럽게(ease-in-out) 스크롤. 최상단 선택 시 0으로 clamp되어 맨 위로.
  const selectedRowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [selectedId]);

  // 사이드바 스크롤바 — 기본 숨김(scrollbar-hidden), 스크롤 중에만 커스텀 막대 페이드 인 → 멈추면 페이드 아웃.
  const asideRef = useRef<HTMLElement>(null);
  const hideThumbRef = useRef<number | null>(null);
  const [scrollThumb, setScrollThumb] = useState<{
    top: number;
    height: number;
    visible: boolean;
  } | null>(null);
  const handleSidebarScroll = () => {
    const el = asideRef.current;
    if (!el) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setScrollThumb(null);
      return;
    }
    // 막대 길이·위치는 뷰포트 비율로 계산. 막대가 스크롤 컨테이너 안의 absolute라 top에 scrollTop을 더해 시야에 고정.
    const height = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
    const track = clientHeight - height;
    const top = scrollTop + (scrollTop / (scrollHeight - clientHeight)) * track;
    setScrollThumb({ top, height, visible: true });
    if (hideThumbRef.current !== null) {
      window.clearTimeout(hideThumbRef.current);
    }
    hideThumbRef.current = window.setTimeout(() => {
      setScrollThumb((prev) => (prev ? { ...prev, visible: false } : prev));
    }, 700);
  };
  useEffect(
    () => () => {
      if (hideThumbRef.current !== null) {
        window.clearTimeout(hideThumbRef.current);
      }
    },
    [],
  );

  // 선택 상태 키맵 — Enter=편집, Tab/↓=다음, Shift+Tab/↑=이전, →=펼치기, ←=닫기, F=스마트 토글.
  // 편집 중에는 input이 키를 처리하므로 무시. 방향키·F는 stopPropagation으로 캔버스/전역 단축키와 분리.
  const handleListKey = (event: KeyboardEvent) => {
    if (editingId !== null || !selectedId) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!readOnly) {
        // 하위 스코프(임베드) 행은 읽기전용 — 편집 UI 대신 안내(더블클릭과 동일 게이트)
        if (outline.find((row) => row.id === selectedId)?.hierarchy) {
          onReadOnlyRowNotice();
          return;
        }
        setEditingId(selectedId);
      }
    } else if ((event.key === "Delete" || event.key === "Backspace") && !readOnly) {
      // 아웃라인 포커스 중 삭제 — 캔버스 포커스 시엔 ReactFlow deleteKeyCode가 처리
      event.preventDefault();
      event.stopPropagation();
      onDeleteNode(selectedId);
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
      <div className="flex h-full w-9 shrink-0 flex-col items-center border-r border-hairline bg-surface py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          title={t("sidebar.expand")}
          aria-label={t("sidebar.expand")}
        >
          <PanelsTopLeft size={16} strokeWidth={1.5} />
        </button>
        {/* 하단 고정 — 맵 설정 진입 (접힌 상태에서도 왼쪽 아래 유지) / Map settings, pinned bottom-left */}
        <Link
          href={`/maps/${mapId}/settings`}
          className="mt-auto rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          title={t("perm.settingsTitle")}
          aria-label={t("perm.settingsTitle")}
        >
          <Settings size={16} strokeWidth={1.5} />
        </Link>
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
    { keys: ["↵"], label: t("outlineNav.edit"), active: !!selRow && !readOnly },
    { keys: ["Del"], label: t("outlineNav.delete"), active: !!selRow && !readOnly },
    { keys: ["→"], label: t("outlineNav.expand"), active: !!selRow?.hasChildren && !selRow.expanded },
    {
      keys: ["←"],
      label: t("outlineNav.collapse"),
      active: !!selRow && ((selRow.hasChildren && selRow.expanded) || selRow.hierarchy),
    },
  ];
  // 더보기 — 전역(캔버스) 단축키 모음(구 우하단 레전드). 아웃라인 키와 중복(Del·Tab 이동)은 제외,
  // 토글폴드(F)는 이 안으로 이동. 항목은 현행 키맵 기준 최신.
  const moreShortcuts: { keys: string; label: string }[] = [
    { keys: "F", label: t("outlineNav.fold") },
    { keys: "Ctrl+Z", label: t("legend.undo") },
    { keys: "Ctrl+⇧Z", label: t("legend.redo") },
    { keys: "/", label: t("legend.search") }, // F8에서 Ctrl+K → / 로 변경됨
    { keys: "F2", label: t("legend.rename") },
    { keys: "Space+Drag", label: t("legend.pan") },
    { keys: "Drag", label: t("legend.boxSelect") },
    { keys: t("legend.dblClick"), label: t("legend.connect") },
    { keys: t("legend.hover"), label: t("legend.dropZones") },
    { keys: "Esc", label: t("legend.cancel") },
    { keys: "⇧L", label: t("ctx.autoLayoutH") },
    { keys: "⇧K", label: t("ctx.autoLayoutV") },
    { keys: "Alt+W/C/T/X", label: t("legend.align") },
    { keys: "Alt+R/V", label: t("legend.distribute") },
    { keys: "Alt+←", label: t("legend.toggleLeftSidebar") },
    { keys: "Alt+→", label: t("legend.toggleInspector") },
    { keys: "] [", label: t("legend.flowHighlight") },
    { keys: "Ctrl+G", label: t("legend.createGroup") },
    { keys: "Ctrl+⇧E", label: t("legend.exportPng") },
    { keys: "1–4·E·A…", label: t("legend.menuKeys") },
  ];
  return (
    <aside
      ref={asideRef}
      onScroll={handleSidebarScroll}
      className="scrollbar-hidden relative flex w-56 shrink-0 flex-col overflow-y-auto border-r border-hairline bg-surface p-2"
    >
      {/* 아웃라인 이동 단축키 — 접기/펼치기, 선택 노드 상태로 행별 활성/흐림. (노드 표시 정보 카드는 맵 탭으로 이관) */}
      <div className="contents">
        <div className="mb-2 rounded-sm border border-hairline bg-surface-alt">
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
            <>
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
              {/* 더보기 — 전역 단축키(토글폴드 포함). 클릭 시 버튼 옆 플로팅 패널(구 레전드 디자인)로 열림 */}
              <button
                type="button"
                className="flex w-full min-w-0 items-center justify-between gap-1 border-t border-hairline px-2 py-1.5 text-fine text-ink-tertiary hover:text-ink"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  // 패널이 화면 아래로 넘치지 않게 top 클램프(패널 높이 대략치)
                  const PANEL_H = 460;
                  setMorePos({
                    left: rect.right + 12,
                    top: Math.max(8, Math.min(rect.top, window.innerHeight - PANEL_H - 8)),
                  });
                  setMoreOpen((v) => !v);
                }}
                aria-expanded={moreOpen}
              >
                <span className="truncate">{t("outlineNav.more")}</span>
                <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
              </button>
              {moreOpen &&
                createPortal(
                  <>
                    {/* 바깥 클릭 닫기 — 투명 백드롭 */}
                    <div className="fixed inset-0 z-[1050]" onClick={() => setMoreOpen(false)} />
                    <div
                      className="fixed z-[1051] w-64 rounded-md border border-hairline bg-surface/85 p-3 text-caption shadow-lg backdrop-blur"
                      style={morePos ? { left: morePos.left, top: morePos.top } : undefined}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium text-ink">{t("outlineNav.more")}</span>
                        <button
                          type="button"
                          onClick={() => setMoreOpen(false)}
                          className="text-ink-tertiary hover:text-ink"
                          aria-label={t("common.cancel")}
                        >
                          <X size={14} strokeWidth={1.5} />
                        </button>
                      </div>
                      <ul className="flex flex-col gap-1">
                        {moreShortcuts.map((shortcut) => (
                          <li
                            key={shortcut.label}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="truncate text-ink-secondary">{shortcut.label}</span>
                            <kbd className="shrink-0 rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">
                              {shortcut.keys}
                            </kbd>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>,
                  document.body,
                )}
            </>
          )}
        </div>
      </div>

      {/* 닫기 버튼은 에디터 헤더 좌상단으로 이동 — 여기선 라벨만 / collapse moved to header */}
      <div className="mb-1 px-1">
        <span className="text-caption-strong text-ink">{t("sidebar.outline")}</span>
      </div>

      {searchSlot}

      {outline.length === 0 ? (
        <p className="px-2 text-fine text-ink-tertiary">{t("sidebar.outlineEmpty")}</p>
      ) : (
        <ul
          ref={listRef}
          tabIndex={-1}
          data-editor-outline
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
                      onDoubleClick={() => {
                        if (readOnly) return;
                        // 하위 스코프(임베드) 행 — 이름편집 대신 읽기전용 안내(조용한 무시 방지)
                        if (item.hierarchy) {
                          onReadOnlyRowNotice();
                          return;
                        }
                        setEditingId(item.id);
                      }}
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
                      <span className="truncate">
                        {item.nodeType === "start" || item.nodeType === "end"
                          ? terminalDisplayLabel(item.nodeType, item.label)
                          : item.label || t("sidebar.untitled")}
                      </span>
                    </button>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
      {scrollThumb && (
        <div
          className="pointer-events-none absolute right-0.5 w-1 rounded-full bg-border-strong transition-opacity duration-300"
          style={{
            top: scrollThumb.top,
            height: scrollThumb.height,
            opacity: scrollThumb.visible ? 1 : 0,
          }}
        />
      )}
      {/* 하단 고정 — 맵 설정 진입. 내용이 길어 스크롤돼도 sticky로 왼쪽 아래 유지 / Map settings, pinned bottom */}
      <Link
        href={`/maps/${mapId}/settings`}
        className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-hairline bg-surface px-2 py-2 text-caption text-ink-tertiary hover:bg-surface-alt hover:text-ink"
      >
        <Settings size={16} strokeWidth={1.5} className="shrink-0" />
        <span className="truncate">{t("perm.settingsTitle")}</span>
      </Link>
    </aside>
  );
}
