"use client";

// 홈 — 프로세스맵 목록 (공개범위 필터링) + 맵 생성 다이얼로그 /
// Home: map list filtered by mock visibility + map creation dialog.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Building2, ChevronDown, CircleDot, Crown, Eye, FileUp, PencilLine, Plus, ShieldCheck, TriangleAlert } from "lucide-react";

import { copyMap, deleteMap, getDirectory, getMe, listMaps, type Directory, type MapSummary, type Me } from "@/lib/api";
import { type CsvImportOutcome } from "@/lib/csv-import";
import { buildOrgTree, filterMyDeptMaps } from "@/lib/org-tree";
import { filterByQuery, type MatchRange } from "@/lib/search";
import { getRecentMaps, partitionByRecency, type RecentMapEntry } from "@/lib/recent-maps";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";
import { splitMapsByMode } from "@/lib/word-map-home";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { CsvCreateModal } from "@/components/csv-create-modal";
import { WordCreateModal, type WordCreateOutcome } from "@/components/word-create-modal";
import { WordQuickCreateDialog } from "@/components/word-quick-create-dialog";
import { FilterDropdown } from "@/components/maps/filter-dropdown";
import { HomeDashboard } from "@/components/maps/home-dashboard";
import { MapCard } from "@/components/maps/map-card";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { MyDeptFavorites } from "@/components/maps/my-dept-favorites";
import { OrgAccordion } from "@/components/maps/org-accordion";
import { WelcomePlaceholder } from "@/components/maps/welcome-placeholder";
import { WordDocsSection } from "@/components/maps/word-docs-section";
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
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  // CSV 모달 → 생성 다이얼로그 핸드오프 (파싱 결과 + 파일명)
  const [csvHandoff, setCsvHandoff] = useState<{ outcome: CsvImportOutcome; fileName: string } | null>(null);
  const [wordModalOpen, setWordModalOpen] = useState(false);
  // Word 모달 → 생성 다이얼로그 핸드오프 (파싱 결과 + 문서명)
  const [wordHandoff, setWordHandoff] = useState<WordCreateOutcome | null>(null);
  // org_path 보유 유저 전용 빠른 생성(자동값 축소) — design 2026-07-24 §3
  const [wordQuick, setWordQuick] = useState<WordCreateOutcome | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 마스터-디테일 선택 / selected map for the detail panel.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mapQuery, setMapQuery] = useState("");
  // 가시성 필터 탭 — ALL/Public/Private
  const [visFilter, setVisFilter] = useState<"all" | "public" | "private">("all");
  // 상태·권한 필터 — 다중 선택 드롭다운, 비어 있으면 전체 / status & role filters; empty = all (H1).
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [permFilter, setPermFilter] = useState<Set<string>>(new Set());
  const [owningFilter, setOwningFilter] = useState<Set<string>>(new Set());
  // 승인본 복사 — 이름 입력 모달(중복 시 error 유지) + 생성 후 새 카드 강조(쉬머) (F12).
  const [copyTarget, setCopyTarget] = useState<{ id: number; name: string } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  // 브라우즈 좌측 컬럼 — 내 정보(부서 즐겨찾기)·디렉터리(조직도 트리) + 아코디언 펼침 상태 /
  // browse-mode left column: my info (dept favorites) + directory (org tree) + accordion expansion.
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [orgOpen, setOrgOpen] = useState<Set<string>>(new Set());
  const [favOpen, setFavOpen] = useState(true);
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const [wordOpen, setWordOpen] = useState(true);

  // 최근 열람 캐시(마운트 후 로드) — 검색 모드 상단 고정 매치에 사용 /
  // recent-opened cache (loaded after mount) — used to pin recent-opened matches on top in search mode.
  const [recentEntries, setRecentEntries] = useState<RecentMapEntry[]>([]);
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

  // 내 정보 + 디렉터리(부서 트리) — 브라우즈 좌측 즐겨찾기·아코디언 소스 (getDirectory는 departments 포함,
  // useDirectory 훅은 유저 Map만 노출해 여기선 직접 fetch).
  useEffect(() => {
    let active = true;
    void getMe().then((m) => { if (active) setMe(m); }).catch(() => {});
    void getDirectory().then((d) => { if (active) setDirectory(d); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // 아코디언 초기 펼침 — 내 org_path 조상 경로를 1회 시드(이후는 사용자 토글만 반영) /
  // seed org accordion expansion from my org_path once when it arrives.
  const seededOrg = useRef(false);
  useEffect(() => {
    if (seededOrg.current || !me?.org_path) return;
    seededOrg.current = true;
    const parts = me.org_path.split("/");
    const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setOrgOpen(new Set(paths)); // one-time seed from my org_path
  }, [me]);

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
        owning?: unknown;
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
      if (Array.isArray(s.owning)) {
        setOwningFilter(new Set(s.owning.filter((x): x is string => x === "missing")));
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
        owning: [...owningFilter],
      }),
    );
  }, [mapQuery, visFilter, statusFilter, permFilter, owningFilter]);

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

  // 맵 선택 = 히스토리 항목 1개 — 대시보드에서 클릭해 상세로 "이동"한 걸 브라우저 뒤로가기로 되돌린다.
  // null→선택 전이에만 pushState(선택 간 전환은 항목 유지), UI로 해제하면 그 항목을 back()으로 소비해 정합 유지.
  const selPushed = useRef(false);
  useEffect(() => {
    if (selectedId !== null && !selPushed.current) {
      selPushed.current = true;
      window.history.pushState(null, "", window.location.href);
    } else if (selectedId === null && selPushed.current) {
      selPushed.current = false;
      window.history.back(); // 우리가 쌓은 선택 항목만 제거(있음이 보장됨) — 홈에 머무름
    }
  }, [selectedId]);
  useEffect(() => {
    const onPop = () => {
      selPushed.current = false; // 우리 항목이 pop됨
      setSelectedId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 생성 메뉴 — 바깥 클릭·Escape로 닫기 (setState는 리스너 안에서만; 이펙트 본문 직접 호출 금지)
  useEffect(() => {
    if (!createMenuOpen) return;
    const close = () => setCreateMenuOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateMenuOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [createMenuOpen]);

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

  // word 맵은 문서 부속 산출물 — 조직도/집계는 processMaps만, Word documents 섹션은 wordMaps (design 2026-07-24 §2)
  const { processMaps, wordMaps } = useMemo(() => splitMapsByMode(visibleMaps), [visibleMaps]);

  // selectedDept를 render에서 파생 — visibleMaps는 refresh()마다 새 배열 참조라 effect deps에 직접 넣으면
  // 배열 identity 변화만으로 재실행되어(값은 동일) 사용자가 방금 접은 아코디언 노드를 재펼침해버린다 /
  // Derive at render so refresh()'s new visibleMaps reference doesn't re-trigger the effect below.
  const selectedDept =
    selectedId != null ? (visibleMaps.find((m) => m.id === selectedId)?.owning_department ?? null) : null;

  // 맵 선택 시 좌측 아코디언 자동펼침 — 선택 맵의 owning_department 조상 경로를 orgOpen에 합집합 /
  // auto-expand the left org accordion to reveal the selected map's owning department.
  useEffect(() => {
    if (selectedId == null || !selectedDept) return;
    const parts = selectedDept.split("/");
    const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to selectedId (user action), not deriving render state
    setOrgOpen((prev) => new Set([...prev, ...paths]));
  }, [selectedId, selectedDept]);

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
        const owningOk =
          owningFilter.size === 0 || (owningFilter.has("missing") && !m.owning_department);
        return visOk && statusOk && permOk && owningOk;
      }),
    [visibleMaps, visFilter, statusFilter, permFilter, owningFilter],
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

  // 최근 접속 파생 — 검색 여부, id 순서·시각 맵(검색 모드 상단 고정용) /
  // recent-opened derivations: search flag, id order, time-by-id (used to pin search matches).
  const isSearching = mapQuery.trim() !== "";
  const recentIds = recentEntries.map((e) => e.id);
  const atById = new Map(recentEntries.map((e) => [e.id, e.at]));
  // 검색 모드 정렬 — 최근 접속 매치 상단 고정(최신순) + 나머지 기존 검색 랭킹 /
  // search order: recent-opened matches pinned on top (recency), rest keep search rank.
  const searchPartition = partitionByRecency(mapHits, (h) => h.item.id, recentIds);
  const orderedHits = [...searchPartition.recent, ...searchPartition.rest];

  // 브라우즈 좌측 — 나의 부서 즐겨찾기 + 조직도 트리(렌더타임 파생, effect 아님) /
  // browse-mode left column: my-dept favorites + org tree, derived at render (not in an effect).
  // 내 org_path의 모든 접두 경로 — 빈 부서 가지치기에서 내 부서(및 조상)는 앵커로 유지한다.
  const myDeptKeepPaths = useMemo(() => {
    if (!me?.org_path) return new Set<string>();
    const parts = me.org_path.split("/");
    return new Set(parts.map((_, i) => parts.slice(0, i + 1).join("/")));
  }, [me]);
  // 조직도·나의 부서 즐겨찾기는 word 맵 제외(splitMapsByMode) — 검색(filteredMaps 자체)은 word 맵 포함 유지 (design 2026-07-24 §2)
  const orgTree = useMemo(
    () => buildOrgTree(splitMapsByMode(filteredMaps).processMaps, directory?.departments ?? [], myDeptKeepPaths),
    [filteredMaps, directory, myDeptKeepPaths],
  );
  const myDeptMaps = useMemo(
    () => (me?.org_path ? filterMyDeptMaps(splitMapsByMode(filteredMaps).processMaps, me.org_path) : []),
    [filteredMaps, me],
  );
  // department가 ""(빈 문자열)일 수 있어 ??는 폴백을 건너뛴다 — || 로 org_path 리프까지 폴백
  const myDeptLabel = (me?.department || me?.org_path?.split("/").pop()) ?? "";

  // 25개씩 증분 렌더 — 맵이 수백 개여도 목록 렌더 부하 없음(검색어·필터 변경 시 리셋). 검색 모드 전용
  // (브라우즈는 즐겨찾기+아코디언이라 별도 증분 렌더 없음).
  const listKey = `${mapQuery}|${visFilter}|${[...statusFilter].sort().join(",")}|${[...permFilter].sort().join(",")}|${[...owningFilter].sort().join(",")}`;
  const {
    visible: shownSearchHits,
    hasMore: hasMoreSearch,
    sentinelRef: searchSentinelRef,
  } = useInfiniteSlice(orderedHits, listKey);

  // 선택 파생 — 자동 첫-맵 선택 없음(초기 선택 없음). 삭제된 맵이면 해제 / no auto-select; clear if stale.
  const effectiveSelected =
    selectedId !== null && visibleMaps.some((m) => m.id === selectedId)
      ? selectedId
      : null;

  // 카드 + 좁은 폭 인라인 상세 아코디언 (li 없이) — 검색 모드(renderRow)와 브라우즈 모드(renderCard) 공유. /
  // MapCard + narrow-screen detail accordion (no <li> wrapper) — shared by search-mode renderRow and browse-mode renderCard.
  const renderCardInner = (
    processMap: MapSummary,
    nameRanges: MatchRange[],
    recentAt: number | undefined,
  ) => (
    <>
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
        className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth split:hidden ${
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
    </>
  );

  // 리스트 행 — 검색 모드 전용(li로 감싼 렌더 결과).
  // A full-list row for search mode (wraps the shared card+detail in <li>).
  const renderRow = (
    processMap: MapSummary,
    nameRanges: MatchRange[],
    recentAt: number | undefined,
  ) => (
    <li key={processMap.id} className="flex flex-col">
      {renderCardInner(processMap, nameRanges, recentAt)}
    </li>
  );

  // 브라우즈 모드(즐겨찾기·조직도 아코디언)에 전달할 카드 렌더러 — 980px 미만에서도 상세 노출. /
  // Card renderer passed to browse-mode accordions — keeps detail visible below the split breakpoint.
  const renderCard = (processMap: MapSummary) =>
    renderCardInner(processMap, [], atById.get(processMap.id));

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
          {/* 분할 버튼 — 왼쪽=빈 맵, 오른쪽 쉐브론=CSV로 만들기. 재사용할 드롭다운 프리미티브가 없어 1항목 메뉴를 직접 둔다.
              stopPropagation은 메뉴를 소유한 쉐브론·메뉴 컨테이너에만 — 왼쪽 버튼은 버블시켜 빈 여백 선택 해제를 유지한다. */}
          <div className="relative flex shrink-0">
            <button
              className="inline-flex shrink-0 items-center gap-1 rounded-l-sm bg-accent px-3 py-2 text-caption-strong text-on-accent hover:bg-accent-focus"
              onClick={() => {
                setCreateMenuOpen(false);
                setDialogOpen(true);
              }}
            >
              <Plus size={16} strokeWidth={1.5} />
              {t("perm.createDialog.title")}
            </button>
            <button
              data-id="home-create-menu-toggle"
              aria-expanded={createMenuOpen}
              aria-label={t("csvImport.createFromCsv")}
              className="inline-flex shrink-0 items-center rounded-r-sm border-l border-accent-focus bg-accent px-2 py-2 text-on-accent hover:bg-accent-focus"
              onClick={(event) => {
                event.stopPropagation(); // 바깥클릭 닫기 리스너가 방금 연 메뉴를 닫지 않도록
                setCreateMenuOpen((open) => !open);
              }}
            >
              <ChevronDown size={16} strokeWidth={1.5} />
            </button>
            {createMenuOpen && (
              <div
                className="absolute right-0 top-full z-30 mt-1 min-w-52 rounded-sm border border-hairline bg-surface py-1 shadow-lg"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  data-id="home-create-from-csv"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setCsvModalOpen(true);
                  }}
                >
                  <FileUp size={16} strokeWidth={1.5} />
                  {t("csvImport.createFromCsv")}
                </button>
              </div>
            )}
          </div>
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
                <FilterDropdown
                  label={t("home.filterOwning")}
                  dataId="home-owning-filter"
                  icon={<Building2 size={14} strokeWidth={1.5} />}
                  options={[
                    {
                      value: "missing",
                      label: t("home.owningMissingOption"),
                      icon: <TriangleAlert size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />,
                    },
                  ]}
                  selected={owningFilter}
                  onToggle={(v) =>
                    setOwningFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                />
                {(statusFilter.size > 0 || permFilter.size > 0 || visFilter !== "all" || owningFilter.size > 0) && (
                  <button
                    type="button"
                    data-id="home-filter-clear"
                    className="ml-auto text-fine text-accent hover:underline"
                    onClick={() => {
                      setStatusFilter(new Set());
                      setPermFilter(new Set());
                      setVisFilter("all");
                      setOwningFilter(new Set());
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
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto pr-1">
                  {shownSearchHits.map(({ item: processMap, matches }) =>
                    renderRow(
                      processMap,
                      matches.find((m) => m.field === "name")?.ranges ?? [],
                      atById.get(processMap.id),
                    ),
                  )}
                  {hasMoreSearch && <li ref={searchSentinelRef} className="h-px shrink-0" />}
                </ul>
              ) : (
                /* 브라우즈 — 나의 부서 즐겨찾기 + 조직도 아코디언 */
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
                  <MyDeptFavorites
                    maps={myDeptMaps}
                    deptLabel={myDeptLabel}
                    open={favOpen}
                    onToggle={() => setFavOpen((v) => !v)}
                    selectedId={effectiveSelected}
                    onSelect={setSelectedId}
                    renderCard={renderCard}
                  />
                  <OrgAccordion
                    roots={orgTree.roots}
                    unassigned={orgTree.unassigned}
                    openPaths={orgOpen}
                    onToggle={(path) => setOrgOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(path)) next.delete(path); else next.add(path);
                      return next;
                    })}
                    onCollapseAll={() => { setOrgOpen(new Set()); setUnassignedOpen(false); }}
                    selectedId={effectiveSelected}
                    highlightId={highlightId}
                    onSelect={setSelectedId}
                    unassignedOpen={unassignedOpen}
                    onToggleUnassigned={() => setUnassignedOpen((v) => !v)}
                    renderCard={renderCard}
                  />
                  <WordDocsSection
                    maps={wordMaps}
                    open={wordOpen}
                    onToggle={() => setWordOpen((v) => !v)}
                    selectedId={effectiveSelected}
                    onSelect={setSelectedId}
                    onCreate={() => setWordModalOpen(true)}
                    onReimport={() => undefined}
                    onPromote={() => undefined}
                  />
                </div>
              )}
            </div>

            {/* ≥ split(980px) — 우측 사이드 패널. 선택 없으면 플레이스홀더 / wide screens: side panel or empty placeholder */}
            <aside
              data-id="map-detail-aside"
              onClick={(e) => e.stopPropagation()} // 상세 내부 클릭이 배경(선택 해제)으로 버블링 방지
              className="hidden min-w-[24rem] flex-[2] flex-col rounded-sm border border-hairline bg-surface-alt split:flex"
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
                <HomeDashboard maps={processMaps} onSelect={setSelectedId} />
              )}
            </aside>
          </>
        )}
      </div>

      {csvModalOpen && (
        <CsvCreateModal
          onClose={() => setCsvModalOpen(false)}
          onContinue={(outcome, fileName) => {
            setCsvModalOpen(false);
            setCsvHandoff({ outcome, fileName });
            setDialogOpen(true);
          }}
        />
      )}

      {wordModalOpen && (
        <WordCreateModal
          onClose={() => setWordModalOpen(false)}
          onContinue={(outcome) => {
            setWordModalOpen(false);
            if (me?.org_path) {
              setWordQuick(outcome); // 빠른 생성 — 부서/승인자 자동 (design 2026-07-24 §3)
            } else {
              setWordHandoff(outcome); // 폴백: org_path 없는 유저는 기존 전체 다이얼로그
              setDialogOpen(true);
            }
          }}
        />
      )}
      {wordQuick && me?.org_path && (
        <WordQuickCreateDialog
          outcome={wordQuick}
          owningDepartment={me.org_path}
          approverId={me.username}
          onClose={() => setWordQuick(null)}
          onCreated={(detail) => {
            setWordQuick(null);
            void refresh();
            showToast(t("perm.createDialog.toastSuccess"));
            router.push(`/maps/${detail.id}`);
          }}
          onPartialCreate={() => void refresh()}
        />
      )}

      {dialogOpen && (
        <CreateMapDialog
          csv={csvHandoff ?? undefined}
          word={wordHandoff ?? undefined}
          onClose={() => {
            setDialogOpen(false);
            setCsvHandoff(null);
            setWordHandoff(null);
          }}
          onCreated={(silent) => {
            void refresh();
            // silent — 임포트 실패 경로: 맵은 생겼지만 성공 토스트는 띄우지 않는다
            if (!silent) showToast(t("perm.createDialog.toastSuccess"));
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
