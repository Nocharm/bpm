"use client";

// 선택된 맵 상세 카드 — 가시성·역할·버전(승인 상태) 요약. 홈의 마스터-디테일 우측 패널 /
// Selected-map detail card: visibility, role, and version (approval-status) summary.
// 데이터는 getMap(MapDetail.versions) 하나로 — 백엔드 추가 없음. 선택 변경 시 key로 remount.

import Link from "next/link";
import { useEffect, useState } from "react";

import { getMap, type MapDetail, type VersionStatus } from "@/lib/api";
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

export function MapDetailCard({ mapId }: { mapId: number }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  if (error) {
    return <p className="text-caption text-error">{error}</p>;
  }
  if (!detail) {
    return <p className="text-caption text-ink-tertiary">…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
