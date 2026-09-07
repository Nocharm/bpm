// 프로세스 라이브러리 패널 — 등록된 맵 목록을 검색하고 캔버스로 드래그해 하위프로세스 노드를 생성.
// 미등록(미지정) 맵은 토글로 노출 — 같은 드래그로 놓으면 캔버스 쪽에서 경고 확인+등록 요청이 이어진다.
// 부서/권한/미등록 필터는 필(pill)로 표시되며 localStorage에 영속(2026-09-07, lib/library-filters.ts).
// 하단 New map은 검색어가 있을 때만 — 그 이름으로 생성 즉시 링크 (spec 2026-07-19).
"use client";

import {
  Check,
  ChevronRight,
  Crown,
  Eye,
  Filter,
  FolderTree,
  type LucideIcon,
  Network,
  PenLine,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { listLibraryProcesses, type LibraryProcess } from "@/lib/api";
import { CheckInput } from "@/components/check-input";
import { LibraryDeptFlyout } from "@/components/library-dept-flyout";
import { CreateMapDialog } from "@/components/permissions/create-map-dialog";
import { OrgInfoModal } from "@/components/org-info-modal";
import { useKoreanDeptByPath } from "@/components/map-ownership-section";
import {
  PEEK_HOVER_DELAY_MS,
  SubprocessPreviewPeek,
  type PeekAddPayload,
} from "@/components/subprocess-preview-peek";
import { buildDeptPathTree } from "@/lib/dept-path-tree";
import { useDirectoryDepartments } from "@/lib/directory";
import {
  buildDeptPathIndex,
  resolveDepartmentPaths,
  buildLibraryDeptOptions,
  buildMyDeptChain,
} from "@/lib/library-dept-options";
import { useMe } from "@/lib/me";
import { filterByQuery } from "@/lib/search";
import { formatDeptName } from "@/lib/korean-dept";
import {
  applyLibraryFilters,
  countActiveFilters,
  EMPTY_LIBRARY_FILTERS,
  type LibraryFilters,
  type LibraryRole,
  readLibraryFilters,
  writeLibraryFilters,
} from "@/lib/library-filters";
import { closesCycle } from "@/lib/subprocess-embed";
import { useI18n } from "@/lib/i18n";
import type { NodeDisplayToggle } from "@/lib/node-actions";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

// 부서 칩 호버 모달 타이밍(ms) — 열림은 인텐트 지연, 닫힘은 즉시 시작하는 페이드아웃.
// 유예 닫기는 답답하다는 피드백으로 폐기 (사용자 요청 2026-09-03). FADE는 globals.css .animate-item-out과 동기.
const DEPT_HOVER_OPEN_MS = 300;
const DEPT_HOVER_FADE_MS = 140;

export interface ProcessLibraryPanelProps {
  currentMapId: number;
  linkedMapIds: Set<number>;
  readOnly: boolean;
  // 현재 맵의 노드 표시 설정 — 피크 목업 호버 시 "현재 맵 기준" 렌더 필터 (2026-08-30)
  nodeDisplayFields: NodeDisplayToggle[];
  onClose: () => void;
  // 새 맵 생성 즉시 링크 — 에디터의 addLinkNodeFromMap 스레딩
  onAddLinkNode: (linkedMapId: number, name: string) => void;
  // 미리보기 피크의 "Add to map" — 드롭과 동일 생성 체인(뷰포트 중앙) (2026-08-30)
  onPeekAdd: (payload: PeekAddPayload) => void;
  // 피크 목업 드롭다운 "해당 맵으로 이동" — 에디터 이탈 확인 게이트(openMapPrompt)로 연결
  onPeekOpenMap: (mapId: number, name: string) => void;
  // 이미 이 맵에 들어와 있는 행 클릭 — 미리보기 대신 캔버스의 그 노드로 포커스 (사용자 요청 2026-08-31)
  onFocusLinkedNode: (linkedMapId: number) => void;
}

// 역할 필 앞 아이콘 — 선택되면 Check로 바뀐다(사용자 지시 2026-09-07)
const ROLE_ICONS: Record<LibraryRole, LucideIcon> = { owner: Crown, editor: PenLine, viewer: Eye };

export function ProcessLibraryPanel({
  currentMapId,
  linkedMapIds,
  readOnly,
  nodeDisplayFields,
  onClose,
  onAddLinkNode,
  onPeekAdd,
  onPeekOpenMap,
  onFocusLinkedNode,
}: ProcessLibraryPanelProps) {
  const { t, lang } = useI18n();
  const koreanDeptByPath = useKoreanDeptByPath();
  const [rows, setRows] = useState<LibraryProcess[]>([]);
  // 부서/역할/미등록 필터 — localStorage 영속(bpm.library.filters). 패널은 클릭 시에만 마운트되어
  // SSR 불일치가 없으므로 지연 초기화로 즉시 복원한다(마운트 이펙트 없이 useState(() => ...), F9) —
  // 이전의 마운트 후 복원 effect는 showUnregistered가 true로 영속된 경우 fetch가 두 번 나가는 부작용이 있었다.
  const [filters, setFilters] = useState<LibraryFilters>(() => readLibraryFilters());
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // 부서 트리 플라이아웃 — 열 때 측정한 팝오버 rect가 곧 열림 상태(null=닫힘)
  const [deptFlyoutAnchor, setDeptFlyoutAnchor] = useState<DOMRect | null>(null);
  const deptFlyoutRef = useRef<HTMLDivElement>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const me = useMe();
  const myOrgPath = me?.org_path || null;
  const directoryDepts = useDirectoryDepartments();

  // 필터 변경 시 그 자리에서 저장 — i18n.tsx setLang과 동일 관례.
  function updateFilters(next: LibraryFilters) {
    setFilters(next);
    writeLibraryFilters(next);
  }

  // 팝오버를 닫으면 플라이아웃도 같이 — 앵커 rect가 팝오버 기준이라 남겨두면 허공에 뜬다.
  function closeFilterPopover() {
    setFilterOpen(false);
    setDeptFlyoutAnchor(null);
  }

  function toggleDeptFlyout() {
    if (deptFlyoutAnchor) {
      setDeptFlyoutAnchor(null);
      return;
    }
    const rect = popoverRef.current?.getBoundingClientRect();
    if (rect) setDeptFlyoutAnchor(rect);
  }

  // 미등록(미지정) 맵 노출은 fetch 플래그 — 켜면 include_undesignated로 재조회(가시성 필터는 서버)
  useEffect(() => {
    let cancelled = false;
    void listLibraryProcesses(filters.showUnregistered).then((data) => {
      if (!cancelled) setRows(data);
    });
    return () => {
      cancelled = true;
    };
  }, [filters.showUnregistered]);

  // 바깥 클릭 시 필터 팝오버 닫기 — notification-bell.tsx와 동일 캡처 패턴.
  // 부서 플라이아웃은 포털이라 filterRef 밖의 DOM이다 — 그 안쪽 클릭도 "안"으로 쳐야 팝오버가 안 닫힌다.
  useEffect(() => {
    if (!filterOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (filterRef.current?.contains(event.target)) return;
      if (deptFlyoutRef.current?.contains(event.target)) return;
      setFilterOpen(false);
      setDeptFlyoutAnchor(null);
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => window.removeEventListener("mousedown", handleMouseDown, true);
  }, [filterOpen]);

  // 패널은 열릴 때마다 새로 마운트되므로 모든 오픈 경로에서 검색창에 포커스된다.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // 순환 참조 판별 맵 — map_id → refs[]
  const refsByMap = useMemo(
    () => new Map(rows.map((r) => [r.map_id, r.refs])),
    [rows],
  );

  // 행의 부서(sp_department)는 리프명만 담기는 일이 많다 — 조직도에서 유일하게 풀리면 경로로 정규화해
  // 트리 위치·필터·한글명·조직 카드가 같은 값을 본다. 중복 리프(두 상위 아래 같은 이름)는 그대로 두고
  // 필터만 후보 전부로 매칭한다(applyLibraryFilters의 deptIndex).
  const deptIndex = useMemo(() => buildDeptPathIndex(directoryDepts), [directoryDepts]);
  // 현재 맵 제외(자기 자신 링크 불가) — refsByMap은 순환 판별용이라 전체 rows 유지.
  const linkableRows = useMemo(
    () =>
      rows
        .filter((r) => r.map_id !== currentMapId)
        .map((r) => {
          if (!r.department) return r;
          const candidates = resolveDepartmentPaths(r.department, deptIndex);
          return candidates.length === 1 && candidates[0] !== r.department
            ? { ...r, department: candidates[0] }
            : r;
        }),
    [rows, currentMapId, deptIndex],
  );
  // 부서 트리 소스 — 조직도 부서(약 500) ∪ 행에만 있는 부서(컨설턴트 임포트 등).
  // filters 자체가 아니라 linkableRows에서 파생해, 필터를 걸수록 다른 옵션이 사라지지 않는다.
  const deptOptions = useMemo(
    () => buildLibraryDeptOptions(directoryDepts, linkableRows.map((r) => r.department), deptIndex),
    [directoryDepts, linkableRows, deptIndex],
  );
  const chainPaths = useMemo(() => buildMyDeptChain(myOrgPath), [myOrgPath]);
  // 팝오버는 "내 위쪽"만 — 루트→내 부서 체인(부서 미지정이면 트리 루트)에, 체인 밖에서 이미
  // 선택된 부서를 덧붙인다(활성 필을 팝오버에서도 해제할 수 있어야 한다). 전체 탐색은 플라이아웃.
  const quickPaths = useMemo(() => {
    const base =
      chainPaths.length > 0 ? chainPaths : buildDeptPathTree(deptOptions).map((r) => r.path);
    return [...base, ...filters.departments.filter((d) => !base.includes(d))];
  }, [chainPaths, deptOptions, filters.departments]);
  // 부서/역할 필터 → 부분일치+초성+로마자+시퀀스 매칭(filterByQuery, 이름·부서 대상, 랭크순) 순.
  const listRows = useMemo(
    () => applyLibraryFilters(linkableRows, filters, deptIndex),
    [linkableRows, filters, deptIndex],
  );
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return listRows;
    return filterByQuery(listRows, q, (r) => [
      { field: "name", text: r.name },
      { field: "department", text: r.department ?? "" },
    ]).map((h) => h.item);
  }, [listRows, query]);
  // 25개씩 증분 렌더 — 라이브러리 맵이 수백 개여도 패널 오픈 부하 없음
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(filtered, query);
  const activeFilterCount = countActiveFilters(filters);
  const roleLabels: Record<LibraryRole, string> = {
    owner: t("perm.roleOwner"),
    editor: t("perm.roleEditor"),
    viewer: t("perm.roleViewer"),
  };

  function toggleDepartment(dept: string) {
    const departments = filters.departments.includes(dept)
      ? filters.departments.filter((d) => d !== dept)
      : [...filters.departments, dept];
    updateFilters({ ...filters, departments });
  }

  function toggleRole(role: LibraryRole) {
    const roles = filters.roles.includes(role)
      ? filters.roles.filter((r) => r !== role)
      : [...filters.roles, role];
    updateFilters({ ...filters, roles });
  }

  function removeDepartment(dept: string) {
    updateFilters({ ...filters, departments: filters.departments.filter((d) => d !== dept) });
  }

  function removeRole(role: LibraryRole) {
    updateFilters({ ...filters, roles: filters.roles.filter((r) => r !== role) });
  }

  function clearFilters() {
    updateFilters(EMPTY_LIBRARY_FILTERS);
  }

  // 행 미리보기 피크 — 클릭 즉시·2.5초 호버로 오픈(패널당 1개). 스크롤·드래그 시작 시 닫는다 (2026-08-30)
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [peek, setPeek] = useState<{
    row: LibraryProcess;
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
  // 부서 칩 호버 → 조직 정보 모달 — 인텐트 지연 오픈·유예 닫힘(모달 위 호버는 닫기 취소) (2026-09-02)
  const [deptModal, setDeptModal] = useState<
    { path: string; origin: { x: number; y: number }; closing: boolean; elevated?: boolean } | null
  >(null);
  const deptOpenTimerRef = useRef<number | null>(null);
  const deptCloseTimerRef = useRef<number | null>(null);
  function clearDeptTimers() {
    if (deptOpenTimerRef.current !== null) {
      window.clearTimeout(deptOpenTimerRef.current);
      deptOpenTimerRef.current = null;
    }
    if (deptCloseTimerRef.current !== null) {
      window.clearTimeout(deptCloseTimerRef.current);
      deptCloseTimerRef.current = null;
    }
  }
  useEffect(() => clearDeptTimers, []);
  function cancelDeptModalClose() {
    if (deptCloseTimerRef.current !== null) {
      window.clearTimeout(deptCloseTimerRef.current);
      deptCloseTimerRef.current = null;
    }
    // 페이드 도중 같은 칩으로 되돌아오면 되살린다
    setDeptModal((cur) => (cur !== null && cur.closing ? { ...cur, closing: false } : cur));
  }
  // 칩을 벗어나면 즉시 페이드아웃 시작, 애니메이션이 끝난 뒤 언마운트
  function startDeptModalClose() {
    cancelDeptModalClose();
    setDeptModal((cur) => (cur === null ? null : { ...cur, closing: true }));
    deptCloseTimerRef.current = window.setTimeout(() => setDeptModal(null), DEPT_HOVER_FADE_MS);
  }
  // 마지막 커서 위치 — 오픈 지연 동안 칩 위에서 움직인 만큼 따라가 카드가 커서 기준으로 뜬다
  const deptPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  function handleDeptChipEnter(path: string, x: number, y: number) {
    clearHoverTimer(); // 칩 호버는 부서 정보 인텐트 — 행 피크 자동 오픈 억제
    cancelDeptModalClose();
    deptPointerRef.current = { x, y };
    if (deptModal?.path === path) return; // 같은 부서 카드가 이미 열림 — 유지
    if (deptOpenTimerRef.current !== null) window.clearTimeout(deptOpenTimerRef.current);
    deptOpenTimerRef.current = window.setTimeout(
      () => setDeptModal({ path, origin: { ...deptPointerRef.current }, closing: false }),
      DEPT_HOVER_OPEN_MS,
    );
  }
  // 플라이아웃 트리 행 우클릭 → "부서 정보": 지연 없이 바로, 플라이아웃(z-1350) 위로 띄운다
  function handleDeptInfoRequest(path: string, x: number, y: number) {
    clearDeptTimers();
    setDeptModal({ path, origin: { x, y }, closing: false, elevated: true });
  }
  function handleDeptChipLeave() {
    if (deptOpenTimerRef.current !== null) {
      window.clearTimeout(deptOpenTimerRef.current);
      deptOpenTimerRef.current = null;
    }
    if (deptModal) startDeptModalClose();
  }

  function openPeek(row: LibraryProcess, blocked: string | null, rowEl: Element) {
    clearHoverTimer();
    // x는 패널 우측 고정(행 들여쓰기와 무관하게 일정), y는 행 기준 — 세로 클램프는 피크가 수행
    const panelRight = panelRef.current?.getBoundingClientRect().right ?? rowEl.getBoundingClientRect().right;
    setPeek({
      row,
      blocked,
      anchor: { x: panelRight + 8, y: rowEl.getBoundingClientRect().top - 4 },
      anchorEl: rowEl,
    });
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, row: LibraryProcess) {
    clearHoverTimer();
    setPeek(null);
    clearDeptTimers();
    setDeptModal(null);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/bpm-process", String(row.map_id));
    // stash name + pinned version to avoid needing a shared-state lookup on drop
    e.dataTransfer.setData("application/bpm-process-name", row.name);
    // 미등록 맵은 최신 추종으로만 링크(핀 없음) — 드롭 쪽에서 경고 확인+등록 요청 체인을 연다
    const pinned = row.designated ? (row.latest_published_version_id ?? row.latest_version_id) : null;
    e.dataTransfer.setData(
      "application/bpm-process-pinned",
      pinned !== null ? String(pinned) : "",
    );
    if (!row.designated) e.dataTransfer.setData("application/bpm-process-unregistered", "1");
  }

  return (
    <div
      ref={panelRef}
      data-id="process-library-panel"
      className="flex w-56 flex-col border-r border-hairline bg-surface"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-1.5 text-caption font-semibold text-ink">
          <Network size={14} strokeWidth={1.5} />
          {t("library.title")}
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

      {/* search */}
      <div className="border-b border-hairline px-2 py-1.5">
        <div className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5">
          <Search size={12} strokeWidth={1.5} className="shrink-0 text-ink/40" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("library.search")}
            className="min-w-0 flex-1 bg-transparent text-fine text-ink outline-none placeholder:text-ink/40"
          />
        </div>
        {/* filter row — Filter 버튼(팝오버) + 활성 필터 필 + 전체삭제 */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              data-id="library-filter-open"
              onClick={() => (filterOpen ? closeFilterPopover() : setFilterOpen(true))}
              className="flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
            >
              <Filter size={12} strokeWidth={1.5} />
              {t("library.filter")}
              {activeFilterCount > 0 && (
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none text-on-accent">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filterOpen && (
              <div
                ref={popoverRef}
                data-id="library-filter-popover"
                className="absolute left-0 top-6 z-[1300] w-52 rounded-md border border-hairline bg-surface p-2 shadow-lg"
              >
                {/* 미등록 맵 — 행 전체가 스위치(행 클릭도 토글). 부서보다 위 (사용자 지시 2026-09-07) */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={filters.showUnregistered}
                  data-id="library-unregistered-toggle"
                  onClick={() => updateFilters({ ...filters, showUnregistered: !filters.showUnregistered })}
                  className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-xs px-1 py-1 text-fine text-ink hover:bg-surface-alt"
                >
                  <span className="min-w-0 truncate">{t("library.filterUnregistered")}</span>
                  <span
                    aria-hidden="true"
                    className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ${
                      filters.showUnregistered ? "bg-accent" : "bg-border-strong"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-all duration-150 ${
                        filters.showUnregistered ? "left-3.5" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>
                <p className="border-t border-hairline px-1 pb-1 pt-1.5 text-fine font-semibold text-ink-tertiary">
                  {t("library.filterDepartment")}
                </p>
                <div className="max-h-36 overflow-y-auto">
                  {quickPaths.map((dept, index) => {
                    const checked = filters.departments.includes(dept);
                    return (
                      <label
                        key={dept}
                        title={dept}
                        // 체인 들여쓰기 — 루트(depth 0)는 기존 px-1(4px)과 같은 자리에 선다
                        style={{ paddingLeft: `${(dept.split("/").length - 1) * 8 + 4}px` }}
                        className="group flex cursor-pointer items-center gap-1.5 rounded-xs px-1 py-1 text-fine text-ink hover:bg-surface-alt"
                      >
                        {/* 체크는 이름 앞 자리를 지키되 호버·포커스·선택 상태에서만 보인다 */}
                        <CheckInput
                          data-id={`library-filter-dept-${index}`}
                          checked={checked}
                          onChange={() => toggleDepartment(dept)}
                          className={`transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
                            checked ? "" : "opacity-0"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">{formatDeptName(dept, lang, koreanDeptByPath)}</span>
                        {dept === myOrgPath && (
                          <span
                            data-id="library-dept-mine"
                            className="shrink-0 rounded-full bg-accent-tint px-1.5 text-[10px] leading-4 text-accent"
                          >
                            {t("library.filterDeptMine")}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  data-id="library-filter-dept-browse"
                  onClick={toggleDeptFlyout}
                  className="mb-2 flex w-full items-center gap-1 rounded-xs px-1 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
                >
                  <FolderTree size={12} strokeWidth={1.5} />
                  {t("library.filterDeptBrowse")}
                  <ChevronRight size={12} strokeWidth={1.5} className="ml-auto" />
                </button>
                <p className="px-1 pb-1 text-fine font-semibold text-ink-tertiary">{t("library.filterRole")}</p>
                {/* 역할은 한 줄 필 토글 — 아무것도 안 고르면 전체와 같다(빈 roles = 필터 없음) */}
                <div className="mb-2 flex gap-1 px-0.5">
                  {(["owner", "editor", "viewer"] as const).map((role) => {
                    const active = filters.roles.includes(role);
                    const RoleIcon = ROLE_ICONS[role];
                    return (
                      <button
                        key={role}
                        type="button"
                        data-id={`library-filter-role-${role}`}
                        aria-pressed={active}
                        onClick={() => toggleRole(role)}
                        className={`flex items-center gap-0.5 whitespace-nowrap rounded-full border px-1 py-0.5 text-fine transition-colors duration-150 ${
                          active
                            ? "border-accent bg-accent-tint text-accent"
                            : "border-hairline text-ink-secondary hover:bg-surface-alt"
                        }`}
                      >
                        {active ? (
                          <Check size={12} strokeWidth={2} />
                        ) : (
                          <RoleIcon size={12} strokeWidth={1.5} />
                        )}
                        {roleLabels[role]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {deptFlyoutAnchor && (
              <LibraryDeptFlyout
                options={deptOptions}
                selected={filters.departments}
                onToggle={toggleDepartment}
                myOrgPath={myOrgPath}
                anchorRect={deptFlyoutAnchor}
                containerRef={deptFlyoutRef}
                onClose={() => setDeptFlyoutAnchor(null)}
                onShowDeptInfo={handleDeptInfoRequest}
                lang={lang}
                koreanDeptByPath={koreanDeptByPath}
              />
            )}
          </div>
          {filters.departments.map((dept, index) => (
            <span
              key={`dept-${dept}`}
              data-id={`library-filter-pill-dept-${index}`}
              title={dept}
              className="flex items-center gap-1 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
            >
              <span className="max-w-20 truncate">{formatDeptName(dept, lang, koreanDeptByPath)}</span>
              <button
                type="button"
                aria-label="Remove filter"
                onClick={() => removeDepartment(dept)}
                className="shrink-0 rounded-full hover:bg-accent/20"
              >
                <X size={10} strokeWidth={1.5} />
              </button>
            </span>
          ))}
          {filters.roles.map((role) => (
            <span
              key={`role-${role}`}
              data-id={`library-filter-pill-role-${role}`}
              className="flex items-center gap-1 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
            >
              {roleLabels[role]}
              <button
                type="button"
                aria-label="Remove filter"
                onClick={() => removeRole(role)}
                className="shrink-0 rounded-full hover:bg-accent/20"
              >
                <X size={10} strokeWidth={1.5} />
              </button>
            </span>
          ))}
          {filters.showUnregistered && (
            <span
              data-id="library-filter-pill-unregistered"
              className="flex items-center gap-1 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
            >
              {t("library.filterUnregistered")}
              <button
                type="button"
                aria-label="Remove filter"
                onClick={() => updateFilters({ ...filters, showUnregistered: false })}
                className="shrink-0 rounded-full hover:bg-accent/20"
              >
                <X size={10} strokeWidth={1.5} />
              </button>
            </span>
          )}
          {activeFilterCount > 0 && (
            <button
              type="button"
              data-id="library-filter-clear"
              onClick={clearFilters}
              className="rounded-xs px-1.5 py-0.5 text-fine text-ink-tertiary hover:text-error hover:underline"
            >
              {t("library.filterClear")}
            </button>
          )}
        </div>
        {activeFilterCount > 0 && (
          <p data-id="library-filter-count" className="mt-1 px-0.5 text-fine text-ink-tertiary">
            {t("library.filterCount", { shown: filtered.length, total: linkableRows.length })}
          </p>
        )}
      </div>

      {/* list */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={() => {
          // 스크롤하면 앵커 rect가 어긋난다 — 피크·호버 타이머 모두 정리
          clearHoverTimer();
          setPeek((cur) => (cur ? null : cur));
        }}
      >
        {filtered.length === 0 ? (
          // 전체가 비면 지정 안내(지정된 맵만 노출), 검색 결과만 비면 기존 문구
          <p data-id="library-empty-state" className="px-3 py-4 text-center text-fine text-ink/40">
            {rows.length === 0 ? t("library.emptyDesignated") : t("library.empty")}
          </p>
        ) : (
          visible.map((row) => {
            const alreadyLinked = linkedMapIds.has(row.map_id);
            const blocked =
              row.map_id === currentMapId ||
              alreadyLinked ||
              closesCycle(row.map_id, currentMapId, refsByMap);
            const blockedReason = alreadyLinked ? t("library.alreadyLinked") : t("library.cycleBlocked");
            const unregistered = !row.designated;
            // 피크 add 비활성 사유 — 행 드래그 차단과 동일 + 읽기전용
            const peekBlocked = readOnly
              ? t("editor.readonly.viewerDesc")
              : blocked
                ? blockedReason
                : null;
            // 미등록 맵도 다른 맵과 같은 드래그로 — 드롭 시 캔버스 쪽에서 경고 확인+등록 요청 체인
            return (
              <div
                key={row.map_id}
                data-map-id={row.map_id}
                draggable={!blocked}
                onDragStart={blocked ? undefined : (e) => handleDragStart(e, row)}
                onClick={(e) => {
                  // 이미 이 맵에 있는 행은 미리보기가 무의미하다(추가도 못 함) — 캔버스의 그 노드로 보낸다
                  if (alreadyLinked) {
                    clearHoverTimer();
                    setPeek(null);
                    onFocusLinkedNode(row.map_id);
                    return;
                  }
                  // 클릭 = 피크 토글(같은 행 재클릭이면 닫기) — 그 외 차단 행도 미리보기는 제공
                  if (peek && peek.row.map_id === row.map_id) setPeek(null);
                  else openPeek(row, peekBlocked, e.currentTarget);
                }}
                onMouseEnter={(e) => {
                  if (alreadyLinked) return; // 호버 자동 오픈도 억제 — 클릭은 포커스 이동이다
                  const rowEl = e.currentTarget;
                  clearHoverTimer();
                  hoverTimerRef.current = window.setTimeout(
                    () => openPeek(row, peekBlocked, rowEl),
                    PEEK_HOVER_DELAY_MS,
                  );
                }}
                onMouseLeave={clearHoverTimer}
                title={alreadyLinked ? t("library.focusLinkedNode") : blocked ? blockedReason : row.name}
                className={[
                  "flex cursor-grab items-center gap-2 border-b border-hairline px-3 py-2 text-caption text-ink",
                  // 이미 포함된 행은 "금지"가 아니라 "이동" — 커서·호버를 그렇게 바꿔 클릭 가능함을 알린다
                  alreadyLinked
                    ? "cursor-pointer opacity-60 hover:bg-accent-tint hover:opacity-100"
                    : blocked
                      ? "cursor-not-allowed opacity-40"
                      : "hover:bg-surface-alt active:cursor-grabbing",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Network size={12} strokeWidth={1.5} className="shrink-0 text-ink/50" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="min-w-0 truncate">{row.name}</span>
                  {unregistered ? (
                    <span
                      data-id="library-unregistered-badge"
                      className="self-start rounded-xs border border-hairline px-1 py-px text-fine text-ink-tertiary"
                    >
                      {t("library.notRegistered")}
                    </span>
                  ) : (
                    row.department && (
                      // 지정 부서 칩 — 최하위 부서만 한 줄 표시(경로 전체는 호버 시 커서 앵커 조직 카드) (2026-09-02)
                      <span
                        data-id="library-department-chip"
                        className="block max-w-full self-start truncate rounded-xs border border-accent-tint-border bg-accent-tint px-1 py-px text-fine text-accent transition-all duration-150 hover:-translate-y-px hover:border-accent hover:shadow-sm"
                        onMouseEnter={(e) =>
                          row.department && handleDeptChipEnter(row.department, e.clientX, e.clientY)
                        }
                        onMouseMove={(e) => {
                          deptPointerRef.current = { x: e.clientX, y: e.clientY };
                        }}
                        onMouseLeave={handleDeptChipLeave}
                      >
                        {formatDeptName(row.department, lang, koreanDeptByPath)}
                      </span>
                    )
                  )}
                </span>
              </div>
            );
          })
        )}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>

      {/* footer — 검색어가 있을 때만: 그 이름으로 새 맵 생성, 생성 즉시 현재 맵에 링크 */}
      {query.trim() !== "" && (
        <div className="border-t border-divider p-1">
          <button
            type="button"
            data-id="library-new-map"
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-caption font-medium text-accent hover:bg-surface-alt"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} strokeWidth={1.5} className="shrink-0" />
            {t("library.newMapNamedPrefix") !== "" && (
              <span className="shrink-0">{t("library.newMapNamedPrefix")}</span>
            )}
            <span className="min-w-0 max-w-[8rem] truncate rounded-xs border border-accent-tint-border bg-accent-tint px-1 py-px text-fine">
              &quot;{query.trim()}&quot;
            </span>
            {t("library.newMapNamedSuffix") !== "" && (
              <span className="shrink-0">{t("library.newMapNamedSuffix")}</span>
            )}
          </button>
        </div>
      )}
      {deptModal && (
        <OrgInfoModal
          anchored
          closing={deptModal.closing}
          elevated={deptModal.elevated}
          orgPath={deptModal.path}
          koreanDeptByPath={koreanDeptByPath}
          origin={deptModal.origin}
          onClose={() => {
            clearDeptTimers();
            setDeptModal(null);
          }}
          onHoverStart={cancelDeptModalClose}
          onHoverEnd={startDeptModalClose}
        />
      )}
      {peek && (
        <SubprocessPreviewPeek
          key={peek.row.map_id}
          mapId={peek.row.map_id}
          name={peek.row.name}
          designated={peek.row.designated}
          info={{
            department: peek.row.department,
            assignee: peek.row.assignee,
            system: peek.row.system,
            duration: peek.row.duration,
            touch_time: peek.row.touch_time,
            cost_krw: peek.row.cost_krw,
            cost_usd: peek.row.cost_usd,
            headcount: peek.row.headcount,
          }}
          anchor={peek.anchor}
          anchorEl={peek.anchorEl}
          addDisabledReason={peek.blocked}
          displayFields={nodeDisplayFields}
          // 목업 드래그 페이로드 — onAdd와 동일 계약(비활성 게이팅은 피크가 addDisabledReason으로 수행)
          dragPayload={{
            linkedMapId: peek.row.map_id,
            name: peek.row.name,
            pinned: peek.row.designated
              ? (peek.row.latest_published_version_id ?? peek.row.latest_version_id)
              : null,
            unregistered: !peek.row.designated,
          }}
          onAdd={() => {
            const row = peek.row;
            setPeek(null);
            // 드래그 페이로드와 동일 계약 — 지정 맵은 게시본 핀, 미등록은 확인 체인(핀 없음)
            onPeekAdd({
              linkedMapId: row.map_id,
              name: row.name,
              pinned: row.designated
                ? (row.latest_published_version_id ?? row.latest_version_id)
                : null,
              unregistered: !row.designated,
            });
          }}
          onOpenMap={() => {
            const row = peek.row;
            setPeek(null);
            onPeekOpenMap(row.map_id, row.name);
          }}
          onClose={() => setPeek(null)}
        />
      )}
      {showCreate && (
        <CreateMapDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
          initialName={query.trim() || undefined}
          onCreatedMap={(createdMapId, createdName) => {
            setShowCreate(false);
            onAddLinkNode(createdMapId, createdName);
          }}
        />
      )}
    </div>
  );
}
