"use client";

// 운영 대시보드 — 풀블리드 3열(좌 요약 레일 · 중앙 지표 · 우 Access/Coverage 사이드바).
// 스냅샷(/summary)과 시계열(/timeseries)을 분리 조회 — 기간 필터는 시계열만 재조회한다.
// (design 2026-07-11)

import { ArrowLeft, Info } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { AccessSidebar } from "@/components/dashboard/access-sidebar";
import { BarChart } from "@/components/dashboard/bar-chart";
import { HBarList } from "@/components/dashboard/hbar-list";
import { LineChart } from "@/components/dashboard/line-chart";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  getAiUsage,
  getDashboardSummary,
  getDashboardTimeseries,
  type AiUsageMetrics,
  type DashboardSummary,
  type DashboardTimeseries,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { resolvePeriod, todayKeyKst, type DateRange } from "@/lib/dashboard-chart";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

// 버전 상태별 막대 색 — globals.css @theme에 실재하는 토큰만 참조(Step 4에서 확인 완료).
const STATUS_TONES: Record<string, string> = {
  published: "var(--color-accent)",
  approved: "var(--color-accent)",
  pending: "var(--color-ink-secondary)",
  draft: "var(--color-ink-tertiary)",
  rejected: "var(--color-error)",
};

export interface DashboardPanelProps {
  onBack?: () => void;
  onToast?: (message: string) => void;
}

export function DashboardPanel({ onBack, onToast }: DashboardPanelProps) {
  const { t } = useI18n();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [series, setSeries] = useState<DashboardTimeseries | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageMetrics | null>(null);
  const [range, setRange] = useState<DateRange>(() => resolvePeriod("7d", todayKeyKst()));
  const [failed, setFailed] = useState(false);

  // 스냅샷 — 마운트 1회. 기간 필터와 무관하다(핵심 불변식: deps에 range를 넣지 않는다).
  useEffect(() => {
    let alive = true;
    getDashboardSummary()
      .then((data) => {
        if (alive) setSummary(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 시계열 — 기간이 바뀔 때만 재조회.
  useEffect(() => {
    let alive = true;
    getDashboardTimeseries(range.from, range.to)
      .then((data) => {
        if (alive) setSeries(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  // AI 사용량 — sysadmin 전용 엔드포인트라 sysadmin일 때만 조회한다(아니면 403).
  useEffect(() => {
    if (!user?.isSysadmin) return;
    let alive = true;
    getAiUsage()
      .then((data) => {
        if (alive) setAiUsage(data);
      })
      .catch(() => {
        /* AI 사용량은 비핵심 — 실패해도 대시보드는 뜬다 */
      });
    return () => {
      alive = false;
    };
  }, [user?.isSysadmin]);

  const count = (value: number | undefined) =>
    value === undefined ? "—" : value.toLocaleString();

  const points = series?.points ?? [];

  return (
    <div data-id="dashboard" className="flex h-full">
      {/* 좌 요약 레일 — 설정 탭 레일 자리를 대신한다 */}
      <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-hairline bg-surface p-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            <ArrowLeft size={16} strokeWidth={1.5} />
            {t("dashboard.back")}
          </button>
        ) : null}

        <div>
          <h1 className="text-body-strong text-ink">{t("dashboard.opsTitle")}</h1>
          <p className="mt-0.5 text-fine text-ink-tertiary">
            {summary ? formatKstShort(summary.generated_at) : "—"}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <StatCard label={t("dashboard.mapsTotal")} value={count(summary?.maps.total)} />
          <StatCard
            label={t("dashboard.mapsPublished")}
            value={count(summary?.maps.published)}
            tone="accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <StatCard label={t("dashboard.mapsDraft")} value={count(summary?.maps.draft)} />
            <StatCard label={t("dashboard.mapsTrashed")} value={count(summary?.maps.trashed)} />
          </div>
        </div>

        <ul className="mt-auto flex flex-col gap-1.5 border-t border-hairline pt-3">
          {[
            { key: "dashboard.opsComments" as const, value: summary?.ops.unresolved_comments },
            {
              key: "dashboard.opsNotifications" as const,
              value: summary?.ops.unread_notifications,
            },
            { key: "dashboard.opsCheckouts" as const, value: summary?.ops.pending_checkouts },
          ].map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-fine text-ink-tertiary">{t(row.key)}</span>
              <span className="shrink-0 text-caption-strong tabular-nums text-ink">
                {count(row.value)}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* 중앙 지표 그리드 */}
      <main className="flex-1 overflow-y-auto bg-canvas p-6">
        {failed ? (
          <p className="flex items-center gap-1.5 pb-4 text-caption text-error">
            <Info size={16} strokeWidth={1.5} />
            {t("dashboard.loadFailed")}
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <section
            data-id="dashboard-activity"
            className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
          >
            <div className="flex items-center justify-between gap-4 pb-4">
              <h2 className="text-body-strong text-ink">{t("dashboard.activityTitle")}</h2>
              <PeriodFilter range={range} onChange={setRange} />
            </div>
            <BarChart
              points={points.map((point) => ({ label: point.date, value: point.logins }))}
            />
          </section>

          <section
            data-id="dashboard-growth"
            className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
          >
            <h2 className="pb-4 text-body-strong text-ink">{t("dashboard.growthTitle")}</h2>
            <LineChart
              labels={points.map((point) => point.date)}
              series={[
                {
                  label: t("dashboard.growthMaps"),
                  color: "var(--color-accent)",
                  values: points.map((point) => point.maps_created),
                },
                {
                  label: t("dashboard.growthVersions"),
                  color: "var(--color-ink-tertiary)",
                  values: points.map((point) => point.versions_created),
                },
              ]}
            />
          </section>

          <div className="grid grid-cols-2 gap-4">
            <section
              data-id="dashboard-version-status"
              className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
            >
              <h2 className="pb-1 text-body-strong text-ink">
                {t("dashboard.versionStatusTitle")}
              </h2>
              <p className="pb-4 text-fine text-ink-tertiary">{t("dashboard.snapshotNote")}</p>
              <HBarList
                rows={Object.entries(summary?.version_status ?? {}).map(([status, value]) => ({
                  label: status,
                  value,
                  tone: STATUS_TONES[status],
                }))}
              />
            </section>

            <section
              data-id="dashboard-coverage"
              className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
            >
              <h2 className="pb-1 text-body-strong text-ink">{t("dashboard.coverageTitle")}</h2>
              {summary && summary.coverage.depts_total === 0 ? (
                <p className="pt-3 text-caption text-ink-tertiary">
                  {t("dashboard.coverageEmpty")}
                </p>
              ) : (
                <>
                  <p className="pb-4 text-fine text-ink-tertiary">
                    {summary
                      ? t("dashboard.coverageSummary", {
                          withMap: summary.coverage.depts_with_map,
                          total: summary.coverage.depts_total,
                          pct: summary.coverage.coverage_pct,
                        })
                      : ""}
                  </p>
                  <HBarList
                    rows={(summary?.coverage.rows ?? []).map((row) => ({
                      label: row.name,
                      value: row.maps,
                      hint:
                        row.maps === 0 ? t("dashboard.coverageMissing") : `↑${row.published}`,
                    }))}
                  />
                </>
              )}
            </section>
          </div>

          <section
            data-id="dashboard-events"
            className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
          >
            <h2 className="pb-4 text-body-strong text-ink">{t("dashboard.eventsTitle")}</h2>
            {summary && summary.recent_events.length === 0 ? (
              <p className="text-caption text-ink-tertiary">{t("dashboard.eventsEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(summary?.recent_events ?? []).map((event) => (
                  <li
                    key={`${event.created_at}-${event.map_name}-${event.version_label}`}
                    className="flex items-center gap-3"
                  >
                    <span className="w-20 shrink-0 rounded-sm bg-surface-alt px-2 py-0.5 text-center text-fine text-ink-secondary">
                      {event.event_type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption text-ink">
                      {event.map_name} {event.version_label} — {event.actor_name}
                    </span>
                    <span className="shrink-0 text-fine text-ink-tertiary">
                      {formatKstShort(event.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* AI 사용량 — sysadmin 전용(엔드포인트가 sysadmin 게이트라 뷰어에겐 403) */}
          {user?.isSysadmin && aiUsage ? (
            <section
              data-id="dashboard-ai-usage"
              className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
            >
              <h2 className="pb-4 text-body-strong text-ink">{t("dashboard.aiHeading")}</h2>
              {aiUsage.last30.calls === 0 ? (
                <p className="text-caption text-ink-tertiary">{t("dashboard.aiEmpty")}</p>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  <StatCard label={t("dashboard.aiCalls7d")} value={count(aiUsage.last7.calls)} />
                  <StatCard
                    label={t("dashboard.aiFailRate7d")}
                    value={
                      aiUsage.last7.calls > 0
                        ? `${Math.round((aiUsage.last7.failed / aiUsage.last7.calls) * 100)}%`
                        : "—"
                    }
                  />
                  <StatCard
                    label={t("dashboard.aiTokens7d")}
                    value={count(aiUsage.last7.prompt_tokens + aiUsage.last7.completion_tokens)}
                  />
                  <StatCard
                    label={t("dashboard.aiTokens30d")}
                    value={count(aiUsage.last30.prompt_tokens + aiUsage.last30.completion_tokens)}
                  />
                </div>
              )}
            </section>
          ) : null}
        </div>
      </main>

      {/* 우 사이드바 — sysadmin만 */}
      {user?.isSysadmin ? <AccessSidebar onToast={onToast} /> : null}
    </div>
  );
}
