"use client";

// 홈 프로세스맵 카드 — 클릭=선택(우측 상세). 타이틀 클릭도 선택(에디터 직행 오클릭 방지) —
// 에디터 이동은 호버 시 2줄 우측에 나타나는 Open 버튼으로만 /
// Home map card: any click selects it; navigation lives in the hover-revealed Open pill.
// 2026-09-10 재디자인(목업 v5 확정): 1줄 = 제목 · SP 아이콘 · 상태(영어 고정, 호버 시 도트만 남기고 접힘) |
// 우측 권한 필(오너=채움). 2줄 = 오너 필(인물 카드 트리거, 미확정=점선+톤다운) · 수정 시각 | 우측 열기(호버)·
// ⚠경고 건수(클릭→모달)·공개범위 아이콘. 노드/버전/인원 수는 카드에서 빼고 호버 요약 모달에만 남긴다.

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Clock, GitBranch, Globe, Lock, TriangleAlert, User, Users, Workflow } from "lucide-react";

import { type MapSummary } from "@/lib/api";
import { placeBesideAnchor } from "@/lib/clamp-viewport";
import { formatKst } from "@/lib/datetime";
import { Highlight } from "@/components/highlight";
import { PersonHoverCard } from "@/components/person-hover-card";
import { MapCardWarningsModal } from "@/components/maps/map-card-warnings-modal";
import { useI18n } from "@/lib/i18n";
import { collectMapWarnings } from "@/lib/map-card-warnings";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { NavRing } from "@/components/nav-ring";
import type { MatchRange } from "@/lib/search";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_TONE } from "@/lib/version-status";

// 호버 요약 모달 — 0.7초 의도 판정 후 등장(인물 카드 OPEN_DELAY_MS와 동일), 퇴장은 globals.css hover-modal-out 길이만큼
// 마운트를 유지해 페이드를 재생한다.
const HOVER_MODAL_OPEN_MS = 700;
const HOVER_MODAL_CLOSE_MS = 150;

interface MapCardProps {
  map: MapSummary;
  // 마스터-디테일 선택 — 클릭 시 우측 상세 패널 대상 / select for the detail panel.
  selected?: boolean;
  onSelect?: (mapId: number) => void;
  nameRanges?: MatchRange[];
  // 복사 직후 강조 — 쉬머 링 + 자동 스크롤 (F12).
  highlighted?: boolean;
  // 최근 접속 시각(epoch ms) — 있으면 accent 배지 표시(상단 밴드·검색모드 최근 매치).
  recentOpenedAt?: number;
}

export function MapCard({
  map,
  selected = false,
  onSelect,
  nameRanges,
  highlighted = false,
  recentOpenedAt,
}: MapCardProps) {
  const { t } = useI18n();
  // 열기 버튼의 1초 지연 이동(다시 클릭하면 취소) — 대시보드 행과 같은 훅
  const { pending: navPending, toggle: toggleNav } = useDelayedNav();
  const openHref = `/maps/${map.id}`;
  const openPending = navPending === openHref;
  // 마운트 시점 1회 — 렌더 중 Date.now() 호출은 순수성 규칙 위반이라 상태로 고정 (상대 시각 기준)
  const [now] = useState(() => Date.now());
  // 상대 시각 — "방금 / N분 전 / N시간 전 / N일 전", 30일↑은 절대 날짜 (브라우저=KST 가정, formatKst와 동일)
  const relativeTime = (iso: string): string => {
    const diffMs = now - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return t("home.timeAgo.now");
    if (min < 60) return t("home.timeAgo.minutes", { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t("home.timeAgo.hours", { n: hr });
    const day = Math.floor(hr / 24);
    if (day < 30) return t("home.timeAgo.days", { n: day });
    return formatKst(iso).slice(0, 10);
  };
  const rootRef = useRef<HTMLDivElement>(null);

  // 강조되면 화면으로 스크롤 (복사 직후 새 카드로 이동)
  useEffect(() => {
    if (highlighted) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  // 역할 필 — 오너는 채움(강조), 에디터는 테두리, 공개+뷰어는 생략(공개맵은 누구나 뷰어라 무의미),
  // 비공개+뷰어만 회색 테두리 (사용자 결정 2026-09-10).
  const role = map.my_role;
  const showRole = role !== null && !(map.visibility === "public" && role === "viewer");

  // 오너 — 표시명은 owner_name(디렉터리) 우선, 없으면 id 폴백(퇴사·임포트 유령) + 퇴사 배지.
  // 카드 트리거는 login_id 기준(인물 카드가 디렉터리로 해석). 임포트 임시 보유(consultant_owner_pending)는
  // 필을 점선+톤다운으로만 낮추고, 사유는 인물 카드 상단 배너로 (사용자 결정 2026-09-10).
  const ownerId = map.owner_id ?? map.created_by;
  const ownerLabel = map.owner_name ?? ownerId;
  const ownerDeparted = !map.owner_name && !!ownerId;
  const ownerPending = !!map.consultant_owner_pending;

  const warnings = collectMapWarnings(map);
  const [warningsOpen, setWarningsOpen] = useState(false);

  // 카드 호버 모달 — 0.7초 호버 시 우측에 요약+인원(읽기 전용). 카드를 벗어나면 페이드 아웃 후 언마운트.
  // 모달은 pointer-events-none(통과) → 디테일 패널/다른 카드 호버를 가리지 않음(호버가 마우스를 따라감).
  const [modalPhase, setModalPhase] = useState<"closed" | "open" | "closing">("closed");
  // top/bottom = 카드 실측 — 모달 높이는 내용(행 수)에 따라 달라 열린 뒤 실측해 아래로 넘치면 카드 하단 정렬로 반전(아래 레이아웃 이펙트)
  const [modalPos, setModalPos] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // 즉시 닫기(클릭·스크롤) — 페이드 없이 바로 언마운트
  const closeModalNow = () => {
    clearTimers();
    setModalPhase("closed");
  };
  // 부드럽게 닫기(마우스 이탈) — closing 페이즈로 페이드 아웃 재생 후 언마운트
  const closeModalSoft = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setModalPhase((phase) => {
      if (phase !== "open") return phase;
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null;
        setModalPhase("closed");
      }, HOVER_MODAL_CLOSE_MS);
      return "closing";
    });
  };
  const onCardEnter = () => {
    if (openTimer.current || modalPhase === "open") return;
    // 페이드 아웃 도중 재진입 — 닫힘 취소하고 다시 연다
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
      setModalPhase("open");
      return;
    }
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setModalPos({ left: rect.right + 8, top: rect.top, bottom: rect.bottom });
      setModalPhase("open");
    }, HOVER_MODAL_OPEN_MS);
  };

  // 열린 직후 실측 높이로 세로 위치 확정 — 화면 아래 카드는 카드 하단에 모달 하단을 맞춘다(반전).
  // top은 이 이펙트가 단독 소유(state로 되돌리면 한 프레임 튐 + 재렌더).
  useLayoutEffect(() => {
    const el = modalRef.current;
    if (!el || modalPhase !== "open" || !modalPos) return;
    // offsetHeight — 등장 애니메이션 첫 프레임의 scale(0.98)이 getBoundingClientRect 높이를 줄여 4px 어긋난다
    el.style.top = `${placeBesideAnchor(modalPos, el.offsetHeight, window.innerHeight)}px`;
  }, [modalPhase, modalPos]);

  // 스크롤/리사이즈 시 위치가 어긋나므로 닫음
  useEffect(() => {
    if (modalPhase === "closed") return;
    const close = () => setModalPhase("closed");
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [modalPhase]);

  // 언마운트 시 대기 타이머 정리
  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // 수정 시각 칩 — 최근 열람 사실은 시계 "아이콘"에만(색 + 배경 하이라이트) 표시한다. 칩 전체에 배경을 입히면
  // 그 줄이 최근 수정이 아닌 다른 값처럼 읽힌다. 상세한 열람 시각은 호버 시 교체 노출 / updated chip
  const renderUpdatedChip = (recent: boolean) => (
    <span
      data-id="map-card-updated-chip"
      title={recent ? t("home.recentBadge") : undefined}
      className="inline-flex shrink-0 items-center gap-1"
    >
      <span
        data-id="map-card-recent-icon"
        className={`inline-flex shrink-0 items-center justify-center ${
          recent ? "rounded-full bg-accent-tint p-0.5 text-accent" : ""
        }`}
      >
        <Clock size={12} strokeWidth={1.5} />
      </span>
      {relativeTime(map.updated_at)}
    </span>
  );

  const statusTone = map.latest_version_status ? VERSION_STATUS_TONE[map.latest_version_status] : null;

  return (
    <div
      ref={rootRef}
      data-id="map-card"
      className={`group relative cursor-pointer select-none rounded-sm border bg-surface px-3.5 py-3 transition-[background-color,box-shadow,border-color] duration-150 ease-smooth hover:bg-surface-alt hover:shadow-sm ${
        highlighted
          ? "animate-pulse border-accent ring-2 ring-accent"
          : selected
            ? "border-accent ring-1 ring-accent"
            : "border-hairline hover:border-accent-tint-border"
      }`}
      onClick={(e) => {
        e.stopPropagation(); // 카드 선택은 배경(선택 해제)으로 버블링 방지
        closeModalNow(); // 클릭(선택) 시 대기 타이머 취소 + 모달 닫기
        onSelect?.(map.id);
      }}
      onMouseEnter={onCardEnter}
      onMouseLeave={closeModalSoft}
    >
      {/* 1줄 — 제목 · SP 아이콘 · 상태(호버 시 도트만) | 우측 권한 필 */}
      <div className="flex min-w-0 items-center gap-1.5">
        {/* 이름은 링크가 아니다 — 클릭이 카드로 버블링돼 선택된다(에디터 직행 오클릭 방지). */}
        <span data-id="map-card-name" className="min-w-0 truncate text-body-strong text-ink">
          <Highlight text={map.name} ranges={nameRanges ?? []} />
        </span>
        {map.sp_designated_at && (
          <span
            data-id="map-card-sp"
            title={t("home.spBadgeTip")}
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-accent-tint text-accent"
          >
            <Workflow size={11} strokeWidth={2.2} />
          </span>
        )}
        {map.latest_version_status && statusTone && (
          // 호버 시 max-width가 도트 폭(패딩 12 + 도트 6)까지 줄어 텍스트가 잘려 들어가고, 벗어나면 다시 펼쳐진다.
          <span
            data-id="map-card-status"
            data-status={map.latest_version_status}
            className={`inline-flex max-w-[120px] shrink-0 items-center gap-1 overflow-hidden rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none transition-[max-width,gap] duration-200 ease-smooth group-hover:max-w-[18px] group-hover:gap-0 ${statusTone.pill}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusTone.dot}`} />
            <span className="whitespace-nowrap transition-opacity duration-150 group-hover:opacity-0">
              {VERSION_STATUS_LABEL_EN[map.latest_version_status]}
            </span>
          </span>
        )}
        {showRole && (
          <span
            data-id="map-card-role"
            data-role={role}
            className={`ml-auto inline-flex shrink-0 items-center rounded-full px-2 py-[3px] text-[11px] leading-none ${
              role === "owner"
                ? "bg-accent font-semibold text-surface"
                : role === "editor"
                  ? "border border-accent font-medium text-accent"
                  : "border border-hairline text-ink-tertiary"
            }`}
          >
            {t(role === "owner" ? "perm.roleOwner" : role === "editor" ? "perm.roleEditor" : "perm.roleViewer")}
          </span>
        )}
      </div>

      {/* 2줄 — 좌: 오너 필·수정 시각(최근 접속 맵은 호버 시 교체) / 우: 열기(호버)·⚠경고·공개범위 */}
      <div className="relative mt-2 flex min-h-[22px] items-center justify-between gap-2 text-fine text-ink-tertiary">
        <div className="flex min-w-0 items-center gap-1.5">
          {ownerId && (
            <PersonHoverCard
              userId={ownerId}
              className="min-w-0"
              notice={
                ownerPending ? (
                  <>
                    <span className="block font-semibold">{t("map.ownerPending")}</span>
                    {t("map.ownerPendingHint")}
                  </>
                ) : undefined
              }
            >
              <span
                data-id="map-card-owner"
                data-pending={ownerPending ? "true" : undefined}
                className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full py-[3px] pl-1.5 pr-2 transition-colors duration-150 hover:bg-accent-tint ${
                  ownerPending
                    ? "border border-dashed border-surface-chip text-ink-secondary opacity-55"
                    : "bg-surface-alt text-ink-secondary group-hover:bg-surface"
                }`}
              >
                <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-surface-chip text-surface">
                  <User size={9} strokeWidth={2.4} />
                </span>
                <span className="truncate">{ownerLabel}</span>
                {ownerDeparted && (
                  <span className="shrink-0 rounded-sm border border-hairline px-1 text-fine text-error">
                    {t("perm.badgeDeparted")}
                  </span>
                )}
              </span>
            </PersonHoverCard>
          )}
          {recentOpenedAt !== undefined ? (
            // 최근 열람 맵 — 기본은 수정시각(시계 아이콘만 accent), 호버 시 최근 접속 기록으로 교체.
            // 두 텍스트를 같은 그리드 셀에 겹쳐 박스를 더 넓은 쪽 폭으로 고정 → 교체 시 폭 점프 없음.
            // 전환은 양방향 모두 0.5초 페이드지만 지연은 비대칭이다 — 들어올 땐 0.5초 머문 뒤
            // 시작(스쳐 지나는 커서에 반응하지 않게), 나갈 땐 지연 없이 바로 페이드로 복귀.
            <div data-id="map-card-recent-badge" className="grid w-fit shrink-0 items-center">
              <div className="col-start-1 row-start-1 flex items-center gap-2 whitespace-nowrap transition-opacity delay-0 duration-500 ease-smooth group-hover:opacity-0 group-hover:delay-500">
                {renderUpdatedChip(true)}
              </div>
              <span
                data-id="map-card-recent-pill"
                className="col-start-1 row-start-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent-tint px-2 py-0.5 text-accent opacity-0 transition-opacity delay-0 duration-500 ease-smooth group-hover:opacity-100 group-hover:delay-500"
              >
                <Clock size={12} strokeWidth={1.5} />
                {t("home.recentBadge")} · {relativeTime(new Date(recentOpenedAt).toISOString())}
              </span>
            </div>
          ) : (
            renderUpdatedChip(false)
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* 에디터 바로 이동 — 호버 시에만 우측에서 슬라이드 인(자리는 항상 차지해 레이아웃 점프 없음), 비노출 중엔 클릭 불가.
              클릭은 1초 지연 이동(링 카운트다운) — 대기 중엔 호버가 끝나도 보이고, 다시 클릭하면 취소 */}
          <Link
            data-id="map-card-open"
            data-navigating={openPending ? "" : undefined}
            href={openHref}
            title={openPending ? t("home.dash.navPending", { dest: map.name }) : t("home.openMap")}
            onClick={(e) => {
              e.stopPropagation();
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 새 탭 등은 브라우저 기본 동작
              e.preventDefault();
              toggleNav(openHref);
            }}
            className={`inline-flex shrink-0 items-center gap-0.5 rounded-[6px] border bg-surface px-2 py-[3px] text-fine font-medium transition-[opacity,translate] duration-150 ease-smooth hover:border-accent hover:text-accent focus-visible:pointer-events-auto focus-visible:translate-x-0 focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 ${
              openPending ? "pointer-events-auto translate-x-0 border-accent text-accent opacity-100" : "pointer-events-none translate-x-1 border-hairline text-ink-secondary opacity-0"
            }`}
          >
            {openPending ? <NavRing size={12} /> : <ArrowUpRight size={12} strokeWidth={1.5} />}
            {openPending ? t("home.dash.navCancel") : t("home.openMap")}
          </Link>
          {warnings.length > 0 && (
            <button
              type="button"
              data-id="map-card-warnings"
              // 종류 목록(공백 구분) — 스모크·검증 스크립트가 특정 경고 유무를 [data-kinds~="…"]로 판정한다
              data-kinds={warnings.map((w) => w.kind).join(" ")}
              title={t("home.warnings.badgeTip", { n: warnings.length })}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-error/10 py-[3px] pl-1.5 pr-2 text-fine font-semibold text-error transition-colors duration-150 hover:bg-error/20"
              onClick={(e) => {
                e.stopPropagation();
                closeModalNow();
                setWarningsOpen(true);
              }}
            >
              <TriangleAlert size={12} strokeWidth={2} />
              {warnings.length}
            </button>
          )}
          <span
            data-id="map-card-visibility"
            className={`inline-flex shrink-0 items-center ${
              map.visibility === "public" ? "text-accent" : "text-ink-tertiary"
            }`}
            title={t(map.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
          >
            {map.visibility === "public" ? (
              <Globe size={15} strokeWidth={1.5} />
            ) : (
              <Lock size={15} strokeWidth={1.5} />
            )}
          </span>
        </div>
      </div>

      {warningsOpen && (
        <MapCardWarningsModal
          mapId={map.id}
          mapName={map.name}
          warnings={warnings}
          onClose={() => setWarningsOpen(false)}
        />
      )}

      {/* 모든 카드 0.7초 호버 — 우측 요약+인원 모달(노드·버전·인원 수는 여기만). 페이드 인/아웃(globals.css hover-modal-*) */}
      {modalPhase !== "closed" &&
        modalPos &&
        createPortal(
          <div
            ref={modalRef}
            data-id="map-card-hover-modal"
            data-phase={modalPhase}
            className={`pointer-events-none fixed z-[1201] w-64 rounded-md border border-hairline bg-surface p-3 text-fine shadow-lg ${
              modalPhase === "closing" ? "animate-hover-modal-out" : "animate-hover-modal-in"
            }`}
            style={{ left: modalPos.left, top: modalPos.top }}
          >
            <p className="mb-2 truncate text-caption-strong text-ink">{map.name}</p>
            {/* 가시성 / visibility */}
            <div className="mb-2 flex items-center gap-2 text-ink-secondary">
              {map.visibility === "public" ? (
                <Globe size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
              ) : (
                <Lock size={13} strokeWidth={1.5} className="shrink-0" />
              )}
              {t(map.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
            </div>

            {/* 카운트 — 라벨 좌측 / 숫자 우측 pill / counts: label left, count pill right */}
            <ul className="flex flex-col gap-1 text-ink-secondary">
              <li className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Workflow size={13} strokeWidth={1.5} className="shrink-0" />
                  <span className="truncate">{t("home.nodeCount")}</span>
                </span>
                <span className="inline-flex min-w-[1.5rem] shrink-0 justify-center rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                  {map.node_count ?? 0}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <GitBranch size={13} strokeWidth={1.5} className="shrink-0" />
                  <span className="truncate">{t("home.versionCount")}</span>
                </span>
                <span className="inline-flex min-w-[1.5rem] shrink-0 justify-center rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                  {map.version_count ?? 0}
                </span>
              </li>
              {/* 인원 수는 접근 권한자(viewer+)만 — 서버 GET /permissions 게이트가 viewer+ (B1) */}
              {map.my_role !== null && (
                <li className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Users size={13} strokeWidth={1.5} className="shrink-0" />
                    <span className="truncate">{t("home.viewMembers")}</span>
                  </span>
                  <span className="inline-flex min-w-[1.5rem] shrink-0 justify-center rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                    {map.member_count ?? 0}
                  </span>
                </li>
              )}
            </ul>

            {/* 오너 카드 / owner card */}
            <div className="mt-2 flex items-center gap-2 rounded-md border border-hairline bg-surface-alt px-2.5 py-1.5">
              <User size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="flex min-w-0 flex-col">
                <span className="text-fine text-ink-tertiary">{t("home.owner")}</span>
                <span className="truncate text-caption text-ink">
                  {ownerLabel}
                  {ownerDeparted && (
                    <span className="ml-1.5 rounded-sm border border-hairline px-1 text-fine text-error">
                      {t("perm.badgeDeparted")}
                    </span>
                  )}
                  {ownerPending && (
                    <span
                      data-id="map-owner-pending"
                      className="ml-1.5 rounded-sm border border-changed/40 bg-changed/10 px-1 text-fine text-changed"
                    >
                      {t("map.ownerPending")}
                    </span>
                  )}
                </span>
              </span>
            </div>

            {/* 업데이트 시각 — 맨 아래 / updated time at the very bottom */}
            <div className="mt-2 flex items-center gap-1.5 text-fine text-ink-tertiary">
              <Clock size={12} strokeWidth={1.5} className="shrink-0" />
              {relativeTime(map.updated_at)}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
