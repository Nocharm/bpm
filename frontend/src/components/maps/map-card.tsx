"use client";

// 홈 프로세스맵 카드 — 이름·메타 한 줄(가시성·역할·허용 인원 드롭다운) + 호버 시 더보기/삭제 /
// Home process-map card: name, a small meta line (visibility · role · allowed-members
// dropdown), and hover-revealed More/Delete actions.

import Link from "next/link";
import { useCallback, useState } from "react";
import { Building2, ChevronDown, MoreHorizontal, Trash2, User, Users } from "lucide-react";

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
      {/* 호버 시 액션 — 더보기 + (owner)삭제 / Hover actions: More + (owner) Delete */}
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
        <Link
          href={`/maps/${map.id}/settings`}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-caption text-ink-tertiary hover:bg-surface hover:text-ink"
          aria-label={t("home.more")}
          title={t("home.more")}
        >
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </Link>
        {isOwner && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-caption text-error hover:bg-surface"
            aria-label={t("home.delete")}
            title={t("home.delete")}
            onClick={() => onDelete(map.id)}
          >
            <Trash2 size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>

      <Link href={`/maps/${map.id}`} className="text-body-strong text-ink hover:underline">
        {map.name}
      </Link>
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
              onClick={toggleMembers}
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
