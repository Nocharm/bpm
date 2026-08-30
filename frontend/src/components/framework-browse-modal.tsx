"use client";

// 업무체계 탐색 모달 — 드릴인 피크의 "탐색" 버튼이 연다 (사용자 요청 2026-08-30).
// 캔버스 트리 피커와 같은 상태 엔진(lib/framework-tree-state)을 재사용하고, 현재 경로(체인)를
// 미리 펼친 채 열어 형제 브랜치(옆)·상위(뒤)로 바로 이동할 수 있게 한다. 맵 행 클릭·L5 연계
// 아이콘·검색 맵 결과는 에디터 이탈이므로 확인 모달(openMapPrompt와 동일 문구)을 거쳐 이동한다.
import { ChevronDown, ChevronRight, ExternalLink, FolderTree, Network, Search, Workflow, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import {
  getCategoryChain,
  searchFramework,
  type CategoryNode,
  type FrameworkSearchResult,
  type MapSummary,
} from "@/lib/api";
import {
  applyCategoryLoaded,
  createInitialState,
  fetchCategoryChildren,
  fetchRootChildren,
  reduceFrameworkTree,
  ROOT,
  shouldFetchChildren,
  type FrameworkTreeState,
} from "@/lib/framework-tree-state";
import { useI18n } from "@/lib/i18n";

export function FrameworkBrowseModal({
  chainCategoryId,
  currentMapId,
  onClose,
}: {
  // 미리 펼칠 경로의 말단(출처 L5) — 루트→여기까지 openIds 시드
  chainCategoryId: number;
  // 하이라이트할 맵(피크의 링크맵) — null이면 강조 없음
  currentMapId: number | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());
  const [chainIds, setChainIds] = useState<ReadonlySet<number>>(new Set());
  const [initFailed, setInitFailed] = useState(false);
  // 검색 — 입력 디바운스 후 서버 검색(pair-state: 쿼리 불일치=로딩) (2026-08-30)
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResult, setSearchResult] = useState<{ q: string; data: FrameworkSearchResult } | null>(null);

  // 초기 로드 — 루트 + 체인 각 노드의 자식·맵을 받아 경로를 펼친 상태로 연다
  useEffect(() => {
    let active = true;
    async function init() {
      const chain = await getCategoryChain(chainCategoryId);
      const ids = chain.map((c) => c.id);
      const roots = await fetchRootChildren();
      const loaded = await Promise.all(ids.map((id) => fetchCategoryChildren(id)));
      if (!active) return;
      let next = createInitialState();
      next = reduceFrameworkTree(next, { type: "children_loaded", parentId: ROOT, nodes: roots });
      ids.forEach((id, i) => {
        next = reduceFrameworkTree(next, { type: "opened", categoryId: id });
        next = applyCategoryLoaded(next, id, loaded[i].nodes, loaded[i].maps);
      });
      setChainIds(new Set(ids));
      setState(next);
    }
    void init().catch(() => {
      if (active) setInitFailed(true);
    });
    return () => {
      active = false;
    };
  }, [chainCategoryId]);

  // 입력 디바운스 — 타이머 콜백에서만 setState(동기 set-state-in-effect 회피)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery === "") return;
    let active = true;
    void searchFramework(debouncedQuery)
      .then((data) => {
        if (active) setSearchResult({ q: debouncedQuery, data });
      })
      .catch(() => {
        if (active) setSearchResult({ q: debouncedQuery, data: { categories: [], maps: [] } });
      });
    return () => {
      active = false;
    };
  }, [debouncedQuery]);
  const results =
    debouncedQuery !== "" && searchResult?.q === debouncedQuery ? searchResult.data : null;

  // 검색 결과의 카테고리로 점프 — 경로를 펼쳐 트리에 합류(기존 펼침 유지) 후 검색 종료
  async function expandTo(categoryId: number) {
    const chain = await getCategoryChain(categoryId);
    const ids = chain.map((c) => c.id);
    const loaded = await Promise.all(ids.map((id) => fetchCategoryChildren(id)));
    setChainIds(new Set(ids));
    setState((prev) => {
      let next = prev;
      ids.forEach((id, i) => {
        next = reduceFrameworkTree(next, { type: "opened", categoryId: id });
        next = applyCategoryLoaded(next, id, loaded[i].nodes, loaded[i].maps);
      });
      return next;
    });
    setQuery("");
    setDebouncedQuery("");
  }

  function handleToggle(categoryId: number) {
    if (state.openIds.has(categoryId)) {
      setState((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    setState((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId }));
    if (shouldFetchChildren(state, categoryId)) {
      setState((prev) => reduceFrameworkTree(prev, { type: "loading_started", categoryId }));
      void fetchCategoryChildren(categoryId)
        .then(({ nodes, maps }) => {
          setState((prev) => applyCategoryLoaded(prev, categoryId, nodes, maps));
        })
        .catch(() => {
          setState((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId }));
        });
    }
  }

  // 이동 확인 게이트 — 에디터 이탈이므로 바로 이동하지 않고 확인 모달을 거친다 (사용자 요청 2026-08-30)
  const [pendingNav, setPendingNav] = useState<{ mapId: number; name: string } | null>(null);

  function goToMap(mapId: number) {
    onClose();
    router.push(`/maps/${mapId}`);
  }

  const renderMapRow = (row: MapSummary) => {
    const isCurrent = row.id === currentMapId;
    return (
      <li key={row.id}>
        <button
          type="button"
          data-id={`framework-browse-map-${row.id}`}
          onClick={() => setPendingNav({ mapId: row.id, name: row.name })}
          title={row.name}
          className={`flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-fine ${
            isCurrent ? "bg-accent-tint font-semibold text-accent" : "text-ink hover:bg-surface-alt"
          }`}
        >
          <Network size={12} strokeWidth={1.5} className="shrink-0 opacity-60" />
          <span className="min-w-0 truncate">{row.name}</span>
        </button>
      </li>
    );
  };

  const renderNode = (node: CategoryNode, depth: number) => {
    const open = state.openIds.has(node.id);
    const children = state.childrenByParent.get(node.id) ?? [];
    const mapsData = state.mapsByCategory.get(node.id);
    const onChain = chainIds.has(node.id);
    return (
      <li key={node.id} className="flex flex-col">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-expanded={open}
            data-id={`framework-browse-node-${node.id}`}
            onClick={() => handleToggle(node.id)}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-sm py-1 text-left hover:bg-surface-alt"
          >
            {open
              ? <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              : <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
            <span
              className={`min-w-0 truncate text-fine ${
                onChain ? "font-semibold text-accent" : "text-ink-secondary"
              }`}
            >
              {node.name}
            </span>
            {node.map_count > 0 && (
              <span className="ml-auto shrink-0 pr-1 text-fine text-ink-muted">{node.map_count}</span>
            )}
          </button>
          {/* L5 연계 캔버스 열기 — 칩 행과 동일 액션 */}
          {node.level === 5 && node.linkage_map_id !== null && (
            <button
              type="button"
              data-id={`framework-browse-linkage-${node.id}`}
              title={t("framework.openLinkage")}
              className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
              onClick={() => {
                const target = node.linkage_map_id;
                if (target !== null) setPendingNav({ mapId: target, name: node.name });
              }}
            >
              <Workflow size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
        {open && (
          <>
            {/* 맵 슬롯은 L5 전용 — 상위 레벨은 하위 카테고리 아코디언만 */}
            {node.level === 5 && mapsData !== undefined && mapsData.maps.length > 0 && (
              <ul style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }} className="flex flex-col">
                {mapsData.maps.map(renderMapRow)}
              </ul>
            )}
            {children.length > 0 && (
              <ul className="flex flex-col">{children.map((c) => renderNode(c, depth + 1))}</ul>
            )}
          </>
        )}
      </li>
    );
  };

  const roots = state.childrenByParent.get(ROOT) ?? [];
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="framework-browse-modal"
        className="flex max-h-[70vh] w-[400px] flex-col rounded-md border border-hairline bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
          <FolderTree size={15} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <span className="min-w-0 flex-1 truncate text-caption-strong font-semibold">
            {t("framework.browseTitle")}
          </span>
          <button
            type="button"
            data-id="framework-browse-close"
            onClick={onClose}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        {/* 검색 — 카테고리·맵 이름 부분일치, 결과에서 점프/이동 (2026-08-30) */}
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
          <Search size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <input
            data-id="framework-browse-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("framework.browseSearch")}
            className="w-full bg-transparent text-caption outline-none placeholder:text-ink-tertiary"
          />
        </div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-2">
          {query.trim() !== "" ? (
            results === null ? (
              <p className="px-2 py-4 text-fine text-ink-tertiary">{t("common.loading")}</p>
            ) : results.categories.length === 0 && results.maps.length === 0 ? (
              <p className="px-2 py-4 text-fine text-ink-tertiary">{t("framework.searchNoResults")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {results.categories.length > 0 && (
                  <div>
                    <p className="px-1.5 pb-0.5 text-fine font-semibold text-ink-tertiary">
                      {t("framework.searchCategories")}
                    </p>
                    <ul className="flex flex-col">
                      {results.categories.map((cat) => (
                        <li key={cat.id}>
                          <button
                            type="button"
                            data-id={`framework-search-cat-${cat.id}`}
                            onClick={() => void expandTo(cat.id)}
                            title={cat.path ?? cat.name}
                            className="flex w-full flex-col items-start rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                          >
                            <span className="max-w-full truncate text-fine text-ink">{cat.name}</span>
                            {cat.path && (
                              <span className="max-w-full truncate text-fine text-ink-tertiary">{cat.path}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {results.maps.length > 0 && (
                  <div>
                    <p className="px-1.5 pb-0.5 text-fine font-semibold text-ink-tertiary">
                      {t("framework.searchMaps")}
                    </p>
                    <ul className="flex flex-col">
                      {results.maps.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            data-id={`framework-search-map-${row.id}`}
                            onClick={() => setPendingNav({ mapId: row.id, name: row.name })}
                            title={row.path ? `${row.path}/${row.name}` : row.name}
                            className="flex w-full flex-col items-start rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                          >
                            <span className="flex max-w-full items-center gap-1.5 truncate text-fine text-ink">
                              <Network size={11} strokeWidth={1.5} className="shrink-0 opacity-60" />
                              {row.name}
                            </span>
                            {row.path && (
                              <span className="max-w-full truncate text-fine text-ink-tertiary">{row.path}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          ) : initFailed ? (
            <p className="px-2 py-4 text-fine text-error">{t("framework.chipError")}</p>
          ) : roots.length === 0 ? (
            <p className="px-2 py-4 text-fine text-ink-tertiary">{t("common.loading")}</p>
          ) : (
            <ul className="flex flex-col">{roots.map((node) => renderNode(node, 0))}</ul>
          )}
        </div>
      </div>
      {/* 이동 확인 — F6 "링크맵 열기"(openMapPrompt)와 동일 문구·아이콘, 확인 시에만 이탈 */}
      {pendingNav && (
        <ConfirmDialog
          dialogId="framework-browse-nav-confirm"
          icon={<ExternalLink size={28} strokeWidth={1.5} />}
          title={pendingNav.name}
          message={t("subprocess.openMapBody")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => goToMap(pendingNav.mapId)}
          onClose={() => setPendingNav(null)}
        />
      )}
    </ModalBackdrop>,
    document.body,
  );
}
