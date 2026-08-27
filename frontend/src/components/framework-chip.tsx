"use client";

// 에디터 우상단 프레임워크 칩 — 맵이 업무 체계(Framework)에 등록된 경우에만 렌더.
// 좌상단 저장 체크리스트 칩(save-checklist)과 같은 반투명 아코디언 디자인: 접힘=연결 카테고리
// 리프명, 펼침=루트→연결 카테고리 체인을 들여쓰기 트리로. 행 클릭 시 좌측 플라이아웃으로
// 그 카테고리의 맵 목록을 띄워 프레임워크의 다른 맵으로 이동한다.

import { ChevronRight, FolderTree, Workflow } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";

import {
  getCategoryChain,
  listCategoryMaps,
  type CategoryNode,
  type MapSummary,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const CHIP_BASE =
  "absolute right-2 top-2 z-10 rounded-sm border border-hairline bg-surface/40 shadow-sm backdrop-blur-sm";

export function FrameworkChip({
  mapId,
  categoryId,
  onNavigate,
}: {
  mapId: number;
  categoryId: number;
  // 이동 게이트 — 주면 직접 이동(router.push) 대신 호출측이 확인 모달을 띄운다(에디터 이탈 미저장 경고)
  onNavigate?: (targetMapId: number, name: string) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<CategoryNode[] | null>(null);
  const [chainError, setChainError] = useState(false);
  // 플라이아웃 — 아코디언 클립(inner overflow-hidden)을 벗어나야 해서 루트 직속으로 렌더하고,
  // 클릭한 행의 루트 기준 top을 실측해 좌측(right-full)에 붙인다.
  const [flyout, setFlyout] = useState<{ catId: number; top: number } | null>(null);
  const [mapsByCat, setMapsByCat] = useState<ReadonlyMap<number, MapSummary[] | "loading">>(
    new Map(),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getCategoryChain(categoryId)
      .then((nodes) => {
        if (active) setChain(nodes);
      })
      .catch(() => {
        if (active) setChainError(true);
      });
    return () => {
      active = false;
    };
  }, [categoryId]);

  // 바깥 클릭 시 플라이아웃 닫기 — notification-bell과 동일 패턴(캡처 단계)
  useEffect(() => {
    if (flyout === null) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && !rootRef.current?.contains(event.target)) {
        setFlyout(null);
      }
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => window.removeEventListener("mousedown", handleMouseDown, true);
  }, [flyout]);

  const toggleFlyout = (catId: number, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (flyout?.catId === catId) {
      setFlyout(null);
      return;
    }
    const rootRect = rootRef.current?.getBoundingClientRect();
    const rowRect = event.currentTarget.getBoundingClientRect();
    setFlyout({ catId, top: rootRect ? rowRect.top - rootRect.top : 0 });
    if (!mapsByCat.has(catId)) {
      setMapsByCat((prev) => new Map(prev).set(catId, "loading"));
      listCategoryMaps(catId)
        .then((result) => {
          setMapsByCat((prev) => new Map(prev).set(catId, result.maps));
        })
        .catch(() => {
          // 목록 조회 실패 — 캐시에서 제거해 다음 열기에서 재시도
          setMapsByCat((prev) => {
            const next = new Map(prev);
            next.delete(catId);
            return next;
          });
        });
    }
  };

  const leafName = chain?.[chain.length - 1]?.name ?? "";
  const flyoutCat = flyout ? chain?.find((cat) => cat.id === flyout.catId) : undefined;
  const flyoutMaps = flyout ? mapsByCat.get(flyout.catId) : undefined;

  return (
    <div
      ref={rootRef}
      data-id="editor-framework-chip"
      className={`${CHIP_BASE} w-max max-w-[240px] select-none`}
    >
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setFlyout(null);
        }}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-surface-alt/50"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 text-ink-tertiary transition-transform duration-350 ease-smooth ${
            open ? "rotate-90" : ""
          }`}
        />
        {/* 리프 카테고리명(접힘) ↔ Framework 라벨(펼침) 크로스페이드 — save-checklist와 동일 */}
        <span className="relative min-w-0 flex-1 text-left">
          <span
            className={`block truncate text-fine font-medium text-ink-secondary transition-opacity duration-350 ease-smooth ${
              open ? "opacity-0" : "opacity-100"
            }`}
          >
            {leafName || t("framework.chipLabel")}
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

      {/* 아코디언 — grid-rows 0fr→1fr (save-checklist와 동일, 오버플로 클립) */}
      <div
        className={`grid transition-all duration-350 ease-smooth ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <ul className="flex flex-col gap-0.5 border-t border-divider px-1 py-1.5">
            {chainError && (
              <li className="px-1 py-0.5 text-fine text-error">{t("framework.chipError")}</li>
            )}
            {chain?.map((cat, depth) => {
              const isLeaf = depth === chain.length - 1;
              return (
                <li key={cat.id}>
                  <button
                    type="button"
                    data-id={`editor-framework-row-${cat.id}`}
                    onClick={(event) => toggleFlyout(cat.id, event)}
                    title={`${cat.code} ${cat.name}`}
                    style={{ paddingLeft: 4 + depth * 12 }}
                    className={`flex w-full items-center gap-1.5 rounded-xs py-0.5 pr-1 text-left hover:bg-surface-alt/70 ${
                      flyout?.catId === cat.id ? "bg-surface-alt/70" : ""
                    }`}
                  >
                    <ChevronRight size={10} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                    <span
                      className={`truncate text-fine ${
                        isLeaf ? "font-semibold text-accent" : "text-ink-secondary"
                      }`}
                    >
                      {cat.name}
                    </span>
                    {/* L5 연계 캔버스 열기 — 부모가 button이라 중첩 금지, span+stopPropagation (design 2026-08-28 §8) */}
                    {cat.level === 5 && cat.linkage_map_id !== null && cat.linkage_map_id !== mapId && (
                      <span
                        data-id={`editor-framework-linkage-${cat.id}`}
                        title={t("framework.openLinkage")}
                        className="ml-auto shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                        onClick={(event) => {
                          event.stopPropagation();
                          const targetId = cat.linkage_map_id;
                          if (targetId === null) return;
                          setFlyout(null);
                          if (onNavigate) onNavigate(targetId, cat.name);
                          else router.push(`/maps/${targetId}`);
                        }}
                      >
                        <Workflow size={12} strokeWidth={1.5} />
                      </span>
                    )}
                    {cat.map_count > 0 && (
                      <span
                        className={`shrink-0 text-fine text-ink-tertiary ${
                          cat.level === 5 && cat.linkage_map_id !== null && cat.linkage_map_id !== mapId
                            ? ""
                            : "ml-auto"
                        }`}
                      >
                        {cat.map_count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* 좌측 플라이아웃 — 카테고리의 맵 목록, 클릭 시 해당 맵 에디터로 이동 */}
      {flyout && (
        <div
          data-id="editor-framework-flyout"
          style={{ top: flyout.top }}
          className="absolute right-full z-20 mr-1.5 w-56 rounded-md border border-hairline bg-surface p-1 shadow-lg"
        >
          <p className="truncate px-1.5 pb-1 pt-0.5 text-fine font-semibold text-ink-secondary">
            {flyoutCat?.name}
          </p>
          {flyoutMaps === "loading" || flyoutMaps === undefined ? (
            <p className="px-1.5 py-1 text-fine text-ink-tertiary">{t("framework.chipLoading")}</p>
          ) : flyoutMaps.length === 0 ? (
            <p className="px-1.5 py-1 text-fine text-ink-tertiary">{t("framework.chipNoMaps")}</p>
          ) : (
            <ul className="scroll-quiet max-h-64 overflow-y-auto">
              {flyoutMaps.map((entry) => {
                const isCurrent = entry.id === mapId;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      data-id={`editor-framework-flyout-map-${entry.id}`}
                      disabled={isCurrent}
                      onClick={() => {
                        setFlyout(null);
                        if (onNavigate) onNavigate(entry.id, entry.name);
                        else router.push(`/maps/${entry.id}`);
                      }}
                      className={`w-full truncate rounded-sm px-1.5 py-1 text-left text-fine ${
                        isCurrent
                          ? "bg-accent-tint font-semibold text-accent"
                          : "text-ink hover:bg-surface-alt"
                      }`}
                    >
                      {entry.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
