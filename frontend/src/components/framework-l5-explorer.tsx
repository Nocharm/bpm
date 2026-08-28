"use client";

// 연계 캔버스 좌상단 L5 탐색기 — 저장 체크리스트 자리를 대체(2026-08-28 개선).
// 접힘: 현재 L5명 칩. 펼침: L1 루트부터 lazy 트리(전 레벨), 마운트 시 내 체인 자동 펼침 +
// 현재 위치 하이라이트. 다른 L5 클릭 = 그 연계 캔버스 열기(없으면 권한자에 한해 생성 후 이동).
// 이동은 onNavigate 게이트(미저장 경고 모달) 경유 — FrameworkChip과 동일 규약.

import { ChevronDown, ChevronRight, Crosshair, FolderTree, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  getCategoryChain,
  listCategoryNodes,
  openLinkageMap,
  type CategoryNode,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";

const CHIP_BASE =
  "absolute left-2 top-2 z-10 rounded-sm border border-hairline bg-surface/40 shadow-sm backdrop-blur-sm";

export interface FrameworkL5ExplorerProps {
  currentCategoryId: number | null; // 이 캔버스가 결착된 L5 — null이면 렌더 안 함(방어)
  currentName: string; // 결착 카테고리명 로드 전 접힘 라벨 폴백(캔버스 맵 이름)
  onNavigate: (targetMapId: number, name: string) => void;
  onError: (message: string) => void;
}

export function FrameworkL5Explorer({
  currentCategoryId, currentName, onNavigate, onError,
}: FrameworkL5ExplorerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [childrenByParent, setChildrenByParent] = useState<Map<number | null, CategoryNode[]>>(
    new Map(),
  );
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [chainIds, setChainIds] = useState<Set<number>>(new Set());
  const [leafName, setLeafName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creatingId, setCreatingId] = useState<number | null>(null);

  // 내 위치 바로 보기 — 체인을 받아 루트+조상들을 미리 펼치고 각 단계 자식을 로드한다.
  useEffect(() => {
    if (currentCategoryId === null) return;
    let active = true;
    void (async () => {
      try {
        const [roots, chain] = await Promise.all([
          listCategoryNodes(),
          getCategoryChain(currentCategoryId),
        ]);
        if (!active) return;
        setLeafName(chain[chain.length - 1]?.name ?? null);
        setChainIds(new Set(chain.map((c) => c.id)));
        // 마지막(자기 자신, L5)은 펼칠 자식이 없다 — 조상까지만 자동 펼침
        const ancestors = chain.slice(0, -1);
        const loaded = await Promise.all(ancestors.map((c) => listCategoryNodes(c.id)));
        if (!active) return;
        setChildrenByParent((prev) => {
          const next = new Map(prev);
          next.set(null, roots);
          ancestors.forEach((c, i) => next.set(c.id, loaded[i]));
          return next;
        });
        setOpenIds((prev) => new Set([...prev, ...ancestors.map((c) => c.id)]));
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentCategoryId]);

  function handleToggle(node: CategoryNode) {
    if (openIds.has(node.id)) {
      setOpenIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
      return;
    }
    setOpenIds((prev) => new Set(prev).add(node.id));
    if (!childrenByParent.has(node.id)) {
      void listCategoryNodes(node.id)
        .then((nodes) => setChildrenByParent((prev) => new Map(prev).set(node.id, nodes)))
        .catch(() => setLoadError(true));
    }
  }

  // 다른 L5 열기 — 캔버스가 있으면 이동, 없으면 권한자에 한해 생성 후 이동(멱등 POST)
  function handleOpenL5(node: CategoryNode) {
    if (node.id === currentCategoryId) return;
    if (node.linkage_map_id !== null) {
      onNavigate(node.linkage_map_id, node.name);
      return;
    }
    if (!node.can_edit_linkage || creatingId !== null) return;
    setCreatingId(node.id);
    void openLinkageMap(node.id)
      .then((result) => onNavigate(result.map_id, node.name))
      .catch((err) => onError(humanizeApiError(err, t)))
      .finally(() => setCreatingId(null));
  }

  const renderNode = (node: CategoryNode, depth: number): ReactNode => {
    const isL5 = node.level === 5;
    const isCurrent = node.id === currentCategoryId;
    const expanded = openIds.has(node.id);
    const children = childrenByParent.get(node.id) ?? [];
    const openable = isL5 && !isCurrent && (node.linkage_map_id !== null || node.can_edit_linkage);
    return (
      <li key={node.id}>
        <button
          type="button"
          data-id={`l5-explorer-row-${node.id}`}
          onClick={() => (isL5 ? handleOpenL5(node) : handleToggle(node))}
          disabled={isL5 && !isCurrent && !openable}
          title={isL5 ? (isCurrent ? t("framework.explorerHere") : node.name) : node.name}
          style={{ paddingLeft: 4 + depth * 12 }}
          className={`flex w-full items-center gap-1.5 rounded-xs py-0.5 pr-1 text-left ${
            isCurrent
              ? "bg-accent-tint"
              : isL5 && !openable
                ? "opacity-45"
                : "hover:bg-surface-alt/70"
          }`}
        >
          {isL5 ? (
            <Workflow size={10} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          ) : expanded ? (
            <ChevronDown size={10} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          ) : (
            <ChevronRight size={10} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          )}
          <span
            className={`min-w-0 truncate text-fine ${
              isCurrent
                ? "font-semibold text-accent"
                : chainIds.has(node.id)
                  ? "text-ink"
                  : "text-ink-secondary"
            }`}
          >
            {creatingId === node.id ? t("framework.explorerCreating") : node.name}
          </span>
          {isCurrent && (
            <Crosshair size={10} strokeWidth={1.5} className="ml-auto shrink-0 text-accent" />
          )}
        </button>
        {!isL5 && expanded && children.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  if (currentCategoryId === null) return null;
  const roots = childrenByParent.get(null) ?? [];

  return (
    <div data-id="framework-l5-explorer" className={`${CHIP_BASE} w-max max-w-[260px] select-none`}>
      <button
        type="button"
        data-id="l5-explorer-toggle"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-surface-alt/50"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 text-ink-tertiary transition-transform duration-350 ease-smooth ${
            open ? "rotate-90" : ""
          }`}
        />
        {/* 접힘=현재 L5명 ↔ 펼침=Framework 라벨 크로스페이드 — FrameworkChip과 동일 패턴 */}
        <span className="relative min-w-0 flex-1 text-left">
          <span
            className={`block truncate text-fine font-medium text-ink-secondary transition-opacity duration-350 ease-smooth ${
              open ? "opacity-0" : "opacity-100"
            }`}
          >
            {leafName ?? currentName}
          </span>
          <span
            className={`pointer-events-none absolute inset-0 truncate text-fine font-semibold text-ink-secondary transition-opacity duration-350 ease-smooth ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            {t("framework.chipLabel")}
          </span>
        </span>
        <FolderTree size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
      </button>

      {/* 아코디언 — grid-rows 0fr→1fr (save-checklist·FrameworkChip과 동일) */}
      <div
        className={`grid transition-all duration-350 ease-smooth ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <ul className="scroll-quiet flex max-h-72 flex-col gap-0.5 overflow-y-auto border-t border-divider px-1 py-1.5">
            {loadError && (
              <li className="px-1 py-0.5 text-fine text-error">{t("framework.chipError")}</li>
            )}
            {roots.map((root) => renderNode(root, 0))}
          </ul>
        </div>
      </div>
    </div>
  );
}
