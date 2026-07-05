"use client";

// 설정 · 분석 › 대시보드 진입 스텁 — 진입 카드(운영 대시보드 열기) + 클릭 시 상세 자리표시(추후 배치).
// 상세 지표(맵/버전 현황·승인 파이프라인·조직·로그인 추이)는 별도 spec.
// (design 2026-07-05, 시안 대시보드 진입점.png — 4b: 클릭 전환·돌아가기·세부 추후 보완)

import { ArrowLeft, ArrowRight, Info, LayoutGrid } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";

export function DashboardPanel() {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);

  // 상세 화면 — 아직 자리표시(돌아가기 + 추후 제공 안내)
  if (opened) {
    return (
      <div className="flex h-full flex-col gap-6">
        <button
          type="button"
          onClick={() => setOpened(false)}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          {t("dashboard.back")}
        </button>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <LayoutGrid size={28} strokeWidth={1.5} className="text-ink-tertiary" />
          <p className="text-body-strong text-ink">{t("dashboard.placeholderTitle")}</p>
          <p className="max-w-sm text-caption text-ink-tertiary">
            {t("dashboard.placeholderBody")}
          </p>
        </div>
      </div>
    );
  }

  // 진입 화면 — 헤딩 + 진입 카드 + 추후 보완 각주
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-body-strong text-ink">{t("dashboard.heading")}</h2>
        <p className="mt-1 text-caption text-ink-tertiary">{t("dashboard.subtitle")}</p>
      </div>

      <button
        type="button"
        onClick={() => setOpened(true)}
        className="flex items-center gap-4 rounded-sm border border-hairline bg-surface px-4 py-3.5 text-left hover:bg-surface-alt"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
          <LayoutGrid size={20} strokeWidth={1.5} />
        </span>
        <span className="flex-1">
          <span className="block text-body-strong text-ink">{t("dashboard.openCard")}</span>
          <span className="block text-caption text-ink-tertiary">
            {t("dashboard.openCardDesc")}
          </span>
        </span>
        <ArrowRight size={18} strokeWidth={1.5} className="text-ink-tertiary" />
      </button>

      <p className="flex items-center gap-1.5 text-fine text-ink-tertiary">
        <Info size={13} strokeWidth={1.5} />
        {t("dashboard.comingSoonNote")}
      </p>
    </div>
  );
}
