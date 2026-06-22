"use client";

// 홈 프로세스맵 카드 — 클릭=선택(우측 상세). 타이틀은 더 이상 에디터로 직행하지 않음(열기는 상세에서) /
// Home map card: click selects it (detail panel). The title no longer navigates — open from detail.
// 카드 자체 액션은 삭제(owner)만. 가시성·역할·허용 인원은 메타 한 줄.

import { useCallback, useState } from "react";
import { Building2, ChevronDown, Trash2, User, Users } from "lucide-react";

import { listMapPermissions, type MapPermission, type MapSummary } from "@/lib/api";
import { RoleBadge } from "@/components/permissions/role-badge";
import { useI18n } from "@/lib/i18n";
import type { MapRole } from "@/lib/mock/permissions";

interface MapCardProps {
  map: MapSummary;
  onDelete: (mapId: number) => void;
  // 마스터-디테일 선택 — 클릭 시 우측 상세 패널 대상 / select for the detail panel.
  selected?: boolean;
  onSelect?: (mapId: number) => void;
}

// principal_type → 아이콘 / principal icon.
function PrincipalIcon({ type }: { type: string }) {
  if (type === "department") return <Building2 size={12} strokeWidth={1.5} />;
  if (type === "group") return <Users size={12} strokeWidth={1.5} />;
  return <User size={12} strokeWidth={1.5} />;
}

export function MapCard({ map, onDelete, selected = false, onSelect }: MapCardProps) {
  const { t } = useI18n();

  const isOwner = map.my_role === "owner";
  // 인원 목록 조회는 서버에서 editor+ 게이트 — viewer 카드엔 버튼 미노출 / list-permissions is editor+ gated.
  const canViewMembers = map.my_role === "editor" || map.my_role === "owner";

  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<MapPermission[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);

  const toggleMembers = useCallback(() => {
    setMembersOpen((open) => {
      const next = !open;
      // 처음 열 때만 lazy fetch / lazy-fetch on first open.
      if (next && members === null) {
        void listMapPermissions(map.id)
          .then((rows) => setMembers(rows))
          .catch((err) =>
            setMembersError(err instanceof Error ? err.message : String(err)),
          );
      }
      return next;
    });
  }, [map.id, members]);

  return (
    <li
      className={`group relative rounded-sm border bg-surface p-4 hover:bg-surface-alt ${
        selected ? "border-accent ring-1 ring-accent" : "border-hairline"
      }`}
      onClick={() => onSelect?.(map.id)}
    >
      {/* 호버 시 삭제(owner) — 열기/설정은 상세 패널로 이동 / Hover delete (owner); open/settings live in detail */}
      {isOwner && (
        <div className="absolute right-3 top-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-caption text-error hover:bg-surface"
            aria-label={t("home.delete")}
            title={t("home.delete")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(map.id);
            }}
          >
            <Trash2 size={16} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <span className="block truncate pr-6 text-body-strong text-ink">{map.name}</span>
      {map.description && (
        <p className="mt-0.5 line-clamp-1 text-caption text-ink-tertiary">{map.description}</p>
      )}

      {/* 메타 한 줄 (왼쪽 아래) / Small meta line, bottom-left */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-fine text-ink-tertiary">
        <span className="rounded-sm border border-hairline px-1.5 py-0.5">
          {t(map.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
        </span>
        {map.my_role && <RoleBadge role={map.my_role as MapRole} />}

        {canViewMembers && (
          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-surface hover:text-ink"
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

            {membersOpen && (
              <>
                {/* 바깥 클릭 닫기 / click-away */}
                <div className="fixed inset-0 z-[1000]" onClick={() => setMembersOpen(false)} />
                <div className="absolute left-0 z-[1001] mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-hairline bg-surface py-1 shadow-lg">
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
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
