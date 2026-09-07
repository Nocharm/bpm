// 라이브러리 부서 필터 플라이아웃 — 조직도 트리(아코디언 모션)+검색+내 부서 찾기. 필터 팝오버 우측 도킹 포털.
"use client";

import { ChevronRight, LocateFixed, Search, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { CheckInput } from "@/components/check-input";
import {
  buildDeptPathTree,
  collectDeptMatches,
  type DeptPathOption,
  type DeptTreeNode,
} from "@/lib/dept-path-tree";
import { useI18n } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n-messages";
import { buildOrgPathChain, formatDeptName } from "@/lib/korean-dept";
import { useSectionMotion } from "@/lib/use-closing-keys";

// w-72(288px) — 오른쪽 공간이 모자라면 왼쪽으로 뒤집는 판정에 쓰므로 클래스와 함께 유지한다.
const FLYOUT_WIDTH = 288;
// 자동 드릴인 상한 — 단일 후보 체인이라도 무한히 파고들지 않게(framework-tree-picker와 같은 규칙)
const AUTO_DRILL_MAX = 6;
// 내 부서 찾기 — 조상을 한 단계씩 여는 간격(ms). 시선이 펼침을 따라갈 만큼만 늦춘다.
const FIND_MINE_STAGGER_MS = 120;
// 도착한 행을 잠시 강조하는 시간(ms)
const FLASH_MS = 1200;

export interface LibraryDeptFlyoutProps {
  options: DeptPathOption[]; // 트리 소스 — 조직도 부서 ∪ 라이브러리 행 부서
  selected: string[]; // filters.departments (org path)
  onToggle: (path: string) => void; // 팝오버 행과 같은 핸들러
  myOrgPath: string | null;
  anchorRect: DOMRect; // 필터 팝오버의 rect — 열 때 측정해 넘어온다
  containerRef: React.RefObject<HTMLDivElement | null>; // 소유자의 바깥 클릭 판정용
  onClose: () => void;
  lang: Lang;
  koreanDeptByPath: Map<string, string>;
}

export function LibraryDeptFlyout({
  options,
  selected,
  onToggle,
  myOrgPath,
  anchorRect,
  containerRef,
  onClose,
  lang,
  koreanDeptByPath,
}: LibraryDeptFlyoutProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flashPath, setFlashPath] = useState<string | null>(null);
  const { closingKeys, getSectionClass, openSection, closeSection } = useSectionMotion<string>();
  // 스크롤 대상 조회 — document.querySelector 대신 행 ref 맵(포털이 여러 개여도 내 것만 잡는다)
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const staggerTimersRef = useRef<number[]>([]);
  const flashTimerRef = useRef<number | null>(null);

  function clearFindMineTimers() {
    for (const id of staggerTimersRef.current) window.clearTimeout(id);
    staggerTimersRef.current = [];
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }
  useEffect(() => clearFindMineTimers, []);

  // Esc는 플라이아웃만 닫고 전파를 끊는다 — 팝오버·에디터의 Esc 핸들러까지 번지지 않게.
  const handleEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => handleEscape(event);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const roots = buildDeptPathTree(options);
  const matches = collectDeptMatches(roots, query);

  function revealPath(path: string, byUser: boolean) {
    openSection(path, byUser);
    setExpanded((prev) => new Set(prev).add(path));
  }

  function toggleNode(node: DeptTreeNode) {
    if (expanded.has(node.path)) {
      // 고스트가 accordion-close를 재생하는 동안에도 closingKeys로 계속 렌더된다
      closeSection(node.path);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
      return;
    }
    openSection(node.path, true); // 사용자가 직접 편 노드만 accordion-open 재생
    const opened = new Set(expanded).add(node.path);
    // 하위 후보가 하나뿐이면 선택지가 생기는 지점까지 계속 펼친다(자동 펼침은 static)
    let cursor = node;
    for (let hop = 0; hop < AUTO_DRILL_MAX; hop += 1) {
      const only = cursor.children.length === 1 ? cursor.children[0] : null;
      if (!only || only.children.length === 0) break;
      openSection(only.path, false);
      opened.add(only.path);
      cursor = only;
    }
    setExpanded(opened);
  }

  function findMine() {
    if (!myOrgPath) return;
    clearFindMineTimers();
    setQuery(""); // 검색 중이면 트리 문맥이 잘려 있다 — 전체 트리로 되돌린 뒤 드릴인
    const ancestors = buildOrgPathChain(myOrgPath).slice(0, -1);
    ancestors.forEach((path, i) => {
      staggerTimersRef.current.push(
        window.setTimeout(() => revealPath(path, true), i * FIND_MINE_STAGGER_MS),
      );
    });
    // 마지막 조상이 펼쳐진 뒤(조상이 없으면 즉시) 내 행으로 스크롤 + 잠시 강조
    staggerTimersRef.current.push(
      window.setTimeout(() => {
        rowRefs.current.get(myOrgPath)?.scrollIntoView({ block: "center", behavior: "smooth" });
        setFlashPath(myOrgPath);
        flashTimerRef.current = window.setTimeout(() => setFlashPath(null), FLASH_MS);
      }, ancestors.length * FIND_MINE_STAGGER_MS),
    );
  }

  const renderNode = (node: DeptTreeNode): ReactNode => {
    if (matches && !matches.has(node.path)) return null;
    // 검색 중엔 접힘 무시(매치 문맥 보이기) — 아코디언 모션도 이때는 걸지 않는다.
    const showChildren =
      node.children.length > 0 &&
      (matches !== null || expanded.has(node.path) || closingKeys.has(node.path));
    const isOpen = node.children.length > 0 && (matches !== null || expanded.has(node.path));
    return (
      <div key={node.path} className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1" style={{ paddingLeft: `${node.depth * 12}px` }}>
          {node.children.length > 0 ? (
            <button
              type="button"
              data-id="library-dept-toggle"
              data-path={node.path}
              aria-expanded={isOpen}
              aria-label={isOpen ? "collapse" : "expand"}
              onClick={() => toggleNode(node)}
              className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt"
            >
              <ChevronRight
                size={12}
                strokeWidth={1.5}
                className={`motion-safe:transition-transform motion-safe:duration-150 ease-smooth ${isOpen ? "rotate-90" : ""}`}
              />
            </button>
          ) : (
            <span className="w-[18px] shrink-0" />
          )}
          <label
            data-id="library-dept-row"
            data-path={node.path}
            ref={(el) => {
              if (el) rowRefs.current.set(node.path, el);
              else rowRefs.current.delete(node.path);
            }}
            title={node.path}
            className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-xs px-1 py-1 text-fine text-ink transition-colors duration-350 hover:bg-surface-alt ${
              flashPath === node.path ? "bg-accent-tint" : ""
            }`}
          >
            <CheckInput checked={selected.includes(node.path)} onChange={() => onToggle(node.path)} />
            <span className="min-w-0 truncate">{formatDeptName(node.path, lang, koreanDeptByPath)}</span>
            {node.path === myOrgPath && (
              <span
                data-id="library-dept-mine"
                className="ml-auto shrink-0 rounded-full bg-accent-tint px-1.5 text-[10px] leading-4 text-accent"
              >
                {t("library.filterDeptMine")}
              </span>
            )}
          </label>
        </div>
        {showChildren && (
          // 아코디언 래퍼는 자식이 하나여야 grid 0fr→1fr가 전체를 접는다 — 목록을 한 겹 감싼다
          <div className={matches ? "" : getSectionClass(node.path)}>
            <div className="flex min-w-0 flex-col">{node.children.map(renderNode)}</div>
          </div>
        )}
      </div>
    );
  };

  const isEmpty = roots.length === 0 || (matches !== null && matches.size === 0);
  const maxHeight = Math.min(Math.round(window.innerHeight * 0.6), window.innerHeight - 16);
  const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - maxHeight - 8));
  const rightDocked = anchorRect.right + 6;
  // 오른쪽에 안 들어가면 팝오버 왼쪽으로 뒤집는다(패널이 화면 우측에 붙는 레이아웃 대비)
  const left =
    rightDocked + FLYOUT_WIDTH > window.innerWidth - 8
      ? anchorRect.left - 6 - FLYOUT_WIDTH
      : rightDocked;

  return createPortal(
    <div
      ref={containerRef}
      data-id="library-dept-flyout"
      className="fixed z-[1350] flex w-72 flex-col rounded-md border border-hairline bg-surface p-2 shadow-lg"
      style={{ left, top, maxHeight }}
    >
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5">
          <Search size={12} strokeWidth={1.5} className="shrink-0 text-ink/40" />
          <input
            data-id="library-dept-search"
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("library.filterDeptSearch")}
            className="min-w-0 flex-1 bg-transparent text-fine text-ink outline-none placeholder:text-ink/40"
          />
        </div>
        <button
          type="button"
          data-id="library-dept-find-mine"
          onClick={findMine}
          disabled={!myOrgPath}
          aria-label={t("library.filterDeptFindMine")}
          title={t("library.filterDeptFindMine")}
          className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <LocateFixed size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          data-id="library-dept-flyout-close"
          onClick={onClose}
          aria-label={t("common.cancel")}
          className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div data-id="library-dept-flyout-list" className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          <p data-id="library-dept-empty" className="px-1 py-2 text-fine text-ink-tertiary">
            {t("library.filterDeptEmpty")}
          </p>
        ) : (
          roots.map(renderNode)
        )}
      </div>
    </div>,
    document.body,
  );
}
