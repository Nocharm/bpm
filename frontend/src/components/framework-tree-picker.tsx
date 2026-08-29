"use client";

// 연계 캔버스용 framework 트리 피커 — 라이브러리 패널(fetch-all)을 대체하는 lazy 트리
// (L5≈3,000·L6≈20,000 스케일, design 2026-08-28 §8). 맵 카드를 기존 bpm-process 드래그
// 규약으로 캔버스에 드롭한다(handleLibraryDrop 무변경 재사용). 상태는 lib/framework-tree-state.ts
// 리듀서 재사용 — 캐스케이드·영속은 없음(패널은 임시 탐색).
import { ChevronDown, ChevronRight, Network, X } from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";

import type { CategoryNode, MapSummary } from "@/lib/api";
import {
  applyCategoryLoaded,
  createInitialState,
  fetchCategoryChildren,
  fetchRootChildren,
  hasCachedChildren,
  reduceFrameworkTree,
  ROOT,
  shouldFetchChildren,
  type FrameworkTreeState,
} from "@/lib/framework-tree-state";
import { useI18n } from "@/lib/i18n";

export interface FrameworkTreePickerProps {
  currentMapId: number;
  linkedMapIds: Set<number>;
  onClose: () => void;
}

export function FrameworkTreePicker({ currentMapId, linkedMapIds, onClose }: FrameworkTreePickerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());
  const [rootError, setRootError] = useState(false);

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
          // loading_ended만 지우면 재펼침으로 재시도 가능 (framework-tree.tsx와 동일 결정)
          setState((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId }));
        });
    }
  }

  function handleDragStart(
    e: DragEvent<HTMLDivElement>,
    row: MapSummary,
    categoryId: number,
    categoryPath: string,
  ) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/bpm-process", String(row.id));
    e.dataTransfer.setData("application/bpm-process-name", row.name);
    // 캔버스 노드는 최신 추종(핀 없음) — 임포트 시드와 동일 계약 (design 2026-08-28 §6)
    e.dataTransfer.setData("application/bpm-process-pinned", "");
    if (!row.sp_designated_at) e.dataTransfer.setData("application/bpm-process-unregistered", "1");
    // 소속 L5 정보 동봉 — 드롭 즉시 외부 L6 색·출처 배지를 그리는 낙관 참조 소스 (2026-08-30 #4)
    e.dataTransfer.setData("application/bpm-process-category", String(categoryId));
    e.dataTransfer.setData("application/bpm-process-category-path", categoryPath);
  }

  const renderMapRow = (row: MapSummary, categoryId: number, categoryPath: string) => {
    // 캔버스 자신·기링크·다른 캔버스는 드래그 불가 — 링크 유일성/의미 없는 대상 선제 차단
    const blocked = row.id === currentMapId || linkedMapIds.has(row.id) || row.mode === "framework";
    return (
      <div
        key={row.id}
        data-id={`framework-picker-map-${row.id}`}
        draggable={!blocked}
        onDragStart={blocked ? undefined : (e) => handleDragStart(e, row, categoryId, categoryPath)}
        title={blocked ? t("library.alreadyLinked") : row.name}
        className={`flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-fine text-ink ${
          blocked ? "cursor-not-allowed opacity-40" : "cursor-grab hover:bg-surface-alt active:cursor-grabbing"
        }`}
      >
        <Network size={12} strokeWidth={1.5} className="shrink-0 text-ink/50" />
        <span className="min-w-0 truncate">{row.name}</span>
      </div>
    );
  };

  const renderNode = (node: CategoryNode, depth: number, trailNames: string[]) => {
    const open = state.openIds.has(node.id);
    const children = state.childrenByParent.get(node.id) ?? [];
    const mapsData = state.mapsByCategory.get(node.id);
    // 루트→현재 노드 이름 경로 — 드래그 페이로드의 출처 배지 소스 (#4)
    const pathNames = [...trailNames, node.name].join("/");
    return (
      <li key={node.id} className="flex flex-col">
        <button
          type="button"
          aria-expanded={open}
          data-id={`framework-picker-node-${node.id}`}
          onClick={() => handleToggle(node.id)}
          style={{ paddingLeft: `${depth * 10 + 4}px` }}
          className="flex w-full items-center gap-1 rounded-sm py-0.5 text-left hover:bg-surface-alt"
        >
          {open
            ? <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            : <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
          <span className="min-w-0 truncate text-fine text-ink-secondary">{node.name}</span>
          {node.map_count > 0 && (
            <span className="ml-auto shrink-0 pr-1 text-fine text-ink-muted">{node.map_count}</span>
          )}
        </button>
        {open && (
          <>
            {mapsData !== undefined && mapsData.maps.length > 0 && (
              <div style={{ paddingLeft: `${(depth + 1) * 10 + 4}px` }} className="flex flex-col">
                {mapsData.maps.map((row) => renderMapRow(row, node.id, pathNames))}
              </div>
            )}
            {children.length > 0 && (
              <ul className="flex flex-col">{children.map((c) => renderNode(c, depth + 1, [...trailNames, node.name]))}</ul>
            )}
          </>
        )}
      </li>
    );
  };

  const roots = state.childrenByParent.get(ROOT) ?? [];
  return (
    <div
      data-id="framework-tree-picker"
      className="flex w-56 flex-col border-r border-hairline bg-surface"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-1.5 text-caption font-semibold text-ink">
          <Network size={14} strokeWidth={1.5} />
          {t("framework.pickerTitle")}
        </div>
        <button
          type="button"
          className="rounded-sm p-0.5 text-ink/50 hover:bg-surface-alt hover:text-ink"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rootError ? (
          <p className="p-2 text-fine text-error">{t("home.frameworkLoadError")}</p>
        ) : !hasCachedChildren(state, ROOT) ? (
          <p className="p-2 text-fine text-ink-tertiary">{t("common.loading")}</p>
        ) : (
          <ul className="flex flex-col">{roots.map((r) => renderNode(r, 0, []))}</ul>
        )}
      </div>
    </div>
  );
}
