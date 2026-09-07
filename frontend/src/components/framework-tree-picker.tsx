"use client";

// 연계 캔버스용 framework 트리 피커 — 라이브러리 패널(fetch-all)을 대체하는 lazy 트리
// (L5≈3,000·L6≈20,000 스케일, design 2026-08-28 §8). 맵 카드를 기존 bpm-process 드래그
// 규약으로 캔버스에 드롭한다(handleLibraryDrop 무변경 재사용). 상태는 lib/framework-tree-state.ts
// 리듀서 재사용 — 캐스케이드·영속은 없음(패널은 임시 탐색).
// onCreatePlaceholder가 주어지면(+ !readOnly) 트리 바디 아래에 플레이스홀더 생성 풋터를 렌더한다 —
// L5 라이브러리 전용 마운트에서만 전달되고, 연결 다이얼로그 임베드는 넘기지 않아 숨는다 (2026-09-07).
import { ChevronRight, Network, Plus, X } from "lucide-react";
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
import type { MessageKey } from "@/lib/i18n-messages";
import type { NodeDisplayToggle } from "@/lib/node-actions";
import { useSectionMotion } from "@/lib/use-closing-keys";

export interface FrameworkTreePickerProps {
  currentMapId: number;
  linkedMapIds: Set<number>;
  readOnly: boolean;
  // 현재 맵의 노드 표시 설정 — 피크 목업 호버 시 "현재 맵 기준" 렌더 필터 (2026-08-30)
  nodeDisplayFields: NodeDisplayToggle[];
  // 캔버스의 결착 L5 — 타 L5 출신 판정(피크 목업을 캔버스 규칙=L5 색+출처 배지로) (design 2026-08-28 §8)
  linkageCategoryId: number | null;
  // 안내된 출처 L5 — 있으면 배지 판정과 마운트 시 자동 펼침 대상 둘 다 linkageCategoryId보다 우선한다.
  // 연결 다이얼로그의 확인 게이트가 이 값을 기준으로 안내/이탈을 가르므로, 배지·펼침도 같은 기준이어야
  // 어긋나지 않는다(리뷰 라운드1 #1, 라운드2 F1). 미지정 시 기존처럼 linkageCategoryId만 본다(다른 마운트는 그대로).
  originCategoryId?: number | null;
  // 루트 패널 스타일 오버라이드 — 기본은 캔버스 옆 레일(w-56). 다이얼로그 임베드(플레이스홀더 연결)는
  // 더 넓은 트리 컬럼이 필요해 넘긴다 (2026-09-06)
  className?: string;
  // true면 내부 "Framework L6" 타이틀 바+닫기 버튼을 렌더하지 않는다 — 호스트가 이미 자체 헤더/닫기를
  // 가진 임베드(연결 다이얼로그)에서 중복 헤더·중복 닫기 버튼을 없앤다 (리뷰 라운드1 #3)
  hideHeader?: boolean;
  // 피크 주 액션 라벨 오버라이드 — SubprocessPreviewPeek로 그대로 전달 (2026-09-06)
  ctaLabelKey?: MessageKey;
  onClose: () => void;
  // 미리보기 피크의 "Add to map" — 드롭과 동일 생성 체인(뷰포트 중앙, 출처 배지 낙관 참조 포함) (2026-08-30)
  onPeekAdd: (payload: PeekAddPayload) => void;
  // 피크 목업 드롭다운 "해당 맵으로 이동" — 에디터 이탈 확인 게이트(openMapPrompt)로 연결
  onPeekOpenMap: (mapId: number, name: string) => void;
  // 이미 이 캔버스에 들어와 있는 행 클릭 — 미리보기 대신 그 노드로 포커스 (사용자 요청 2026-08-31)
  onFocusLinkedNode: (linkedMapId: number) => void;
  // 주어지면(+ !readOnly) 하단 풋터에서 이름만으로 링크 없는 플레이스홀더 생성 — 기존 서브프로세스
  // 플레이스홀더 워크플로(임포트 미배치 L6와 동일 모양)를 L5 라이브러리에서도 쓸 수 있게 (2026-09-07)
  onCreatePlaceholder?: (title: string) => void;
}

export function FrameworkTreePicker({
  currentMapId,
  linkedMapIds,
  readOnly,
  nodeDisplayFields,
  linkageCategoryId,
  originCategoryId,
  className,
  hideHeader = false,
  ctaLabelKey,
  onClose,
  onPeekAdd,
  onPeekOpenMap,
  onFocusLinkedNode,
  onCreatePlaceholder,
}: FrameworkTreePickerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());
  const [rootError, setRootError] = useState(false);
  // 아코디언 펼침 모션 — 노드별 userOpenedIds 추적(자동 드릴인은 static, 사용자가 직접 편
  // 노드만 open 애니메이션)을 공용 훅으로 이관(F4) — framework-assign-modal.tsx와 중복이던 배선.
  const { closingKeys, sectionClass, openSection, closeSection } = useSectionMotion<number>();

  // 하단 플레이스홀더 생성 폼 입력 — submitPlaceholder가 트리밍·클리어까지 담당
  const [placeholderName, setPlaceholderName] = useState("");
  function submitPlaceholder() {
    const name = placeholderName.trim();
    if (!name || !onCreatePlaceholder) return;
    onCreatePlaceholder(name);
    setPlaceholderName("");
  }

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

  // 피크가 열려 있는 동안 Esc는 피크만 닫는다 — document에 capture 단계로 걸고 stopPropagation해
  // ModalBackdrop의 window bubble 리스너(호스트 다이얼로그 전체 닫기, modal-backdrop.tsx 확인함)보다
  // 먼저 소비한다. capture는 항상 bubble보다 먼저 실행되고, 그 안에서 stopPropagation하면 이벤트가
  // target에도, 이후 bubble 단계(= window)에도 도달하지 않으므로 리스너의 phase와 무관하게 확실히
  // 막힌다 (리뷰 라운드1 #4)
  useEffect(() => {
    if (peek === null) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPeek(null);
    };
    document.addEventListener("keydown", handleEscape, { capture: true });
    return () => document.removeEventListener("keydown", handleEscape, { capture: true });
  }, [peek]);

  // 마운트 시 루트 + 자동 펼침 대상(안내된 origin이 있으면 그쪽, 없으면 캔버스 결착 L5) 체인을 미리
  // 펼친다 — 매번 L1부터 파고들지 않게(사용자 요청 2026-08-31). 대상 L5 자신은 열어서 소속 L6 목록까지
  // 바로 보이게 한다. "내 위치" 강조(isCurrentL5)는 이 대상과 별개로 항상 linkageCategoryId 기준이라,
  // origin이 다르면 펼침 위치와 강조 위치가 갈릴 수 있다 — 그 차이는 호스트의 안내 pill이 알려준다(F1).
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
      const autoExpandId = originCategoryId ?? linkageCategoryId;
      if (autoExpandId === null) return;
      try {
        const chain = await getCategoryChain(autoExpandId);
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
  }, [linkageCategoryId, originCategoryId]);

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
    openSection(categoryId, false); // F5: 닫히는 중이던 고스트가 방금 재펼침을 덮지 않게 먼저 취소
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
      closeSection(categoryId); // 고스트 렌더로 accordion-close 재생 후 언마운트
      setState((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    openSection(categoryId, true); // 사용자가 직접 편 노드만 accordion-open 재생
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
    // 클릭·Enter/Space 공용 활성화 — 이미 링크된 행은 포커스 이동, 그 외(차단 포함)는 피크 토글
    function activateRow(rowEl: Element) {
      // 이미 이 캔버스에 있는 행은 추가가 불가능하다 — 미리보기 대신 그 노드로 보낸다
      if (alreadyLinked) {
        clearHoverTimer();
        setPeek(null);
        onFocusLinkedNode(row.id);
        return;
      }
      // 클릭 = 피크 토글(같은 행 재클릭이면 닫기) — 그 외 차단 행도 미리보기는 제공
      if (peek && peek.row.id === row.id) setPeek(null);
      else openPeek(row, categoryId, categoryPath, peekBlocked, rowEl);
    }
    return (
      <div
        key={row.id}
        data-id={`framework-picker-map-${row.id}`}
        role="button"
        tabIndex={0}
        aria-disabled={blocked}
        draggable={!blocked}
        onDragStart={blocked ? undefined : (e) => handleDragStart(e, row, categoryId, categoryPath)}
        onClick={(e) => activateRow(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          activateRow(e.currentTarget);
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
    // 접힘 애니메이션 중(고스트) — open은 이미 false, 콘텐츠만 accordion-close 재생 동안 남긴다.
    const isClosing = closingKeys.has(node.id);
    const showContent = open || isClosing;
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
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`shrink-0 motion-safe:transition-transform duration-150 ease-smooth ${isCurrentL5 ? "text-accent" : "text-ink-tertiary"} ${open ? "rotate-90" : ""}`}
          />
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
        {/* 콘텐츠 도착 후에만 마운트 — 빈 박스 위에서 accordion-open이 헛도는 것 방지 (F1) */}
        {showContent &&
          ((node.level === 5 && mapsData !== undefined && mapsData.maps.length > 0) || children.length > 0) && (
            <div className={sectionClass(node.id)}>
              {/* 맵 슬롯은 L5 전용(2026-08-30 확정) — 상위 레벨은 하위 카테고리 아코디언만 */}
              {node.level === 5 && mapsData !== undefined && mapsData.maps.length > 0 && (
                <div style={{ paddingLeft: `${(depth + 1) * 10 + 4}px` }} className="flex flex-col">
                  {mapsData.maps.map((row) => renderMapRow(row, node.id, pathNames))}
                </div>
              )}
              {children.length > 0 && (
                <ul className="flex flex-col">{children.map((c) => renderNode(c, depth + 1, [...trailNames, node.name]))}</ul>
              )}
            </div>
          )}
      </li>
    );
  };

  const roots = state.childrenByParent.get(ROOT) ?? [];
  // 배지("외부 L6") 판정 기준 — 안내된 출처가 있으면 그걸 우선, 없으면 캔버스 결착 L5 (리뷰 라운드1 #1)
  const externalOriginReferenceId = originCategoryId ?? linkageCategoryId;
  return (
    <div
      ref={panelRef}
      data-id="framework-tree-picker"
      className={className ?? "flex w-56 flex-col border-r border-hairline bg-surface"}
      style={className ? undefined : { boxShadow: "var(--shadow-md)" }}
    >
      {!hideHeader && (
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
      )}
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
      {/* 플레이스홀더 생성 풋터 — L5 라이브러리 전용(onCreatePlaceholder 미전달인 연결 다이얼로그는 숨김).
          기존 서브프로세스 라이브러리 "New map" 풋터(process-library-panel.tsx)와 같은 하단 스트립 자리 */}
      {onCreatePlaceholder && !readOnly && (
        <div className="border-t border-hairline p-1">
          <div className="flex items-center gap-1">
            <input
              type="text"
              data-id="framework-placeholder-name"
              value={placeholderName}
              onChange={(e) => setPlaceholderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPlaceholder();
              }}
              placeholder={t("framework.placeholderNamePlaceholder")}
              className="min-w-0 flex-1 rounded-sm border border-hairline bg-surface-alt px-1.5 py-1 text-fine text-ink outline-none placeholder:text-ink/40"
            />
            <button
              type="button"
              data-id="framework-placeholder-create"
              title={t("framework.createPlaceholder")}
              aria-label={t("framework.createPlaceholder")}
              disabled={placeholderName.trim() === ""}
              onClick={submitPlaceholder}
              className="shrink-0 rounded-sm p-1.5 text-accent hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
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
          ctaLabelKey={ctaLabelKey}
          externalOrigin={
            externalOriginReferenceId !== null && peek.categoryId !== externalOriginReferenceId
              ? { categoryId: peek.categoryId, categoryPath: peek.categoryPath }
              : null
          }
          // 목업 드래그 페이로드 — onAdd·행 드래그와 동일 계약(핀 없음 + 출처 L5 동봉)
          dragPayload={{
            linkedMapId: peek.row.id,
            name: peek.row.name,
            pinned: null,
            unregistered: !peek.row.sp_designated_at,
            categoryId: peek.categoryId,
            categoryPath: peek.categoryPath,
          }}
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
