"use client";

// 선택된 맵 상세 카드 — 가시성·역할·버전(승인 상태) 요약. 홈의 마스터-디테일 우측 패널 /
// Selected-map detail card: visibility, role, and version (approval-status) summary.
// 데이터는 getMap(MapDetail.versions) 하나로 — 백엔드 추가 없음. 선택 변경 시 key로 remount.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Building2, User, Users } from "lucide-react";

import {
  getMap,
  listMapPermissions,
  type MapDetail,
  type MapPermission,
  type VersionStatus,
} from "@/lib/api";
import { RoleBadge } from "@/components/permissions/role-badge";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { MapRole } from "@/lib/mock/permissions";

const STATUS_LABEL: Record<VersionStatus, MessageKey> = {
  draft: "home.verStatus.draft",
  pending: "home.verStatus.pending",
  approved: "home.verStatus.approved",
  published: "home.verStatus.published",
  rejected: "home.verStatus.rejected",
};

// 상태별 스타일 — 토큰만(raw hex 금지) / status pill styles, tokens only.
const STATUS_STYLE: Record<VersionStatus, string> = {
  draft: "border-hairline text-ink-tertiary",
  pending: "border-changed text-changed",
  approved: "border-accent text-accent",
  published: "border-added text-added",
  rejected: "border-error text-error",
};

// principal_type → 아이콘 / principal icon.
function PrincipalIcon({ type }: { type: string }) {
  if (type === "department") return <Building2 size={12} strokeWidth={1.5} />;
  if (type === "group") return <Users size={12} strokeWidth={1.5} />;
  return <User size={12} strokeWidth={1.5} />;
}

interface MapDetailCardProps {
  mapId: number;
  onDelete: (mapId: number) => void;
}

export function MapDetailCard({ mapId, onDelete }: MapDetailCardProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 허용 인원 — my_role이 editor+ 일 때만 조회(서버 게이트와 동일) / members, editor+ only.
  const [members, setMembers] = useState<MapPermission[] | null>(null);

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then(async (d) => {
        if (!active) return;
        setDetail(d);
        if (d.my_role === "editor" || d.my_role === "owner") {
          try {
            const rows = await listMapPermissions(mapId);
            if (active) setMembers(rows);
          } catch {
            // 멤버 조회 실패(권한/네트워크)는 무시 — 섹션만 비표시 / ignore; section hidden.
          }
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  if (error) {
    return <p className="p-4 text-caption text-error">{error}</p>;
  }
  if (!detail) {
    return <p className="p-4 text-caption text-ink-tertiary">…</p>;
  }

  const isOwner = detail.my_role === "owner";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 스크롤 콘텐츠 / Scrollable content */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
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
        <span className="rounded-sm border border-hairline px-1.5 py-0.5">
          {t(detail.visibility === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
        </span>
        {detail.my_role && <RoleBadge role={detail.my_role as MapRole} />}
      </div>

      {/* 버전 + 승인 상태 / Versions with approval status */}
      <div className="flex flex-col gap-1">
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
                className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine ${STATUS_STYLE[version.status]}`}
              >
                {t(STATUS_LABEL[version.status])}
              </span>
            </div>
          ))
        )}
      </div>

      {/* 허용 인원 / Allowed members (editor+ only) */}
      {members !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-fine uppercase tracking-wide text-ink-tertiary">
            {t("home.members")}
          </p>
          {members.length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("home.membersEmpty")}</p>
          ) : (
            members.map((perm) => (
              <div
                key={perm.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink">
                  <PrincipalIcon type={perm.principal_type} />
                  <span className="truncate">{perm.principal_id}</span>
                </span>
                <RoleBadge role={perm.role as MapRole} />
              </div>
            ))
          )}
        </div>
      )}
      </div>

      {/* 하단 고정 버튼바 — 왼쪽: 열기·맵 설정 / 오른쪽: 삭제(owner) / Pinned footer */}
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
        {isOwner && (
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
