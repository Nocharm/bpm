// 홈 Framework 뷰 — L5 포커스 드릴다운(목업 v4 확정 2026-09-19). 브레드크럼·상위 버튼 아래를 형제(1) : 하위(2) 두 열로
// 나눈다: 왼쪽은 현재 카테고리의 형제(직전 레벨 목록, 현재 강조·최근 연 항목 점) — 클릭하면 오른쪽만 교체, 오른쪽은
// 현재의 하위(L1~L4 행=드릴인, L5=컴팩트 카드: 클릭=선택, 캔버스는 카드 안 아이콘). 루트는 왼쪽 L1 목록 + 오른쪽 안내.
// 브레드크럼 우측 트리 아이콘은 탐색 모달(계단식·다이어그램, framework-explorer-modal.tsx)을 연다.
// 소속 맵 목록은 좌측에서 빼고 우측 CategorySummaryCard가 담당한다. 판정 헬퍼는 lib/framework-drill.ts.
"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, FolderTree, Hourglass, Loader2, Map as MapIcon, Network, Plus, User, Workflow } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { getCategoryChain, listCategoryNodes, type CategoryNode } from "@/lib/api";
import {
  CANVAS_STATE_LABEL_EN,
  bumpRecent,
  getCanvasState,
  getSiblingRows,
  readPersistedDrill,
  resolveCurrentNode,
  writePersistedDrill,
} from "@/lib/framework-drill";
import { useI18n } from "@/lib/i18n";
import { PersonHoverCard } from "@/components/person-hover-card";
import { FrameworkExplorerModal } from "@/components/maps/framework-explorer-modal";

type ParentKey = number | "root";
const ROOT: ParentKey = "root";

interface FrameworkDrillProps {
  // L5 카드 "캔버스 열기/만들기" — page.tsx handleOpenLinkage(있으면 이동, 권한자면 생성 후 이동)
  onOpenLinkage: (node: CategoryNode) => void;
  // 우측 요약 카드 선택 — 드릴인·형제 전환·브레드크럼·L5 카드 클릭 모두 목적지 카테고리를 선택한다
  selectedCategoryId?: number | null;
  onSelectCategory?: (node: CategoryNode) => void;
  // 루트로 돌아가면 선택 카테고리를 비운다(우측은 대시보드로)
  onClearCategory?: () => void;
  // 우측 요약 "직계 하위" 클릭 — 그 노드의 부모 레벨로 이동해 노드가 목록에 보이게 한다(seq마다 재처리)
  revealRequest?: { id: number; seq: number } | null;
}

export function FrameworkDrill({
  onOpenLinkage,
  selectedCategoryId,
  onSelectCategory,
  onClearCategory,
  revealRequest,
}: FrameworkDrillProps) {
  const { t } = useI18n();
  // 루트→현재까지의 경로. 비어 있으면 루트(L1 목록). null=영속 위치 복원 중(첫 렌더 깜빡임 방지)
  const [path, setPath] = useState<CategoryNode[] | null>(null);
  const [children, setChildren] = useState<Map<ParentKey, CategoryNode[]>>(new Map());
  const [loading, setLoading] = useState<Set<ParentKey>>(new Set());
  const [failed, setFailed] = useState<Set<ParentKey>>(new Set());
  // 목록 전환 방향 — 드릴인/상위 이동만 슬라이드, 형제 전환·복원은 즉시. key로 애니메이션을 재시작한다
  const [motion, setMotion] = useState<{ dir: "in" | "back" | null; key: number }>({ dir: null, key: 0 });
  // 최근에 현재 위치였던 카테고리(앞이 최신) — 형제 열의 "최근 열어봄" 점
  const [recent, setRecent] = useState<number[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const handledRevealSeq = useRef<number | null>(null);

  const loadChildren = (key: ParentKey) => {
    setFailed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setLoading((prev) => new Set(prev).add(key));
    listCategoryNodes(typeof key === "number" ? key : undefined)
      .then((nodes) => {
        setChildren((prev) => new Map(prev).set(key, nodes));
      })
      .catch(() => {
        setFailed((prev) => new Set(prev).add(key));
      })
      .finally(() => {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  };

  // 경로 이동 — 현재 노드의 자식(오른쪽 열)과 부모의 자식(왼쪽 형제 열)이 없으면 불러온다
  const navigate = (next: CategoryNode[], dir: "in" | "back" | null) => {
    setPath(next);
    setMotion((m) => ({ dir, key: m.key + 1 }));
    const currentId = next.length > 0 ? next[next.length - 1].id : null;
    // 방문 기록은 최신 상태 위에 올린다(이펙트에서 불려도 stale 클로저를 안 탄다). 영속 쓰기는 멱등이라
    // StrictMode의 updater 이중 호출에도 무해.
    setRecent((prev) => {
      const bumped = currentId === null ? prev : bumpRecent(prev, currentId);
      writePersistedDrill({ currentId, recent: bumped });
      return bumped;
    });
    const keys: ParentKey[] = [currentId ?? ROOT];
    if (next.length > 0) keys.push(next.length > 1 ? next[next.length - 2].id : ROOT);
    for (const key of keys) if (!children.has(key) && !loading.has(key)) loadChildren(key);
  };

  // 마운트 — 영속된 위치가 있으면 체인으로 경로를 복원(삭제된 카테고리면 루트로)
  useEffect(() => {
    let active = true;
    const saved = readPersistedDrill();
    const restore: Promise<CategoryNode[]> =
      saved.currentId === null
        ? Promise.resolve([])
        : getCategoryChain(saved.currentId)
            // 체인 말단이 L5면 그 부모까지만 — L5는 드릴인 대상이 아니다
            .then((chain) => (chain[chain.length - 1]?.level === 5 ? chain.slice(0, -1) : chain))
            .catch(() => []);
    void restore.then((next) => {
      if (!active) return;
      setRecent(saved.recent);
      navigate(next, null);
    });
    return () => {
      active = false;
    };
    // 마운트 1회 — navigate는 최신 상태를 클로저로 읽지만 첫 실행에선 캐시가 비어 있어 무관
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 우측 요약 드릴다운 요청 — 대상 노드의 부모 레벨로 이동(선택은 page.tsx가 이미 반영)
  useEffect(() => {
    if (!revealRequest || handledRevealSeq.current === revealRequest.seq) return;
    handledRevealSeq.current = revealRequest.seq;
    let active = true;
    getCategoryChain(revealRequest.id)
      .then((chain) => {
        if (active) navigate(chain.slice(0, -1), "in");
      })
      .catch(() => {
        /* 체인 실패 — 현재 위치 유지(선택 하이라이트만 없음) */
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest]);

  const currentKey: ParentKey = path && path.length > 0 ? path[path.length - 1].id : ROOT;
  // 형제 열의 부모 — 루트면 L1 목록(ROOT), 아니면 부모(없으면 ROOT)
  const siblingKey: ParentKey | null = path === null ? null : path.length > 1 ? path[path.length - 2].id : ROOT;
  const rows = children.get(currentKey);
  const siblingSource = siblingKey === null ? undefined : children.get(siblingKey);
  const siblings = siblingSource ? getSiblingRows(siblingSource) : [];
  const current = path && path.length > 0 ? resolveCurrentNode(path[path.length - 1], siblingSource) : null;

  const drillIn = (node: CategoryNode) => {
    if (!path) return;
    navigate([...path, node], "in");
    onSelectCategory?.(node);
  };
  // index=0 → 루트, n → path[0..n)
  const goTo = (index: number) => {
    if (!path || index >= path.length) return;
    const next = path.slice(0, index);
    navigate(next, "back");
    if (next.length === 0) onClearCategory?.();
    else onSelectCategory?.(next[next.length - 1]);
  };
  // 형제 열 클릭 — 루트면 드릴인, 아니면 현재를 교체(오른쪽만 바뀐다)
  const switchSibling = (node: CategoryNode) => {
    if (!path) return;
    if (path.length === 0) {
      drillIn(node);
      return;
    }
    if (node.id === currentKey) return;
    navigate([...path.slice(0, -1), node], null);
    onSelectCategory?.(node);
  };
  // 탐색 모달에서 고른 카테고리로 — 체인으로 경로를 다시 세운다(L5면 부모 레벨 + 카드 선택)
  const goToCategory = (node: CategoryNode) => {
    void getCategoryChain(node.id)
      .then((chain) => {
        navigate(node.level === 5 ? chain.slice(0, -1) : chain, "in");
        onSelectCategory?.(node);
      })
      .catch(() => {
        /* 체인 실패 — 현재 위치 유지 */
      });
  };

  // 목록 포커스 중 Backspace/← = 상위로 (입력 필드 안에선 무시)
  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if ((e.key === "Backspace" || e.key === "ArrowLeft") && path && path.length > 0) {
      e.preventDefault();
      goTo(path.length - 1);
    }
  };

  const renderRow = (node: CategoryNode) => (
    <li key={node.id}>
      <button
        type="button"
        data-id={`framework-row-${node.id}`}
        className="flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface py-2 pl-2.5 pr-2 text-left transition-colors duration-150 hover:border-accent-tint-border hover:bg-surface-pearl"
        onClick={() => drillIn(node)}
      >
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-alt text-ink-tertiary">
          <FolderTree size={14} strokeWidth={1.5} />
        </span>
        <span className="min-w-0 flex-1 truncate text-caption-strong text-ink">{node.name}</span>
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-fine text-ink-tertiary">
          <span>{t("category.summary.l5Count", { n: node.l5_count })}</span>
          <span className="text-ink-muted">·</span>
          <MapIcon size={12} strokeWidth={1.5} />
          {node.map_count}
        </span>
        <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
      </button>
    </li>
  );

  // 컴팩트 L5 카드(약 275px) — 1줄 이름 + 상태 점(title=영어 라벨), 2줄 관리자 · 맵 수 · 승인 대기 · 열기 아이콘
  const renderCard = (node: CategoryNode) => {
    const state = getCanvasState(node);
    const selected = selectedCategoryId === node.id;
    const canOpen = node.linkage_map_id !== null || node.can_edit_linkage;
    const dotClass =
      state === "confirmed" ? "bg-chart-approved" : state === "draft" ? "bg-chart-draft" : "border border-dashed border-border-strong bg-transparent";
    return (
      <li key={node.id}>
        <div
          role="button"
          tabIndex={0}
          data-id={`framework-l5-${node.id}`}
          data-state={state}
          aria-pressed={selected}
          className={`group flex w-full flex-col gap-1.5 rounded-sm border py-2 pl-2.5 pr-2 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
            selected ? "border-accent-tint-border bg-accent-tint" : "border-hairline bg-surface hover:border-accent-tint-border hover:shadow-md"
          }`}
          onClick={() => onSelectCategory?.(node)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectCategory?.(node);
            }
          }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm ${
                state === "none" ? "bg-surface-alt text-ink-muted" : selected ? "bg-accent text-on-accent" : "bg-accent-tint text-accent"
              }`}
            >
              <Workflow size={13} strokeWidth={1.5} />
            </span>
            <span className="min-w-0 flex-1 truncate text-caption-strong text-ink" title={node.name}>
              {node.name}
            </span>
            <span
              data-id="framework-l5-status"
              data-state={state}
              title={CANVAS_STATE_LABEL_EN[state]}
              aria-label={CANVAS_STATE_LABEL_EN[state]}
              className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`}
            />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-fine text-ink-tertiary">
            {node.admin ? (
              <PersonHoverCard userId={node.admin.login_id} className="min-w-0">
                <span
                  data-id="framework-l5-admin"
                  className="inline-flex max-w-[110px] items-center gap-1 rounded-full border border-hairline bg-surface py-0.5 pl-1 pr-1.5 text-ink-secondary"
                >
                  <User size={11} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  <span className="truncate">{node.admin.name}</span>
                </span>
              </PersonHoverCard>
            ) : (
              <span
                data-id="framework-l5-admin"
                data-unset=""
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-hairline py-0.5 pl-1 pr-1.5 text-ink-muted"
                title={t("framework.drill.unassigned")}
              >
                <User size={11} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{t("framework.drill.unassigned")}</span>
              </span>
            )}
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap" title={t("category.summary.mapsSection")}>
              <MapIcon size={11} strokeWidth={1.5} />
              {node.map_count}
            </span>
            {node.slot_pending_count > 0 && (
              <span
                data-id="framework-l5-pending"
                title={t("framework.drill.pending", { n: node.slot_pending_count })}
                className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-warn/10 px-1 py-0.5 font-semibold text-warn"
              >
                <Hourglass size={10} strokeWidth={1.7} />
                {node.slot_pending_count}
              </span>
            )}
            {canOpen && (
              <button
                type="button"
                data-id={`framework-linkage-${node.id}`}
                title={node.linkage_map_id !== null ? t("category.summary.openCanvas") : t("framework.drill.createCanvas")}
                aria-label={node.linkage_map_id !== null ? t("category.summary.openCanvas") : t("framework.drill.createCanvas")}
                className={`ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors ${
                  node.linkage_map_id !== null
                    ? "bg-accent text-on-accent hover:bg-accent-focus"
                    : "border border-accent-tint-border bg-surface text-accent hover:bg-accent-tint"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenLinkage(node);
                }}
              >
                {node.linkage_map_id !== null ? <ArrowUpRight size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2} />}
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  let body: ReactNode;
  if (path === null) {
    body = null;
  } else if (currentKey === ROOT) {
    body = (
      <div data-id="framework-drill-root-hint" className="rounded-sm border border-dashed border-hairline px-3 py-6 text-center text-fine text-ink-tertiary">
        {t("framework.drill.rootHint")}
      </div>
    );
  } else if (rows === undefined && (loading.has(currentKey) || !failed.has(currentKey))) {
    body = (
      <div data-id="framework-drill-loading" className="flex items-center gap-2 px-1 py-3 text-fine text-ink-tertiary">
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
        {t("common.loading")}
      </div>
    );
  } else if (rows === undefined) {
    body = (
      <button
        type="button"
        data-id="framework-node-retry"
        className="self-start px-1 py-2 text-left text-fine text-error hover:underline"
        onClick={() => loadChildren(currentKey)}
      >
        {t("framework.drill.retry")}
      </button>
    );
  } else if (rows.length === 0) {
    body = (
      <div data-id="framework-drill-empty" className="rounded-sm border border-dashed border-hairline px-3 py-6 text-center text-fine text-ink-tertiary">
        {t("category.summary.noChildren")}
      </div>
    );
  } else {
    body = (
      <ul
        key={motion.key}
        data-id="framework-drill-list"
        className={`flex flex-col gap-1.5 ${motion.dir === "in" ? "fw-slide-in" : motion.dir === "back" ? "fw-slide-back" : ""}`}
      >
        {rows.map((node) => (node.level === 5 ? renderCard(node) : renderRow(node)))}
      </ul>
    );
  }

  // 형제 열 — 루트: L1 목록(선택 없음). 로딩/실패는 짧게 표시
  const siblingsLoading = siblingKey !== null && siblingSource === undefined && !failed.has(siblingKey);
  const siblingsBody: ReactNode =
    path === null ? null : siblingsLoading ? (
      <div className="flex items-center gap-1.5 px-2 py-2 text-fine text-ink-tertiary">
        <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
      </div>
    ) : siblings.length === 0 && currentKey === ROOT ? (
      <div className="px-2 py-2 text-fine text-ink-tertiary">{t("home.frameworkEmpty")}</div>
    ) : (
      siblings.map((s) => {
        const on = s.id === currentKey;
        return (
          <button
            key={s.id}
            type="button"
            data-id={`framework-sib-${s.id}`}
            aria-current={on ? "true" : undefined}
            title={s.name}
            className={`relative flex w-full flex-col gap-0.5 rounded-sm border px-2 py-1.5 pl-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
              on
                ? "border-accent-tint-border bg-surface font-semibold text-accent shadow-md before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[3px] before:rounded-sm before:bg-accent"
                : "border-transparent text-ink-secondary hover:border-hairline hover:bg-surface hover:text-ink"
            }`}
            onClick={() => switchSibling(s)}
          >
            <span className="min-w-0 truncate text-fine">{s.name}</span>
            <span className="flex items-center gap-1 text-[10px] font-normal text-ink-tertiary">
              {t("category.summary.l5Count", { n: s.l5_count })}
              {!on && recent.includes(s.id) && (
                <span data-id="framework-sib-recent" title={t("framework.drill.recent")} className="h-[5px] w-[5px] rounded-full bg-chart-approved" />
              )}
            </span>
          </button>
        );
      })
    );

  return (
    <section
      data-id="framework-drill"
      className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-x-hidden overflow-y-auto pr-1"
      onKeyDown={handleKeyDown}
    >
      {/* 브레드크럼 — 루트 라벨 + 조상 버튼, 현재는 굵게. 우측 끝 = 탐색 모달 아이콘 */}
      <nav data-id="framework-crumb" className="flex min-h-[22px] items-center gap-0.5 px-0.5 text-fine text-ink-tertiary">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          {path && path.length > 0 ? (
            <>
              <button
                type="button"
                data-id="framework-crumb-root"
                className="rounded-sm px-1 hover:bg-accent-tint hover:text-accent"
                onClick={() => goTo(0)}
              >
                {t("home.viewFramework")}
              </button>
              {path.map((node, i) => (
                <span key={node.id} className="flex min-w-0 items-center gap-0.5">
                  <ChevronRight size={11} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                  {i === path.length - 1 ? (
                    <span className="max-w-[10rem] truncate px-1 font-semibold text-ink">{node.name}</span>
                  ) : (
                    <button
                      type="button"
                      data-id={`framework-crumb-${node.id}`}
                      className="max-w-[10rem] truncate rounded-sm px-1 hover:bg-accent-tint hover:text-accent"
                      onClick={() => goTo(i + 1)}
                    >
                      {node.name}
                    </button>
                  )}
                </span>
              ))}
            </>
          ) : (
            <span className="px-1 font-semibold text-ink">{t("home.viewFramework")}</span>
          )}
        </div>
        <button
          type="button"
          data-id="framework-explorer-open"
          title={t("framework.explorer.open")}
          aria-label={t("framework.explorer.open")}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-hairline bg-surface text-ink-tertiary transition-colors hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent"
          onClick={() => setExplorerOpen(true)}
        >
          <Network size={13} strokeWidth={1.5} />
        </button>
      </nav>

      {/* 레벨 헤더 — 상위 버튼 · L배지 · 이름 · "L5 n · 맵 n" */}
      <div className="flex items-center gap-2 px-0.5 pb-0.5">
        <button
          type="button"
          data-id="framework-back"
          title={t("framework.drill.up")}
          aria-label={t("framework.drill.up")}
          disabled={!path || path.length === 0}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-hairline bg-surface text-ink-tertiary transition-colors hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent disabled:opacity-35 disabled:hover:border-hairline disabled:hover:bg-surface disabled:hover:text-ink-tertiary"
          onClick={() => path && goTo(path.length - 1)}
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        {current && (
          <span className="shrink-0 rounded-full bg-accent-tint px-2 py-0.5 text-fine font-semibold text-accent">L{current.level}</span>
        )}
        <span data-id="framework-drill-title" className="min-w-0 flex-1 truncate text-body-strong text-ink">
          {current ? current.name : t("home.viewFramework")}
        </span>
        {current && (
          <span data-id="framework-drill-meta" className="shrink-0 whitespace-nowrap text-fine text-ink-tertiary">
            {t("category.summary.l5Count", { n: current.l5_count })}
            <span className="mx-1 text-ink-muted">·</span>
            {t("category.summary.mapCountShort", { n: current.map_count })}
          </span>
        )}
      </div>

      {/* 형제(1) : 하위(2) */}
      <div className="grid grid-cols-[1fr_2fr] items-start gap-2">
        <div data-id="framework-sibs" className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-divider bg-surface-alt p-1">
          <span className="px-2 pb-0.5 pt-1 text-[10px] font-semibold tracking-wide text-ink-muted">
            {current ? `L${current.level} · ${t("framework.drill.sameLevel")}` : "L1"}
          </span>
          {siblingsBody}
        </div>
        <div className="min-w-0">{body}</div>
      </div>

      {explorerOpen && (
        <FrameworkExplorerModal
          centerId={typeof currentKey === "number" ? currentKey : null}
          onClose={() => setExplorerOpen(false)}
          onNavigate={goToCategory}
        />
      )}
    </section>
  );
}
