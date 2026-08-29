"use client";

// 플레이스홀더 후차 연결 다이얼로그 (design 2026-08-28 §10.1) — 안내된 출처 L5의 맵을
// 유사도 순(정확 일치 최상단)으로 우선 노출하고, 필요하면 트리 드릴로 다른 L5에서 찾는다.
// 안내 밖 L5의 맵을 고르면 게이트 중간에 확인 모달(경로 비교)을 끼운다.
import {
  ArrowRight,
  ChevronRight,
  CornerDownLeft,
  CornerUpRight,
  Link2,
  Map as MapIcon,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { listCategoryMaps, listCategoryNodes, type CategoryNode, type MapSummary } from "@/lib/api";
import { rankConnectCandidates } from "@/lib/framework-connect";
import { useI18n } from "@/lib/i18n";

// 후보 조회 상한 — 초과분은 카운트 안내(필터로 좁히기 유도). L5당 L6 수십 개 규모 전제.
const CANDIDATE_LIMIT = 100;

interface Scope {
  id: number;
  path: string;
}

export interface FrameworkConnectDialogProps {
  nodeTitle: string;
  originCategoryId: number | null;
  originPath: string | null;
  // 이양 후계자 — 스테일 링크 교체 플로우에서 최우선 추천으로 고정 노출 (2026-08-30)
  successor?: { id: number; name: string } | null;
  linkedMapIds: Set<number>;
  currentMapId: number;
  // 적용에 필요한 건 id·이름뿐 — 후계자 추천(전체 MapSummary 없음)도 같은 경로를 쓴다.
  // origin은 낙관 참조용 스코프 정보(리스트 픽만 제공) — 즉시 외부 L6 스타일 렌더 (#4)
  onConnect: (
    map: Pick<MapSummary, "id" | "name">,
    origin?: { categoryId: number; categoryPath: string | null; designated: boolean },
  ) => void;
  onClose: () => void;
}

export function FrameworkConnectDialog({
  nodeTitle,
  originCategoryId,
  originPath,
  successor = null,
  linkedMapIds,
  currentMapId,
  onConnect,
  onClose,
}: FrameworkConnectDialogProps) {
  const { t } = useI18n();
  const origin: Scope | null =
    originCategoryId !== null ? { id: originCategoryId, path: originPath ?? "" } : null;
  const [scope, setScope] = useState<Scope | null>(origin);
  // 스코프별 결과 pair-state — 이펙트 내 동기 리셋 없이 키 불일치=로딩으로 파생 (하우스 린트)
  const [mapsResult, setMapsResult] = useState<{
    scopeId: number;
    maps: MapSummary[];
    total: number;
    error: boolean;
  } | null>(null);
  const [query, setQuery] = useState("");
  // 트리 드릴 — null=목록 모드, []=루트에서 시작. 항목은 내려온 경로(브레드크럼).
  const [trail, setTrail] = useState<CategoryNode[] | null>(origin === null ? [] : null);
  const [childrenResult, setChildrenResult] = useState<{ key: string; nodes: CategoryNode[] } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<MapSummary | null>(null);

  // 스코프 맵 로드
  useEffect(() => {
    if (scope === null) {
      return;
    }
    let active = true;
    const scopeId = scope.id;
    void listCategoryMaps(scopeId, 0, CANDIDATE_LIMIT)
      .then((res) => {
        if (active) {
          setMapsResult({ scopeId, maps: res.maps, total: res.total, error: false });
        }
      })
      .catch(() => {
        if (active) {
          setMapsResult({ scopeId, maps: [], total: 0, error: true });
        }
      });
    return () => {
      active = false;
    };
  }, [scope]);

  const trailKey = trail === null ? null : trail.map((node) => node.id).join("/") || "root";
  // 트리 드릴 자식 로드
  useEffect(() => {
    if (trail === null || trailKey === null) {
      return;
    }
    let active = true;
    const parentId = trail.length > 0 ? trail[trail.length - 1].id : undefined;
    void listCategoryNodes(parentId)
      .then((nodes) => {
        if (active) {
          setChildrenResult({ key: trailKey, nodes });
        }
      })
      .catch(() => {
        if (active) {
          setChildrenResult({ key: trailKey, nodes: [] });
        }
      });
    return () => {
      active = false;
    };
  }, [trail, trailKey]);

  const scopeLoaded = scope !== null && mapsResult !== null && mapsResult.scopeId === scope.id;
  const maps = scopeLoaded ? mapsResult.maps : null;
  const total = scopeLoaded ? mapsResult.total : 0;
  const loadError = scopeLoaded && mapsResult.error;
  const children = trailKey !== null && childrenResult?.key === trailKey ? childrenResult.nodes : null;

  const ranked = useMemo(() => {
    if (maps === null) {
      return [];
    }
    const q = query.trim().toLowerCase();
    const eligible = maps.filter(
      (map) =>
        map.id !== currentMapId &&
        map.mode !== "framework" &&
        !map.deleted_at &&
        (q === "" || map.name.toLowerCase().includes(q)),
    );
    return rankConnectCandidates(nodeTitle, eligible);
  }, [maps, query, currentMapId, nodeTitle]);

  const isGuidedScope = origin !== null && scope !== null && scope.id === origin.id;

  function pickMeta(map: MapSummary) {
    return scope !== null
      ? { categoryId: scope.id, categoryPath: scope.path || null, designated: map.sp_designated_at != null }
      : undefined;
  }

  function handlePick(map: MapSummary) {
    // 안내와 같은 L5(또는 안내 자체가 없음) → 직결. 그 외 → 확인 게이트 (사용자 요구 2026-08-29)
    if (origin === null || isGuidedScope) {
      onConnect(map, pickMeta(map));
      return;
    }
    setPendingConfirm(map);
  }

  function enterScope(node: CategoryNode, pathNodes: CategoryNode[]) {
    setScope({ id: node.id, path: pathNodes.map((c) => c.name).join("/") });
    setTrail(null);
    setQuery("");
  }

  const lastSeg = (path: string) => path.split("/").slice(-2).join("/") || path;

  return (
    <>
      <ModalBackdrop
        onClose={onClose}
        className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
      >
        <div
          data-id="framework-connect-dialog"
          className="flex max-h-[560px] w-[520px] flex-col rounded-md border border-hairline bg-surface shadow-lg"
        >
          {/* 헤더 */}
          <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
              <Link2 size={15} strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-caption-strong font-semibold">{t("framework.connectTitle")}</div>
              <div className="truncate text-fine text-ink-tertiary">{nodeTitle}</div>
            </div>
            <button
              type="button"
              data-id="framework-connect-close"
              onClick={onClose}
              className="rounded-xs p-1 text-ink-tertiary hover:bg-surface-alt"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          {/* 스코프 줄 — 안내 L5 or 탐색 중 스코프 */}
          <div className="flex items-center gap-2 border-b border-hairline px-4 py-2 text-fine">
            {scope !== null ? (
              <>
                <span className="shrink-0 text-ink-tertiary">
                  {isGuidedScope ? t("framework.connectGuided") : t("framework.connectScope")}
                </span>
                <span
                  data-id="framework-connect-scope"
                  title={scope.path}
                  className={`truncate rounded-full border px-2 py-0.5 ${
                    isGuidedScope
                      ? "border-accent-tint-border bg-accent-tint text-accent"
                      : "border-hairline bg-surface-alt text-ink-secondary"
                  }`}
                >
                  {lastSeg(scope.path)}
                </span>
                {!isGuidedScope && origin !== null && (
                  <button
                    type="button"
                    data-id="framework-connect-back-guided"
                    onClick={() => {
                      setScope(origin);
                      setTrail(null);
                      setQuery("");
                    }}
                    className="ml-auto flex shrink-0 items-center gap-1 text-fine text-accent hover:underline"
                  >
                    <CornerDownLeft size={12} strokeWidth={1.5} />
                    {t("framework.connectBackToGuided")}
                  </button>
                )}
              </>
            ) : (
              <span className="text-ink-tertiary">
                {origin === null ? t("framework.connectNoGuide") : t("framework.connectBrowse")}
              </span>
            )}
          </div>

          {/* 이양 후계자 추천 — 시스템이 아는 대체 맵을 고정 노출(탐색 모드 포함, 직결·게이트 없음) */}
          {successor !== null && (
            <div className="border-b border-hairline p-2">
              <button
                type="button"
                data-id="framework-connect-successor"
                disabled={linkedMapIds.has(successor.id)}
                onClick={() => onConnect({ id: successor.id, name: successor.name })}
                className={`flex w-full items-center gap-2 rounded-sm border border-accent-tint-border bg-accent-tint px-3 py-2 text-left text-caption ${
                  linkedMapIds.has(successor.id) ? "opacity-45" : "hover:border-accent"
                }`}
              >
                <CornerUpRight size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-semibold">{successor.name}</span>
                <span className="shrink-0 rounded-full border border-accent-tint-border bg-surface px-2 py-0.5 text-fine text-accent">
                  {linkedMapIds.has(successor.id)
                    ? t("framework.connectOnCanvas")
                    : t("framework.successorPill")}
                </span>
              </button>
            </div>
          )}
          {trail === null ? (
            <>
              {/* 검색 */}
              <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
                <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <input
                  data-id="framework-connect-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("framework.connectSearch")}
                  className="w-full bg-transparent text-caption outline-none placeholder:text-ink-tertiary"
                />
              </div>
              {/* 후보 목록 */}
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {loadError ? (
                  <div className="px-3 py-6 text-center text-caption text-error">
                    {t("framework.connectLoadError")}
                  </div>
                ) : maps === null ? (
                  <div className="px-3 py-6 text-center text-caption text-ink-tertiary">…</div>
                ) : ranked.length === 0 ? (
                  <div className="px-3 py-6 text-center text-caption text-ink-tertiary">
                    {t("framework.connectEmpty")}
                  </div>
                ) : (
                  ranked.map(({ map, exact }) => {
                    const taken = linkedMapIds.has(map.id);
                    return (
                      <button
                        key={map.id}
                        type="button"
                        data-id={`framework-connect-row-${map.id}`}
                        disabled={taken}
                        onClick={() => handlePick(map)}
                        className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-caption ${
                          taken ? "opacity-45" : "hover:bg-accent-tint"
                        }`}
                      >
                        <MapIcon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                        <span className="min-w-0 flex-1 truncate">{map.name}</span>
                        {exact && !taken && (
                          <span className="shrink-0 rounded-full border border-added/40 bg-added/10 px-2 py-0.5 text-fine text-added">
                            {t("framework.connectExact")}
                          </span>
                        )}
                        {map.sp_designated_at === null && !taken && (
                          <span className="shrink-0 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-fine text-ink-tertiary">
                            {t("framework.connectUnregistered")}
                          </span>
                        )}
                        {taken && (
                          <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-tertiary">
                            {t("framework.connectOnCanvas")}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
                {maps !== null && total > maps.length && (
                  <div className="px-3 py-2 text-center text-fine text-ink-tertiary">
                    {t("framework.connectMore", { n: total - maps.length })}
                  </div>
                )}
              </div>
              {/* 푸터 — 다른 L5 탐색 */}
              <div className="border-t border-hairline px-3 py-2">
                <button
                  type="button"
                  data-id="framework-connect-browse"
                  onClick={() => setTrail([])}
                  className="flex w-full items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                >
                  <Search size={14} strokeWidth={1.5} />
                  {t("framework.connectBrowse")}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* 트리 드릴 — 브레드크럼 + 자식 목록 */}
              <div className="flex flex-wrap items-center gap-1 border-b border-hairline px-4 py-2 text-fine text-ink-tertiary">
                <button
                  type="button"
                  data-id="framework-connect-crumb-root"
                  onClick={() => setTrail([])}
                  className="hover:text-ink"
                >
                  L1
                </button>
                {trail.map((node, index) => (
                  <span key={node.id} className="flex items-center gap-1">
                    <ChevronRight size={11} strokeWidth={1.5} />
                    <button
                      type="button"
                      onClick={() => setTrail(trail.slice(0, index + 1))}
                      className="max-w-[120px] truncate hover:text-ink"
                    >
                      {node.name}
                    </button>
                  </span>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {children === null ? (
                  <div className="px-3 py-6 text-center text-caption text-ink-tertiary">…</div>
                ) : children.length === 0 ? (
                  <div className="px-3 py-6 text-center text-caption text-ink-tertiary">
                    {t("framework.connectEmpty")}
                  </div>
                ) : (
                  children.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      data-id={`framework-connect-cat-${node.id}`}
                      onClick={() => {
                        if (node.level >= 5) {
                          enterScope(node, [...trail, node]);
                        } else {
                          setTrail([...trail, node]);
                        }
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-caption hover:bg-surface-alt"
                    >
                      <span className="w-7 shrink-0 rounded-xs border border-hairline text-center text-fine text-ink-tertiary">
                        L{node.level}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{node.name}</span>
                      {node.map_count > 0 && (
                        <span className="shrink-0 text-fine text-ink-tertiary">{node.map_count}</span>
                      )}
                      {node.level >= 5 ? (
                        <ArrowRight size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
                      ) : (
                        <ChevronRight size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                      )}
                    </button>
                  ))
                )}
              </div>
              {scope !== null && (
                <div className="border-t border-hairline px-3 py-2">
                  <button
                    type="button"
                    data-id="framework-connect-browse-cancel"
                    onClick={() => setTrail(null)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                  >
                    <CornerDownLeft size={14} strokeWidth={1.5} />
                    {t("common.cancel")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </ModalBackdrop>

      {/* 안내 밖 L5 확인 게이트 — 경로 비교 배너로 시인성 확보 (사용자 요구 2026-08-29) */}
      {pendingConfirm !== null && scope !== null && origin !== null && (
        <ConfirmDialog
          dialogId="framework-connect-confirm"
          title={t("framework.connectConfirmTitle")}
          icon={<TriangleAlert size={20} strokeWidth={1.5} className="text-changed" />}
          banner={
            <div className="flex flex-col gap-1.5 text-caption">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 whitespace-nowrap text-fine text-ink-tertiary">
                  {t("framework.connectConfirmGuided")}
                </span>
                <span
                  title={origin.path}
                  className="truncate rounded-full border border-accent-tint-border bg-accent-tint px-2 py-0.5 text-fine text-accent"
                >
                  {lastSeg(origin.path)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 whitespace-nowrap text-fine text-ink-tertiary">
                  {t("framework.connectConfirmChosen")}
                </span>
                <span
                  title={`${scope.path}/${pendingConfirm.name}`}
                  className="truncate rounded-full border border-changed/40 bg-changed/10 px-2 py-0.5 text-fine text-changed"
                >
                  {lastSeg(scope.path)} · {pendingConfirm.name}
                </span>
              </div>
            </div>
          }
          message={t("framework.connectConfirmLine")}
          confirmLabel={t("framework.connectAnyway")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const map = pendingConfirm;
            setPendingConfirm(null);
            onConnect(map, pickMeta(map));
          }}
          onClose={() => setPendingConfirm(null)}
        />
      )}
    </>
  );
}
