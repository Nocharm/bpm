// 홈 Framework 뷰 — lazy 카테고리 트리(컨설턴트 업무 체계). org-accordion.tsx 행 UX를 미러하되
// 캐시·펼침 상태는 lib/framework-tree-state.ts 순수 리듀서가 소유(thin 렌더러). 검색은 페이지 공용
// 플랫 검색 모드가 커버하고, 여기선 활성 필터(filterMap)를 로드된 맵 카드에만 적용한다.
"use client";

import { ChevronDown, ChevronRight, FolderTree, Workflow } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { CategoryMaps, CategoryNode, MapSummary } from "@/lib/api";
import {
  applyCategoryLoaded,
  CASCADE_BUDGET,
  collectCascadeTargets,
  createInitialState,
  fetchCategoryChildren,
  fetchMoreMaps,
  fetchRootChildren,
  hasCachedChildren,
  hasMoreMaps,
  readPersistedTreeState,
  reduceFrameworkTree,
  ROOT,
  shouldFetchChildren,
  shouldFetchMore,
  writePersistedTreeState,
  type FrameworkTreeState,
  type PersistedTreeState,
} from "@/lib/framework-tree-state";
import { useI18n } from "@/lib/i18n";
import { useClosingKeys } from "@/lib/use-closing-keys";
import { CLAMP_VISIBLE, ClampedList } from "@/components/maps/clamped-list";
import { CountTag } from "@/components/maps/count-tag";
import { DeptGroupBox } from "@/components/maps/dept-group-box";
import { StickyBoxHeader } from "@/components/maps/sticky-box-header";

interface FrameworkTreeProps {
  // page.tsx의 기존 renderCard를 그대로 물려받아 맵 행 렌더를 OrgAccordion과 일원화 (selectedId는 renderCard 클로저 내부 처리).
  renderCard: (map: MapSummary) => ReactNode;
  // 활성 필터 술어(가시성·상태·역할) — null이면 필터 없음. 로드된 맵 카드에만 적용하고
  // 카운트 태그·total은 서버 전체 기준 그대로 둔다(lazy 트리라 전수 재계산 불가).
  filterMap: ((map: MapSummary) => boolean) | null;
  // L5 행 연계 캔버스 열기 — 캔버스 존재 시 전원, 미존재 시 권한자만 버튼 노출 (design 2026-08-28 §8)
  onOpenLinkage: (node: CategoryNode) => void;
}

export function FrameworkTree({ renderCard, filterMap, onOpenLinkage }: FrameworkTreeProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());
  // 캐스케이드 예산 — 펼침 제스처마다 리셋. 재귀 loadChildren들이 공유 차감한다.
  const cascadeBudgetRef = useRef(0);
  // 영속 게이트 — 복원 effect가 지나기 전 persist effect가 빈 초기 상태로 저장값을 덮는 것을 막는다.
  const hydratedRef = useRef(false);
  // 복원 대상 스냅샷 — StrictMode 이중 실행 사이에 persist가 끼어들어도 첫 판독값을 유지한다.
  const restoreRef = useRef<PersistedTreeState | null>(null);
  // 맵 리스트 3.5개 클램프의 "전체 펼치기" 상태 — 카테고리 id 키, openIds와 함께 영속.
  const [expandedLists, setExpandedLists] = useState<Set<number>>(new Set());
  // 카테고리 접힘 애니메이션 — 상태는 즉시 커밋(영속 보존), 고스트 렌더로 accordion-close만 재생.
  const { closingKeys, beginClose, cancelClose, getSectionClass } = useClosingKeys<number>();

  // 펼침 상태 영속 — 복원 effect(아래)보다 먼저 선언해 첫 실행이 hydration 전에 스킵되게 한다.
  useEffect(() => {
    if (!hydratedRef.current) return;
    writePersistedTreeState(state.openIds, expandedLists);
  }, [state.openIds, expandedLists]);

  // 펼침 상태 복원 — 뒤로가기/새로고침 후 저장된 openIds를 다시 열고 각 노드를 재fetch(캐스케이드 없음:
  // 저장값이 곧 사용자의 최종 상태다). 삭제된 카테고리 id는 부모 목록에 없어 렌더되지 않는다(무해).
  useEffect(() => {
    restoreRef.current ??= readPersistedTreeState();
    const persisted = restoreRef.current;
    hydratedRef.current = true;
    if (persisted.expandedLists.length > 0) {
      setExpandedLists(new Set(persisted.expandedLists)); // one-time hydration
    }
    if (persisted.openIds.length === 0) return;
    setState((prev) => {
      let next = prev;
      for (const id of persisted.openIds) next = reduceFrameworkTree(next, { type: "opened", categoryId: id });
      return next;
    }); // one-time hydration (부서 트리 page.tsx 복원과 동일 관례)
    for (const id of persisted.openIds) loadChildren(id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  // opened 판단 없이 무조건 fetch — handleToggle(최초 펼침)·에러 재시도 행·복원이 호출.
  // cascade=true(사용자 펼침 제스처)면 로드 결과에서 맵 있는 자식을 예산 내 자동 펼침·재귀 로드 —
  // 한 클릭으로 맵이 있는 범위까지 트리가 퍼진다. 복원(false)은 저장된 상태만 되살린다.
  function loadChildren(categoryId: number, cascade: boolean) {
    setState((prev) => reduceFrameworkTree(prev, { type: "loading_started", categoryId }));
    void fetchCategoryChildren(categoryId)
      .then(({ nodes, maps }) => {
        setState((prev) => applyCategoryLoaded(prev, categoryId, nodes, maps));
        if (!cascade) return;
        const targets = collectCascadeTargets(nodes, cascadeBudgetRef.current);
        cascadeBudgetRef.current -= targets.length;
        for (const id of targets) {
          // 방금 부모의 첫 fetch로 발견된 자식이라 사실상 미캐시 — 복원 fetch와 겹치는 극단 케이스도
          // 같은 데이터 덮어쓰기라 무해해 shouldFetchChildren 재판정은 생략한다.
          setState((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId: id }));
          loadChildren(id, true);
        }
      })
      .catch(() => {
        // loading_ended만 지우면 재요청 잠금이 풀린다 — 재시도 행 클릭이나 재펼침으로 다시 시도 가능.
        setState((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId }));
      });
  }

  function handleToggle(categoryId: number) {
    if (state.openIds.has(categoryId)) {
      // 닫기: 상태·영속은 즉시, 콘텐츠는 고스트로 accordion-close 재생 후 언마운트("뿅" 방지).
      beginClose(categoryId);
      setState((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    cancelClose(categoryId);
    setState((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId }));
    // 캐시 있거나 이미 인플라이트면 재요청 안 함 — 닫았다 로딩 중 재펼침해도 fetch는 1회만.
    // 캐스케이드도 첫 로드에만 — 재펼침은 사용자가 접어둔 하위 상태를 존중한다.
    if (shouldFetchChildren(state, categoryId)) {
      cascadeBudgetRef.current = CASCADE_BUDGET;
      loadChildren(categoryId, true);
    }
  }

  // 펼침 실패 재시도 — 첫 로드의 재시도이므로 캐스케이드도 새 예산으로 다시 시도한다.
  function handleRetryNode(categoryId: number) {
    cascadeBudgetRef.current = CASCADE_BUDGET;
    loadChildren(categoryId, true);
  }

  // 리스트 "전체 펼치기" 토글 — 영속은 persist effect가 expandedLists 변경을 따라 저장한다.
  function toggleListExpand(categoryId: number) {
    setExpandedLists((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
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
    // 활성 필터는 로드된 카드에만 적용 — 숨긴 개수를 노트로 밝혀 카운트 태그(전체 기준)와의 차이를 설명한다.
    const shownMaps = filterMap ? mapsData.maps.filter(filterMap) : mapsData.maps;
    const filteredOut = mapsData.maps.length - shownMaps.length;
    return (
      // accordion-open/close — 펼침(로드 완료) 진입·접힘 퇴장 높이 애니메이션(globals.css).
      <div className={getSectionClass(categoryId)}>
      <ClampedList
        count={shownMaps.length}
        expanded={expandedLists.has(categoryId)}
        onToggle={() => toggleListExpand(categoryId)}
        dataId={`framework-list-expand-${categoryId}`}
      >
      <ul className="flex flex-col gap-2 pl-5 pr-2">
        {shownMaps.map((m) => (
          <li key={m.id}>{renderCard(m)}</li>
        ))}
        {filteredOut > 0 && (
          <li data-id="framework-filtered-note" className="text-fine text-ink-tertiary">
            {t("home.frameworkFilteredOut", { n: filteredOut })}
          </li>
        )}
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
      </ClampedList>
      </div>
    );
  };

  const renderNode = (node: CategoryNode, depth: number): ReactNode => {
    const open = state.openIds.has(node.id);
    // 접힘 애니메이션 중(고스트) — open은 이미 false, 콘텐츠만 accordion-close 재생 동안 남긴다.
    const isClosing = closingKeys.has(node.id);
    const showContent = open || isClosing;
    const loading = state.loadingIds.has(node.id);
    // 최초 펼침 로딩만 전체를 placeholder로 대체 — 캐시가 이미 있으면(= "더 보기" 로딩) 기존 목록을 유지한다.
    const initialLoading = loading && !hasCachedChildren(state, node.id);
    // 펼침 fetch 실패 — 열려 있는데 로딩 중도 아니고 캐시도 없으면 실패로 catch가 loading_ended만 지운 상태.
    const loadFailed = open && !loading && !hasCachedChildren(state, node.id);
    const children = state.childrenByParent.get(node.id) ?? [];
    const mapsData = state.mapsByCategory.get(node.id);
    // 직접 보유 맵이 있는 카테고리를 펼치면 헤더+자기 맵만 틴트 박스로 묶는다 — 부서 목록(org-accordion)과
    // 동일 규칙: 박스의 뜻은 "이 카테고리가 직접 가진 맵", 자식 카테고리는 박스 밖(중첩 금지).
    // 맵 슬롯은 L5 전용(2026-08-30 확정) — 상위 레벨은 레거시 직결 맵이 있어도 목록을 열지 않는다(아코디언만).
    const boxed =
      showContent && !initialLoading && !loadFailed && node.level === 5 && (mapsData?.total ?? 0) > 0;

    const header = (
      <div className="group flex w-full items-center gap-1 rounded-sm hover:bg-divider">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => handleToggle(node.id)}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
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
        {node.level === 5 && (node.linkage_map_id !== null || node.can_edit_linkage) && (
          <button
            type="button"
            data-id={`framework-linkage-${node.id}`}
            title={t("framework.openLinkage")}
            className="hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface-alt hover:text-accent group-hover:block"
            onClick={(event) => {
              event.stopPropagation();
              onOpenLinkage(node);
            }}
          >
            <Workflow size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
    );

    // 헤더 우측 다시 접기 조건은 렌더 목록과 같은 기준(필터 적용 후 개수)이어야 한다 — renderMapList와 동일 필터.
    const shownCount = mapsData
      ? (filterMap ? mapsData.maps.filter(filterMap) : mapsData.maps).length
      : 0;

    return (
      <li key={node.id} data-id="framework-node" className="flex flex-col gap-2">
        {boxed
          ? (
            <DeptGroupBox dataId="framework-group-box">
              <StickyBoxHeader
                showCollapse={shownCount > CLAMP_VISIBLE && expandedLists.has(node.id)}
                onCollapse={() => toggleListExpand(node.id)}
                dataId={`framework-list-collapse-${node.id}`}
              >
                {header}
              </StickyBoxHeader>
              {renderMapList(node.id, mapsData, loading)}
            </DeptGroupBox>
          )
          : header}
        {showContent && (
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
              onClick={() => handleRetryNode(node.id)}
            >
              {node.name} - {t("home.frameworkLoadError")}
            </button>
          ) : (
            children.length > 0 && (
              <div className={getSectionClass(node.id)}>
                <ul className="flex flex-col gap-2">{children.map((c) => renderNode(c, depth + 1))}</ul>
              </div>
            )
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
