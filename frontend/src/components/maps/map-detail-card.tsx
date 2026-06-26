"use client";

// 선택된 맵 상세 — 가시성·역할·버전(승인 상태)·허용 인원. 홈 우측 패널 + 에디터 인스펙터 빈 상태 공용 /
// Map detail: visibility, role, versions (approval status), allowed members.
// 데이터는 getMap(+editor+면 listMapPermissions/listGroups). 선택 변경 시 key로 remount.

import Link from "next/link";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  Boxes,
  Building2,
  Copy,
  Hand,
  Landmark,
  Settings,
  Trash2,
  User,
  Users,
  UsersRound,
} from "lucide-react";

import {
  getDirectory,
  getMap,
  listGroups,
  listMapPermissions,
  type MapDetail,
  type MapPermission,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { DeleteMapDialog } from "@/components/maps/delete-map-dialog";
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

// 조직 레벨별 아이콘 — 센터/담당/팀/그룹/파트 (deptLevelRank 순서) (HM)
const LEVEL_ICONS = [Landmark, Building2, Users, UsersRound, Boxes];

// 멤버 행 아이콘 — 부서는 레벨별, 그룹은 UsersRound, 유저는 User(본인이면 'me' 배지) (HM)
function MemberIcon({ perm, isMe }: { perm: MapPermission; isMe: boolean }) {
  if (perm.principal_type === "user") {
    if (isMe) {
      // 본인 — 손든 사람 아이콘 + 작은 ME, 악센트 선색으로 강조(아이콘과 동급 크기)
      return (
        <span
          data-id="member-me-badge"
          title="me"
          className="inline-flex shrink-0 items-center gap-px text-accent"
        >
          <Hand size={13} strokeWidth={2} />
          <span className="text-[7px] font-bold leading-none">ME</span>
        </span>
      );
    }
    return <User size={12} strokeWidth={1.5} />;
  }
  if (perm.principal_type === "group") return <UsersRound size={12} strokeWidth={1.5} />;
  const Icon = LEVEL_ICONS[deptLevelRank(deptLeaf(perm.principal_id))] ?? Building2;
  return <Icon size={12} strokeWidth={1.5} />;
}

interface MapDetailCardProps {
  mapId: number;
  // 하단 버튼바(열기·설정·삭제) 표시 — 홈=true, 에디터 인스펙터=false / footer toggle.
  showFooter?: boolean;
  // 헤더 Open 버튼 숨김 — 에디터에선 이미 그 맵을 보고 있어 무의미 (#6).
  hideOpen?: boolean;
  onDelete?: (mapId: number) => void;
  // 승인본 복사 — 홈이 이름 입력 모달·생성·강조를 처리 (F12). 없으면 복사 버튼 미노출.
  onCopy?: (mapId: number, name: string) => void;
}

export function MapDetailCard({
  mapId,
  showFooter = true,
  hideOpen = false,
  onDelete,
  onCopy,
}: MapDetailCardProps) {
  const { t } = useI18n();
  const me = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const loginId = me?.loginId ?? null;
  const orgPath = me?.orgPath ?? "";
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 허용 인원 — 접근 권한자(viewer+)면 조회. 서버 GET /permissions 게이트도 viewer+ (B1) / members for any role with access.
  const [members, setMembers] = useState<MapPermission[] | null>(null);
  // 내가 속한 그룹 id(문자열) — 멤버 하이라이트용 / my group ids for the "mine" highlight.
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  // loginId → 표시명 — 멤버(유저) 행을 "이름(아이디)"로 보여주기 위함 (#5)
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  // 디렉터리 파생 — 멤버 2번째 줄(유저 직급·말단org, 부서 카운트) (H2) / directory-derived maps for the 2nd line.
  const [titleById, setTitleById] = useState<Map<string, string>>(new Map());
  const [orgPathById, setOrgPathById] = useState<Map<string, string>>(new Map());
  // 그룹 id → {구성원수, 상태} — 그룹 멤버 2번째 줄 (H2) / group id → {count, status}.
  const [groupInfo, setGroupInfo] = useState<Map<string, { count: number; status: string }>>(new Map());
  // 호버한 부서(팀)의 org_path — 상위/하위 팀 하이라이트 + 상위 소속 노출 (H2) / hovered dept path.
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  // 삭제 확인 다이얼로그 표시 여부 / delete confirm dialog visibility.
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 펼친 버전·멤버 — 클릭 토글, 여러 개 동시 / expanded version & member ids (click-toggle).
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const toggleVersion = (id: number) =>
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleMember = (id: string) =>
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const collapseVersions = () => setExpandedVersions(new Set());
  const collapseMembers = () => setExpandedMembers(new Set());

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then(async (d) => {
        if (!active) return;
        setDetail(d);
        if (d.my_role !== null) {
          try {
            const [perms, groups, dir] = await Promise.all([
              listMapPermissions(mapId),
              listGroups(),
              getDirectory(),
            ]);
            if (!active) return;
            setMembers(perms);
            setNameById(new Map(dir.users.map((u) => [u.id, u.name])));
            setTitleById(new Map(dir.users.map((u) => [u.id, u.title ?? ""])));
            setOrgPathById(new Map(dir.users.map((u) => [u.id, u.org_path ?? ""])));
            setGroupInfo(
              new Map(groups.map((g) => [String(g.id), { count: g.members.length, status: g.status }])),
            );
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
        {!hideOpen && (
          <Link
            href={`/maps/${detail.id}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus"
          >
            <ArrowUpRight size={14} strokeWidth={1.5} />
            {t("home.open")}
          </Link>
        )}
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

      {/* 버전 · 허용 인원 — 좌우 배치(2:1) + 사이 세로 구분선 / Versions:members = 2:1 with a vertical divider */}
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* 버전 + 승인 상태 / Versions with approval status */}
        <div data-id="map-detail-versions" className="flex min-w-0 flex-[2] flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-fine uppercase tracking-wide text-ink-tertiary">{t("home.versions")}</p>
            {expandedVersions.size > 0 && (
              <button
                type="button"
                data-id="collapse-versions"
                className="shrink-0 text-fine text-accent hover:underline"
                onClick={collapseVersions}
              >
                {t("home.collapseAll")}
              </button>
            )}
          </div>
          {detail.versions.length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("perm.version.noVersions")}</p>
          ) : (
            <VersionTimeline
              versions={detail.versions}
              nameById={nameById}
              expandedIds={expandedVersions}
              onToggle={toggleVersion}
            />
          )}
        </div>

        {/* 허용 인원 (editor+ only) — 개인 → 팀 → 유저 그룹 순, 그룹 사이 스페이서, 내 소속 하이라이트 */}
        {members !== null && (
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:border-l sm:border-hairline sm:pl-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-fine uppercase tracking-wide text-ink-tertiary">{t("home.members")}</p>
              {expandedMembers.size > 0 && (
                <button
                  type="button"
                  data-id="collapse-members"
                  className="shrink-0 text-fine text-accent hover:underline"
                  onClick={collapseMembers}
                >
                  {t("home.collapseAll")}
                </button>
              )}
            </div>
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
                      {rows.map((perm) => {
                        // 호버한 팀의 상위/하위 팀이면 하이라이트 (멤버수 중복 인지) (H2)
                        const related =
                          hoveredPath !== null &&
                          perm.principal_type === "department" &&
                          perm.principal_id !== hoveredPath &&
                          (hoveredPath.startsWith(`${perm.principal_id}/`) ||
                            perm.principal_id.startsWith(`${hoveredPath}/`));
                        // 유저 펼침 — 클릭 토글(여러 개 동시) (H2c)
                        const memberOpen =
                          perm.principal_type === "user" && expandedMembers.has(perm.principal_id);
                        // 행 내용 — 유저=이름/부서(클릭 시 아이디·타이틀·부서레벨 펼침) · 부서=말단/구성원수(호버 시 상위) · 그룹=id/구성원수·상태 (H2c)
                        let nameLine: ReactNode;
                        let restNode: ReactNode = null;
                        if (perm.principal_type === "user") {
                          nameLine = nameById.get(perm.principal_id) ?? perm.principal_id;
                          const path = orgPathById.get(perm.principal_id) ?? "";
                          const leaf = deptLeaf(path);
                          const title = titleById.get(perm.principal_id) ?? "";
                          const levels = path.split("/").filter(Boolean).reverse(); // 작은→큰 / leaf→root
                          restNode = (
                            <>
                              {/* 평소: 말단 부서 (펼치면 숨김) */}
                              {leaf && !memberOpen && (
                                <span className="block truncate text-fine text-ink-tertiary">{leaf}</span>
                              )}
                              {/* 펼침: 아이디·타이틀·부서 레벨(작은→큰)을 필로 — 괄호 없이 (H2c) */}
                              <span
                                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                                  memberOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                                }`}
                              >
                                <span className="overflow-hidden">
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    <span className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
                                      {perm.principal_id}
                                    </span>
                                    {title && (
                                      <span className="rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
                                        {title}
                                      </span>
                                    )}
                                    {levels.map((lv) => (
                                      <span
                                        key={lv}
                                        className="rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary"
                                      >
                                        {lv}
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              </span>
                            </>
                          );
                        } else if (perm.principal_type === "group") {
                          nameLine = perm.principal_id;
                          const g = groupInfo.get(perm.principal_id);
                          if (g) {
                            const status = t(
                              g.status === "pending"
                                ? "home.groupPending"
                                : g.status === "rejected"
                                  ? "home.groupRejected"
                                  : "home.groupActive",
                            );
                            restNode = (
                              <span className="flex min-w-0 items-center gap-1 text-fine text-ink-tertiary">
                                <Users size={11} strokeWidth={1.5} className="shrink-0" />
                                {g.count}
                                <span className="truncate">· {status}</span>
                              </span>
                            );
                          }
                        } else {
                          nameLine = deptLeaf(perm.principal_id);
                          const count = [...orgPathById.values()].filter(
                            (p) => p === perm.principal_id || p.startsWith(`${perm.principal_id}/`),
                          ).length;
                          const parts = perm.principal_id.split("/").filter(Boolean);
                          const parent = parts.length > 1 ? parts.slice(0, -1).join(" › ") : (parts[0] ?? "");
                          restNode = (
                            <span className="flex min-w-0 items-center gap-1 text-fine text-ink-tertiary">
                              <Users size={11} strokeWidth={1.5} className="shrink-0" />
                              {count}
                              {parent && <span className="hidden truncate group-hover:inline">· {parent}</span>}
                            </span>
                          );
                        }
                        return (
                          <div
                            key={perm.id}
                            role={perm.principal_type === "user" ? "button" : undefined}
                            tabIndex={perm.principal_type === "user" ? 0 : undefined}
                            onClick={
                              perm.principal_type === "user"
                                ? () => toggleMember(perm.principal_id)
                                : undefined
                            }
                            onKeyDown={
                              perm.principal_type === "user"
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      toggleMember(perm.principal_id);
                                    }
                                  }
                                : undefined
                            }
                            onMouseEnter={
                              perm.principal_type === "department"
                                ? () => setHoveredPath(perm.principal_id)
                                : undefined
                            }
                            onMouseLeave={
                              perm.principal_type === "department"
                                ? () => setHoveredPath(null)
                                : undefined
                            }
                            // 유저 행=클릭 토글(펼침) · 부서=호버(상위/관련 팀) (H2c/H2)
                            className={`group flex items-start justify-between gap-2 rounded-sm border px-2.5 py-1.5 transition-colors ${
                              perm.principal_type === "user"
                                ? "cursor-pointer hover:ring-1 hover:ring-accent-tint-border"
                                : ""
                            } ${
                              isMine(perm)
                                ? "border-accent bg-accent/10"
                                : related
                                  ? "border-accent-tint-border bg-accent-tint/40"
                                  : "border-hairline bg-surface"
                            }`}
                          >
                            <span className="flex min-w-0 items-start gap-1.5 text-caption text-ink">
                              <span className="mt-0.5 shrink-0">
                                <MemberIcon
                                  perm={perm}
                                  isMe={perm.principal_type === "user" && perm.principal_id === loginId}
                                />
                              </span>
                              {/* 1줄: 이름/말단/그룹 · 이하: 부서/펼침 (H2c) */}
                              <span className="flex min-w-0 flex-col leading-tight">
                                <span className="truncate">{nameLine}</span>
                                {restNode}
                              </span>
                            </span>
                            <RoleBadge role={perm.role as MapRole} />
                          </div>
                        );
                      })}
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
        <DeleteMapDialog
          mapName={detail.name}
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
