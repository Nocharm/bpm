"use client";

// 선택된 맵 상세 — 가시성·역할·버전(승인 상태)·허용 인원. 홈 우측 패널 + 에디터 인스펙터 빈 상태 공용 /
// Map detail: visibility, role, versions (approval status), allowed members.
// 데이터는 getMap(+editor+면 listMapPermissions/listGroups). 선택 변경 시 key로 remount.

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Building2, User, Users } from "lucide-react";

import {
  getMap,
  listGroups,
  listMapPermissions,
  type MapDetail,
  type MapPermission,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { RoleBadge } from "@/components/permissions/role-badge";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { MapRole } from "@/lib/mock/permissions";
import {
  VERSION_STATUS_LABEL,
  VERSION_STATUS_STYLE,
  visibilityPillClass,
} from "@/lib/version-status";

// 멤버 그룹 표시 순서 — 개인 → 팀 → 유저 그룹 / member group order: individuals, teams, user groups.
const MEMBER_GROUPS: { type: string; labelKey: MessageKey }[] = [
  { type: "user", labelKey: "home.memberUser" },
  { type: "department", labelKey: "home.memberDept" },
  { type: "group", labelKey: "home.memberGroup" },
];

// principal_type → 아이콘 / principal icon.
function PrincipalIcon({ type }: { type: string }) {
  if (type === "department") return <Building2 size={12} strokeWidth={1.5} />;
  if (type === "group") return <Users size={12} strokeWidth={1.5} />;
  return <User size={12} strokeWidth={1.5} />;
}

interface MapDetailCardProps {
  mapId: number;
  // 하단 버튼바(열기·설정·삭제) 표시 — 홈=true, 에디터 인스펙터=false / footer toggle.
  showFooter?: boolean;
  onDelete?: (mapId: number) => void;
}

export function MapDetailCard({ mapId, showFooter = true, onDelete }: MapDetailCardProps) {
  const { t } = useI18n();
  const loginId =
    useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null)?.loginId ?? null;
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 허용 인원 — my_role이 editor+ 일 때만 조회(서버 게이트와 동일) / members, editor+ only.
  const [members, setMembers] = useState<MapPermission[] | null>(null);
  // 내가 속한 그룹 id(문자열) — 멤버 하이라이트용 / my group ids for the "mine" highlight.
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then(async (d) => {
        if (!active) return;
        setDetail(d);
        if (d.my_role === "editor" || d.my_role === "owner") {
          try {
            const [perms, groups] = await Promise.all([listMapPermissions(mapId), listGroups()]);
            if (!active) return;
            setMembers(perms);
            if (loginId) {
              setMyGroupIds(
                new Set(
                  groups
                    .filter((g) =>
                      g.members.some((m) => m.member_type === "user" && m.member_id === loginId),
                    )
                    .map((g) => String(g.id)),
                ),
              );
            }
          } catch {
            // 멤버/그룹 조회 실패는 무시 — 섹션만 비표시 / ignore; section hidden.
          }
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [mapId, loginId]);

  if (error) {
    return <p className="p-4 text-caption text-error">{error}</p>;
  }
  if (!detail) {
    return <p className="p-4 text-caption text-ink-tertiary">…</p>;
  }

  const isOwner = detail.my_role === "owner";

  // 나의 소속(직접 user 그랜트 / 내가 속한 그룹) 여부 — 하이라이트 / is this grant "mine"?
  const isMine = (perm: MapPermission): boolean =>
    (perm.principal_type === "user" && perm.principal_id === loginId) ||
    (perm.principal_type === "group" && myGroupIds.has(perm.principal_id));

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-body-strong text-ink">{detail.name}</h2>
        <Link
          href={`/maps/${detail.id}`}
          className="shrink-0 rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus"
        >
          {t("home.open")}
        </Link>
      </div>

      {detail.description && (
        <p className="text-caption text-ink-tertiary">{detail.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-fine text-ink-tertiary">
        {/* 공개 범위 — public/private 색 구분 / visibility pill, colored */}
        <span className={`rounded-sm border px-1.5 py-0.5 ${visibilityPillClass(detail.visibility)}`}>
          {t(detail.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
        </span>
        {detail.my_role && <RoleBadge role={detail.my_role as MapRole} />}
      </div>

      {/* 버전 · 허용 인원 — 좌우 배치 / Versions and members side by side */}
      <div className="flex flex-wrap gap-4">
        {/* 버전 + 승인 상태 / Versions with approval status */}
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <p className="text-fine uppercase tracking-wide text-ink-tertiary">
            {t("home.versions")}
          </p>
          {detail.versions.length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("perm.version.noVersions")}</p>
          ) : (
            detail.versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-caption text-ink">{version.label}</span>
                <span
                  className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine ${VERSION_STATUS_STYLE[version.status]}`}
                >
                  {t(VERSION_STATUS_LABEL[version.status])}
                </span>
              </div>
            ))
          )}
        </div>

        {/* 허용 인원 (editor+ only) — 개인 → 팀 → 유저 그룹 순, 그룹 사이 스페이서, 내 소속 하이라이트 */}
        {members !== null && (
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <p className="text-fine uppercase tracking-wide text-ink-tertiary">
              {t("home.members")}
            </p>
            {members.length === 0 ? (
              <p className="text-caption text-ink-tertiary">{t("home.membersEmpty")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {MEMBER_GROUPS.map((g) => {
                  const rows = members.filter((m) => m.principal_type === g.type);
                  if (rows.length === 0) return null;
                  return (
                    <div key={g.type} className="flex flex-col gap-1">
                      <p className="text-fine text-ink-tertiary">{t(g.labelKey)}</p>
                      {rows.map((perm) => (
                        <div
                          key={perm.id}
                          // 나의 소속이면 투명도 조절한 악센트 배경으로 하이라이트 / highlight my grants.
                          className={`flex items-center justify-between gap-2 rounded-sm border px-2.5 py-1.5 ${
                            isMine(perm)
                              ? "border-accent bg-accent/10"
                              : "border-hairline bg-surface"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink">
                            <PrincipalIcon type={perm.principal_type} />
                            <span className="truncate">{perm.principal_id}</span>
                          </span>
                          <RoleBadge role={perm.role as MapRole} />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  // 에디터 인스펙터(footer 없음) — 부모 스크롤에 자연 배치 / embedded: flow in parent, no footer.
  if (!showFooter) {
    return <div className="flex flex-col gap-3">{body}</div>;
  }

  // 홈 우측 패널 — 내부 스크롤 + 하단 고정 버튼바 / home: internal scroll + pinned footer.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{body}</div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline p-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/maps/${detail.id}`}
            className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
          >
            {t("home.open")}
          </Link>
          <Link
            href={`/maps/${detail.id}/settings`}
            className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
          >
            {t("perm.settingsTitle")}
          </Link>
        </div>
        {isOwner && onDelete && (
          <button
            type="button"
            className="rounded-sm px-2.5 py-1 text-caption text-error hover:bg-surface"
            onClick={() => onDelete(detail.id)}
          >
            {t("home.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
