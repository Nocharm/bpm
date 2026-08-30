"use client";

// 업무체계 탐색 모달 — 드릴인 피크의 "탐색" 버튼이 연다 (사용자 요청 2026-08-30).
// 캔버스 트리 피커와 같은 상태 엔진(lib/framework-tree-state)을 재사용하고, 현재 경로(체인)를
// 미리 펼친 채 열어 형제 브랜치(옆)·상위(뒤)로 바로 이동할 수 있게 한다. 맵 행 클릭·L5 연계
// 아이콘은 우상단 칩 플라이아웃과 동일하게 해당 에디터로 이동한다.
import { ChevronDown, ChevronRight, FolderTree, Network, Workflow, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { getCategoryChain, type CategoryNode, type MapSummary } from "@/lib/api";
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
          onClick={() => goToMap(row.id)}
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
                if (target !== null) goToMap(target);
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
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-2">
          {initFailed ? (
            <p className="px-2 py-4 text-fine text-error">{t("framework.chipError")}</p>
          ) : roots.length === 0 ? (
            <p className="px-2 py-4 text-fine text-ink-tertiary">{t("common.loading")}</p>
          ) : (
            <ul className="flex flex-col">{roots.map((node) => renderNode(node, 0))}</ul>
          )}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
