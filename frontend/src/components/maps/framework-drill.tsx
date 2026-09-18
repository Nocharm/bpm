// 홈 Framework 뷰 — L5 포커스 드릴다운(목업 B안 확정 2026-09-18). 한 번에 한 레벨만 보여주고 브레드크럼·
// 상위 버튼·형제 칩(넘치면 쉐브론 드롭다운)으로 이동한다. L1~L4는 얇은 행(클릭=드릴인+우측 요약 선택),
// L5는 캔버스 상태·직속 관리자·소속 맵 수·슬롯 승인 대기를 담은 카드(클릭=선택, 캔버스는 카드 안 버튼).
// 소속 맵 목록은 좌측에서 빼고 우측 CategorySummaryCard가 담당한다. 판정 헬퍼는 lib/framework-drill.ts.
"use client";

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Hourglass,
  Loader2,
  Map as MapIcon,
  User,
  Workflow,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { getCategoryChain, listCategoryNodes, type CategoryNode } from "@/lib/api";
import {
  CANVAS_STATE_LABEL_EN,
  bumpRecent,
  getCanvasState,
  getSiblingRows,
  layoutChips,
  orderChipsByRecency,
  readPersistedDrill,
  resolveCurrentNode,
  writePersistedDrill,
} from "@/lib/framework-drill";
import { useI18n } from "@/lib/i18n";
import { PersonHoverCard } from "@/components/person-hover-card";

type ParentKey = number | "root";
const ROOT: ParentKey = "root";
// 형제 칩 스트립 — 칩 간격(px)과 "더 보기" 쉐브론 버튼 폭(px). pickVisibleChips 계산 입력.
const CHIP_GAP = 6;
const MORE_WIDTH = 28;

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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  // 형제 세트별 칩 실측 폭(id 키) — 모두 렌더된 첫 레이아웃에서 재고 리사이즈 땐 저장값으로 재계산(숨긴 칩은 폭 0)
  const chipWidthsRef = useRef<{ key: string; widthById: Map<number, number> } | null>(null);
  const [stripWidth, setStripWidth] = useState(0);
  // 스트립 배치(표시 순서 + 앞에서 몇 개 노출)는 세트 키와 함께 보관 — 세트가 바뀐 첫 렌더는 옛 배치를
  // 쓰지 않고 원래 순서로 전부 그려 실측한다
  const [chipLayout, setChipLayout] = useState<{ key: string; order: number[]; visibleCount: number } | null>(null);
  // 최근에 현재 위치였던 카테고리(앞이 최신) — 넘친 형제 칩을 "현재 + 최근 연 것"으로 고른다(사용자 지시 2026-09-19)
  const [recent, setRecent] = useState<number[]>([]);
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

  // 경로 이동 — 현재 노드의 자식(목록)과 부모의 자식(형제 칩)이 없으면 불러온다
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
    const keys: ParentKey[] = [next.length > 0 ? next[next.length - 1].id : ROOT];
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
  const parentKey: ParentKey | null = path === null ? null : path.length > 1 ? path[path.length - 2].id : path.length === 1 ? ROOT : null;
  const rows = children.get(currentKey);
  const parentChildren = parentKey === null ? undefined : children.get(parentKey);
  // children 맵이 바뀔 때만 새 배열 — 아래 실측 이펙트 deps에 넣어도 렌더마다 재실행되지 않는다
  const siblings = useMemo(() => (parentChildren ? getSiblingRows(parentChildren) : []), [parentChildren]);
  const current = path && path.length > 0 ? resolveCurrentNode(path[path.length - 1], parentChildren) : null;
  const siblingsKey = `${String(parentKey)}:${siblings.map((s) => s.id).join(",")}`;
  const effectiveLayout = chipLayout?.key === siblingsKey ? chipLayout : null;
  // 표시 순서 — 배치 전(실측 렌더)엔 원래 순서 전부, 배치 후엔 layoutChips가 정한 순서(전부 들어가면 원래 순서,
  // 넘치면 현재 → 최근 순)로 앞 visibleCount개만 보인다
  const siblingById = useMemo(() => new Map(siblings.map((s) => [s.id, s])), [siblings]);
  const displayedChips = effectiveLayout
    ? effectiveLayout.order.map((id) => siblingById.get(id)).filter((s): s is CategoryNode => s !== undefined)
    : siblings;
  const visibleCount = effectiveLayout ? effectiveLayout.visibleCount : displayedChips.length;

  // 형제 칩 폭 실측 → 배치. 세트가 바뀌면(키 불일치) 전부 렌더된 프레임에서 폭을 재고 캐시한다.
  // setState는 다음 프레임 콜백에서 — 레이아웃 이펙트 본문의 동기 setState(캐스케이드 렌더)를 피한다.
  useLayoutEffect(() => {
    if (siblings.length === 0) return;
    const frame = requestAnimationFrame(() => {
      let cached = chipWidthsRef.current;
      if (!cached || cached.key !== siblingsKey) {
        const widthById = new Map(siblings.map((s) => [s.id, chipRefs.current.get(s.id)?.offsetWidth ?? 0]));
        // 숨김 칩(폭 0)이 섞여 있으면 실측 불가 — 키 불일치 렌더(전부 노출)에서 다시 잰다
        if ([...widthById.values()].some((w) => w === 0)) return;
        cached = { key: siblingsKey, widthById };
        chipWidthsRef.current = cached;
      }
      // 가용 폭은 스트립이 아니라 래퍼(칩 + 더 보기 버튼) 기준 — 스트립은 버튼이 있을 때 그만큼 좁아져
      // "버튼 때문에 못 들어간다"는 순환(넓혀도 못 돌아옴)이 생긴다
      const wrapper = moreRef.current;
      if (!wrapper) return;
      const style = getComputedStyle(wrapper);
      const available = wrapper.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (available <= 0) return;
      const priority = orderChipsByRecency(siblings, typeof currentKey === "number" ? currentKey : null, recent);
      const next = layoutChips(siblings, priority, cached.widthById, available, MORE_WIDTH, CHIP_GAP);
      const order = next.order.map((s) => s.id);
      setChipLayout((prev) => {
        if (
          prev &&
          prev.key === siblingsKey &&
          prev.visibleCount === next.visibleCount &&
          prev.order.length === order.length &&
          prev.order.every((id, i) => id === order[i])
        ) {
          return prev;
        }
        return { key: siblingsKey, order, visibleCount: next.visibleCount };
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [siblings, siblingsKey, currentKey, recent, stripWidth]);

  // 래퍼는 형제가 있을 때만 렌더된다 — 그 존재 여부에 맞춰 관찰을 붙였다 뗀다(경로 변경 시점엔 아직 없을 수 있다)
  const hasSiblings = siblings.length > 0;
  useEffect(() => {
    const el = moreRef.current;
    if (!hasSiblings || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setStripWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasSiblings]);

  // 칩 전환 애니메이션(사용자 지시 2026-09-19) — 배치가 바뀌면 남는 칩은 이전 자리에서 새 자리로 미끄러지고(FLIP),
  // 새로 보이는 칩은 살짝 커지며 나타난다. 위치는 렌더 후 실측, 애니메이션은 WAAPI라 상태를 건드리지 않는다.
  const prevChipRects = useRef<Map<number, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const rects = new Map<number, DOMRect>();
    for (const [id, el] of chipRefs.current) {
      if (el.offsetParent !== null) rects.set(id, el.getBoundingClientRect());
    }
    const prev = prevChipRects.current;
    prevChipRects.current = rects;
    if (prev.size === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, rect] of rects) {
      const el = chipRefs.current.get(id);
      if (!el) continue;
      const before = prev.get(id);
      if (before) {
        const dx = before.left - rect.left;
        if (Math.abs(dx) > 1) {
          el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], {
            duration: 350,
            easing: "cubic-bezier(0.25, 1, 0.5, 1)",
          });
        }
      } else {
        el.animate(
          [{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }],
          { duration: 350, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
      }
    }
  }, [chipLayout]);

  // 드롭다운 바깥 클릭·Esc 닫기 — FilterDropdown과 동일 패턴(document capture 리스너)
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

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
  const switchSibling = (node: CategoryNode) => {
    if (!path || path.length === 0 || node.id === currentKey) return;
    navigate([...path.slice(0, -1), node], null);
    setMoreOpen(false);
    onSelectCategory?.(node);
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
        className="flex w-full items-center gap-2.5 rounded-sm border border-hairline bg-surface px-3 py-2 text-left transition-colors duration-150 hover:border-accent-tint-border hover:bg-surface-pearl"
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

  const renderCard = (node: CategoryNode) => {
    const state = getCanvasState(node);
    const selected = selectedCategoryId === node.id;
    const canOpen = node.linkage_map_id !== null || node.can_edit_linkage;
    const pillClass =
      state === "confirmed"
        ? `${selected ? "bg-surface" : "bg-accent-tint"} text-accent`
        : state === "draft"
          ? "bg-ink/5 text-ink-tertiary"
          : "border border-dashed border-hairline text-ink-tertiary";
    const dotClass = state === "confirmed" ? "bg-chart-approved" : "bg-chart-draft";
    return (
      <li key={node.id}>
        <div
          role="button"
          tabIndex={0}
          data-id={`framework-l5-${node.id}`}
          data-state={state}
          aria-pressed={selected}
          className={`group flex w-full flex-col gap-2 rounded-sm border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
            selected
              ? "border-accent-tint-border bg-accent-tint"
              : "border-hairline bg-surface hover:border-accent-tint-border hover:shadow-md"
          }`}
          onClick={() => onSelectCategory?.(node)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectCategory?.(node);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm ${
                state === "none"
                  ? "bg-surface-alt text-ink-muted"
                  : selected
                    ? "bg-accent text-on-accent"
                    : "bg-accent-tint text-accent"
              }`}
            >
              <Workflow size={14} strokeWidth={1.5} />
            </span>
            <span className="min-w-0 flex-1 truncate text-caption-strong text-ink">{node.name}</span>
            <span
              data-id="framework-l5-status"
              className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${pillClass}`}
            >
              {state !== "none" && <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />}
              {CANVAS_STATE_LABEL_EN[state]}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-fine text-ink-tertiary">
            {node.admin ? (
              <PersonHoverCard userId={node.admin.login_id} className="min-w-0">
                <span
                  data-id="framework-l5-admin"
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-hairline bg-surface py-0.5 pl-1 pr-2 text-ink-secondary"
                >
                  <User size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  <span className="truncate">{node.admin.name}</span>
                </span>
              </PersonHoverCard>
            ) : (
              <span
                data-id="framework-l5-admin"
                data-unset=""
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-hairline py-0.5 pl-1 pr-2 text-ink-muted"
              >
                <User size={12} strokeWidth={1.5} className="shrink-0" />
                {t("framework.drill.unassigned")}
              </span>
            )}
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap" title={t("category.summary.mapsSection")}>
              <MapIcon size={12} strokeWidth={1.5} />
              {t("category.summary.mapCountShort", { n: node.map_count })}
            </span>
            {node.slot_pending_count > 0 && (
              <span
                data-id="framework-l5-pending"
                className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-warn/10 px-1.5 py-0.5 font-semibold text-warn"
              >
                <Hourglass size={11} strokeWidth={1.7} />
                {t("framework.drill.pending", { n: node.slot_pending_count })}
              </span>
            )}
            {canOpen && (
              <button
                type="button"
                data-id={`framework-linkage-${node.id}`}
                className={`ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 py-1 text-fine font-semibold transition-colors ${
                  node.linkage_map_id !== null
                    ? "bg-accent text-on-accent hover:bg-accent-focus"
                    : "border border-accent-tint-border bg-surface text-accent hover:bg-accent-tint"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenLinkage(node);
                }}
              >
                <ArrowUpRight size={12} strokeWidth={2} />
                {node.linkage_map_id !== null ? t("category.summary.openCanvas") : t("framework.drill.createCanvas")}
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  let body: ReactNode;
  if (path === null || (rows === undefined && (loading.has(currentKey) || !failed.has(currentKey)))) {
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
      <div
        data-id="framework-drill-empty"
        className="rounded-sm border border-dashed border-hairline px-3 py-6 text-center text-fine text-ink-tertiary"
      >
        {currentKey === ROOT ? t("home.frameworkEmpty") : t("category.summary.noChildren")}
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

  const hiddenCount = displayedChips.length - visibleCount;

  return (
    <section
      data-id="framework-drill"
      className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-x-hidden overflow-y-auto pr-1"
      onKeyDown={handleKeyDown}
    >
      {/* 브레드크럼 — 루트 라벨 + 조상 버튼, 현재는 굵게. 루트에선 높이만 유지 */}
      <nav data-id="framework-crumb" className="flex min-h-[18px] flex-wrap items-center gap-0.5 px-0.5 text-fine text-ink-tertiary">
        {path && path.length > 0 && (
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
                  <span className="truncate px-1 font-semibold text-ink">{node.name}</span>
                ) : (
                  <button
                    type="button"
                    data-id={`framework-crumb-${node.id}`}
                    className="truncate rounded-sm px-1 hover:bg-accent-tint hover:text-accent"
                    onClick={() => goTo(i + 1)}
                  >
                    {node.name}
                  </button>
                )}
              </span>
            ))}
          </>
        )}
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
          <span className="shrink-0 rounded-full bg-accent-tint px-2 py-0.5 text-fine font-semibold text-accent">
            L{current.level}
          </span>
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

      {/* 형제 칩 스트립 — 같은 부모의 다른 L1~L4로 1클릭 전환. 넘치면 쉐브론 → 전체 목록 드롭다운 */}
      {siblings.length > 0 && (
        <div ref={moreRef} className="relative flex items-center gap-1.5 px-0.5 pb-1">
          <div data-id="framework-sibs" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {displayedChips.map((s, i) => {
              const on = s.id === currentKey;
              const shown = i < visibleCount;
              return (
                <button
                  key={s.id}
                  ref={(el) => {
                    if (el) chipRefs.current.set(s.id, el);
                    else chipRefs.current.delete(s.id);
                  }}
                  type="button"
                  data-id={`framework-sib-${s.id}`}
                  aria-current={on ? "true" : undefined}
                  // display는 한 클래스만 — inline-flex와 hidden을 같이 두면 생성 순서에 따라 hidden이 진다
                  className={`${shown ? "inline-flex" : "hidden"} shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-fine transition-colors ${
                    on
                      ? "border-accent bg-accent text-on-accent"
                      : "border-hairline bg-surface text-ink-secondary hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent"
                  }`}
                  onClick={() => switchSibling(s)}
                >
                  <span className="max-w-[12rem] truncate">{s.name}</span>
                  <span className={`text-[10px] font-semibold ${on ? "text-on-accent/80" : "text-ink-tertiary"}`}>
                    {t("category.summary.l5Count", { n: s.l5_count })}
                  </span>
                </button>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              data-id="framework-sibs-more"
              aria-expanded={moreOpen}
              title={t("framework.drill.siblings", { level: current?.level ?? 1 })}
              aria-label={t("framework.drill.siblings", { level: current?.level ?? 1 })}
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                moreOpen
                  ? "border-accent-tint-border bg-accent-tint text-accent"
                  : "border-hairline bg-surface text-ink-tertiary hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent"
              }`}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <ChevronDown size={14} strokeWidth={1.5} className={moreOpen ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
          )}
          {moreOpen && (
            <div
              data-id="framework-sibs-menu"
              className="absolute right-0 top-full z-[1001] mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-hairline bg-surface py-1 shadow-lg"
            >
              {siblings.map((s) => {
                const on = s.id === currentKey;
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-id={`framework-sibs-item-${s.id}`}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption hover:bg-surface-alt ${on ? "text-accent" : "text-ink"}`}
                    onClick={() => switchSibling(s)}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 text-fine text-ink-tertiary">{t("category.summary.l5Count", { n: s.l5_count })}</span>
                    {on && <Check size={14} strokeWidth={1.7} className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {body}
    </section>
  );
}
