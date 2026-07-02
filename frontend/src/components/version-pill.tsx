"use client";

// 상단바 버전 pill — 현재 버전 라벨(accent) + 드롭다운. 즉시 전환하지 않고 확인 모달을 거친다.
// 편집 화면(isEditing)이면 모달에 미저장 변경 손실 안내를 함께 노출.
import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { type VersionSummary } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import { formatVersionMarker } from "@/lib/version-name";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

interface VersionPillProps {
  versions: VersionSummary[];
  versionId: number | null;
  isEditing: boolean;
  onSwitch: (id: number) => void;
  // 승인 탭 등 컴팩트 위치 — 패딩·글자 축소 / shrink padding & text for tight spots.
  compact?: boolean;
}

export function VersionPill({ versions, versionId, isEditing, onSwitch, compact = false }: VersionPillProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<VersionSummary | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = versions.find((v) => v.id === versionId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!current) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-tint font-medium text-accent hover:bg-accent-tint/70 ${
          compact ? "px-2 py-0.5 text-fine" : "px-2.5 py-1 text-caption"
        }`}
        onClick={() => setOpen((v) => !v)}
        title={t("editor.versionSelectAria")}
        aria-label={t("editor.versionSelectAria")}
      >
        <span className={`inline-flex items-baseline gap-1 truncate ${compact ? "max-w-[8rem]" : "max-w-[10rem]"}`}>
          {/* 마커(번호/(Draft)v.n)는 작게 회색 — 이름을 강조 */}
          <span className="shrink-0 text-fine font-normal text-ink-tertiary">
            {formatVersionMarker(current, versions)}
          </span>
          <span className="truncate font-semibold">{current.label}</span>
        </span>
        <ChevronDown size={compact ? 12 : 14} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-[1001] mt-1 w-60 rounded-md border border-hairline bg-surface py-1 shadow-lg">
            {versions.map((version) => (
              <button
                key={version.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption hover:bg-surface-alt"
                onClick={() => {
                  setOpen(false);
                  if (version.id === versionId) return;
                  // 편집 중이 아니면(읽기전용) 잃을 변경이 없으니 즉시 전환, 편집 중이면 확인 모달
                  if (!isEditing) onSwitch(version.id);
                  else setPending(version);
                }}
              >
                <span className="flex min-w-0 flex-1 items-baseline gap-1 truncate">
                  <span className="shrink-0 text-fine text-ink-tertiary">
                    {formatVersionMarker(version, versions)}
                  </span>
                  <span className="truncate font-medium text-ink">{version.label}</span>
                </span>
                <span
                  className={`rounded-sm border px-1.5 py-0.5 text-fine ${VERSION_STATUS_STYLE[version.status]}`}
                >
                  {t(VERSION_STATUS_LABEL[version.status])}
                </span>
                {version.id === versionId && (
                  <Check size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {pending && (
        <ConfirmDialog
          icon={<GitBranch size={28} strokeWidth={1.5} />}
          title={t("editor.confirmSwitchTitle")}
          lines={[
            { icon: <ArrowLeftRight size={14} strokeWidth={1.5} />, text: t("editor.confirmSwitchBody", { label: pending.label }) },
            { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("editor.unsavedNotice"), tone: "error" },
          ]}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const id = pending.id;
            setPending(null);
            onSwitch(id);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
