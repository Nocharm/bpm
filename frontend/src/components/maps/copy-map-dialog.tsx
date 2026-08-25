"use client";

// 맵 복사 모달 — 이름 입력 + 원본 버전 선택(승인 여부 무관). 복사 후 새 맵의 드래프트로 이동.
// PromptDialog 파생 레이아웃 — ModalBackdrop(바깥 mousedown 닫힘) + Esc 닫힘, Enter 제출.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import type { VersionSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface CopyMapDialogProps {
  sourceName: string;
  versions: VersionSummary[];
  /** 제출 실패 안내(예: 이름 중복) — 표시되면 모달 유지 */
  error?: string | null;
  onConfirm: (name: string, versionId: number) => void;
  onClose: () => void;
}

// 기본 선택 — 최신 승인본(approved/published), 없으면 최신 버전
function pickDefaultVersionId(versions: VersionSummary[]): number | undefined {
  const sorted = [...versions].sort((a, b) => b.id - a.id);
  const approved = sorted.find((v) => v.status === "approved" || v.status === "published");
  return (approved ?? sorted[0])?.id;
}

// 드롭다운 표기 — 게시 번호(v3)·라벨·상태(상태 문자열은 영어 고정 규칙)
function formatVersionOption(v: VersionSummary): string {
  const number = v.version_number ? `v${v.version_number} · ` : "";
  return `${number}${v.label} · ${v.status}`;
}

export function CopyMapDialog({
  sourceName,
  versions,
  error,
  onConfirm,
  onClose,
}: CopyMapDialogProps) {
  const { t } = useI18n();
  // 최신 우선 정렬 — 백엔드 versions는 생성순
  const sorted = [...versions].sort((a, b) => b.id - a.id);
  const [name, setName] = useState(`${sourceName} (Copy)`);
  const [versionId, setVersionId] = useState<number | undefined>(() =>
    pickDefaultVersionId(versions),
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed && versionId !== undefined) onConfirm(trimmed, versionId);
  };

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
    >
      <div
        data-id="copy-map-dialog"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        <h2 className="text-body-strong text-ink">{t("home.copyTitle")}</h2>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-ink-secondary">{t("home.copyNameLabel")}</span>
          <input
            autoFocus
            data-id="copy-map-dialog-name"
            className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-ink-secondary">{t("home.copyVersionLabel")}</span>
          <select
            data-id="copy-map-dialog-version"
            className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
            value={versionId ?? ""}
            onChange={(event) => setVersionId(Number(event.target.value))}
          >
            {sorted.map((v) => (
              <option key={v.id} value={v.id}>
                {formatVersionOption(v)}
              </option>
            ))}
          </select>
          <span className="text-fine text-ink-tertiary">{t("home.copyOpensDraft")}</span>
        </label>
        {error && <p className="text-fine text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="copy-map-dialog-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            data-id="copy-map-dialog-confirm"
            disabled={!name.trim() || versionId === undefined}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={submit}
          >
            {t("home.copyFromApproved")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
