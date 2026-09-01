"use client";

// 운영 대시보드 — "새벽 조감도" 하늘 프레임(L5 캔버스 파생). 상단 네브바만 라이트 크롬으로 남기고
// 그 아래 전체(지표·사이드바)가 흰 거터 위 라운드 다크 프레임 하나에 담긴다 (사용자 결정 2026-09-01).
// 스냅샷(/summary)과 시계열(/timeseries)을 분리 조회 — 기간 필터는 시계열만 재조회한다.
// (design 2026-07-11)

import { ArrowLeft, Info } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { AccessSidebar } from "@/components/dashboard/access-sidebar";
import { BarChart } from "@/components/dashboard/bar-chart";
import { HBarList } from "@/components/dashboard/hbar-list";
import { LineChart } from "@/components/dashboard/line-chart";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import {
  getAiUsage,
  getDashboardSummary,
  getDashboardTimeseries,
  type AiUsageMetrics,
  type DashboardSummary,
  type DashboardTimeseries,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { getTodayKeyKst, resolvePeriod, type DateRange } from "@/lib/dashboard-chart";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

// 버전 상태별 막대 색 — 다크(하늘) 유리 카드 위 가독을 위해 토큰의 밝힌 파생색만 사용.
// approved는 published(violet)와 구분되도록 added(green, 승인=긍정 의미) 계열 유지.
const STATUS_TONES: Record<string, string> = {
  published: "var(--color-accent-sky)",
  approved: "color-mix(in srgb, var(--color-added) 65%, white)",
  pending: "color-mix(in srgb, var(--color-canvas) 70%, transparent)",
  draft: "color-mix(in srgb, var(--color-canvas) 40%, transparent)",
  rejected: "color-mix(in srgb, var(--color-error) 55%, white)",
};

// 하늘 위 KPI 타일 — 유리(반투명 surface) 배경 + 밝은 큰 숫자. StatCard의 하늘 버전(대시보드 전용이라 로컬 정의).
function SkyStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      data-id="dashboard-sky-stat"
      className="flex flex-col gap-1 rounded-md border border-surface/15 bg-surface/10 px-4 py-3"
    >
      <span className="text-fine uppercase tracking-wide text-canvas/60">{label}</span>
      <span
        className={`text-tagline tabular-nums ${tone === "accent" ? "text-accent-sky" : "text-canvas"}`}
      >
        {value}
      </span>
    </div>
  );
}

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
  const [range, setRange] = useState<DateRange>(() => resolvePeriod("7d", getTodayKeyKst()));
  // 실패 플래그는 fetch별로 분리 — 하나로 공유하면 한쪽 성공이 다른 쪽 실패를 감춘다.
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [seriesFailed, setSeriesFailed] = useState(false);
  // 설정 저장(커버리지 부서 변경) 후 summary만 재조회시키는 트리거 — 증가시키면 effect가 재실행된다.
  // 기간 변경으로는 절대 늘어나지 않는다(핵심 불변식: deps에 range를 넣지 않는다).
  const [summaryNonce, setSummaryNonce] = useState(0);

  // 스냅샷 — 마운트 1회 + summaryNonce 변경 시(설정 저장 트리거). 기간 필터와는 무관하다
  // (핵심 불변식: deps에 range를 넣지 않는다).
  useEffect(() => {
    let alive = true;
    getDashboardSummary()
      .then((data) => {
        if (alive) {
          setSummary(data);
          setSummaryFailed(false);
        }
      })
      .catch(() => {
        if (alive) setSummaryFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [summaryNonce]);

  // 시계열 — 기간이 바뀔 때만 재조회.
  useEffect(() => {
    let alive = true;
    getDashboardTimeseries(range.from, range.to)
      .then((data) => {
        if (alive) {
          setSeries(data);
          setSeriesFailed(false);
        }
      })
      .catch(() => {
        if (alive) setSeriesFailed(true);
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
    value === undefined ? "-" : value.toLocaleString();

  const points = series?.points ?? [];

  return (
    <div data-id="dashboard" className="relative h-full bg-surface">
      {/* 새벽 하늘 프레임 — L5 캔버스와 같은 문법(흰 거터 위 라운드 프레임). 거터가 라이트
          네브바와 다크 면 사이를 이어 단절감을 없앤다. */}
      <div
        data-id="dashboard-sky-frame"
        className="bpm-l5-sky absolute inset-2.5 flex overflow-hidden rounded-md shadow-md"
      >
        {/* 중앙 지표 — 하늘 위 스크롤 컬럼(하늘은 프레임에 고정, 내용만 흐른다) */}
        <main className="relative z-[1] min-w-0 flex-1">
          <div className="bpm-sky-scroll absolute inset-0 overflow-y-auto p-6">
            {/* 헤더 밴드 — 타이틀·스냅샷 시각·운영 카운터를 하늘 위 밝은 타이포로 */}
            <div className="flex flex-col gap-4 pb-6">
              {onBack ? (
                <button
                  type="button"
                  data-id="dashboard-back"
                  onClick={onBack}
                  className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-surface/20 bg-surface/10 px-2.5 py-1.5 text-caption text-canvas hover:bg-surface/20"
                >
                  <ArrowLeft size={16} strokeWidth={1.5} />
                  {t("dashboard.back")}
                </button>
              ) : null}
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div>
                  <h1 className="text-tagline text-canvas">{t("dashboard.opsTitle")}</h1>
                  <p className="mt-1 text-fine text-canvas/60">
                    {summary ? formatKstShort(summary.generated_at) : "-"}
                  </p>
                </div>
                {/* 운영 카운터 — 좌 레일에 있던 3종을 헤더 우측 컴팩트 지표로 */}
                <ul className="flex shrink-0 flex-wrap gap-x-7 gap-y-2">
                  {[
                    {
                      key: "dashboard.opsComments" as const,
                      value: summary?.ops.unresolved_comments,
                    },
                    {
                      key: "dashboard.opsNotifications" as const,
                      value: summary?.ops.unread_notifications,
                    },
                    {
                      key: "dashboard.opsCheckouts" as const,
                      value: summary?.ops.pending_checkouts,
                    },
                  ].map((row) => (
                    <li key={row.key} className="flex flex-col items-end gap-0.5">
                      <span className="text-body-strong tabular-nums text-canvas">
                        {count(row.value)}
                      </span>
                      <span className="text-fine text-canvas/60">{t(row.key)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {summaryFailed || seriesFailed ? (
              <p
                className="flex items-center gap-1.5 pb-4 text-caption"
                // error 원색은 남색 하늘에서 가라앉는다 — 밝힌 파생색(inline mix)으로만 사용
                style={{ color: "color-mix(in srgb, var(--color-error) 55%, white)" }}
              >
                <Info size={16} strokeWidth={1.5} />
                {t("dashboard.loadFailed")}
              </p>
            ) : null}

            {/* KPI 밴드 — 좌 레일 StatCard 4종을 하늘 위 유리 타일 큰 숫자로 승격(대시보드 정체성) */}
            <div
              data-id="dashboard-kpi-band"
              className="grid grid-cols-2 gap-3 pb-4 xl:grid-cols-4"
            >
              <SkyStat label={t("dashboard.mapsTotal")} value={count(summary?.maps.total)} />
              <SkyStat
                label={t("dashboard.mapsPublished")}
                value={count(summary?.maps.published)}
                tone="accent"
              />
              <SkyStat label={t("dashboard.mapsDraft")} value={count(summary?.maps.draft)} />
              <SkyStat label={t("dashboard.mapsTrashed")} value={count(summary?.maps.trashed)} />
            </div>

            <div className="flex flex-col gap-4">
              <section
                data-id="dashboard-activity"
                className="rounded-md border border-surface/15 bg-surface/10 p-5"
              >
                <div className="flex items-center justify-between gap-4 pb-4">
                  <h2 className="text-body-strong text-canvas">{t("dashboard.activityTitle")}</h2>
                  <PeriodFilter range={range} onChange={setRange} />
                </div>
                <BarChart
                  points={points.map((point) => ({ label: point.date, value: point.logins }))}
                />
              </section>

              <section
                data-id="dashboard-growth"
                className="rounded-md border border-surface/15 bg-surface/10 p-5"
              >
                <h2 className="pb-4 text-body-strong text-canvas">{t("dashboard.growthTitle")}</h2>
                <LineChart
                  labels={points.map((point) => point.date)}
                  series={[
                    {
                      label: t("dashboard.growthMaps"),
                      color: "var(--color-accent-sky)",
                      values: points.map((point) => point.maps_created),
                    },
                    {
                      // 보조 시리즈 — 하늘 위에서 ink 계열은 가라앉아 밝은 회백으로
                      label: t("dashboard.growthVersions"),
                      color: "color-mix(in srgb, var(--color-canvas) 55%, transparent)",
                      values: points.map((point) => point.versions_created),
                    },
                  ]}
                />
              </section>

              <div className="grid grid-cols-2 gap-4">
                <section
                  data-id="dashboard-version-status"
                  className="rounded-md border border-surface/15 bg-surface/10 p-5"
                >
                  <h2 className="pb-1 text-body-strong text-canvas">
                    {t("dashboard.versionStatusTitle")}
                  </h2>
                  <p className="pb-4 text-fine text-canvas/60">{t("dashboard.snapshotNote")}</p>
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
                  className="rounded-md border border-surface/15 bg-surface/10 p-5"
                >
                  <h2 className="pb-1 text-body-strong text-canvas">{t("dashboard.coverageTitle")}</h2>
                  {summary && summary.coverage.depts_total === 0 ? (
                    <p className="pt-3 text-caption text-canvas/60">
                      {t("dashboard.coverageEmpty")}
                    </p>
                  ) : (
                    <>
                      <p className="pb-4 text-fine text-canvas/60">
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
                className="rounded-md border border-surface/15 bg-surface/10 p-5"
              >
                <h2 className="pb-4 text-body-strong text-canvas">{t("dashboard.eventsTitle")}</h2>
                {summary && summary.recent_events.length === 0 ? (
                  <p className="text-caption text-canvas/60">{t("dashboard.eventsEmpty")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {(summary?.recent_events ?? []).map((event) => (
                      <li
                        key={`${event.created_at}-${event.map_name}-${event.version_label}-${event.event_type}`}
                        className="flex items-center gap-3"
                      >
                        <span className="w-20 shrink-0 rounded-sm bg-surface/12 px-2 py-0.5 text-center text-fine text-canvas/75">
                          {event.event_type}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-caption text-canvas">
                          {event.map_name} {event.version_label} - {event.actor_name}
                        </span>
                        <span className="shrink-0 text-fine text-canvas/60">
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
                  className="rounded-md border border-surface/15 bg-surface/10 p-5"
                >
                  <h2 className="pb-4 text-body-strong text-canvas">{t("dashboard.aiHeading")}</h2>
                  {aiUsage.last30.calls === 0 ? (
                    <p className="text-caption text-canvas/60">{t("dashboard.aiEmpty")}</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-3">
                      <SkyStat
                        label={t("dashboard.aiCalls7d")}
                        value={count(aiUsage.last7.calls)}
                      />
                      <SkyStat
                        label={t("dashboard.aiFailRate7d")}
                        value={
                          aiUsage.last7.calls > 0
                            ? `${Math.round((aiUsage.last7.failed / aiUsage.last7.calls) * 100)}%`
                            : "-"
                        }
                      />
                      <SkyStat
                        label={t("dashboard.aiTokens7d")}
                        value={count(
                          aiUsage.last7.prompt_tokens + aiUsage.last7.completion_tokens,
                        )}
                      />
                      <SkyStat
                        label={t("dashboard.aiTokens30d")}
                        value={count(
                          aiUsage.last30.prompt_tokens + aiUsage.last30.completion_tokens,
                        )}
                      />
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          </div>
        </main>

        {/* 우 사이드바 — sysadmin만. 같은 하늘 안 유리 패널(라이트 크롬은 상단 네브바뿐) */}
        {user?.isSysadmin ? (
          <AccessSidebar
            onToast={onToast}
            onCoverageChange={() => setSummaryNonce((prev) => prev + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}
