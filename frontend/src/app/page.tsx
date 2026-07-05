"use client";

// 홈 — 프로세스맵 목록 (공개범위 필터링) + 맵 생성 다이얼로그 /
// Home: map list filtered by mock visibility + map creation dialog.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, ChevronUp, CircleDot, Crown, Eye, PencilLine, Plus, ShieldCheck } from "lucide-react";

import { copyMap, deleteMap, listMaps, type MapSummary } from "@/lib/api";
import { filterByQuery, type MatchRange } from "@/lib/search";
import { getRecentMaps, partitionByRecency, type RecentMapEntry } from "@/lib/recent-maps";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { FilterDropdown } from "@/components/maps/filter-dropdown";
import { MapCard } from "@/components/maps/map-card";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { WelcomePlaceholder } from "@/components/maps/welcome-placeholder";
import { PromptDialog } from "@/components/prompt-dialog";
import { SearchBox } from "@/components/search-box";
import { ToastStack, type ToastItem } from "@/components/toast-stack";

// 상태 필터 필 순서 — 초안/검토중/승인됨/반려/게시 / status filter pills order.
const STATUS_ORDER = ["draft", "pending", "approved", "rejected", "published"] as const;

export default function MapListPage() {
  const { t } = useI18n();
  const router = useRouter();

  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 마스터-디테일 선택 / selected map for the detail panel.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mapQuery, setMapQuery] = useState("");
  // 가시성 필터 탭 — ALL/Public/Private
  const [visFilter, setVisFilter] = useState<"all" | "public" | "private">("all");
  // 상태·권한 필터 — 다중 선택 드롭다운, 비어 있으면 전체 / status & role filters; empty = all (H1).
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [permFilter, setPermFilter] = useState<Set<string>>(new Set());
  // 승인본 복사 — 이름 입력 모달(중복 시 error 유지) + 생성 후 새 카드 강조(쉬머) (F12).
  const [copyTarget, setCopyTarget] = useState<{ id: number; name: string } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  // 최근 열람 캐시(마운트 후 로드) + 밴드 노출 개수("더보기" +3, 검색내용 아님 → 미영속) /
  // recent-opened cache (loaded after mount) + band page size.
  const [recentEntries, setRecentEntries] = useState<RecentMapEntry[]>([]);
  // 최근 밴드 노출 개수 — 초기 2개, "더보기" +3, "접기"로 2로 리셋(검색내용 아님 → 미영속) /
  // recent band page size — initial 2, "show more" +3, "collapse" resets to 2.
  const [recentShown, setRecentShown] = useState(2);
  // 최근 밴드 접힘 — 접기=전부 닫힘, 펼침=2개부터 다시 / recent band collapsed toggle.
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  // "/" 단축키로 포커스할 검색 input / search input focused by the "/" hotkey.
  const searchRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string) => {
    setToasts((prev) => [{ id: genId(), message }, ...prev]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.loadMaps"));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await listMaps();
        if (active) {
          setMaps(result);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : t("err.loadMaps"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  // 최근 열람 로드 — localStorage는 클라 전용이라 마운트 후 복원(초기 render는 빈 배열).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentEntries(getRecentMaps()); // one-time hydration from localStorage
  }, []);

  // 검색·필터 복원 — 맵→복귀(SPA)만 복원. 새로고침(reload)은 저장값 폐기 후 초기화.
  useEffect(() => {
    try {
      // reload면 초기화 — 브랜드 로고는 stash를 먼저 지우므로 navigate 타입이어도 clean 복원.
      const navEntry = window.performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (navEntry?.type === "reload") {
        window.sessionStorage.removeItem("bpm.home.filters");
        return;
      }
      const raw = window.sessionStorage.getItem("bpm.home.filters");
      if (!raw) {
        return;
      }
      const s = JSON.parse(raw) as {
        q?: unknown;
        vis?: unknown;
        status?: unknown;
        perm?: unknown;
      };
      if (typeof s.q === "string") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMapQuery(s.q); // one-time hydration restore from sessionStorage
      }
      if (s.vis === "all" || s.vis === "public" || s.vis === "private") {
        setVisFilter(s.vis);
      }
      if (Array.isArray(s.status)) {
        setStatusFilter(new Set(s.status.filter((x): x is string => typeof x === "string")));
      }
      if (Array.isArray(s.perm)) {
        setPermFilter(new Set(s.perm.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      /* 손상된 저장값 무시 */
    }
  }, []);

  // 검색·필터 저장 — 변경 시 session에 기록. 마운트 첫 실행은 skip(초기 default가 저장값 덮어쓰기 방지).
  const saveSkip = useRef(true);
  useEffect(() => {
    if (saveSkip.current) {
      saveSkip.current = false;
      return;
    }
    window.sessionStorage.setItem(
      "bpm.home.filters",
      JSON.stringify({
        q: mapQuery,
        vis: visFilter,
        status: [...statusFilter],
        perm: [...permFilter],
      }),
    );
  }, [mapQuery, visFilter, statusFilter, permFilter]);

  // "/" 단축키 — 입력 중이 아닐 때 검색창 포커스(GitHub식) / focus search on "/" unless already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleDelete = useCallback(
    async (mapId: number) => {
      try {
        await deleteMap(mapId);
        await refresh();
        showToast(t("home.deletedToast")); // 휴지통 이동 + 복구 안내 (DL)
      } catch (err) {
        setError(err instanceof Error ? err.message : t("err.deleteMap"));
      }
    },
    [refresh, showToast, t],
  );

  // 복사 버튼(맵 상세) → 이름 입력 모달 오픈
  const handleCopyOpen = useCallback((mapId: number, name: string) => {
    setCopyError(null);
    setCopyTarget({ id: mapId, name });
  }, []);

  // 복사 모달 제출 — 중복 이름이면 모달 유지하고 error 표시, 성공하면 목록 갱신 + 새 카드 강조.
  const handleCopySubmit = useCallback(
    async (name: string) => {
      if (copyTarget === null) {
        return;
      }
      try {
        const created = await copyMap(copyTarget.id, name);
        setCopyTarget(null);
        setCopyError(null);
        await refresh();
        setSelectedId(created.id);
        setHighlightId(created.id);
        showToast(t("home.copyCreated"));
        window.setTimeout(() => setHighlightId(null), 2500); // 쉬머 후 해제
      } catch (err) {
        setCopyError(err instanceof Error ? err.message : String(err));
      }
    },
    [copyTarget, refresh, showToast, t],
  );

  // 가시성은 서버가 이미 적용(GET /maps는 접근 가능한 맵만 반환, my_role 동봉) — 클라 재계산 폐기 /
  // Server already filters GET /maps by access and sets my_role; no client recompute.
  const visibleMaps = useMemo(
    () => maps.filter((m) => m.my_role !== null),
    [maps],
  );

  // 가시성 탭 AND 상태 필 — 각 그룹 내 OR, 그룹 간 AND, 둘 다 비면 전체 (H1) /
  // visibility tab AND status pills — OR within group, AND across; empty = all.
  const filteredMaps = useMemo(
    () =>
      visibleMaps.filter((m) => {
        const visOk = visFilter === "all" || m.visibility === visFilter;
        const statusOk =
          statusFilter.size === 0 ||
          (m.latest_version_status !== null && statusFilter.has(m.latest_version_status));
        const permOk =
          permFilter.size === 0 || (m.my_role !== null && permFilter.has(m.my_role));
        return visOk && statusOk && permOk;
      }),
    [visibleMaps, visFilter, statusFilter, permFilter],
  );

  // 검색 필터 — 빈 쿼리면 전체 통과 / search filter; empty query returns all.
  const mapHits = useMemo(
    () =>
      filterByQuery(filteredMaps, mapQuery, (m) => [
        { field: "name", text: m.name },
        { field: "description", text: m.description ?? "" },
      ]),
    [filteredMaps, mapQuery],
  );

  // 최근 접속 파생 — 검색 여부, id 순서·시각 맵, 브라우즈 밴드(최근 ∩ 필터, 최신순) /
  // recent-opened derivations: search flag, id order, time-by-id, browse band.
  const isSearching = mapQuery.trim() !== "";
  const recentIds = recentEntries.map((e) => e.id);
  const atById = new Map(recentEntries.map((e) => [e.id, e.at]));
  const recentBand = isSearching
    ? []
    : partitionByRecency(filteredMaps, (m) => m.id, recentIds).recent;
  // 검색 모드 정렬 — 최근 접속 매치 상단 고정(최신순) + 나머지 기존 검색 랭킹 /
  // search order: recent-opened matches pinned on top (recency), rest keep search rank.
  const searchPartition = partitionByRecency(mapHits, (h) => h.item.id, recentIds);
  const orderedHits = [...searchPartition.recent, ...searchPartition.rest];

  // 선택 파생 — 자동 첫-맵 선택 없음(초기 선택 없음). 삭제된 맵이면 해제 / no auto-select; clear if stale.
  const effectiveSelected =
    selectedId !== null && visibleMaps.some((m) => m.id === selectedId)
      ? selectedId
      : null;

  // 최근 밴드 토글 — 접힘→펼침 시 2개부터 다시 시작 / toggle: expanding restarts at 2.
  const toggleRecentCollapse = () => {
    if (recentCollapsed) {
      setRecentShown(2);
      setRecentCollapsed(false);
    } else {
      setRecentCollapsed(true);
    }
  };

  // 리스트 행 — MapCard + 좁은 폭 인라인 아코디언(기존 블록 그대로). 밴드는 아코디언 없이 별도 렌더. /
  // A full-list row: MapCard + narrow-screen accordion. The band renders cards without the accordion.
  const renderRow = (
    processMap: MapSummary,
    nameRanges: MatchRange[],
    recentAt: number | undefined,
  ) => (
    <li key={processMap.id} className="flex flex-col">
      <MapCard
        map={processMap}
        selected={effectiveSelected === processMap.id}
        highlighted={highlightId === processMap.id}
        onSelect={setSelectedId}
        nameRanges={nameRanges}
        recentOpenedAt={recentAt}
      />
      <div
        data-id="map-detail-accordion"
        onClick={(e) => e.stopPropagation()} // 상세 내부 클릭이 배경(선택 해제)으로 버블링 방지
        className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth xl:hidden ${
          effectiveSelected === processMap.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {effectiveSelected === processMap.id && (
            <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
              <MapDetailCard
                mapId={processMap.id}
                onDelete={(id) => void handleDelete(id)}
                onCopy={handleCopyOpen}
                onGoToVersion={(vid) => router.push(`/maps/${processMap.id}?version=${vid}`)}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );

  return (
    // 페이지는 뷰포트 높이를 채우고 스크롤 안 함 — 리스트만 내부 스크롤 / Page fills height; only the list scrolls.
    // 빈 여백(마진·헤더 간격·필터 우측 등) 클릭 = 선택 해제. 카드·상세·밴드버튼은 stopPropagation으로 제외.
    <div
      className="flex h-full min-h-0 flex-col px-8 py-6"
      onClick={() => setSelectedId(null)}
    >
      {/* 제목 + New map (검색·필터는 좌측 리스트 컬럼 상단으로 이동, #5) */}
      <div className="mx-auto mb-4 flex w-full max-w-[80rem] shrink-0 items-center justify-between gap-4">
        <h1 data-id="home-title" className="text-tagline text-ink">Process Maps</h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* Manual — 홈 헤더에서도 매뉴얼 열람(뷰어 /manual). New map 왼쪽 보조 버튼 */}
          <button
            data-id="home-manual-btn"
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline bg-surface px-3 py-2 text-caption-strong text-ink hover:bg-surface-alt"
            onClick={() => router.push("/manual")}
          >
            <BookOpen size={16} strokeWidth={1.5} />
            {t("manual.title")}
          </button>
          <button
            className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent px-3 py-2 text-caption-strong text-on-accent hover:bg-accent-focus"
            onClick={() => setDialogOpen(true)}
          >
            <Plus size={16} strokeWidth={1.5} />
            {t("perm.createDialog.title")}
          </button>
        </div>
      </div>

      {error && (
        <p className="mx-auto mb-3 w-full max-w-[80rem] shrink-0 text-caption text-error">{error}</p>
      )}

      {/* 마스터-디테일 — 리스트:상세 = 1:2(flex-1 : flex-[2]), min-w로 안 깨지게, 전체 max-w로 중앙 (H6) /
          List : detail = 1:2 (flex-1 : flex-[2]); min-w guards wrapping; centered by max-w. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 gap-4">
        {visibleMaps.length === 0 ? (
          /* 맵이 하나도 없음 — 풀폭 환영 화면(상세 자리까지 차지) */
          <WelcomePlaceholder onCreate={() => setDialogOpen(true)} />
        ) : (
          <>
            {/* 좌측 리스트 컬럼 — 상단에 검색·필터탭(같은 폭), 아래 리스트 (#5) */}
            <div className="flex min-h-0 min-w-[18rem] flex-1 flex-col gap-2">
              <SearchBox
                value={mapQuery}
                onChange={setMapQuery}
                placeholder={t("home.searchPlaceholder")}
                inputRef={searchRef}
                dataId="home-map-search"
              />
              <div
                data-id="home-visibility-filter"
                className="flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5"
              >
                {(["all", "public", "private"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={visFilter === f}
                    className={`flex-1 rounded-sm px-2.5 py-1 text-caption transition-colors ${
                      visFilter === f
                        ? "bg-accent-tint text-accent"
                        : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                    }`}
                    onClick={() => setVisFilter(f)}
                  >
                    {f === "all"
                      ? t("home.filterAll")
                      : t(f === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
                  </button>
                ))}
              </div>
              {/* 상태·권한 필터 — 멀티셀렉트 드롭다운(가시성과 AND), Clear는 우측끝 (H1 개정) */}
              <div data-id="home-filter-row" className="flex shrink-0 items-center gap-1.5">
                <FilterDropdown
                  label={t("home.filterStatus")}
                  dataId="home-status-filter"
                  icon={<CircleDot size={14} strokeWidth={1.5} />}
                  options={STATUS_ORDER.map((s) => ({
                    value: s,
                    label: t(VERSION_STATUS_LABEL[s]),
                    icon: (
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${VERSION_STATUS_STYLE[s]}`}
                      />
                    ),
                  }))}
                  selected={statusFilter}
                  onToggle={(v) =>
                    setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                />
                <FilterDropdown
                  label={t("home.filterRole")}
                  dataId="home-role-filter"
                  icon={<ShieldCheck size={14} strokeWidth={1.5} />}
                  options={[
                    { value: "owner", label: t("perm.roleOwner"), icon: <Crown size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" /> },
                    { value: "editor", label: t("perm.roleEditor"), icon: <PencilLine size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" /> },
                    { value: "viewer", label: t("perm.roleViewer"), icon: <Eye size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" /> },
                  ]}
                  selected={permFilter}
                  onToggle={(v) =>
                    setPermFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                />
                {(statusFilter.size > 0 || permFilter.size > 0 || visFilter !== "all") && (
                  <button
                    type="button"
                    data-id="home-filter-clear"
                    className="ml-auto text-fine text-accent hover:underline"
                    onClick={() => {
                      setStatusFilter(new Set());
                      setPermFilter(new Set());
                      setVisFilter("all");
                    }}
                  >
                    {t("home.filterClear")}
                  </button>
                )}
              </div>
              {mapHits.length === 0 ? (
                /* 필터/검색 결과 없음 */
                <div className="flex flex-1 items-center justify-center rounded-sm border border-hairline bg-surface p-4 text-caption text-ink-tertiary">
                  {t("home.empty")}
                </div>
              ) : isSearching ? (
                /* 검색 모드 — 최근 접속 매치 상단 고정 + 배지, 나머지 검색 랭킹. 빈 공간 클릭=선택 해제 */
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {orderedHits.map(({ item: processMap, matches }) =>
                    renderRow(
                      processMap,
                      matches.find((m) => m.field === "name")?.ranges ?? [],
                      atById.get(processMap.id),
                    ),
                  )}
                </ul>
              ) : (
                /* 브라우즈 모드 — 상단 최근 밴드 + 하단 전체 목록(중복 허용). 빈 공간 클릭=선택 해제 */
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                  {recentBand.length > 0 && (
                    <section data-id="home-recent-band" className="flex flex-col gap-2">
                      {/* 섹션 라벨 행 — 클릭 토글(접힘=전부 닫힘, 펼침=2개부터), 우측끝 쉐브론 */}
                      <button
                        type="button"
                        data-id="home-recent-toggle"
                        aria-expanded={!recentCollapsed}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRecentCollapse();
                        }}
                        className="group -mx-1.5 flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-surface-alt"
                      >
                        <span className="text-fine text-ink-tertiary group-hover:text-ink-secondary">{t("home.recentTitle")}</span>
                        {recentCollapsed ? (
                          <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary group-hover:text-ink-secondary" />
                        ) : (
                          <ChevronUp size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary group-hover:text-ink-secondary" />
                        )}
                      </button>
                      {!recentCollapsed && (
                        <>
                          <ul className="flex flex-col gap-2">
                            {recentBand.slice(0, recentShown).map((processMap) => (
                              <li key={processMap.id}>
                                <MapCard
                                  map={processMap}
                                  selected={effectiveSelected === processMap.id}
                                  highlighted={highlightId === processMap.id}
                                  onSelect={setSelectedId}
                                  recentOpenedAt={atById.get(processMap.id)}
                                />
                              </li>
                            ))}
                          </ul>
                          {(recentBand.length > recentShown || recentShown > 2) && (
                            <div className="flex items-center gap-3">
                              {recentBand.length > recentShown && (
                                <button
                                  type="button"
                                  data-id="home-recent-more"
                                  className="text-fine text-accent hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRecentShown((n) => n + 3);
                                  }}
                                >
                                  {t("home.recentMore")}
                                </button>
                              )}
                              {recentShown > 2 && (
                                <button
                                  type="button"
                                  data-id="home-recent-collapse"
                                  className="inline-flex items-center gap-1 text-fine text-ink-tertiary hover:text-ink"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRecentCollapse();
                                  }}
                                >
                                  <ChevronUp size={14} strokeWidth={1.5} />
                                  {t("home.recentCollapse")}
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  )}
                  {recentBand.length > 0 && (
                    /* 스페이서 + 전체목록 섹션 라벨 */
                    <div className="border-t border-divider pt-3">
                      <h2 className="text-fine text-ink-tertiary">{t("home.allMapsTitle")}</h2>
                    </div>
                  )}
                  <ul className="flex flex-col gap-2">
                    {mapHits.map(({ item: processMap, matches }) =>
                      renderRow(
                        processMap,
                        matches.find((m) => m.field === "name")?.ranges ?? [],
                        undefined,
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* ≥ xl — 우측 사이드 패널. 선택 없으면 플레이스홀더 / wide screens: side panel or empty placeholder */}
            <aside
              data-id="map-detail-aside"
              onClick={(e) => e.stopPropagation()} // 상세 내부 클릭이 배경(선택 해제)으로 버블링 방지
              className="hidden min-w-[24rem] flex-[2] flex-col rounded-sm border border-hairline bg-surface-alt xl:flex"
            >
              {effectiveSelected !== null ? (
                <MapDetailCard
                  key={effectiveSelected}
                  mapId={effectiveSelected}
                  onDelete={(id) => void handleDelete(id)}
                  onCopy={handleCopyOpen}
                  onGoToVersion={(vid) => router.push(`/maps/${effectiveSelected}?version=${vid}`)}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center p-6 text-caption text-ink-tertiary">
                  {t("home.detailEmpty")}
                </div>
              )}
            </aside>
          </>
        )}
      </div>

      {dialogOpen && (
        <CreateMapDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            void refresh();
            showToast(t("perm.createDialog.toastSuccess"));
          }}
        />
      )}

      {copyTarget && (
        <PromptDialog
          title={t("home.copyTitle")}
          label={t("home.copyNameLabel")}
          defaultValue={`${copyTarget.name} (Copy)`}
          confirmLabel={t("home.copyFromApproved")}
          cancelLabel={t("common.cancel")}
          error={copyError}
          onConfirm={(name) => void handleCopySubmit(name)}
          onClose={() => {
            setCopyTarget(null);
            setCopyError(null);
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
