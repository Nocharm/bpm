// 홈 Framework 뷰 — lazy 카테고리 트리(컨설턴트 업무 체계). org-accordion.tsx 행 UX를 미러하되
// 캐시·펼침 상태는 lib/framework-tree-state.ts 순수 리듀서가 소유(thin 렌더러). v1은 브라우즈 전용 —
// 검색은 Departments 뷰가 커버(설계 §6 v1 단순화).
"use client";

import { ChevronDown, ChevronRight, FolderTree } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { CategoryMaps, CategoryNode, MapSummary } from "@/lib/api";
import {
  applyCategoryLoaded,
  createInitialState,
  fetchCategoryChildren,
  fetchMoreMaps,
  fetchRootChildren,
  hasCachedChildren,
  reduceFrameworkTree,
  ROOT,
  type FrameworkTreeState,
} from "@/lib/framework-tree-state";
import { useI18n } from "@/lib/i18n";
import { CountTag } from "@/components/maps/count-tag";

interface FrameworkTreeProps {
  // page.tsx의 기존 renderCard를 그대로 물려받아 맵 행 렌더를 OrgAccordion과 일원화 (selectedId는 renderCard 클로저 내부 처리).
  renderCard: (map: MapSummary) => ReactNode;
  selectedId: number | null;
}

export function FrameworkTree({ renderCard }: FrameworkTreeProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());

  // 루트 1회 로드 — StrictMode 이중 마운트는 `active` 가드로(기존 page.tsx 패턴과 동일).
  useEffect(() => {
    let active = true;
    void fetchRootChildren().then((nodes) => {
      if (active) {
        setState((prev) => reduceFrameworkTree(prev, { type: "children_loaded", parentId: ROOT, nodes }));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function handleToggle(categoryId: number) {
    if (state.openIds.has(categoryId)) {
      setState((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    const cached = hasCachedChildren(state, categoryId);
    setState((prev) => {
      let next = reduceFrameworkTree(prev, { type: "opened", categoryId });
      if (!cached) next = reduceFrameworkTree(next, { type: "loading_started", categoryId });
      return next;
    });
    if (cached) return;
    void fetchCategoryChildren(categoryId).then(({ nodes, maps }) => {
      setState((prev) => applyCategoryLoaded(prev, categoryId, nodes, maps));
    });
  }

  function handleLoadMore(categoryId: number) {
    void fetchMoreMaps(state, categoryId).then((maps) => {
      setState((prev) => reduceFrameworkTree(prev, { type: "maps_loaded", categoryId, maps, append: true }));
    });
  }

  // 맵 인셋 — org-accordion.tsx와 동일 상수(depth 무관 고정폭).
  const renderMapList = (categoryId: number, mapsData: CategoryMaps | undefined) => {
    if (!mapsData) return null;
    const shown = mapsData.maps.length;
    return (
      <ul className="flex flex-col gap-2 pl-5 pr-2">
        {mapsData.maps.map((m) => (
          <li key={m.id}>{renderCard(m)}</li>
        ))}
        {mapsData.hidden > 0 && (
          <li className="text-fine text-ink-tertiary">{t("home.frameworkHidden", { n: mapsData.hidden })}</li>
        )}
        {mapsData.total > shown + mapsData.hidden && (
          <li>
            <button
              type="button"
              data-id="framework-more"
              className="text-fine text-accent hover:underline"
              onClick={() => handleLoadMore(categoryId)}
            >
              {t("home.frameworkMore")}
            </button>
          </li>
        )}
      </ul>
    );
  };

  const renderNode = (node: CategoryNode, depth: number): ReactNode => {
    const open = state.openIds.has(node.id);
    const loading = state.loadingIds.has(node.id);
    const children = state.childrenByParent.get(node.id) ?? [];
    const mapsData = state.mapsByCategory.get(node.id);

    return (
      <li key={node.id} data-id="framework-node" className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => handleToggle(node.id)}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className="group flex w-full items-center gap-1.5 rounded-sm py-1 text-left hover:bg-divider"
        >
          {open
            ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
            : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
          <span
            className={`truncate text-fine ${open ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
          >
            {node.name}
          </span>
          {!open && <CountTag count={node.map_count} />}
        </button>
        {open && (
          loading ? (
            <p style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }} className="text-fine text-ink-tertiary">
              {t("common.loading")}
            </p>
          ) : (
            <>
              {children.length > 0 && (
                <ul className="flex flex-col gap-2">{children.map((c) => renderNode(c, depth + 1))}</ul>
              )}
              {renderMapList(node.id, mapsData)}
            </>
          )
        )}
      </li>
    );
  };

  // 루트 fetch 완료 여부 — 미완료를 "카테고리 없음"과 구분한다(구분 없으면 로드 중에도 empty 문구가 잠깐 깜빡임).
  const rootLoaded = hasCachedChildren(state, ROOT);
  const roots = state.childrenByParent.get(ROOT) ?? [];

  return (
    <section
      data-id="framework-tree"
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto pr-1"
    >
      {!rootLoaded ? (
        <p className="p-4 text-caption text-ink-tertiary">{t("common.loading")}</p>
      ) : roots.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-sm border border-hairline bg-surface p-4 text-center text-caption text-ink-tertiary">
          <FolderTree size={16} strokeWidth={1.5} />
          {t("home.frameworkEmpty")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">{roots.map((r) => renderNode(r, 0))}</ul>
      )}
    </section>
  );
}
