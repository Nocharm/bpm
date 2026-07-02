"use client";

// 상단바 버전 pill — 현재 버전 라벨(accent) + 드롭다운. 즉시 전환하지 않고 확인 모달을 거친다.
// 편집 화면(isEditing)이면 모달에 미저장 변경 손실 안내를 함께 노출.
import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, CornerDownRight, GitBranch } from "lucide-react";
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
  const [hovering, setHovering] = useState(false);
  const [pending, setPending] = useState<VersionSummary | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = versions.find((v) => v.id === versionId) ?? null;
  // 게시 안 된(진행 중) 버전 — 현재 제외, 최근 순. 호버 아코디언 바로가기용.
  const unpublished = versions
    .filter((v) => v.id !== versionId && v.status !== "published" && v.status !== "expired")
    .reverse();
  const showHover = hovering && !open && unpublished.length > 0;

  // 버전 선택 — 편집 중이면 확인 모달, 아니면 즉시 전환(드롭다운·아코디언 공용).
  const handlePick = (version: VersionSummary) => {
    setOpen(false);
    setHovering(false);
    if (version.id === versionId) return;
    if (!isEditing) onSwitch(version.id);
    else setPending(version);
  };

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
    <div
      ref={rootRef}
      className="relative shrink-0"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
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
      {/* 호버 아코디언 — 게시 안 된 최근 버전 바로가기. pt-1로 pill↔패널 호버 갭 브리지. */}
      {unpublished.length > 0 && (
        <div
          className={`absolute left-0 top-full z-[999] w-56 pt-1 ${showHover ? "" : "pointer-events-none"}`}
        >
          <div
            className={`grid transition-all duration-200 ease-out ${
              showHover ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div className="rounded-md border border-hairline bg-surface p-1 shadow-lg">
                {unpublished.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => handlePick(version)}
                    className="flex w-full items-center gap-1.5 rounded-sm py-1 pl-4 pr-2 text-left text-fine hover:bg-surface-alt"
                  >
                    {/* 들여쓰기 커넥터 */}
                    <CornerDownRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                    <span className="flex min-w-0 flex-1 items-baseline gap-1 truncate">
                      <span className="shrink-0 text-ink-tertiary">{formatVersionMarker(version, versions)}</span>
                      <span className="truncate font-medium text-ink">{version.label}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-sm border px-1 py-0.5 ${VERSION_STATUS_STYLE[version.status]}`}
                    >
                      {t(VERSION_STATUS_LABEL[version.status])}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-[1001] mt-1 w-60 rounded-md border border-hairline bg-surface py-1 shadow-lg">
            {versions.map((version) => (
              <button
                key={version.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption hover:bg-surface-alt"
                onClick={() => handlePick(version)}
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
