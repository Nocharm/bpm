"use client";

// 하위프로세스 노드 버전 선택 — 연결 맵의 버전을 가져와 '최신본 추종' 토글 + (해제 시) 버전 고정 드롭다운 + 업데이트.
// 비동기 fetch를 page.tsx 밖으로 격리(set-state-in-effect 회피: active 가드). 저장 배선은 onChange로 위임.
import { useEffect, useRef, useState } from "react";

import { getMap, type VersionDetail } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface SubprocessVersionPickerProps {
  linkedMapId: number;
  linkedVersionId: number | null;
  followLatest: boolean;
  updateAvailable: boolean;
  readOnly: boolean;
  onFollowLatest: (value: boolean) => void;
  onPinVersion: (versionId: number) => void;
  onUpdate: () => void;
}

export function SubprocessVersionPicker({
  linkedMapId,
  linkedVersionId,
  followLatest,
  updateAvailable,
  readOnly,
  onFollowLatest,
  onPinVersion,
  onUpdate,
}: SubprocessVersionPickerProps) {
  const { t } = useI18n();
  const [versions, setVersions] = useState<VersionDetail[]>([]);
  const loadedFor = useRef<number | null>(null);

  useEffect(() => {
    if (loadedFor.current === linkedMapId) return;
    let active = true;
    void (async () => {
      try {
        const detail = await getMap(linkedMapId);
        if (active) {
          setVersions(detail.versions);
          loadedFor.current = linkedMapId;
        }
      } catch {
        if (active) setVersions([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [linkedMapId]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-hairline p-3">
      <div className="text-fine font-semibold text-ink">{t("subprocess.versionTitle")}</div>
      <div className="flex items-center justify-between">
        <span className="text-caption text-ink-secondary">{t("subprocess.followLatest")}</span>
        <button
          type="button"
          role="switch"
          aria-checked={followLatest}
          aria-label={t("subprocess.followLatest")}
          disabled={readOnly}
          onClick={() => onFollowLatest(!followLatest)}
          className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
            followLatest ? "bg-accent" : "bg-border-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-all ${
              followLatest ? "left-3.5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {!followLatest && (
        <select
          className="w-full rounded-sm border border-hairline px-2 py-1.5 text-caption disabled:opacity-40"
          value={linkedVersionId ?? ""}
          disabled={readOnly}
          onChange={(event) => onPinVersion(Number(event.target.value))}
          aria-label={t("subprocess.versionTitle")}
        >
          <option value="" disabled>
            {t("subprocess.pickVersion")}
          </option>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}
            </option>
          ))}
        </select>
      )}

      {updateAvailable && (
        <button
          type="button"
          disabled={readOnly}
          className="rounded-sm border border-accent/40 bg-accent-tint px-3 py-1.5 text-caption font-medium text-accent hover:bg-accent-tint/70 disabled:opacity-40"
          onClick={onUpdate}
        >
          {t("subprocess.update")}
        </button>
      )}
    </div>
  );
}
