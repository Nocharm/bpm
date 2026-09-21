"use client";

// 업무 체계 계단식 피커 — 탐색 모달(framework-explorer-modal)의 계단식 트리 규칙(lazy 트리 엔진·가이드 라인·레벨 필·
// 조상 호버 강조·accordion 모션)을 그대로 쓰되 "이동" 대신 "선택"을 한다. 검색 히트 클릭 = 체인 펼침 + 선택.
// AI L5 캠페인 진입(기존 L5 고르기 / 새 L5의 부모 L4 고르기)이 쓴다.
// variant="dropdown"이면 검색 상자만 자리를 차지하고 트리는 상자를 누를 때 body 포털(fixed, z 1350)로 내려온다.
// 관리자 아코디언 섹션(overflow hidden + 내부 스크롤) 안에서도 잘리지 않게 SearchSelect와 같은 포털 규칙.

import { Check, ChevronRight, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { getCategoryChain, listAllCategories, listCategoryNodes, type CategoryLite, type CategoryNode } from "@/lib/api";
import {
  createInitialState,
  reduceFrameworkTree,
  ROOT,
  shouldFetchChildren,
  type FrameworkTreeState,
} from "@/lib/framework-tree-state";
import { useI18n } from "@/lib/i18n";
import { filterByQuery } from "@/lib/search";
import { getTreeIndentStyle, TREE_INDENT_PADDING_CLASS } from "@/lib/tree-indent";
import { useSectionMotion } from "@/lib/use-closing-keys";
import { Highlight } from "@/components/highlight";
import { LevelPill } from "@/components/level-pill";

const SEARCH_CAP = 60;

export interface FrameworkCascadePickerProps {
  selectedId: number | null;
  onSelect: (node: CategoryNode | null) => void;
  // 선택 가능한 레벨(기본 L5만). 새 L5 부모 고르기는 [4]
  selectableLevels?: number[];
  // 펼침 상한(기본 5). 부모 고르기 모드는 4까지만 내려간다
  maxLevel?: number;
  height?: number;  // px — inline은 상자 높이, dropdown은 내려오는 패널 높이 상한
  // inline(기본): 트리가 항상 보이는 상자. dropdown: 검색 상자만 두고 트리는 포털 패널로
  variant?: "inline" | "dropdown";
  dataIdPrefix: string;
}

const DROPDOWN_GAP = 4;
const DROPDOWN_MARGIN = 8;

export function FrameworkCascadePicker({
  selectedId, onSelect, selectableLevels = [5], maxLevel = 5, height = 320, variant = "inline", dataIdPrefix,
}: FrameworkCascadePickerProps) {
  const { t } = useI18n();
  const [tree, setTree] = useState<FrameworkTreeState>(createInitialState());
  const { closingKeys, getSectionClass, openSection, closeSection } = useSectionMotion<number>();
  const [initFailed, setInitFailed] = useState(false);
  const selectable = useMemo(() => new Set(selectableLevels), [selectableLevels]);
  const isDropdown = variant === "dropdown";

  // ── 드롭다운 — 검색 상자 rect 기준 fixed 패널. 열려 있는 동안 스크롤·리사이즈에 재계산(SearchSelect와 동일) ──
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLLabelElement>(null);
  const [panelPos, setPanelPos] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!isDropdown || !open) return;
    const updatePos = () => {
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const top = rect.bottom + DROPDOWN_GAP;
      // 아래 공간이 모자라면 패널을 줄인다 — 위로 뒤집지 않는다(트리는 위→아래로 읽는다)
      const maxBelow = window.innerHeight - DROPDOWN_MARGIN - top;
      setPanelPos({ left: rect.left, top, width: rect.width, height: Math.max(160, Math.min(height, maxBelow)) });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [isDropdown, open, height]);
  useEffect(() => {
    if (!isDropdown || !open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDropdown, open]);

  // 고르면 드롭다운은 닫힌다(선택 해제는 열어 둔다) — 선택 결과는 호출부 요약 카드가 보여준다
  function pick(node: CategoryNode | null) {
    onSelect(node);
    if (isDropdown && node !== null) setOpen(false);
  }

  // 루트 + (초기 선택이 있으면) 그 체인을 미리 펼친다 — 탐색 모달 init과 같은 순서
  useEffect(() => {
    let active = true;
    async function init() {
      const chain = selectedId === null ? [] : await getCategoryChain(selectedId);
      const ancestorIds = chain.slice(0, -1).map((c) => c.id);
      const [roots, ...loaded] = await Promise.all([listCategoryNodes(), ...ancestorIds.map((id) => listCategoryNodes(id))]);
      if (!active) return;
      let next = createInitialState();
      next = reduceFrameworkTree(next, { type: "children_loaded", parentId: ROOT, nodes: roots });
      ancestorIds.forEach((id, i) => {
        next = reduceFrameworkTree(next, { type: "opened", categoryId: id });
        next = reduceFrameworkTree(next, { type: "children_loaded", parentId: id, nodes: loaded[i] });
      });
      setTree(next);
    }
    void init().catch(() => { if (active) setInitFailed(true); });
    return () => { active = false; };
    // 초기 1회만 — 이후 선택 변화는 handleToggle/reveal이 트리를 갱신한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadChildren(categoryId: number) {
    setTree((prev) => reduceFrameworkTree(prev, { type: "loading_started", categoryId }));
    return listCategoryNodes(categoryId)
      .then((nodes) => setTree((prev) => reduceFrameworkTree(reduceFrameworkTree(prev, { type: "children_loaded", parentId: categoryId, nodes }), { type: "loading_ended", categoryId })))
      .catch(() => setTree((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId })));
  }

  function handleToggle(categoryId: number) {
    if (tree.openIds.has(categoryId)) {
      closeSection(categoryId);
      setTree((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    openSection(categoryId, true);
    setTree((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId }));
    if (shouldFetchChildren(tree, categoryId)) void loadChildren(categoryId);
  }

  // 검색 히트 → 체인을 펼치고 선택 (경량 행이라 chain으로 노드를 되찾는다)
  async function reveal(categoryId: number) {
    const chain = await getCategoryChain(categoryId);
    const self = chain[chain.length - 1];
    if (!self) return;
    const ancestorIds = chain.slice(0, -1).map((c) => c.id);
    const missing = ancestorIds.filter((id) => !tree.childrenByParent.has(id));
    const loaded = await Promise.all(missing.map((id) => listCategoryNodes(id)));
    setTree((prev) => {
      let next = prev;
      missing.forEach((id, i) => { next = reduceFrameworkTree(next, { type: "children_loaded", parentId: id, nodes: loaded[i] }); });
      ancestorIds.forEach((id) => { next = reduceFrameworkTree(next, { type: "opened", categoryId: id }); });
      return next;
    });
    ancestorIds.forEach((id) => openSection(id, false));
    setQuery("");
    pick(self);
  }

  // ── 검색 — 전 카테고리 경량 목록을 클라이언트에서 거른다(탐색 모달과 동일) ──
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<CategoryLite[] | null>(null);
  useEffect(() => {
    let active = true;
    void listAllCategories().then((rows) => { if (active) setAll(rows); }).catch(() => { if (active) setAll([]); });
    return () => { active = false; };
  }, []);
  const liteById = useMemo(() => new Map((all ?? []).map((c) => [c.id, c])), [all]);
  const pathOf = (c: CategoryLite): string => {
    const parts: string[] = [];
    for (let cur = c.parent_id === null ? undefined : liteById.get(c.parent_id); cur; cur = cur.parent_id === null ? undefined : liteById.get(cur.parent_id)) {
      parts.unshift(cur.name);
    }
    return parts.join(" › ");
  };
  const trimmed = query.trim();
  const hits = useMemo(
    () => (all && trimmed !== ""
      ? filterByQuery(all.filter((c) => selectable.has(c.level)), trimmed, (c) => [{ field: "name", text: c.name }]).slice(0, SEARCH_CAP)
      : null),
    [all, trimmed, selectable],
  );

  const renderNode = (node: CategoryNode, depth: number): ReactNode => {
    const open = tree.openIds.has(node.id);
    const kids = tree.childrenByParent.get(node.id) ?? [];
    const loading = tree.loadingIds.has(node.id);
    const isSelected = node.id === selectedId;
    const canPick = selectable.has(node.level);
    const canExpand = node.level < maxLevel;
    const showKids = (open || closingKeys.has(node.id)) && kids.length > 0;
    return (
      <li key={node.id} data-tree-node data-id={`${dataIdPrefix}-node-${node.id}`} className="flex flex-col">
        <div
          data-tree-head
          style={getTreeIndentStyle(depth)}
          className={`group relative flex items-center gap-1 rounded-sm ${isSelected ? "bg-accent-tint" : "hover:bg-divider"}`}
        >
          <button
            type="button"
            aria-expanded={canExpand ? open : undefined}
            aria-label={canExpand ? (open ? "collapse" : "expand") : undefined}
            disabled={!canExpand}
            className={`inline-flex h-7 w-6 shrink-0 items-center justify-center text-ink-tertiary disabled:opacity-0 ${TREE_INDENT_PADDING_CLASS}`}
            onClick={() => handleToggle(node.id)}
          >
            {loading ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <ChevronRight size={12} strokeWidth={1.5} className={`motion-safe:transition-transform motion-safe:duration-150 ease-smooth ${open ? "rotate-90" : ""}`} />
            )}
          </button>
          <button
            type="button"
            data-id={`${dataIdPrefix}-${canPick ? "pick" : "open"}-${node.id}`}
            aria-pressed={canPick ? isSelected : undefined}
            className={`flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left ${canPick ? "" : "cursor-default"}`}
            onClick={() => (canPick ? pick(isSelected ? null : node) : canExpand && handleToggle(node.id))}
          >
            <LevelPill level={node.level} size="sm" />
            <span
              data-tree-name={isSelected ? undefined : ""}
              className={`min-w-0 truncate text-fine ${isSelected ? "font-semibold text-accent" : canPick ? "text-ink" : "text-ink-secondary group-hover:text-ink"}`}
            >
              {node.name}
            </span>
            {node.level < 5 && (
              <span className="ml-auto shrink-0 text-fine text-ink-muted">{t("category.summary.l5Count", { n: node.l5_count })}</span>
            )}
            {canPick && (
              <span className={`shrink-0 text-accent ${isSelected ? "" : "opacity-0 transition-opacity group-hover:opacity-100"}`}>
                <Check size={14} strokeWidth={1.5} />
              </span>
            )}
          </button>
        </div>
        {showKids && (
          <div className={getSectionClass(node.id)}>
            <ul className="ml-3 flex flex-col border-l border-divider pl-1">{kids.map((k) => renderNode(k, depth + 1))}</ul>
          </div>
        )}
      </li>
    );
  };

  const roots = tree.childrenByParent.get(ROOT) ?? [];
  const searchBox = (
    <label
      ref={boxRef}
      className={`flex min-w-0 items-center gap-2 rounded-sm border bg-surface px-2.5 py-1.5 text-caption text-ink ${isDropdown ? "" : "m-2"} ${isDropdown && open ? "border-accent" : "border-hairline"}`}
    >
      <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
      <input
        data-id={`${dataIdPrefix}-search`}
        value={query}
        onChange={(e) => { setQuery(e.target.value); if (isDropdown) setOpen(true); }}
        onFocus={() => { if (isDropdown) setOpen(true); }}
        onClick={() => { if (isDropdown) setOpen(true); }}
        placeholder={t("framework.explorer.search")}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-muted"
      />
      {query !== "" ? (
        <button type="button" aria-label="clear" className="text-ink-muted hover:text-ink" onClick={() => setQuery("")}>
          <X size={12} strokeWidth={1.5} />
        </button>
      ) : isDropdown ? (
        <ChevronRight size={12} strokeWidth={1.5} className={`shrink-0 text-ink-tertiary motion-safe:transition-transform motion-safe:duration-150 ease-smooth ${open ? "rotate-90" : ""}`} />
      ) : null}
    </label>
  );
  const body = (
      <div className="relative flex min-h-0 flex-1">
        {hits !== null ? (
          <ul data-id={`${dataIdPrefix}-results`} className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            {hits.length === 0 ? (
              <li className="px-2 py-6 text-center text-fine text-ink-tertiary">{t("framework.explorer.noResults")}</li>
            ) : (
              hits.map(({ item: c, matches }) => {
                const ranges = matches.find((m) => m.field === "name")?.ranges ?? [];
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-id={`${dataIdPrefix}-result-${c.id}`}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-alt"
                      onClick={() => void reveal(c.id)}
                    >
                      <LevelPill level={c.level} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-fine text-ink"><Highlight text={c.name} ranges={ranges} /></span>
                      <span className="min-w-0 max-w-[50%] truncate text-fine text-ink-tertiary">{pathOf(c)}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : (
          <div data-id={`${dataIdPrefix}-tree`} className="fw-tree flex-1 overflow-y-auto px-2 pb-2">
            {initFailed ? (
              <p className="px-2 py-6 text-center text-fine text-error">{t("home.frameworkLoadError")}</p>
            ) : roots.length === 0 ? (
              <p className="px-2 py-6 text-center text-fine text-ink-tertiary">{t("common.loading")}</p>
            ) : (
              <ul className="flex flex-col border-l border-transparent pl-1">{roots.map((r) => renderNode(r, 0))}</ul>
            )}
          </div>
        )}
      </div>
  );
  if (isDropdown) {
    return (
      <div className="flex flex-col" data-id={`${dataIdPrefix}`} data-open={open}>
        {searchBox}
        {open && panelPos && createPortal(
          <>
            {/* 바깥 클릭 닫기 — 상자 자체도 덮이지만 포커스는 입력에 남아 타이핑은 계속된다 */}
            <div className="fixed inset-0 z-[1340]" onClick={() => setOpen(false)} />
            <div
              data-id={`${dataIdPrefix}-panel`}
              className="fixed z-[1350] flex flex-col overflow-hidden rounded-md border border-hairline bg-surface pt-2 shadow-lg"
              style={{ left: panelPos.left, top: panelPos.top, width: panelPos.width, height: panelPos.height }}
            >
              {body}
            </div>
          </>,
          document.body,
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-hairline bg-surface" style={{ height }} data-id={`${dataIdPrefix}`}>
      {searchBox}
      {body}
    </div>
  );
}
