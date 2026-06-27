"use client";

// 홈 프로세스맵 카드 — 클릭=선택(우측 상세). 타이틀은 더 이상 에디터로 직행하지 않음(열기는 상세에서) /
// Home map card: click selects it (detail panel). The title no longer navigates — open from detail.
// 카드 자체 액션은 삭제(owner)만. 가시성·역할·허용 인원은 메타 한 줄.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Clock, GitBranch, Globe, Lock, User, Users, Workflow } from "lucide-react";

import { listMapPermissions, type MapPermission, type MapSummary } from "@/lib/api";
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
}

// principal_type → 아이콘 / principal icon.
function PrincipalIcon({ type }: { type: string }) {
  if (type === "department") return <Building2 size={12} strokeWidth={1.5} />;
  if (type === "group") return <Users size={12} strokeWidth={1.5} />;
  return <User size={12} strokeWidth={1.5} />;
}

export function MapCard({
  map,
  selected = false,
  onSelect,
  nameRanges,
  highlighted = false,
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

  // 카드 호버 모달 — 모든 카드 1초 호버 시 우측에 요약+인원 모달. 카드/모달 벗어나면 닫힘 (요청 간소화)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPos, setModalPos] = useState<{ left: number; top: number } | null>(null);
  const [members, setMembers] = useState<MapPermission[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOpen = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const clearClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // 카드 진입 → 1초 뒤 모달 열기(위치 계산·인원 fetch). 모달 진입 시에도 호출되어 닫힘 취소.
  const onCardEnter = () => {
    clearClose();
    if (modalOpen) return;
    openTimer.current = setTimeout(() => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setModalPos({ left: rect.right + 8, top: rect.top });
      setModalOpen(true);
      if (canViewMembers && members === null) {
        void listMapPermissions(map.id)
          .then((rows) => setMembers(rows))
          .catch((err) => setMembersError(err instanceof Error ? err.message : String(err)));
      }
    }, 1000);
  };
  // 카드/모달 이탈 → 150ms 뒤 닫기(카드↔모달 이동 허용). 재진입 시 clearClose로 취소.
  const scheduleClose = () => {
    clearOpen();
    clearClose();
    closeTimer.current = setTimeout(() => setModalOpen(false), 150);
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

  // 언마운트 시 대기 타이머 정리 — 사라진 컴포넌트가 setState 호출하지 않게
  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

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
      onClick={() => {
        // 클릭(선택) 시 대기 중 1초 타이머 취소 + 모달 닫기 — 클릭 후 모달이 뒤늦게 뜨거나 가리지 않게
        clearOpen();
        clearClose();
        setModalOpen(false);
        onSelect?.(map.id);
      }}
      onMouseEnter={onCardEnter}
      onMouseLeave={scheduleClose}
    >
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
            className="fixed z-[1201] w-64 rounded-md border border-hairline bg-surface p-3 text-fine shadow-lg"
            style={{ left: modalPos.left, top: modalPos.top }}
            onMouseEnter={clearClose}
            onMouseLeave={scheduleClose}
          >
            <p className="mb-2 truncate text-caption-strong text-ink">{map.name}</p>
            <ul className="flex flex-col gap-1.5 text-ink-secondary">
              <li className="flex items-center gap-2">
                {map.visibility === "public" ? (
                  <Globe size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
                ) : (
                  <Lock size={13} strokeWidth={1.5} className="shrink-0" />
                )}
                {t(map.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
              </li>
              <li className="flex items-center gap-2">
                <Workflow size={13} strokeWidth={1.5} className="shrink-0" />
                {t("home.nodeCount")} — {map.node_count ?? 0}
              </li>
              <li className="flex items-center gap-2">
                <GitBranch size={13} strokeWidth={1.5} className="shrink-0" />
                {t("home.versionCount")} — {map.version_count ?? 0}
              </li>
              <li className="flex items-center gap-2">
                <Users size={13} strokeWidth={1.5} className="shrink-0" />
                {t("home.viewMembers")} — {map.member_count ?? 0}
              </li>
              <li className="flex min-w-0 items-center gap-2">
                <User size={13} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">
                  {map.owner_name ?? map.created_by} · {relativeTime(map.updated_at)}
                </span>
              </li>
            </ul>
            {canViewMembers && (
              <div className="mt-2 max-h-40 overflow-y-auto border-t border-hairline pt-2">
                {membersError ? (
                  <p className="text-fine text-error">{membersError}</p>
                ) : members === null ? (
                  <p className="text-fine text-ink-tertiary">…</p>
                ) : members.length === 0 ? (
                  <p className="text-fine text-ink-tertiary">{t("home.membersEmpty")}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {members.map((perm) => (
                      <li key={perm.id} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-ink">
                          <PrincipalIcon type={perm.principal_type} />
                          <span className="truncate">{perm.principal_id}</span>
                        </span>
                        <RoleBadge role={perm.role as MapRole} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
