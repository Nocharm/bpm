"use client";

// 선택된 맵 상세 — 가시성·역할·버전(승인 상태)·허용 인원. 홈 우측 패널 + 에디터 인스펙터 빈 상태 공용 /
// Map detail: visibility, role, versions (approval status), allowed members.
// 데이터는 getMap(+editor+면 listMapPermissions/listGroups). 선택 변경 시 key로 remount.

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Building2, Copy, Settings, Trash2, User, Users } from "lucide-react";

import {
  getMap,
  listGroups,
  listMapPermissions,
  type MapDetail,
  type MapPermission,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { VersionTimeline } from "@/components/maps/version-timeline";
import { RoleBadge } from "@/components/permissions/role-badge";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { MapRole } from "@/lib/mock/permissions";
import { visibilityPillClass } from "@/lib/version-status";

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

// 부서 org_path("A/B/C")의 말단 세그먼트만 / leaf segment of a dept org_path (HM-3).
function deptLeaf(orgPath: string): string {
  const parts = orgPath.split("/");
  return parts[parts.length - 1] || orgPath;
}

// 조직 레벨 순위(낮을수록 위): 센터 > 담당(Department) > 팀 > 그룹 > 파트. 이름 접미사로 판별(KO/EN). (HM-3)
function deptLevelRank(leaf: string): number {
  const s = leaf.toLowerCase();
  if (s.includes("센터") || s.includes("center")) return 0;
  if (s.includes("팀") || s.includes("team")) return 2;
  if (s.includes("그룹") || s.includes("group")) return 3;
  if (s.includes("파트") || s.includes("part")) return 4;
  return 1; // 담당(Department) / 그 외 기본
}

interface MapDetailCardProps {
  mapId: number;
  // 하단 버튼바(열기·설정·삭제) 표시 — 홈=true, 에디터 인스펙터=false / footer toggle.
  showFooter?: boolean;
  onDelete?: (mapId: number) => void;
  // 승인본 복사 — 홈이 이름 입력 모달·생성·강조를 처리 (F12). 없으면 복사 버튼 미노출.
  onCopy?: (mapId: number, name: string) => void;
}

export function MapDetailCard({
  mapId,
  showFooter = true,
  onDelete,
  onCopy,
}: MapDetailCardProps) {
  const { t } = useI18n();
  const me = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const loginId = me?.loginId ?? null;
  const orgPath = me?.orgPath ?? "";
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 허용 인원 — my_role이 editor+ 일 때만 조회(서버 게이트와 동일) / members, editor+ only.
  const [members, setMembers] = useState<MapPermission[] | null>(null);
  // 내가 속한 그룹 id(문자열) — 멤버 하이라이트용 / my group ids for the "mine" highlight.
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  // 삭제 확인 다이얼로그 표시 여부 / delete confirm dialog visibility.
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // 나의 소속(직접 user / 내 그룹 / 내 부서) 여부 — 하이라이트 / is this grant "mine"?
  // 부서: org_path 정확일치 또는 prefix("…/") 경계 (belongs_to_department 규약, HM-2).
  const isMine = (perm: MapPermission): boolean =>
    (perm.principal_type === "user" && perm.principal_id === loginId) ||
    (perm.principal_type === "group" && myGroupIds.has(perm.principal_id)) ||
    (perm.principal_type === "department" &&
      orgPath !== "" &&
      (orgPath === perm.principal_id || orgPath.startsWith(`${perm.principal_id}/`)));

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-body-strong text-ink">{detail.name}</h2>
        <Link
          href={`/maps/${detail.id}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus"
        >
          <ArrowUpRight size={14} strokeWidth={1.5} />
          {t("home.open")}
        </Link>
      </div>

      <div
        data-id="map-detail-description"
        className="rounded-sm border border-hairline bg-surface p-3 text-caption text-ink"
      >
        {detail.description ? (
          detail.description
        ) : (
          <span className="text-ink-tertiary">{t("home.descEmpty")}</span>
        )}
      </div>

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
        <div data-id="map-detail-versions" className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <p className="text-fine uppercase tracking-wide text-ink-tertiary">
            {t("home.versions")}
          </p>
          {detail.versions.length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("perm.version.noVersions")}</p>
          ) : (
            <VersionTimeline versions={detail.versions} />
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
                  const unsorted = members.filter((m) => m.principal_type === g.type);
                  if (unsorted.length === 0) return null;
                  // 부서는 레벨 순(센터>담당>팀>그룹>파트)으로 정렬 (HM-3)
                  const rows =
                    g.type === "department"
                      ? [...unsorted].sort(
                          (a, b) =>
                            deptLevelRank(deptLeaf(a.principal_id)) -
                            deptLevelRank(deptLeaf(b.principal_id)),
                        )
                      : unsorted;
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
                            {/* 부서는 말단 조직만 표시 (HM-3) */}
                            <span className="truncate">
                              {perm.principal_type === "department"
                                ? deptLeaf(perm.principal_id)
                                : perm.principal_id}
                            </span>
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

  // 승인본(approved/published)이 있어야 복사 가능 — 없으면 버튼 숨김(백엔드 409 회피) /
  // Copy needs an approved/published version; hide otherwise (avoids backend 409).
  const hasApprovedVersion = detail.versions.some(
    (v) => v.status === "approved" || v.status === "published",
  );

  // 홈 우측 패널 — 내부 스크롤 + 하단 고정 버튼바 / home: internal scroll + pinned footer.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{body}</div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline p-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/maps/${detail.id}/settings`}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
          >
            <Settings size={14} strokeWidth={1.5} />
            {t("perm.settingsTitle")}
          </Link>
          {hasApprovedVersion && onCopy && (
            <button
              type="button"
              data-id="map-detail-copy"
              className="flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
              onClick={() => onCopy(detail.id, detail.name)}
            >
              <Copy size={14} strokeWidth={1.5} />
              {t("home.copyFromApproved")}
            </button>
          )}
        </div>
        {isOwner && onDelete && (
          <button
            type="button"
            data-id="map-detail-delete"
            className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-caption text-error hover:bg-surface"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {t("home.delete")}
          </button>
        )}
      </div>
      {confirmDelete && onDelete && (
        <ConfirmDialog
          title={t("home.confirmDeleteTitle")}
          message={t("home.confirmDeleteMessage")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(detail.id);
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
