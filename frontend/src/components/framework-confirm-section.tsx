"use client";

// 연계 캔버스 확정 섹션 — 일반 맵의 ApprovalPanel 자리를 대체. 권한자(editor+)만 버튼,
// 확정은 minor+1, Major 체크 시 다음 메이저.0 (design 2026-08-28 §6).
import { BadgeCheck } from "lucide-react";
import { useState } from "react";

import { confirmFrameworkVersion, type VersionSummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";

export interface FrameworkConfirmSectionProps {
  mapId: number;
  canConfirm: boolean; // myRole editor+ (권한자/sysadmin 파생)
  latestLabel: string | null; // 최신 확정 스냅샷 label("v1.1") — 없으면 null
  onConfirmed: (snapshot: VersionSummary) => void; // 부모가 versions 갱신·토스트
  onError: (message: string) => void;
}

export function FrameworkConfirmSection({
  mapId, canConfirm, latestLabel, onConfirmed, onError,
}: FrameworkConfirmSectionProps) {
  const { t } = useI18n();
  const [major, setMajor] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div data-id="framework-confirm-section" className="flex flex-col gap-2 p-3">
      <p className="text-caption text-ink-secondary">
        {latestLabel
          ? t("framework.latestConfirmed", { label: latestLabel })
          : t("framework.notConfirmed")}
      </p>
      {canConfirm && (
        <>
          <label className="flex cursor-pointer items-center gap-1.5 text-fine text-ink-tertiary">
            <input
              data-id="framework-confirm-major"
              type="checkbox"
              checked={major}
              onChange={() => setMajor((value) => !value)}
            />
            {t("framework.majorVersion")}
          </label>
          <button
            type="button"
            data-id="framework-confirm-button"
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => {
              setBusy(true);
              confirmFrameworkVersion(mapId, major)
                .then((snapshot) => {
                  setMajor(false);
                  onConfirmed(snapshot);
                })
                .catch((err) => onError(humanizeApiError(err, t)))
                .finally(() => setBusy(false));
            }}
          >
            <BadgeCheck size={16} strokeWidth={1.5} />
            {t("framework.confirmChanges")}
          </button>
        </>
      )}
    </div>
  );
}
