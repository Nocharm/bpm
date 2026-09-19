// 업무 체계 탐색 모달 — 홈 드릴다운 브레드크럼의 트리 아이콘이 연다(목업 v4 확정 2026-09-19). 상단 [계단식 | 다이어그램]
// 세그먼트 + 검색. 계단식: lazy 트리(lib/framework-tree-state 엔진), 현재 경로 미리 펼침·강조, 행 클릭=이동+닫힘, 자손
// 호버 시 조상 강조(globals.css data-tree-* 규칙 공용). 다이어그램: lib/framework-diagram 레이아웃(ERD식 직각 엣지, 상위 체인
// L1까지 위 가운데 차콜, 현재 액센트, 자식 좌/우, 손자 계단 스택). 좌클릭=재중심(전환 애니), 우클릭=메뉴(정보·이동·중심),
// 휠 줌·드래그 팬. 모달 폭은 모드에 따라 640↔1180px로 전환.
// 플로팅 패널(사용자 지시 2026-09-19): 배경 딤 없이 페이지 위에 떠 있고 헤더 드래그로 옮긴다. 바깥 클릭으로 닫히지 않고
// ×/Esc로만 닫힌다. 항목을 골라 이동해도 열린 채 남아 현재 위치(centerId)를 따라간다.
"use client";

import { ChevronDown, ChevronRight, Crosshair, Info, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type WheelEvent } from "react";
import { createPortal } from "react-dom";

import {
  getCategoryChain,
  getCategorySummary,
  listCategoryNodes,
  searchFramework,
  type CategoryNode,
  type CategorySummary,
  type FrameworkSearchResult,
} from "@/lib/api";
import { DIAGRAM, fitScale, layoutDiagram, type DiagramLayout, type DiagramNode } from "@/lib/framework-diagram";
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
import { getTreeIndentStyle, TREE_INDENT_PADDING_CLASS } from "@/lib/tree-indent";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { GoToMenu } from "@/components/maps/go-to-menu";

type Mode = "tree" | "diagram";
// 마지막 모드 영속 — 다음에 열 때 같은 형태로
const MODE_KEY = "bpm.home.frameworkExplorerMode";
const VIEW_W = 1180;
const VIEW_H = 640;
// 플로팅 패널 폭(px) — 페이지를 다 가리지 않게 다이어그램 1000·계단식 560(뷰박스는 1180 기준, meet 스케일)
const PANEL_W = { tree: 560, diagram: 1000 } as const;
// 다이어그램 데이터: 부모 id(또는 루트)별 자식 캐시 — 트리 엔진 캐시와 별도(정렬·형태 동일, 갱신 주기 짧음)
type ParentKey = number | "root";

interface FrameworkExplorerModalProps {
  // 현재 드릴 위치(루트면 null) — 트리 미리 펼침·다이어그램 중심
  centerId: number | null;
  onClose: () => void;
  // 카테고리로 이동(L5면 부모 레벨 + 카드 선택은 호출부 담당) — 호출부가 닫는다
  onNavigate: (node: CategoryNode) => void;
}

function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "tree" ? "tree" : "diagram";
  } catch {
    return "diagram";
  }
}

export function FrameworkExplorerModal({ centerId, onClose, onNavigate }: FrameworkExplorerModalProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>(() => readMode());

  // ── 계단식 트리 ──
  const [tree, setTree] = useState<FrameworkTreeState>(createInitialState());
  const [chainIds, setChainIds] = useState<Set<number>>(new Set());
  // 루트→현재 체인 — 어느 centerId의 것인지 함께 둔다(centerId가 바뀐 직후 옛 체인으로 중심을 맞추는 경합 방지)
  const [chain, setChain] = useState<{ forId: number | null; nodes: CategoryNode[] } | null>(null);
  const [initFailed, setInitFailed] = useState(false);
  useEffect(() => {
    let active = true;
    async function init() {
      const chainNodes = centerId === null ? [] : await getCategoryChain(centerId);
      const ids = chainNodes.map((c) => c.id);
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
      setChain({ forId: centerId, nodes: chainNodes });
      setTree(next);
    }
    void init().catch(() => {
      if (active) setInitFailed(true);
    });
    return () => {
      active = false;
    };
  }, [centerId]);

  function handleToggle(categoryId: number) {
    if (tree.openIds.has(categoryId)) {
      setTree((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    setTree((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId }));
    if (shouldFetchChildren(tree, categoryId)) {
      setTree((prev) => reduceFrameworkTree(prev, { type: "loading_started", categoryId }));
      void fetchCategoryChildren(categoryId)
        .then(({ nodes, maps }) => setTree((prev) => applyCategoryLoaded(prev, categoryId, nodes, maps)))
        .catch(() => setTree((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId })));
    }
  }

  // ── 검색(두 모드 공용) ──
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResult, setSearchResult] = useState<{ q: string; data: FrameworkSearchResult } | null>(null);
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
  const results = debouncedQuery !== "" && searchResult?.q === debouncedQuery ? searchResult.data : null;

  // ── 다이어그램 ──
  const [center, setCenter] = useState<CategoryNode | null>(null);
  const [full, setFull] = useState(false);
  const [childrenCache, setChildrenCache] = useState<Map<ParentKey, CategoryNode[]>>(new Map());
  const [chainCache, setChainCache] = useState<Map<number, CategoryNode[]>>(new Map());
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [placed, setPlaced] = useState<Set<number>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: CategoryNode } | null>(null);
  const [infoNode, setInfoNode] = useState<CategoryNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // 중심 동기화 — 체인 말단(L5면 그 부모), 루트면 첫 L1. centerId가 바뀌면(패널을 열어둔 채 이동) 다시 맞추고,
  // 사용자가 박스를 눌러 옮긴 중심은 다음 centerId 변경 전까지 유지한다
  const appliedCenterId = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (chain === null || chain.forId !== centerId || (center !== null && appliedCenterId.current === centerId)) return;
    const nodes = chain.nodes;
    const roots = tree.childrenByParent.get(ROOT) ?? [];
    const last = nodes[nodes.length - 1];
    const initial = last ? (last.level === 5 ? nodes[nodes.length - 2] : last) : roots[0];
    if (!initial) return;
    // 체인 응답은 카운트 0 — 부모 자식 목록에 같은 id가 있으면 그것을 쓴다
    const parentKey: ParentKey = nodes.length > 1 && last.level < 5 ? nodes[nodes.length - 2].id : ROOT;
    const resolved = tree.childrenByParent.get(parentKey)?.find((n) => n.id === initial.id) ?? initial;
    const frame = requestAnimationFrame(() => {
      appliedCenterId.current = centerId;
      setCenter(resolved);
      setFull(false);
      setChainCache((prev) => new Map(prev).set(initial.id, nodes.filter((c) => c.level < initial.level)));
    });
    return () => cancelAnimationFrame(frame);
  }, [chain, center, tree, centerId]);

  // 중심 기준 데이터 보강 — 상위 체인·자식·손자(자식별) 캐시에 없으면 받아온다
  const effectiveCenter = full ? (chainCache.get(center?.id ?? -1)?.[0] ?? (center?.level === 1 ? center : null)) : center;
  useEffect(() => {
    if (!effectiveCenter) return;
    const id = effectiveCenter.id;
    let active = true;
    async function load() {
      const need: Promise<void>[] = [];
      if (!chainCache.has(id)) {
        need.push(
          getCategoryChain(id).then((c) => {
            if (active) setChainCache((prev) => new Map(prev).set(id, c.slice(0, -1)));
          }),
        );
      }
      let kids = childrenCache.get(id);
      if (kids === undefined) {
        kids = await listCategoryNodes(id);
        if (!active) return;
        const loadedKids = kids;
        setChildrenCache((prev) => new Map(prev).set(id, loadedKids));
      }
      const missing = kids.filter((k) => k.level < 5 && !childrenCache.has(k.id));
      const grand = await Promise.all(missing.map((k) => listCategoryNodes(k.id).then((n) => [k.id, n] as const)));
      if (!active) return;
      if (grand.length > 0) {
        setChildrenCache((prev) => {
          const next = new Map(prev);
          for (const [kid, nodes] of grand) next.set(kid, nodes);
          return next;
        });
      }
      await Promise.all(need);
    }
    void load().catch(() => {
      /* 일부 실패 — 있는 캐시로 그린다 */
    });
    return () => {
      active = false;
    };
    // 캐시 맵은 load 안에서 갱신되므로 deps에 넣지 않는다(무한 재실행 방지) — 중심이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCenter?.id, full]);

  // 체인 응답(상위·재중심한 상위)은 카운트가 0 고정 — 자식 캐시 어딘가에 같은 id가 있으면 그 노드로 바꿔 건수를 살린다
  const resolveFromCache = (n: CategoryNode): CategoryNode => {
    for (const list of childrenCache.values()) {
      const hit = list.find((c) => c.id === n.id);
      if (hit) return hit;
    }
    // 트리 엔진 캐시(루트 L1 목록·펼친 경로)도 같은 /nodes 응답이라 그대로 쓸 수 있다
    for (const list of tree.childrenByParent.values()) {
      const hit = list.find((c) => c.id === n.id);
      if (hit) return hit;
    }
    return n;
  };
  const layout: DiagramLayout | null = (() => {
    if (!effectiveCenter) return null;
    const ancestors = full ? [] : (chainCache.get(effectiveCenter.id) ?? []).map(resolveFromCache);
    const kids = childrenCache.get(effectiveCenter.id) ?? [];
    const grandchildren = new Map<number, CategoryNode[]>();
    for (const k of kids) {
      const g = childrenCache.get(k.id);
      if (g) grandchildren.set(k.id, g);
    }
    return layoutDiagram({ ancestors, center: resolveFromCache(effectiveCenter), children: kids, grandchildren }, VIEW_W);
  })();

  // 등장 애니메이션 — 새 박스는 중심 자리에서 시작해 다음 프레임에 제자리로(transform 전환)
  const layoutIds = layout ? layout.nodes.map((n) => n.node.id).join(",") : "";
  useEffect(() => {
    if (!layout) return;
    const ids = layout.nodes.map((n) => n.node.id);
    if (ids.every((id) => placed.has(id))) return;
    const frame = requestAnimationFrame(() => setPlaced(new Set(ids)));
    return () => cancelAnimationFrame(frame);
    // layoutIds가 노드 집합 변경을 대표한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutIds]);

  const recenter = (node: CategoryNode) => {
    if (node.level === 5) return;
    setFull(false);
    setView({ x: 0, y: 0, k: 1 });
    setCenter(node);
  };
  // 이동해도 패널은 열린 채 — centerId가 바뀌면 트리·다이어그램이 새 위치를 따라간다
  const navigate = (node: CategoryNode) => {
    onNavigate(node);
  };

  // 플로팅 위치 — null이면 가로 중앙·위 72px(폭 전환 중에도 translateX(-50%)로 중앙 유지), 드래그하면 절대 좌표
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const startPanelDrag = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, label")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    panelDragRef.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    e.preventDefault();
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = panelDragRef.current;
      const rect = panelRef.current?.getBoundingClientRect();
      if (!d || !rect) return;
      const left = Math.min(Math.max(8, d.left + (e.clientX - d.x)), window.innerWidth - rect.width - 8);
      const top = Math.min(Math.max(8, d.top + (e.clientY - d.y)), window.innerHeight - 48);
      setPos({ left, top });
    };
    const onUp = () => {
      panelDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  // Esc — 메뉴·정보 카드가 열려 있으면 그쪽이 먼저 닫힌다(정보 카드는 자체 백드롭 스택)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ctxMenu || infoNode) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctxMenu, infoNode, onClose]);
  const pathOf = (node: CategoryNode): string => {
    // 다이어그램 안 노드의 경로 — 상위 체인 + 중심 + (자식) + (손자)
    if (!layout || !effectiveCenter) return node.name;
    const anc = chainCache.get(effectiveCenter.id) ?? [];
    const names = anc.map((a) => a.name);
    if (node.id === effectiveCenter.id) return [...names, node.name].join(" › ");
    if (anc.some((a) => a.id === node.id)) return names.slice(0, anc.findIndex((a) => a.id === node.id) + 1).join(" › ");
    const kids = childrenCache.get(effectiveCenter.id) ?? [];
    const asChild = kids.find((k) => k.id === node.id);
    if (asChild) return [...names, effectiveCenter.name, node.name].join(" › ");
    const parent = kids.find((k) => (childrenCache.get(k.id) ?? []).some((g) => g.id === node.id));
    return [...names, effectiveCenter.name, parent?.name ?? "?", node.name].join(" › ");
  };

  const handleWheel = (e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setView((v) => ({ ...v, k: Math.min(3, Math.max(0.4, v.k * (e.deltaY < 0 ? 1.12 : 0.9))) }));
  };
  const handleDown = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const switchMode = (next: Mode) => {
    // 드래그해 둔 패널은 폭이 바뀌어도 가운데를 지킨다(중앙 정렬 상태는 translateX(-50%)가 알아서)
    const widthOf = (m: Mode) => (m === "tree" ? PANEL_W.tree : PANEL_W.diagram);
    setPos((p) => (p ? { ...p, left: Math.max(8, p.left + (widthOf(mode) - widthOf(next)) / 2) } : p));
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* 영속은 편의 */
    }
  };

  // ── 렌더: 계단식 트리 행 ──
  const renderTreeNode = (node: CategoryNode, depth: number): ReactNode => {
    const open = tree.openIds.has(node.id);
    const kids = tree.childrenByParent.get(node.id) ?? [];
    const loading = tree.loadingIds.has(node.id);
    const current = node.id === centerId;
    const onChain = chainIds.has(node.id);
    return (
      <li key={node.id} data-tree-node data-id={`framework-explorer-node-${node.id}`} className="flex flex-col">
        <div
          data-tree-head
          style={getTreeIndentStyle(depth)}
          className={`group relative flex items-center gap-1 rounded-sm ${current ? "bg-accent-tint" : "hover:bg-divider"}`}
        >
          <button
            type="button"
            aria-expanded={node.level < 5 ? open : undefined}
            aria-label={node.level < 5 ? (open ? "collapse" : "expand") : undefined}
            disabled={node.level === 5}
            className={`inline-flex h-7 w-6 shrink-0 items-center justify-center text-ink-tertiary disabled:opacity-0 ${TREE_INDENT_PADDING_CLASS}`}
            onClick={() => handleToggle(node.id)}
          >
            {loading ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
            ) : open ? (
              <ChevronDown size={12} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={12} strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            data-id={`framework-explorer-go-${node.id}`}
            className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left"
            onClick={() => navigate(node)}
          >
            <span
              data-tree-name={current ? undefined : ""}
              className={`min-w-0 truncate text-fine ${
                current ? "font-semibold text-accent" : onChain ? "text-ink" : "text-ink-secondary group-hover:text-ink"
              }`}
            >
              {node.name}
            </span>
            {node.level < 5 && (
              <span className="ml-auto shrink-0 text-fine text-ink-muted">{t("category.summary.l5Count", { n: node.l5_count })}</span>
            )}
            <span className="shrink-0 text-fine font-semibold text-accent opacity-0 transition-opacity group-hover:opacity-100">
              {t("framework.explorer.go")} →
            </span>
          </button>
        </div>
        {open && kids.length > 0 && (
          <ul className="ml-3 flex flex-col border-l border-divider pl-1">{kids.map((k) => renderTreeNode(k, depth + 1))}</ul>
        )}
      </li>
    );
  };

  // ── 렌더: 다이어그램 박스 ──
  const renderBox = (p: DiagramNode) => {
    const { BW, BH } = DIAGRAM;
    const n = p.node;
    const isPlaced = placed.has(n.id);
    const cx = layout ? layout.cx - BW / 2 : 0;
    const cy = layout ? layout.cy - BH / 2 : 0;
    const x = isPlaced ? p.x : cx;
    const y = isPlaced ? p.y : cy;
    const fill =
      p.kind === "center" ? "var(--color-accent)" : p.kind === "ancestor" ? "var(--color-canvas-l5)" : p.kind === "grandchild" ? "var(--color-surface-pearl)" : "var(--color-surface)";
    const stroke = p.kind === "center" ? "var(--color-accent)" : p.kind === "ancestor" ? "var(--color-canvas-l5)" : "var(--color-border-strong)";
    const inverted = p.kind === "center" || p.kind === "ancestor";
    const textFill = inverted ? "var(--color-on-accent)" : "var(--color-ink-secondary)";
    // 체인 응답 노드(캐시로 못 살린 상위·중심)는 카운트가 0 고정 — child_count까지 0이면 건수를 적지 않는다
    const counted = n.level < 5 && (n.l5_count > 0 || n.child_count > 0);
    const info = counted ? (full && n.level === 3 ? `L4 ${n.child_count} · L5 ${n.l5_count}` : `L5 ${n.l5_count}`) : "";
    const tag = p.kind === "ancestor" ? t("framework.explorer.ancestorTag") : `L${n.level}`;
    const tagW = p.kind === "ancestor" ? 28 : 20;
    const maxChars = info ? (full && n.level === 3 ? 6 : 8) : 12;
    const label = n.name.length > maxChars ? `${n.name.slice(0, maxChars - 1)}…` : n.name;
    return (
      <g
        key={n.id}
        data-id={`framework-diagram-node-${n.id}`}
        data-kind={p.kind}
        className="cursor-pointer"
        style={{
          transform: `translate(${x}px, ${y}px)`,
          opacity: isPlaced ? 1 : 0,
          transition: "transform 350ms var(--ease-smooth), opacity 350ms var(--ease-smooth)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (n.level === 5) setInfoNode(n);
          else recenter(n);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY, node: n });
        }}
        onMouseMove={(e) => {
          const r = diagramRef.current?.getBoundingClientRect();
          if (!r) return;
          setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top, text: `${n.name} · L${n.level}` });
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <rect width={BW} height={BH} rx={6} fill={fill} stroke={stroke} strokeWidth={1} strokeDasharray={n.level === 5 ? "3 2" : undefined} />
        <rect x={6} y={7} width={tagW} height={14} rx={4} fill={inverted ? "rgba(255,255,255,.2)" : "var(--color-surface-alt)"} />
        <text x={6 + tagW / 2} y={17.5} textAnchor="middle" fontSize={9} fontWeight={600} fill={inverted ? "var(--color-on-accent)" : "var(--color-ink-tertiary)"}>
          {tag}
        </text>
        <text x={12 + tagW} y={18} fontSize={11} fontWeight={inverted ? 600 : 400} fill={textFill}>
          {label}
        </text>
        {info && (
          <text x={BW - 6} y={18} textAnchor="end" fontSize={9} fill={inverted ? "rgba(255,255,255,.8)" : "var(--color-ink-tertiary)"}>
            {info}
          </text>
        )}
      </g>
    );
  };

  const k = layout ? view.k * fitScale(layout, VIEW_H) : 1;
  const tx = view.x + (VIEW_W - VIEW_W * k) / 2;
  const ty = view.y + 10;

  const roots = tree.childrenByParent.get(ROOT) ?? [];
  const showSearch = results !== null;

  return createPortal(
    // z 1200(모달 단) — 우클릭 GoToMenu(z 1200, 나중에 body에 붙음)가 위에 오도록 1300을 쓰지 않는다(오버레이 z 사다리).
    // 컨테이너는 pointer-events-none — 패널 밖은 페이지가 그대로 반응한다(플로팅).
    <div className="pointer-events-none fixed inset-0 z-[1200]">
      <div
        ref={panelRef}
        data-id="framework-explorer-modal"
        data-mode={mode}
        className="pointer-events-auto absolute flex h-[min(600px,80vh)] max-w-[95vw] flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
        style={{
          width: mode === "tree" ? PANEL_W.tree : PANEL_W.diagram,
          transition: "width 450ms var(--ease-spring)",
          ...(pos ? { left: pos.left, top: pos.top } : { left: "50%", top: 72, transform: "translateX(-50%)" }),
        }}
      >
        <div
          data-id="framework-explorer-handle"
          className="flex cursor-move select-none items-center gap-3 border-b border-hairline px-4 py-2.5"
          onMouseDown={startPanelDrag}
        >
          <span className="shrink-0 text-caption-strong text-ink">{t("framework.explorer.title")}</span>
          <div data-id="framework-explorer-mode" className="flex w-56 shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5">
            {(["tree", "diagram"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                data-id={`framework-explorer-mode-${m}`}
                className={`flex-1 rounded-sm px-2.5 py-1 text-caption transition-colors ${
                  mode === m ? "bg-accent-tint font-semibold text-accent" : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                }`}
                onClick={() => switchMode(m)}
              >
                {t(m === "tree" ? "framework.explorer.tree" : "framework.explorer.diagram")}
              </button>
            ))}
          </div>
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-caption text-ink">
            <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            <input
              data-id="framework-explorer-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("framework.explorer.search")}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-muted"
            />
            {query !== "" && (
              <button type="button" aria-label="clear" className="text-ink-muted hover:text-ink" onClick={() => setQuery("")}>
                <X size={12} strokeWidth={1.5} />
              </button>
            )}
          </label>
          <button
            type="button"
            data-id="framework-explorer-close"
            aria-label="Close"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {showSearch ? (
            <ul data-id="framework-explorer-results" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
              {results.categories.length === 0 ? (
                <li className="px-2 py-6 text-center text-fine text-ink-tertiary">{t("framework.explorer.noResults")}</li>
              ) : (
                results.categories.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-id={`framework-explorer-result-${c.id}`}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-alt"
                      onClick={() => {
                        // 검색 결과는 경량 행이라 chain으로 노드를 되찾아 이동한다
                        void getCategoryChain(c.id).then((chainNodes) => {
                          const node = chainNodes[chainNodes.length - 1];
                          if (!node) return;
                          // 이동 후엔 검색을 비워 트리/다이어그램이 새 위치로 따라온 모습을 보여준다(패널은 열린 채)
                          setQuery("");
                          setDebouncedQuery("");
                          navigate(node);
                        });
                      }}
                    >
                      <span className="shrink-0 rounded-full bg-accent-tint px-1.5 py-0.5 text-[11px] font-semibold leading-none text-accent">L{c.level}</span>
                      <span className="min-w-0 truncate text-caption text-ink">{c.name}</span>
                      {c.path && <span className="ml-auto min-w-0 truncate text-fine text-ink-tertiary">{c.path}</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : mode === "tree" ? (
            <div data-id="framework-explorer-tree" className="flex-1 overflow-y-auto p-3">
              {initFailed ? (
                <div className="px-2 py-6 text-center text-fine text-error">{t("framework.drill.retry")}</div>
              ) : roots.length === 0 ? (
                <div className="flex items-center gap-2 px-2 py-6 text-fine text-ink-tertiary">
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                  {t("common.loading")}
                </div>
              ) : (
                <ul className="flex flex-col">{roots.map((r) => renderTreeNode(r, 0))}</ul>
              )}
            </div>
          ) : (
            <div
              ref={diagramRef}
              data-id="framework-explorer-diagram"
              className="relative flex-1 overflow-hidden bg-surface-pearl"
              style={{ backgroundImage: "radial-gradient(var(--color-divider) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
            >
              <div className="absolute left-4 top-3 z-10 flex items-center gap-1.5">
                {(["focus", "all"] as const).map((f) => {
                  const on = f === "all" ? full : !full;
                  return (
                    <button
                      key={f}
                      type="button"
                      data-id={`framework-explorer-${f}`}
                      aria-pressed={on}
                      className={`rounded-sm border px-2.5 py-1 text-fine transition-colors ${
                        on ? "border-accent-tint-border bg-accent-tint font-semibold text-accent" : "border-hairline bg-surface text-ink-secondary hover:bg-surface-alt"
                      }`}
                      onClick={() => {
                        setFull(f === "all");
                        setView({ x: 0, y: 0, k: 1 });
                      }}
                    >
                      {t(f === "all" ? "framework.explorer.all" : "framework.explorer.focus")}
                    </button>
                  );
                })}
                {effectiveCenter && (
                  <span className="text-fine text-ink-tertiary">
                    {effectiveCenter.name} · L{effectiveCenter.level}
                  </span>
                )}
              </div>
              {effectiveCenter && (
                <button
                  type="button"
                  data-id="framework-explorer-go-center"
                  className="absolute right-4 top-3 z-10 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus"
                  onClick={() => navigate(effectiveCenter)}
                >
                  {t("framework.explorer.goHere")}
                </button>
              )}
              {layout ? (
                <svg
                  viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                  preserveAspectRatio="xMidYMin meet"
                  className="block h-full w-full cursor-grab active:cursor-grabbing"
                  onWheel={handleWheel}
                  onMouseDown={handleDown}
                >
                  <g transform={`translate(${tx},${ty}) scale(${k})`}>
                    <g key={`${effectiveCenter?.id}-${full}`} className="fw-fade-in">
                      {layout.links.map((l, i) => (
                        <path
                          key={i}
                          d={l.d}
                          fill="none"
                          stroke={l.kind === "up" ? "var(--color-canvas-l5)" : "var(--color-border-strong)"}
                          strokeWidth={l.kind === "up" ? 1.4 : 1.2}
                        />
                      ))}
                    </g>
                    {layout.nodes.map(renderBox)}
                  </g>
                </svg>
              ) : (
                <div className="flex h-full items-center justify-center gap-2 text-fine text-ink-tertiary">
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                  {t("common.loading")}
                </div>
              )}
              {tooltip && (
                <div
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-fine text-on-accent"
                  style={{ left: tooltip.x, top: tooltip.y }}
                >
                  {tooltip.text}
                </div>
              )}
              <div className="absolute bottom-3 left-4 z-10 rounded-sm border border-hairline bg-surface/90 px-2.5 py-1 text-fine text-ink-tertiary">
                {t("framework.explorer.legend")}
              </div>
              {infoNode && (
                <InfoCard
                  node={infoNode}
                  path={pathOf(infoNode)}
                  onClose={() => setInfoNode(null)}
                  onGo={() => navigate(infoNode)}
                  onCenter={infoNode.level < 5 ? () => { setInfoNode(null); recenter(infoNode); } : undefined}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {ctxMenu && (
        <GoToMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t("framework.explorer.info"), icon: <Info size={14} strokeWidth={1.5} />, onSelect: () => setInfoNode(ctxMenu.node) },
            { label: t("framework.explorer.goHere"), onSelect: () => navigate(ctxMenu.node) },
            ...(ctxMenu.node.level < 5
              ? [{ label: t("framework.explorer.center"), icon: <Crosshair size={14} strokeWidth={1.5} />, onSelect: () => recenter(ctxMenu.node) }]
              : []),
          ]}
        />
      )}
    </div>,
    document.body,
  );
}

// 정보 카드 — 우클릭 "정보 보기"·L5 좌클릭. 요약 API로 관리자·서브트리 수를 채우고 이동/중심 버튼을 함께 둔다.
function InfoCard({
  node,
  path,
  onClose,
  onGo,
  onCenter,
}: {
  node: CategoryNode;
  path: string;
  onClose: () => void;
  onGo: () => void;
  onCenter?: () => void;
}) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<CategorySummary | null>(null);
  useEffect(() => {
    let active = true;
    void getCategorySummary(node.id)
      .then((s) => {
        if (active) setSummary(s);
      })
      .catch(() => {
        /* 요약 실패 — 노드 필드만으로 표시 */
      });
    return () => {
      active = false;
    };
  }, [node.id]);
  return (
    <ModalBackdrop onClose={onClose} className="absolute inset-0 z-20 flex items-center justify-center bg-ink/20">
      <div data-id="framework-explorer-info" className="flex w-[380px] flex-col gap-3 rounded-md border border-hairline bg-surface p-4 shadow-lg">
        <span className="truncate text-fine text-ink-tertiary" title={path}>
          {path}
        </span>
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-accent-tint px-2 py-0.5 text-fine font-semibold text-accent">L{node.level}</span>
          <h3 className="min-w-0 truncate text-body-strong text-ink">{node.name}</h3>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Fact label={t("category.summary.subtreeL5")} value={summary ? summary.subtree_l5_count : node.l5_count} />
          <Fact label={t("category.summary.subtreeMaps")} value={summary ? summary.subtree_map_count : node.map_count} />
          <Fact label={t("category.summary.children")} value={summary ? summary.child_count : node.child_count} />
        </div>
        <div className="flex flex-wrap gap-1.5 text-fine text-ink-secondary">
          <span className="text-ink-tertiary">{t("category.summary.admins")}</span>
          {summary === null ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-ink-tertiary" />
          ) : summary.admins.length === 0 ? (
            <span className="text-ink-muted">{t("category.summary.noAdmins")}</span>
          ) : (
            summary.admins.map((a) => (
              <span key={a.login_id} className="rounded-full bg-ink/5 px-2 py-0.5">
                {a.name} <span className="text-ink-tertiary">L{a.level}</span>
              </span>
            ))
          )}
        </div>
        <div className="flex justify-end gap-1.5 pt-1">
          <button type="button" className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt" onClick={onClose}>
            {t("common.cancel")}
          </button>
          {onCenter && (
            <button type="button" data-id="framework-explorer-info-center" className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt" onClick={onCenter}>
              {t("framework.explorer.center")}
            </button>
          )}
          <button type="button" data-id="framework-explorer-info-go" className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus" onClick={onGo}>
            {t("framework.explorer.goHere")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm bg-surface-alt px-2 py-1.5">
      <div className="text-fine text-ink-tertiary">{label}</div>
      <div className="text-body-strong text-ink">{value}</div>
    </div>
  );
}
