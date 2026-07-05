"use client";

// 홈 프로세스맵 카드 — 클릭=선택(우측 상세). 타이틀은 더 이상 에디터로 직행하지 않음(열기는 상세에서) /
// Home map card: click selects it (detail panel). The title no longer navigates — open from detail.
// 카드 자체 액션은 삭제(owner)만. 가시성·역할·허용 인원은 메타 한 줄.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, GitBranch, Globe, Lock, User, Users, Workflow } from "lucide-react";

import { type MapSummary } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { Highlight } from "@/components/highlight";
import { RoleBadge } from "@/components/permissions/role-badge";
import { useI18n } from "@/lib/i18n";
import type { MapRole } from "@/lib/mock/permissions";
import type { MatchRange } from "@/lib/search";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

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

  // 인원 목록은 접근 권한자(viewer+)면 조회 가능 — 서버 GET /permissions 게이트가 viewer+ (B1) / members button for any role with access.
  const canViewMembers = map.my_role !== null;
  // 역할 배지는 공개+뷰어면 생략(공개맵은 누구나 뷰어라 무의미) — 에디터/오너 또는 비공개일 때만 (요청)
  const showRole = map.my_role !== null && !(map.visibility === "public" && map.my_role === "viewer");

  // 카드 호버 모달 — 모든 카드 1초 호버 시 우측에 요약+인원(읽기 전용). 카드를 벗어나면 닫힘.
  // 모달은 pointer-events-none(통과) → 디테일 패널/다른 카드 호버를 가리지 않음(호버가 마우스를 따라감).
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPos, setModalPos] = useState<{ left: number; top: number } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeModal = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    setModalOpen(false);
  };
  const onCardEnter = () => {
    if (openTimer.current || modalOpen) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setModalPos({ left: rect.right + 8, top: rect.top });
      setModalOpen(true);
    }, 1000);
  };

  // 스크롤/리사이즈 시 위치가 어긋나므로 닫음
  useEffect(() => {
    if (!modalOpen) return;
    const close = () => setModalOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [modalOpen]);

  // 언마운트 시 대기 타이머 정리
  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      data-id="map-card"
      className={`group relative cursor-pointer select-none rounded-sm border bg-surface p-4 hover:bg-surface-alt ${
        highlighted
          ? "animate-pulse border-accent ring-2 ring-accent"
          : selected
            ? "border-accent ring-1 ring-accent"
            : "border-hairline"
      }`}
      onClick={(e) => {
        e.stopPropagation(); // 카드 선택은 배경(선택 해제)으로 버블링 방지
        closeModal(); // 클릭(선택) 시 대기 타이머 취소 + 모달 닫기
        onSelect?.(map.id);
      }}
      onMouseEnter={onCardEnter}
      onMouseLeave={closeModal}
    >
      {/* 최근 접속 배지 — 플로팅 텍스트(배경 없음, 상단·좌측 근접, 타이틀과 비겹침). 밴드·검색 pinned에만 전달됨 */}
      {recentOpenedAt !== undefined && (
        <div
          data-id="map-card-recent-badge"
          className="absolute left-2 top-1 z-10 inline-flex items-center gap-0.5 text-[11px] leading-none text-accent"
        >
          <Clock size={11} strokeWidth={1.5} />
          {t("home.recentBadge")} · {relativeTime(new Date(recentOpenedAt).toISOString())}
        </div>
      )}
      {/* 1줄 — 좌: 타이틀+상태 / 우: 역할 배지 + 공개/비공개 아이콘 (역할은 공개+뷰어면 생략) */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            data-id="map-card-name"
            href={`/maps/${map.id}`}
            className="min-w-0 truncate text-body-strong text-ink hover:text-accent hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <Highlight text={map.name} ranges={nameRanges ?? []} />
          </Link>
          {map.latest_version_status && (
            <span
              data-id="map-card-status"
              className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine ${VERSION_STATUS_STYLE[map.latest_version_status]}`}
            >
              {t(VERSION_STATUS_LABEL[map.latest_version_status])}
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {showRole && <RoleBadge role={map.my_role as MapRole} />}
          <span
            data-id="map-card-visibility"
            className={`inline-flex items-center ${
              map.visibility === "public" ? "text-accent" : "text-ink-tertiary"
            }`}
            title={t(map.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
          >
            {map.visibility === "public" ? (
              <Globe size={16} strokeWidth={1.5} />
            ) : (
              <Lock size={16} strokeWidth={1.5} />
            )}
          </span>
        </div>
      </div>

      {/* 메타 한 줄 — 좌: 소유자·수정시각(상대) / 우: 노드·버전·인원 수 (이미지 H4/H5) */}
      <div className="relative mt-2 flex items-center justify-between gap-2 text-fine text-ink-tertiary">
        <div className="flex min-w-0 items-center gap-2">
          {(map.owner_name ?? map.created_by) && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <User size={12} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">{map.owner_name ?? map.created_by}</span>
            </span>
          )}
          <span className="inline-flex shrink-0 items-center gap-1">
            <Clock size={12} strokeWidth={1.5} />
            {relativeTime(map.updated_at)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="inline-flex items-center gap-1" title={t("home.nodeCount")}>
            <Workflow size={12} strokeWidth={1.5} />
            {map.node_count ?? 0}
          </span>
          <span className="inline-flex items-center gap-1" title={t("home.versionCount")}>
            <GitBranch size={12} strokeWidth={1.5} />
            {map.version_count ?? 0}
          </span>
          {canViewMembers && (
            <span className="inline-flex items-center gap-1" title={t("home.viewMembers")}>
              <Users size={12} strokeWidth={1.5} />
              {map.member_count ?? 0}
            </span>
          )}
        </div>
      </div>

      {/* 모든 카드 1초 호버 — 우측 요약+인원 모달. 카드/모달 벗어나면 닫힘 (요청) */}
      {modalOpen &&
        modalPos &&
        createPortal(
          <div
            data-id="map-card-hover-modal"
            className="pointer-events-none fixed z-[1201] w-64 rounded-md border border-hairline bg-surface p-3 text-fine shadow-lg"
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
              <li className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Users size={13} strokeWidth={1.5} className="shrink-0" />
                  <span className="truncate">{t("home.viewMembers")}</span>
                </span>
                <span className="inline-flex min-w-[1.5rem] shrink-0 justify-center rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                  {map.member_count ?? 0}
                </span>
              </li>
            </ul>

            {/* 오너 카드 / owner card */}
            <div className="mt-2 flex items-center gap-2 rounded-md border border-hairline bg-surface-alt px-2.5 py-1.5">
              <User size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="flex min-w-0 flex-col">
                <span className="text-fine text-ink-tertiary">{t("home.owner")}</span>
                <span className="truncate text-caption text-ink">{map.owner_name ?? map.created_by}</span>
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
