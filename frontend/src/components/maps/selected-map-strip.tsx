// 업무 체계 뷰 좌측 맨 아래의 "선택된 맵" 스트립 — 우측 L5 요약에서 L6 맵을 눌러 맵 상세로 넘어갔을 때, 드릴다운은 그대로
// 두고 어느 맵을 보고 있는지 댓글처럼 띄운다(임시 모달 톤: 떠 있는 카드, 사용자 지시 2026-09-21). × 또는 "L5로 돌아가기"와
// 브라우저 뒤로가기가 모두 직전 L5 선택 화면으로 복귀한다(page.tsx returnToOrigin).
"use client";

import { ArrowLeft, Map as MapIcon, X } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_TONE } from "@/lib/version-status";

interface SelectedMapStripProps {
  map: MapSummary;
  // 출처 L5 — 이름은 캡션, id는 복귀 대상
  origin: { id: number; name: string };
  onBack: () => void;
}

export function SelectedMapStrip({ map, origin, onBack }: SelectedMapStripProps) {
  const { t } = useI18n();
  const status = map.latest_version_status;
  const tone = status ? VERSION_STATUS_TONE[status] : null;
  return (
    <div
      data-id="selected-map-strip"
      role="status"
      className="fw-slide-in mt-2 flex shrink-0 items-center gap-2 rounded-md border border-accent-tint-border bg-surface px-2.5 py-2 shadow-lg"
    >
      <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
        <MapIcon size={14} strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span data-id="selected-map-strip-name" className="min-w-0 truncate text-caption-strong text-ink">
            {map.name}
          </span>
          {status && tone && (
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${tone.pill}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {VERSION_STATUS_LABEL_EN[status]}
            </span>
          )}
        </span>
        <span className="truncate text-fine text-ink-tertiary">{t("home.selectedMapFrom", { name: origin.name })}</span>
      </span>
      <button
        type="button"
        data-id="selected-map-strip-back"
        className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-accent-tint hover:text-accent"
        onClick={onBack}
      >
        <ArrowLeft size={12} strokeWidth={1.5} />
        {t("home.selectedMapBack")}
      </button>
      <button
        type="button"
        data-id="selected-map-strip-close"
        aria-label={t("summary.close")}
        title={t("summary.close")}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-alt hover:text-ink"
        onClick={onBack}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
