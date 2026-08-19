"use client";

// 홈 — 프로세스맵 목록 (공개범위 필터링) + 맵 생성 다이얼로그 /
// Home: map list filtered by mock visibility + map creation dialog.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, FileUp, Plus } from "lucide-react";

import { copyMap, deleteMap, getDirectory, getMe, listMaps, setWordDoc, type Directory, type MapSummary, type Me } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { type CsvImportOutcome } from "@/lib/csv-import";
import { pickFilterDisplayMode, type FilterDisplayMode } from "@/lib/filter-display";
import { buildOrgTree, collectSingleChildChain, filterMyDeptMaps } from "@/lib/org-tree";
import { filterByQuery, type MatchRange } from "@/lib/search";
import { getRecentMaps, partitionByRecency, type RecentMapEntry } from "@/lib/recent-maps";
import { WORD_FEATURES_ENABLED } from "@/lib/features";
import { splitMapsByMode } from "@/lib/word-map-home";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { CsvCreateModal } from "@/components/csv-create-modal";
import { WordCreateModal, type WordCreateOutcome } from "@/components/word-create-modal";
import { WordQuickCreateDialog } from "@/components/word-quick-create-dialog";
import { FrameworkTree } from "@/components/maps/framework-tree";
import { HomeDashboard } from "@/components/maps/home-dashboard";
import { HomeFilterPills } from "@/components/maps/home-filter-pills";
import { MapCard } from "@/components/maps/map-card";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { MyDeptFavorites } from "@/components/maps/my-dept-favorites";
import { OrgAccordion } from "@/components/maps/org-accordion";
import { WelcomePlaceholder } from "@/components/maps/welcome-placeholder";
import { WordDocsSection } from "@/components/maps/word-docs-section";
import { PromptDialog } from "@/components/prompt-dialog";
import { SearchBox } from "@/components/search-box";
import { ToastStack, type ToastItem } from "@/components/toast-stack";

// 좌측 접힘 상태 영속 키 — 검색·필터(sessionStorage, 새로고침 시 초기화)와 달리 새로고침에도 유지한다.
const TREE_STATE_KEY = "bpm.home.tree";

export default function MapListPage() {
  const { t, lang } = useI18n();
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
  // 재임포트 타겟 맵 — onReimport 핸들러 시작
  const [reimportTarget, setReimportTarget] = useState<MapSummary | null>(null);
  // org_path 보유 유저 전용 빠른 생성(자동값 축소) — design 2026-07-24 §3
  const [wordQuick, setWordQuick] = useState<WordCreateOutcome | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 마스터-디테일 선택 / selected map for the detail panel.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 재임포트 후 열린 상세 카드 강제 리마운트(키에 포함) — refresh()는 리스트만 갱신, 상세는 재조회 안 함.
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [mapQuery, setMapQuery] = useState("");
  // 가시성 필터 탭 — ALL/Public/Private
  const [visFilter, setVisFilter] = useState<"all" | "public" | "private">("all");
  // 상태·권한 필터 — 다중 선택 드롭다운, 비어 있으면 전체 / status & role filters; empty = all (H1).
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [permFilter, setPermFilter] = useState<Set<string>>(new Set());
  const [owningFilter, setOwningFilter] = useState<Set<string>>(new Set());
  // SP 지정 여부 필터 — "sp"(지정됨)/"non_sp"(미지정), 비면 전체 (sp_designated_at 기준)
  const [spFilter, setSpFilter] = useState<Set<string>>(new Set());
  // 승인본 복사 — 이름 입력 모달(중복 시 error 유지) + 생성 후 새 카드 강조(쉬머) (F12).
  const [copyTarget, setCopyTarget] = useState<{ id: number; name: string } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  // word 맵 승격 대상 — 지정 시 승격 관문 다이얼로그(CreateMapDialog promote 모드)를 연다 (design 2026-07-24 §6).
  const [promoteTarget, setPromoteTarget] = useState<{ id: number; name: string } | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  // 브라우즈 좌측 컬럼 — 내 정보(부서 즐겨찾기)·디렉터리(조직도 트리) + 아코디언 펼침 상태 /
  // browse-mode left column: my info (dept favorites) + directory (org tree) + accordion expansion.
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [orgOpen, setOrgOpen] = useState<Set<string>>(new Set());
  const [favOpen, setFavOpen] = useState(true);
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const [wordOpen, setWordOpen] = useState(true);
  // "조직도 트리 자체를 조작"했는지 — My부서/Word/미지정 토글과 구분해 시드 재실행 여부를 가른다 (아래 writeTree).
  const [treeTouched, setTreeTouched] = useState(false);
  // 좌측 컬럼 뷰 — 부서 트리(기존) ↔ 업무 체계(Framework, Phase 2 lazy 카테고리 트리)
  const [homeView, setHomeView] = useState<"departments" | "framework">("departments");
  // 카테고리 연결/해제/이양 성공 시 증가 — FrameworkTree key로 넘겨 강제 리마운트(캐시 무효화, fix round 1 #1).
  const [frameworkVersion, setFrameworkVersion] = useState(0);
  const handleFrameworkChanged = () => setFrameworkVersion((v) => v + 1);

  // 최근 열람 캐시(마운트 후 로드) — 검색 모드 상단 고정 매치에 사용 /
  // recent-opened cache (loaded after mount) — used to pin recent-opened matches on top in search mode.
  const [recentEntries, setRecentEntries] = useState<RecentMapEntry[]>([]);
  // "/" 단축키로 포커스할 검색 input / search input focused by the "/" hotkey.
  const searchRef = useRef<HTMLInputElement>(null);

  // 필터 필 3단계 반응형(full/label/icon) — 실측 폭 기반, 측정 복제(absolute invisible) 2종의
  // 자연폭을 행 가용폭과 비교해 판정한다 (Task 8).
  const filterRowRef = useRef<HTMLDivElement | null>(null);
  const measureFullRef = useRef<HTMLDivElement | null>(null);
  const measureLabelRef = useRef<HTMLDivElement | null>(null);
  // Clear 버튼(필터 활성 시만 렌더)도 같은 행의 가용폭을 갉아먹는다 — 측정에서 빼지 않으면
  // Clear가 나타나는 순간 겹치거나 넘칠 수 있다(T9 실측 발견).
  const clearBtnRef = useRef<HTMLButtonElement | null>(null);
  const [filterMode, setFilterMode] = useState<FilterDisplayMode>("full");

  const showToast = useCallback((message: string, tone?: "error") => {
    setToasts((prev) => [{ id: genId(), message, tone }, ...prev]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const seededOrg = useRef(false);

  // 접힘 상태 저장 — 의존성 이펙트로 저장하면 StrictMode 재마운트에서 초기 default가 저장값을 덮어쓴다.
  // 반드시 토글 핸들러에서 다음 값을 계산해 넘긴다 (설계: 2026-08-04-home-dept-visibility-design.md §4).
  // C1 시드는 사용자 행동이 아니므로 저장하지 않는다 — 미조작 사용자는 매 진입 같은 규칙으로 재계산된다.
  // touched는 "조직도 트리 자체를 편집"했을 때만 true(OrgAccordion onToggle/onCollapseAll) — My부서/Word/
  // 미지정 토글은 트리를 바꾸지 않으므로 touched를 그대로 이어받아 저장만 하고 래치하지 않는다. 그래야
  // 내 부서 맵이 없는 유저가 트리와 무관한 토글만 건드려도 진입할 때마다 시드가 계속 재계산된다.
  const writeTree = (
    org: Set<string>,
    fav: boolean,
    word: boolean,
    unassigned: boolean,
    touched: boolean = false,
    view: "departments" | "framework",
  ) => {
    if (touched) seededOrg.current = true;
    setTreeTouched(touched);
    window.localStorage.setItem(
      TREE_STATE_KEY,
      JSON.stringify({ orgOpen: [...org], fav, word, unassigned, touched, view }),
    );
  };

  const refresh = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch (err) {
      setError(humanizeApiError(err, t));
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
          setError(humanizeApiError(err, t));
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

  // 접힘 상태 복원 — localStorage(새로고침에도 유지). 저장값이 있으면 내 부서 시드보다 우선한다.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TREE_STATE_KEY);
      if (!raw) {
        return;
      }
      const s = JSON.parse(raw) as {
        orgOpen?: unknown; fav?: unknown; word?: unknown; unassigned?: unknown; touched?: unknown; view?: unknown;
      };
      if (Array.isArray(s.orgOpen)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrgOpen(new Set(s.orgOpen.filter((x): x is string => typeof x === "string"))); // one-time hydration
      }
      if (typeof s.fav === "boolean") setFavOpen(s.fav);
      if (typeof s.word === "boolean") setWordOpen(s.word);
      if (typeof s.unassigned === "boolean") setUnassignedOpen(s.unassigned);
      if (s.view === "departments" || s.view === "framework") setHomeView(s.view);
      if (typeof s.touched === "boolean") {
        setTreeTouched(s.touched);
        // orgOpen 존재 자체는 더 이상 근거가 아니다 — 조직도 트리를 실제로 조작한 적 있을 때만 시드를 막는다.
        if (s.touched) seededOrg.current = true;
      }
    } catch {
      /* 손상된 저장값 무시 */
    }
  }, []);

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
        sp?: unknown;
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
      if (Array.isArray(s.sp)) {
        setSpFilter(new Set(s.sp.filter((x): x is string => x === "sp" || x === "non_sp")));
      }
    } catch {
      /* 손상된 저장값 무시 */
    }
  }, []);

  // Clear 필 노출 조건 — JSX(아래)와 effect deps 양쪽이 같은 식을 참조(중복 방지 겸 clearBtnRef
  // mount/unmount 시 effect 재실행 트리거).
  const hasActiveFilter =
    statusFilter.size > 0 || permFilter.size > 0 || visFilter !== "all" || owningFilter.size > 0 || spFilter.size > 0;

  // 필터 필 표시 단계 실측 — 측정 복제(absolute invisible) 2종의 자연폭 vs 행 가용폭(Clear 필 폭
  // 차감). i18n/뷰 전환은 복제가 같은 props로 다시 그려지므로 자동 반영. RO 콜백 내 setState는
  // 라이브 행 폭이 모드에 따라 변해도 복제 폭은 불변이라 진동하지 않는다.
  useEffect(() => {
    const row = filterRowRef.current;
    const full = measureFullRef.current;
    const label = measureLabelRef.current;
    if (!row || !full || !label) return;
    const update = () => {
      const clear = clearBtnRef.current;
      // Clear가 뜨면 같은 행의 gap(1.5=6px)만큼 더 먹는다 — 폭+간격을 가용폭에서 미리 뺀다.
      const available = row.clientWidth - (clear ? clear.offsetWidth + 6 : 0);
      setFilterMode(
        pickFilterDisplayMode(available, {
          full: full.scrollWidth,
          label: label.scrollWidth,
        }),
      );
    };
    // 최초 산정은 렌더 커밋 후로 이연 — 이펙트 본문 동기 setState 린트 회피(react-hooks/set-state-in-effect).
    const raf = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(row);
    ro.observe(full);
    ro.observe(label);
    if (clearBtnRef.current) ro.observe(clearBtnRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // 필 개수·언어 외에 maps.length도 의존성에 포함 — 맵 목록이 비동기로 도착하기 전엔
    // visibleMaps.length===0이라 WelcomePlaceholder가 렌더되어 필터 행 자체가 마운트되지 않고
    // (row/full/label ref가 null) 이 effect가 조기 반환한다. maps 도착 후 필터 행이 처음
    // 마운트될 때 effect를 다시 돌려야 ResizeObserver가 비로소 붙는다 — 없으면 filterMode가
    // 초기값 "full"에 영원히 고정되고(관측된 실측 버그, T9), 그 뒤 리사이즈도 못 잡는다.
    // hasActiveFilter는 clearBtnRef가 새로 마운트/언마운트될 때 observer를 다시 붙이기 위함.
  }, [homeView, lang, maps.length, hasActiveFilter]);

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
        sp: [...spFilter],
      }),
    );
  }, [mapQuery, visFilter, statusFilter, permFilter, owningFilter, spFilter]);

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

  // 생성 메뉴 — 바깥 누름(mousedown)·Escape로 닫기 (setState는 리스너 안에서만; 이펙트 본문 직접 호출 금지)
  useEffect(() => {
    if (!createMenuOpen) return;
    const close = () => setCreateMenuOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateMenuOpen(false);
    };
    // 캡처 단계 — 중간에서 stopPropagation 하는 영역(맵 상세 카드 등)에서도 닫히게
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close, true);
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
        setError(humanizeApiError(err, t));
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
        setCopyError(humanizeApiError(err, t));
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
        const spOk =
          spFilter.size === 0 ||
          (spFilter.has("sp") && !!m.sp_designated_at) ||
          (spFilter.has("non_sp") && !m.sp_designated_at);
        return visOk && statusOk && permOk && owningOk && spOk;
      }),
    [visibleMaps, visFilter, statusFilter, permFilter, owningFilter, spFilter],
  );

  // Framework 뷰 카드 필터 — filteredMaps 술어의 부분집합(가시성·상태·역할만, owning/SP는 부서 뷰 전용).
  // 트리는 lazy 서버 fetch라 filteredMaps를 못 쓰고 술어를 넘겨 로드된 카드에만 적용한다.
  const frameworkFilterActive = visFilter !== "all" || statusFilter.size > 0 || permFilter.size > 0;
  const frameworkFilterMap = frameworkFilterActive
    ? (m: MapSummary) => {
        const visOk = visFilter === "all" || m.visibility === visFilter;
        const statusOk =
          statusFilter.size === 0 ||
          (m.latest_version_status !== null && statusFilter.has(m.latest_version_status));
        const permOk = permFilter.size === 0 || (m.my_role !== null && permFilter.has(m.my_role));
        return visOk && statusOk && permOk;
      }
    : null;

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

  // 아코디언 초기 펼침 — 내 부서 섹션이 진입점이므로, 내 부서 맵이 있으면 조직도는 접힌 채로 둔다.
  // me·maps가 모두 도착한 뒤 1회만 판단한다 — 먼저 도착한 쪽만 보고 시드하면 뒤늦게 뜬 My dept 섹션과
  // 조직도가 결국 둘 다 펼쳐진다. deps는 배열 identity가 아닌 길이 스칼라로(refresh()마다 새 참조).
  const hasMyDeptMaps = myDeptMaps.length > 0;
  useEffect(() => {
    if (seededOrg.current || !me?.org_path || maps.length === 0) return;
    seededOrg.current = true;
    if (hasMyDeptMaps) return;
    const parts = me.org_path.split("/");
    const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed once me+maps have both landed
    setOrgOpen(new Set(paths)); // one-time seed from my org_path
  }, [me, maps.length, hasMyDeptMaps]);

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
        onMouseDown={(e) => e.stopPropagation()} // 상세 내부 조작이 배경(선택 해제)으로 버블링 방지
        className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth split:hidden ${
          effectiveSelected === processMap.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {effectiveSelected === processMap.id && (
            <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
              <MapDetailCard
                key={`${processMap.id}-${detailReloadKey}`}
                mapId={processMap.id}
                onDelete={(id) => void handleDelete(id)}
                onCopy={handleCopyOpen}
                onPromote={(id, name) => setPromoteTarget({ id, name })}
                onGoToVersion={(vid) => router.push(`/maps/${processMap.id}?version=${vid}`)}
                onFrameworkChanged={handleFrameworkChanged}
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
    // 빈 여백(마진·헤더 간격·필터 우측 등)을 "누르면"(mousedown) 선택 해제 — 손 뗄 때까지 기다리지 않는다.
    // 카드·상세·밴드버튼은 stopPropagation으로 제외.
    <div
      className="flex h-full min-h-0 flex-col px-8 py-6"
      onMouseDown={() => setSelectedId(null)}
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
              onMouseDown={(event) => event.stopPropagation()} // 바깥 누름 닫기 리스너가 방금 연 메뉴를 닫지 않도록
              onClick={() => setCreateMenuOpen((open) => !open)}
            >
              <ChevronDown size={16} strokeWidth={1.5} />
            </button>
            {createMenuOpen && (
              <div
                className="absolute right-0 top-full z-30 mt-1 min-w-52 rounded-sm border border-hairline bg-surface py-1 shadow-lg"
                onMouseDown={(event) => event.stopPropagation()}
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
              {/* 뷰 토글 — 부서 트리 ↔ 업무 체계(Framework, Phase 2). 가시성 필터 세그먼트(아래) 스타일 복제 */}
              <div
                data-id="home-view-toggle"
                className="flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5"
              >
                {(["departments", "framework"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={homeView === v}
                    className={`flex-1 rounded-sm px-2.5 py-1 text-caption transition-colors ${
                      homeView === v
                        ? "bg-accent-tint text-accent"
                        : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                    }`}
                    onClick={() => {
                      setHomeView(v);
                      writeTree(orgOpen, favOpen, wordOpen, unassignedOpen, treeTouched, v);
                    }}
                  >
                    {t(v === "departments" ? "home.viewDepartments" : "home.viewFramework")}
                  </button>
                ))}
              </div>
              {/* 검색·가시성·상태·역할 필터는 두 뷰 공용 — owning/SP 필터만 부서 뷰 전용(선별 이식).
                  검색 입력 시 뷰와 무관하게 아래 공용 플랫 검색 리스트로 전환된다. */}
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
              <div
                data-id="home-filter-row"
                ref={filterRowRef}
                className="relative flex min-w-0 items-center gap-1.5"
              >
                <HomeFilterPills
                  display={filterMode}
                  homeView={homeView}
                  statusFilter={statusFilter}
                  onToggleStatus={(v) =>
                    setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                  permFilter={permFilter}
                  onTogglePerm={(v) =>
                    setPermFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                  owningFilter={owningFilter}
                  onToggleOwning={(v) =>
                    setOwningFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                  spFilter={spFilter}
                  onToggleSp={(v) =>
                    setSpFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                />
                {/* 측정 복제 — 보이지 않게 자연폭만 잰다(absolute라 레이아웃 불참여, dataId 없음) */}
                <div
                  ref={measureFullRef}
                  aria-hidden
                  className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5"
                >
                  <HomeFilterPills
                    display="full"
                    measureOnly
                    homeView={homeView}
                    statusFilter={statusFilter}
                    onToggleStatus={() => {}}
                    permFilter={permFilter}
                    onTogglePerm={() => {}}
                    owningFilter={owningFilter}
                    onToggleOwning={() => {}}
                    spFilter={spFilter}
                    onToggleSp={() => {}}
                  />
                </div>
                <div
                  ref={measureLabelRef}
                  aria-hidden
                  className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5"
                >
                  <HomeFilterPills
                    display="label"
                    measureOnly
                    homeView={homeView}
                    statusFilter={statusFilter}
                    onToggleStatus={() => {}}
                    permFilter={permFilter}
                    onTogglePerm={() => {}}
                    owningFilter={owningFilter}
                    onToggleOwning={() => {}}
                    spFilter={spFilter}
                    onToggleSp={() => {}}
                  />
                </div>
                {hasActiveFilter && (
                  <button
                    ref={clearBtnRef}
                    type="button"
                    data-id="home-filter-clear"
                    className="ml-auto text-fine text-accent hover:underline"
                    onClick={() => {
                      setStatusFilter(new Set());
                      setPermFilter(new Set());
                      setVisFilter("all");
                      setOwningFilter(new Set());
                      setSpFilter(new Set());
                    }}
                  >
                    {t("home.filterClear")}
                  </button>
                )}
              </div>
              {isSearching && mapHits.length === 0 ? (
                /* 검색 결과 없음(두 뷰 공용) */
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
              ) : homeView === "framework" ? (
                // Framework 브라우즈 — key=frameworkVersion: 연결/해제/이양 성공 시 강제 리마운트해 트리 캐시를 무효화(fix round 1 #1).
                <FrameworkTree key={frameworkVersion} renderCard={renderCard} filterMap={frameworkFilterMap} />
              ) : mapHits.length === 0 ? (
                /* 필터 결과 없음(부서 브라우즈) — 필터가 전량 제외한 경우 */
                <div className="flex flex-1 items-center justify-center rounded-sm border border-hairline bg-surface p-4 text-caption text-ink-tertiary">
                  {t("home.empty")}
                </div>
              ) : (
                /* 브라우즈 — 나의 부서 즐겨찾기 + Word 문서 섹션 + 조직도 아코디언.
                   Word 섹션은 조직도 위 고정 — 트리 아래에 두면 스크롤 밖으로 묻혀 발견 불가(사용자 피드백). */
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
                  <MyDeptFavorites
                    maps={myDeptMaps}
                    deptLabel={myDeptLabel}
                    open={favOpen}
                    onToggle={() => {
                      const next = !favOpen;
                      setFavOpen(next);
                      writeTree(orgOpen, next, wordOpen, unassignedOpen, treeTouched, homeView);
                    }}
                    selectedId={effectiveSelected}
                    onSelect={setSelectedId}
                    renderCard={renderCard}
                  />
                  {WORD_FEATURES_ENABLED ? (
                    <WordDocsSection
                      maps={wordMaps}
                      open={wordOpen}
                      onToggle={() => {
                        const next = !wordOpen;
                        setWordOpen(next);
                        writeTree(orgOpen, favOpen, next, unassignedOpen, treeTouched, homeView);
                      }}
                      selectedId={effectiveSelected}
                      onSelect={setSelectedId}
                      onCreate={() => setWordModalOpen(true)}
                      onReimport={(m) => setReimportTarget(m)}
                      onPromote={(m) => setPromoteTarget({ id: m.id, name: m.name })}
                    />
                  ) : null}
                  <OrgAccordion
                    roots={orgTree.roots}
                    unassigned={orgTree.unassigned}
                    openPaths={orgOpen}
                    onToggle={(path) => {
                      const next = new Set(orgOpen);
                      if (next.has(path)) {
                        next.delete(path);
                      } else {
                        next.add(path);
                        // 하위 부서가 1개뿐인 구간은 이어서 자동 펼침 — 선택지 없는 클릭 반복 제거
                        for (const p of collectSingleChildChain(orgTree.roots, path)) next.add(p);
                      }
                      setOrgOpen(next);
                      writeTree(next, favOpen, wordOpen, unassignedOpen, true, homeView);
                    }}
                    onCollapseAll={() => {
                      const next = new Set<string>();
                      setOrgOpen(next);
                      setUnassignedOpen(false);
                      writeTree(next, favOpen, wordOpen, false, true, homeView);
                    }}
                    selectedId={effectiveSelected}
                    highlightId={highlightId}
                    onSelect={setSelectedId}
                    unassignedOpen={unassignedOpen}
                    onToggleUnassigned={() => {
                      const next = !unassignedOpen;
                      setUnassignedOpen(next);
                      writeTree(orgOpen, favOpen, wordOpen, next, treeTouched, homeView);
                    }}
                    renderCard={renderCard}
                  />
                </div>
              )}
            </div>

            {/* ≥ split(980px) — 우측 사이드 패널. 선택 없으면 플레이스홀더 / wide screens: side panel or empty placeholder */}
            <aside
              data-id="map-detail-aside"
              onMouseDown={(e) => e.stopPropagation()} // 상세 내부 조작이 배경(선택 해제)으로 버블링 방지
              className="hidden min-w-[24rem] flex-[2] flex-col rounded-sm border border-hairline bg-surface-alt split:flex"
            >
              {effectiveSelected !== null ? (
                <MapDetailCard
                  key={`${effectiveSelected}-${detailReloadKey}`}
                  mapId={effectiveSelected}
                  onDelete={(id) => void handleDelete(id)}
                  onCopy={handleCopyOpen}
                  onPromote={(id, name) => setPromoteTarget({ id, name })}
                  onGoToVersion={(vid) => router.push(`/maps/${effectiveSelected}?version=${vid}`)}
                  onFrameworkChanged={handleFrameworkChanged}
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

      {reimportTarget && (
        <WordCreateModal
          onClose={() => setReimportTarget(null)}
          onContinue={(outcome) => {
            const target = reimportTarget;
            setReimportTarget(null);
            void setWordDoc(target.id, { doc_name: outcome.docName, sections: outcome.sections })
              .then(() => {
                void refresh();
                setDetailReloadKey((k) => k + 1);
                showToast("Document re-imported.");
              })
              .catch((err) => {
                showToast(humanizeApiError(err, t), "error");
              });
          }}
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

      {promoteTarget && (
        <CreateMapDialog
          promote={{ mapId: promoteTarget.id, defaultName: `${promoteTarget.name} (Copy)` }}
          onClose={() => setPromoteTarget(null)}
          onCreated={(silent) => {
            void refresh();
            if (!silent) showToast("Converted to process map.");
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
