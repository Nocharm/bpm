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
  hasMoreMaps,
  reduceFrameworkTree,
  ROOT,
  shouldFetchChildren,
  shouldFetchMore,
  type FrameworkTreeState,
} from "@/lib/framework-tree-state";
import { useI18n } from "@/lib/i18n";
import { CountTag } from "@/components/maps/count-tag";

interface FrameworkTreeProps {
  // page.tsx의 기존 renderCard를 그대로 물려받아 맵 행 렌더를 OrgAccordion과 일원화 (selectedId는 renderCard 클로저 내부 처리).
  renderCard: (map: MapSummary) => ReactNode;
}

export function FrameworkTree({ renderCard }: FrameworkTreeProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());
  // 루트 fetch 실패 표시 — children_loaded가 한 번도 없으면 rootLoaded는 영원히 false로 남는데,
  // effect는 마운트 1회뿐이라 실패 시 재시도 트리거가 없다. 별도 플래그로 에러 행 + 재시도 버튼을 낸다.
  const [rootError, setRootError] = useState(false);

  // 루트 1회 로드 — StrictMode 이중 마운트는 `active` 가드로(기존 page.tsx 패턴과 동일).
  useEffect(() => {
    let active = true;
    void fetchRootChildren()
      .then((nodes) => {
        if (active) {
          setState((prev) => reduceFrameworkTree(prev, { type: "children_loaded", parentId: ROOT, nodes }));
        }
      })
      .catch(() => {
        if (active) setRootError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleRetryRoot() {
    setRootError(false);
    void fetchRootChildren()
      .then((nodes) => {
        setState((prev) => reduceFrameworkTree(prev, { type: "children_loaded", parentId: ROOT, nodes }));
      })
      .catch(() => setRootError(true));
  }

  // opened 판단 없이 무조건 fetch — handleToggle(최초 펼침)과 에러 재시도 행 둘 다 호출.
  function loadChildren(categoryId: number) {
    setState((prev) => reduceFrameworkTree(prev, { type: "loading_started", categoryId }));
    void fetchCategoryChildren(categoryId)
      .then(({ nodes, maps }) => {
        setState((prev) => applyCategoryLoaded(prev, categoryId, nodes, maps));
      })
      .catch(() => {
        // loading_ended만 지우면 재요청 잠금이 풀린다 — 재시도 행 클릭이나 재펼침으로 다시 시도 가능.
        setState((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId }));
      });
  }

  function handleToggle(categoryId: number) {
    if (state.openIds.has(categoryId)) {
      setState((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    setState((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId }));
    // 캐시 있거나 이미 인플라이트면 재요청 안 함 — 닫았다 로딩 중 재펼침해도 fetch는 1회만.
    if (shouldFetchChildren(state, categoryId)) loadChildren(categoryId);
  }

  function handleLoadMore(categoryId: number) {
    // 인플라이트 중 중복 클릭 가드 — 없으면 같은 offset이 두 번 요청되어 중복 id가 append된다.
    if (!shouldFetchMore(state, categoryId)) return;
    setState((prev) => reduceFrameworkTree(prev, { type: "loading_started", categoryId }));
    void fetchMoreMaps(state, categoryId)
      .then((maps) => {
        setState((prev) => {
          let next = reduceFrameworkTree(prev, { type: "maps_loaded", categoryId, maps, append: true });
          next = reduceFrameworkTree(next, { type: "loading_ended", categoryId });
          return next;
        });
      })
      .catch(() => {
        // 버튼 disabled를 풀어 재클릭으로 재시도 가능하게 — 실패해도 offset(로드된 개수)은 그대로라 안전.
        setState((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId }));
      });
  }

  // 맵 인셋 — org-accordion.tsx와 동일 상수(depth 무관 고정폭). loading은 "더 보기" 인플라이트 중
  // 버튼만 비활성화(이미 로드된 목록은 그대로 유지 — 초기 로딩 placeholder와 달리 목록을 지우지 않는다).
  const renderMapList = (categoryId: number, mapsData: CategoryMaps | undefined, loading: boolean) => {
    if (!mapsData) return null;
    return (
      <ul className="flex flex-col gap-2 pl-5 pr-2">
        {mapsData.maps.map((m) => (
          <li key={m.id}>{renderCard(m)}</li>
        ))}
        {mapsData.hidden > 0 && (
          <li className="text-fine text-ink-tertiary">{t("home.frameworkHidden", { n: mapsData.hidden })}</li>
        )}
        {hasMoreMaps(state, categoryId) && (
          <li>
            <button
              type="button"
              data-id="framework-more"
              disabled={loading}
              className="text-fine text-accent hover:underline disabled:opacity-40"
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
    // 최초 펼침 로딩만 전체를 placeholder로 대체 — 캐시가 이미 있으면(= "더 보기" 로딩) 기존 목록을 유지한다.
    const initialLoading = loading && !hasCachedChildren(state, node.id);
    // 펼침 fetch 실패 — 열려 있는데 로딩 중도 아니고 캐시도 없으면 실패로 catch가 loading_ended만 지운 상태.
    const loadFailed = open && !loading && !hasCachedChildren(state, node.id);
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
          initialLoading ? (
            <p style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }} className="text-fine text-ink-tertiary">
              {t("common.loading")}
            </p>
          ) : loadFailed ? (
            <button
              type="button"
              data-id="framework-node-retry"
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
              className="text-left text-fine text-error hover:underline"
              onClick={() => loadChildren(node.id)}
            >
              {node.name} — {t("home.frameworkLoadError")}
            </button>
          ) : (
            <>
              {children.length > 0 && (
                <ul className="flex flex-col gap-2">{children.map((c) => renderNode(c, depth + 1))}</ul>
              )}
              {renderMapList(node.id, mapsData, loading)}
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
      {rootError ? (
        <button
          type="button"
          data-id="framework-root-retry"
          className="p-4 text-left text-caption text-error hover:underline"
          onClick={handleRetryRoot}
        >
          {t("home.frameworkLoadError")}
        </button>
      ) : !rootLoaded ? (
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
