"use client";

// 연계 캔버스용 framework 트리 피커 — 라이브러리 패널(fetch-all)을 대체하는 lazy 트리
// (L5≈3,000·L6≈20,000 스케일, design 2026-08-28 §8). 맵 카드를 기존 bpm-process 드래그
// 규약으로 캔버스에 드롭한다(handleLibraryDrop 무변경 재사용). 상태는 lib/framework-tree-state.ts
// 리듀서 재사용 — 캐스케이드·영속은 없음(패널은 임시 탐색).
import { ChevronDown, ChevronRight, Network, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { getCategoryChain, type CategoryNode, type MapSummary } from "@/lib/api";
import {
  PEEK_HOVER_DELAY_MS,
  SubprocessPreviewPeek,
  type PeekAddPayload,
} from "@/components/subprocess-preview-peek";
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
import type { NodeDisplayToggle } from "@/lib/node-actions";

export interface FrameworkTreePickerProps {
  currentMapId: number;
  linkedMapIds: Set<number>;
  readOnly: boolean;
  // 현재 맵의 노드 표시 설정 — 피크 목업 호버 시 "현재 맵 기준" 렌더 필터 (2026-08-30)
  nodeDisplayFields: NodeDisplayToggle[];
  // 캔버스의 결착 L5 — 타 L5 출신 판정(피크 목업을 캔버스 규칙=L5 색+출처 배지로) (design 2026-08-28 §8)
  linkageCategoryId: number | null;
  onClose: () => void;
  // 미리보기 피크의 "Add to map" — 드롭과 동일 생성 체인(뷰포트 중앙, 출처 배지 낙관 참조 포함) (2026-08-30)
  onPeekAdd: (payload: PeekAddPayload) => void;
  // 피크 목업 드롭다운 "해당 맵으로 이동" — 에디터 이탈 확인 게이트(openMapPrompt)로 연결
  onPeekOpenMap: (mapId: number, name: string) => void;
  // 이미 이 캔버스에 들어와 있는 행 클릭 — 미리보기 대신 그 노드로 포커스 (사용자 요청 2026-08-31)
  onFocusLinkedNode: (linkedMapId: number) => void;
}

export function FrameworkTreePicker({
  currentMapId,
  linkedMapIds,
  readOnly,
  nodeDisplayFields,
  linkageCategoryId,
  onClose,
  onPeekAdd,
  onPeekOpenMap,
  onFocusLinkedNode,
}: FrameworkTreePickerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());
  const [rootError, setRootError] = useState(false);

  // 행 미리보기 피크 — 클릭 즉시·2.5초 호버로 오픈(패널당 1개). 스크롤·드래그 시작 시 닫는다 (2026-08-30)
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [peek, setPeek] = useState<{
    row: MapSummary;
    categoryId: number;
    categoryPath: string;
    blocked: string | null;
    anchor: { x: number; y: number };
    anchorEl: Element;
  } | null>(null);
  function clearHoverTimer() {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }
  useEffect(() => clearHoverTimer, []);
  function openPeek(
    row: MapSummary,
    categoryId: number,
    categoryPath: string,
    blocked: string | null,
    rowEl: Element,
  ) {
    clearHoverTimer();
    // x는 패널 우측 고정(트리 들여쓰기와 무관하게 일정), y는 행 기준 — 세로 클램프는 피크가 수행
    const panelRight = panelRef.current?.getBoundingClientRect().right ?? rowEl.getBoundingClientRect().right;
    setPeek({
      row,
      categoryId,
      categoryPath,
      blocked,
      anchor: { x: panelRight + 8, y: rowEl.getBoundingClientRect().top - 4 },
      anchorEl: rowEl,
    });
  }

  // 마운트 시 루트 + "내 위치"(캔버스 결착 L5) 체인을 미리 펼친다 — 매번 L1부터 파고들지 않게
  // (사용자 요청 2026-08-31). L5 자신은 열어서 소속 L6 목록까지 바로 보이게 한다.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const roots = await fetchRootChildren();
        if (!active) return;
        setState((prev) =>
          reduceFrameworkTree(prev, { type: "children_loaded", parentId: ROOT, nodes: roots }),
        );
      } catch {
        if (active) setRootError(true);
        return;
      }
      if (linkageCategoryId === null) return;
      try {
        const chain = await getCategoryChain(linkageCategoryId);
        if (!active) return;
        // 체인 전 단계의 자식+맵을 병렬로 받아 한 번에 펼침 — 순차 클릭 시뮬레이션보다 빠르다
        const loaded = await Promise.all(chain.map((cat) => fetchCategoryChildren(cat.id)));
        if (!active) return;
        setState((prev) => {
          let next = prev;
          chain.forEach((cat, i) => {
            next = applyCategoryLoaded(next, cat.id, loaded[i].nodes, loaded[i].maps);
            next = reduceFrameworkTree(next, { type: "opened", categoryId: cat.id });
          });
          return next;
        });
      } catch {
        // 자동 드릴인 실패는 조용히 — 루트는 이미 떠 있어 수동 탐색이 가능하다
      }
    })();
    return () => {
      active = false;
    };
  }, [linkageCategoryId]);

  // 자동 드릴인 상한 — 단일 후보 체인이라도 무한히 파고들지 않게(대량 전달 방어)
  const AUTO_DRILL_MAX = 6;
  // 캐시된 자식/맵을 비동기 루프에서 읽기 위한 ref 미러 (react-ts-patterns §deps)
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 하위 후보가 하나뿐이면 계속 펼쳐 L6 목록까지 한 번에 도달한다. 중간에 직속 맵이 있거나
  // 갈래가 둘 이상이면 거기서 멈춘다 — 선택지가 생기는 지점은 사용자가 고른다 (사용자 요청 2026-08-31)
  async function autoDrillIn(categoryId: number, hop: number): Promise<void> {
    if (hop >= AUTO_DRILL_MAX) return;
    setState((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId }));
    let kids = stateRef.current.childrenByParent.get(categoryId);
    let maps = stateRef.current.mapsByCategory.get(categoryId);
    if (kids === undefined) {
      try {
        const loaded = await fetchCategoryChildren(categoryId);
        setState((prev) => applyCategoryLoaded(prev, categoryId, loaded.nodes, loaded.maps));
        kids = loaded.nodes;
        maps = loaded.maps;
      } catch {
        return; // 자동 펼침 실패는 조용히 중단 — 수동 펼침으로 재시도 가능
      }
    }
    if (kids.length === 1 && (maps?.maps.length ?? 0) === 0) {
      await autoDrillIn(kids[0].id, hop + 1);
    }
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
          if (nodes.length === 1 && maps.maps.length === 0) void autoDrillIn(nodes[0].id, 0);
        })
        .catch(() => {
          // loading_ended만 지우면 재펼침으로 재시도 가능 (framework-tree.tsx와 동일 결정)
          setState((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId }));
        });
      return;
    }
    // 캐시 적중 경로도 같은 규칙 적용
    const cachedKids = state.childrenByParent.get(categoryId) ?? [];
    const cachedMaps = state.mapsByCategory.get(categoryId);
    if (cachedKids.length === 1 && (cachedMaps?.maps.length ?? 0) === 0) {
      void autoDrillIn(cachedKids[0].id, 0);
    }
  }

  function handleDragStart(
    e: DragEvent<HTMLDivElement>,
    row: MapSummary,
    categoryId: number,
    categoryPath: string,
  ) {
    clearHoverTimer();
    setPeek(null);
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
    const alreadyLinked = linkedMapIds.has(row.id);
    const blocked = row.id === currentMapId || alreadyLinked || row.mode === "framework";
    // 피크 add 비활성 사유 — 행 드래그 차단과 동일 + 읽기전용
    const peekBlocked = readOnly
      ? t("editor.readonly.viewerDesc")
      : blocked
        ? t("library.alreadyLinked")
        : null;
    return (
      <div
        key={row.id}
        data-id={`framework-picker-map-${row.id}`}
        draggable={!blocked}
        onDragStart={blocked ? undefined : (e) => handleDragStart(e, row, categoryId, categoryPath)}
        onClick={(e) => {
          // 이미 이 캔버스에 있는 행은 추가가 불가능하다 — 미리보기 대신 그 노드로 보낸다
          if (alreadyLinked) {
            clearHoverTimer();
            setPeek(null);
            onFocusLinkedNode(row.id);
            return;
          }
          // 클릭 = 피크 토글(같은 행 재클릭이면 닫기) — 그 외 차단 행도 미리보기는 제공
          if (peek && peek.row.id === row.id) setPeek(null);
          else openPeek(row, categoryId, categoryPath, peekBlocked, e.currentTarget);
        }}
        onMouseEnter={(e) => {
          if (alreadyLinked) return; // 호버 자동 오픈 억제 — 클릭은 포커스 이동이다
          const rowEl = e.currentTarget;
          clearHoverTimer();
          hoverTimerRef.current = window.setTimeout(
            () => openPeek(row, categoryId, categoryPath, peekBlocked, rowEl),
            PEEK_HOVER_DELAY_MS,
          );
        }}
        onMouseLeave={clearHoverTimer}
        title={alreadyLinked ? t("library.focusLinkedNode") : blocked ? t("library.alreadyLinked") : row.name}
        className={`flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-fine text-ink ${
          alreadyLinked
            ? "cursor-pointer opacity-60 hover:bg-accent-tint hover:opacity-100"
            : blocked
              ? "cursor-not-allowed opacity-40"
              : "cursor-grab hover:bg-surface-alt active:cursor-grabbing"
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
    // 이 캔버스가 결착된 L5 — 트리에서 내 위치를 바로 찾게 강조 (사용자 요청 2026-08-31)
    const isCurrentL5 = node.id === linkageCategoryId;
    return (
      <li key={node.id} className="flex flex-col">
        <button
          type="button"
          aria-expanded={open}
          aria-current={isCurrentL5 ? "true" : undefined}
          data-id={`framework-picker-node-${node.id}`}
          onClick={() => handleToggle(node.id)}
          style={{ paddingLeft: `${depth * 10 + 4}px` }}
          className={`flex w-full items-center gap-1 rounded-sm py-0.5 text-left ${
            isCurrentL5 ? "bg-accent-tint" : "hover:bg-surface-alt"
          }`}
        >
          {open
            ? <ChevronDown size={12} strokeWidth={1.5} className={`shrink-0 ${isCurrentL5 ? "text-accent" : "text-ink-tertiary"}`} />
            : <ChevronRight size={12} strokeWidth={1.5} className={`shrink-0 ${isCurrentL5 ? "text-accent" : "text-ink-tertiary"}`} />}
          <span
            className={`min-w-0 truncate text-fine ${
              isCurrentL5 ? "font-semibold text-accent" : "text-ink-secondary"
            }`}
          >
            {node.name}
          </span>
          {node.map_count > 0 && (
            <span className={`ml-auto shrink-0 pr-1 text-fine ${isCurrentL5 ? "text-accent" : "text-ink-muted"}`}>
              {node.map_count}
            </span>
          )}
        </button>
        {open && (
          <>
            {/* 맵 슬롯은 L5 전용(2026-08-30 확정) — 상위 레벨은 하위 카테고리 아코디언만 */}
            {node.level === 5 && mapsData !== undefined && mapsData.maps.length > 0 && (
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
      ref={panelRef}
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
      <div
        className="min-h-0 flex-1 overflow-y-auto p-1"
        onScroll={() => {
          // 스크롤하면 앵커 rect가 어긋난다 — 피크·호버 타이머 모두 정리
          clearHoverTimer();
          setPeek((cur) => (cur ? null : cur));
        }}
      >
        {rootError ? (
          <p className="p-2 text-fine text-error">{t("home.frameworkLoadError")}</p>
        ) : !hasCachedChildren(state, ROOT) ? (
          <p className="p-2 text-fine text-ink-tertiary">{t("common.loading")}</p>
        ) : (
          <ul className="flex flex-col">{roots.map((r) => renderNode(r, 0, []))}</ul>
        )}
      </div>
      {peek && (
        <SubprocessPreviewPeek
          key={peek.row.id}
          mapId={peek.row.id}
          name={peek.row.name}
          designated={!!peek.row.sp_designated_at}
          info={{
            department: peek.row.sp_department ?? null,
            assignee: peek.row.sp_assignee ?? null,
            system: peek.row.sp_system ?? null,
            duration: peek.row.sp_duration ?? null,
            touch_time: peek.row.sp_touch_time ?? null,
            cost_krw: peek.row.sp_cost_krw ?? null,
            cost_usd: peek.row.sp_cost_usd ?? null,
            headcount: peek.row.sp_headcount ?? null,
          }}
          anchor={peek.anchor}
          anchorEl={peek.anchorEl}
          addDisabledReason={peek.blocked}
          displayFields={nodeDisplayFields}
          externalOrigin={
            linkageCategoryId !== null && peek.categoryId !== linkageCategoryId
              ? { categoryId: peek.categoryId, categoryPath: peek.categoryPath }
              : null
          }
          onAdd={() => {
            const { row, categoryId, categoryPath } = peek;
            setPeek(null);
            // 드래그 페이로드와 동일 계약 — 캔버스 노드는 최신 추종(핀 없음) + 출처 L5 동봉 (design 2026-08-28 §6)
            onPeekAdd({
              linkedMapId: row.id,
              name: row.name,
              pinned: null,
              unregistered: !row.sp_designated_at,
              categoryId,
              categoryPath,
            });
          }}
          onOpenMap={() => {
            const { row } = peek;
            setPeek(null);
            onPeekOpenMap(row.id, row.name);
          }}
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  );
}
