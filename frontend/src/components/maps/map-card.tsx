"use client";

// 홈 프로세스맵 카드 — 클릭=선택(우측 상세). 타이틀은 더 이상 에디터로 직행하지 않음(열기는 상세에서) /
// Home map card: click selects it (detail panel). The title no longer navigates — open from detail.
// 카드 자체 액션은 삭제(owner)만. 가시성·역할·허용 인원은 메타 한 줄.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronDown, ExternalLink, User, Users } from "lucide-react";

import { listMapPermissions, type MapPermission, type MapSummary } from "@/lib/api";
import { Highlight } from "@/components/highlight";
import { RoleBadge } from "@/components/permissions/role-badge";
import { useI18n } from "@/lib/i18n";
import type { MapRole } from "@/lib/mock/permissions";
import type { MatchRange } from "@/lib/search";
import {
  VERSION_STATUS_LABEL,
  VERSION_STATUS_STYLE,
  visibilityPillClass,
} from "@/lib/version-status";

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
  const rootRef = useRef<HTMLDivElement>(null);

  // 강조되면 화면으로 스크롤 (복사 직후 새 카드로 이동)
  useEffect(() => {
    if (highlighted) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  // 인원 목록 조회는 서버에서 editor+ 게이트 — viewer 카드엔 버튼 미노출 / list-permissions is editor+ gated.
  const canViewMembers = map.my_role === "editor" || map.my_role === "owner";

  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<MapPermission[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  // 멤버 팝오버는 body 포털(fixed)로 — 리스트 overflow에 잘리거나 z-index에 가리지 않게.
  const membersBtnRef = useRef<HTMLButtonElement>(null);
  const [membersPos, setMembersPos] = useState<{ left: number; bottom: number } | null>(null);

  // 스크롤/리사이즈 시 위치가 어긋나므로 닫음
  useEffect(() => {
    if (!membersOpen) return;
    const close = () => setMembersOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [membersOpen]);

  const toggleMembers = () => {
    if (membersOpen) {
      setMembersOpen(false);
      return;
    }
    const rect = membersBtnRef.current?.getBoundingClientRect();
    if (rect) {
      // 버튼 오른쪽 위로 펼침 — right 정렬(left=rect.right + translateX -100%), bottom=버튼 위.
      setMembersPos({ left: rect.right, bottom: window.innerHeight - rect.top + 4 });
    }
    setMembersOpen(true);
    if (members === null) {
      void listMapPermissions(map.id)
        .then((rows) => setMembers(rows))
        .catch((err) => setMembersError(err instanceof Error ? err.message : String(err)));
    }
  };

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
      onClick={() => onSelect?.(map.id)}
    >
      {/* 호버 시 새 탭으로 열기 / Hover: open in a new tab */}
      <a
        data-id="map-card-open-newtab"
        href={`/maps/${map.id}`}
        target="_blank"
        rel="noopener"
        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-caption text-ink-tertiary opacity-0 transition-opacity duration-150 hover:bg-surface hover:text-ink group-hover:opacity-100 focus-within:opacity-100"
        aria-label={t("home.openNewWindow")}
        title={t("home.openNewWindow")}
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink size={16} strokeWidth={1.5} />
      </a>

      {/* 타이틀 + 최신 버전 상태(이름 바로 우측) — 타이틀 텍스트로만 열림(히트박스 축소) */}
      <div className="flex items-center gap-2 pr-6">
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

      {/* 메타 한 줄 — 좌: 가시성·역할 / 우: 승인멤버 (구 상태필 자리) */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-fine text-ink-tertiary">
          {/* 공개 범위 — public/private 색 구분 / visibility pill, colored */}
          <span className={`rounded-sm border px-1.5 py-0.5 ${visibilityPillClass(map.visibility)}`}>
            {t(map.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
          </span>
          {map.my_role && <RoleBadge role={map.my_role as MapRole} />}
        </div>

        {canViewMembers && (
          <div className="shrink-0">
            <button
              ref={membersBtnRef}
              type="button"
              data-id="map-card-members"
              className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-fine text-ink-tertiary hover:bg-surface hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                toggleMembers();
              }}
            >
              <Users size={12} strokeWidth={1.5} />
              {t("home.viewMembers")}
              <ChevronDown
                size={12}
                strokeWidth={1.5}
                className={membersOpen ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </button>

            {membersOpen &&
              membersPos &&
              createPortal(
                <>
                  {/* 바깥 클릭 닫기 / click-away */}
                  <div
                    className="fixed inset-0 z-[1200]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMembersOpen(false);
                    }}
                  />
                  {/* body 포털(fixed) — 리스트 overflow/z-index 무관하게 항상 보임 */}
                  <div
                    className="fixed z-[1201] max-h-64 w-64 -translate-x-full overflow-y-auto rounded-md border border-hairline bg-surface py-1 shadow-lg"
                    style={{ left: membersPos.left, bottom: membersPos.bottom }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {membersError ? (
                      <p className="px-3 py-1.5 text-fine text-error">{membersError}</p>
                    ) : members === null ? (
                      <p className="px-3 py-1.5 text-fine text-ink-tertiary">…</p>
                    ) : members.length === 0 ? (
                      <p className="px-3 py-1.5 text-fine text-ink-tertiary">{t("home.membersEmpty")}</p>
                    ) : (
                      members.map((perm) => (
                        <div
                          key={perm.id}
                          className="flex items-center justify-between gap-2 px-3 py-1.5"
                        >
                          <span className="flex min-w-0 items-center gap-1.5 text-fine text-ink">
                            <PrincipalIcon type={perm.principal_type} />
                            <span className="truncate">{perm.principal_id}</span>
                          </span>
                          <RoleBadge role={perm.role as MapRole} />
                        </div>
                      ))
                    )}
                  </div>
                </>,
                document.body,
              )}
          </div>
        )}
      </div>
    </div>
  );
}
