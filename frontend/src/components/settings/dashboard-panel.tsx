"use client";

// 설정 · 분석 › 대시보드 진입 스텁 — 진입 카드(운영 대시보드 열기) + 클릭 시 상세 자리표시(추후 배치).
// 상세 지표(맵/버전 현황·승인 파이프라인·조직·로그인 추이)는 별도 spec.
// (design 2026-07-05, 시안 대시보드 진입점.png — 4b: 클릭 전환·돌아가기·세부 추후 보완)

import { ArrowLeft, ArrowRight, Info, LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";

import { getDashboard, type DashboardMetrics } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// 지표 카드 — 라벨·큰 값·보조 설명. 로딩 중이면 값 자리에 "—".
function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface px-4 py-3">
      <span className="text-fine uppercase tracking-wide text-ink-tertiary">{label}</span>
      <span className="text-tagline text-ink">{value}</span>
      {hint ? <span className="text-fine text-ink-tertiary">{hint}</span> : null}
    </div>
  );
}

export function DashboardPanel() {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  // 대시보드를 열 때 접속자 지표 조회 (login_records 집계)
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    getDashboard()
      .then((data) => {
        if (alive) setMetrics(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [opened]);

  // 상세 화면 — 접속자수만 실데이터, 나머지 칸·지표는 추후 보완
  if (opened) {
    const value = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString());
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

        <div className="flex flex-col gap-3">
          <h2 className="text-body-strong text-ink">{t("dashboard.opsHeading")}</h2>
          <div className="grid max-w-2xl grid-cols-3 gap-3">
            <StatCard
              label={t("dashboard.visitors")}
              value={value(metrics?.visitors_unique)}
              hint={t("dashboard.visitorsHint")}
            />
            <StatCard label={t("dashboard.loginsTotal")} value={value(metrics?.logins_total)} />
            <StatCard label={t("dashboard.logins7d")} value={value(metrics?.logins_7d)} />
          </div>
          <p className="flex items-center gap-1.5 text-fine text-ink-tertiary">
            <Info size={13} strokeWidth={1.5} />
            {t("dashboard.metricsComingSoon")}
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
