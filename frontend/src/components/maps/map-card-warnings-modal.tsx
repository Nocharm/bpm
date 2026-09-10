"use client";

// 홈 맵 카드 경고 모달 — 카드의 ⚠+건수 클릭 시 경고 종류별 설명과 이동 링크(맵 설정 / 맵 열기).
// 경고 집계는 lib/map-card-warnings.ts(단일 소스). 공용 ModalBackdrop(mousedown 닫기+Esc). (사용자 결정 2026-09-10)

import Link from "next/link";
import { createPortal } from "react-dom";
import { Building2, Link2, TriangleAlert, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";
import type { MapCardWarning } from "@/lib/map-card-warnings";

interface MapCardWarningsModalProps {
  mapId: number;
  mapName: string;
  warnings: MapCardWarning[];
  onClose: () => void;
}

export function MapCardWarningsModal({ mapId, mapName, warnings, onClose }: MapCardWarningsModalProps) {
  const { t } = useI18n();
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="map-card-warnings-modal"
        role="dialog"
        aria-modal="true"
        className="flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-5 shadow-lg"
        // 카드 선택 클릭으로 버블링 방지(포털이어도 React 트리로는 카드가 조상)
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <TriangleAlert size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-error" />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-body-strong text-ink">{t("home.warnings.title", { n: warnings.length })}</h2>
            <p className="truncate text-fine text-ink-tertiary" title={mapName}>
              {mapName}
            </p>
          </div>
          <button
            type="button"
            data-id="map-card-warnings-close"
            aria-label={t("action.close")}
            className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <ul className="flex flex-col gap-2">
          {warnings.map((w) => (
            <li
              key={w.kind}
              data-id={`map-card-warning-${w.kind}`}
              className="flex gap-2.5 rounded-sm border border-error/25 bg-error/5 px-3 py-2.5"
            >
              <span className="mt-0.5 shrink-0 text-error">
                {w.kind === "owning_missing" ? (
                  <Building2 size={14} strokeWidth={1.5} />
                ) : (
                  <Link2 size={14} strokeWidth={1.5} />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-caption-strong text-ink">
                  {w.kind === "owning_missing"
                    ? t("home.warnings.owningTitle")
                    : t("home.warnings.staleTitle", { n: w.count })}
                </span>
                <span className="text-fine leading-snug text-ink-secondary">
                  {w.kind === "owning_missing" ? t("home.owningMissingNote") : t("home.staleRefsNote", { n: w.count })}
                </span>
                <Link
                  href={w.kind === "owning_missing" ? `/maps/${mapId}/settings` : `/maps/${mapId}`}
                  className="mt-1 self-start text-fine text-accent hover:underline"
                >
                  {w.kind === "owning_missing" ? t("home.warnings.openSettings") : t("home.warnings.openMap")} →
                </Link>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("action.close")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
