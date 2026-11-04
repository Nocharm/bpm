// 홈 대시보드 "진행 중 실행" 펼침 칸 — 거르기 필 5개(개수)·정렬 메뉴 + 실행 줄(상태 글씨가 맨 앞이라 좁아도 잘리지 않는다).
// 줄을 누르면 0.6초 지연 이동으로 그 맵의 실행 화면을 연다: 칸 전체를 레이어가 덮고 레이어 클릭 = 취소. 활동 타일이 펼친다 (design 2026-11-04 §4.8).
"use client";

import { CircleAlert, Hourglass, List, User, Users, type LucideIcon } from "lucide-react";

import type { MeDashboardRun } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import {
  countRunFilters,
  filterRuns,
  RUN_LIST_FILTERS,
  RUN_LIST_SORTS,
  sortRuns,
  type HomeListPrefs,
  type RunListFilter,
  type RunListSort,
} from "@/lib/home-list-prefs";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { buildRunHref } from "@/lib/run-links";
import { useAgo } from "@/lib/use-ago";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { IconPillFilter } from "@/components/icon-pill-filter";
import { MenuSelect } from "@/components/menu-select";
import { NavPendingScope } from "@/components/nav-pending-scope";

const FILTER_ICON: Record<RunListFilter, LucideIcon> = {
  all: List,
  problem: CircleAlert,
  idle: Hourglass,
  shared: Users,
  solo: User,
};

const FILTER_LABEL: Record<RunListFilter, MessageKey> = {
  all: "home.dash.runs.filter.all",
  problem: "home.dash.runs.filter.problem",
  idle: "home.dash.runs.filter.idle",
  shared: "home.dash.runs.filter.shared",
  solo: "home.dash.runs.filter.solo",
};

const SORT_LABEL: Record<RunListSort, MessageKey> = {
  urgent: "home.dash.runs.sort.urgent",
  recent: "home.dash.runs.sort.recent",
  progress: "home.dash.runs.sort.progress",
  map: "home.dash.runs.sort.map",
};

type Translate = ReturnType<typeof useI18n>["t"];

interface DashboardRunPanelProps {
  runs: MeDashboardRun[];
  prefs: HomeListPrefs;
  onPrefs: (prefs: HomeListPrefs) => void;
}

export function DashboardRunPanel(props: DashboardRunPanelProps) {
  return (
    <NavPendingScope dataId="home-run-panel" className="rounded-sm">
      <RunPanelBody {...props} />
    </NavPendingScope>
  );
}

// 스코프 안쪽에서 훅을 돌려야 이 칸의 레이어에 보고된다
function RunPanelBody({ runs, prefs, onPrefs }: DashboardRunPanelProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const { pending, toggle } = useDelayedNav();
  const counts = countRunFilters(runs);
  const shown = sortRuns(filterRuns(runs, prefs.runFilter), prefs.runSort);
  const goingLabel = t("home.dash.navGoing", { dest: t("home.dash.destRun") });
  return (
    <div className="flex flex-col rounded-sm border border-accent-tint-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-2.5 py-1.5">
        <IconPillFilter
          dataId="home-run-filter"
          options={RUN_LIST_FILTERS.map((filter) => ({
            value: filter,
            label: t(FILTER_LABEL[filter]),
            Icon: FILTER_ICON[filter],
            count: counts[filter],
          }))}
          value={prefs.runFilter}
          onChange={(runFilter) => onPrefs({ ...prefs, runFilter })}
        />
        <MenuSelect
          dataId="home-run-sort"
          value={prefs.runSort}
          items={RUN_LIST_SORTS.map((sort) => ({ value: sort, label: t(SORT_LABEL[sort]) }))}
          leading={<span className="text-ink-tertiary">{t("home.dash.runs.sortLabel")}</span>}
          onChange={(value) => {
            const runSort = RUN_LIST_SORTS.find((sort) => sort === value);
            if (runSort) onPrefs({ ...prefs, runSort });
          }}
        />
      </div>
      <ul data-id="home-run-list" className="max-h-60 overflow-y-auto">
        {shown.length === 0 ? (
          <li data-id="home-run-empty" className="px-3 py-4 text-center text-fine text-ink-muted">
            {t("home.dash.runs.empty")}
          </li>
        ) : (
          shown.map((run) => {
            const href = buildRunHref(run.map_id, run.version_id, run.run_id);
            const selecting = pending === href;
            const ratio = run.total > 0 ? run.done / run.total : 0;
            return (
              <li key={run.run_id}>
                <button
                  type="button"
                  data-id={`home-run-row-${run.run_id}`}
                  data-selecting={selecting || undefined}
                  onClick={() => toggle(href, goingLabel)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-pearl [li+li>&]:border-t [li+li>&]:border-divider ${
                    selecting ? "bg-accent-tint/40" : ""
                  }`}
                >
                  <span className="min-w-0 truncate text-caption-strong text-ink">{run.name}</span>
                  <span className="row-span-2 flex flex-col items-end gap-1 text-fine tabular-nums text-ink-tertiary">
                    <span className="inline-flex items-center gap-1.5">
                      {run.done}/{run.total}
                      <span className="h-1 w-12 overflow-hidden rounded-full bg-hairline">
                        <span className="block h-full rounded-full bg-run-done" style={{ width: `${ratio * 100}%` }} />
                      </span>
                    </span>
                    <span title={formatKstShort(run.last_activity_at)}>{ago(run.last_activity_at)}</span>
                  </span>
                  <RunSubLine run={run} t={t} />
                </button>
              </li>
            );
          })
        )}
      </ul>
      <p className="border-t border-hairline px-3 py-1.5 text-fine text-ink-tertiary">{t("home.dash.runs.foot")}</p>
    </div>
  );
}

// 작은 줄 — 상태 글씨(문제 빨강 · 곧 중단 경고 · 다음 악센트) · 맵 이름 · 나만/공유 n명
function RunSubLine({ run, t }: { run: MeDashboardRun; t: Translate }) {
  const idleText = t("home.dash.runs.stateIdle", { d: run.idle_days, s: run.stop_in_days });
  const scopeText = run.scope === "shared" ? t("home.dash.runs.shared", { n: run.participant_count }) : t("home.dash.runs.solo");
  return (
    <span className="min-w-0 truncate text-fine text-ink-tertiary">
      {run.state_kind === "idle" ? (
        <span data-id="home-run-state" className="font-semibold text-warn">{idleText}</span>
      ) : (
        <span data-id="home-run-state" className={`font-semibold ${run.state_kind === "problem" ? "text-run-problem" : "text-accent"}`}>
          {formatTitledState(run, t)}
        </span>
      )}
      {/* 문제이면서 방치된 실행은 "곧 중단" 거르기에도 잡히므로 이유를 같이 보인다(R20) */}
      {run.state_kind === "problem" && run.is_idle && (
        <>
          {" · "}
          <span className="font-semibold text-warn">{idleText}</span>
        </>
      )}
      {` · ${run.map_name} · ${scopeText}`}
    </span>
  );
}

// "문제: 노드" · "다음: 노드"(+ "외 n") — 볼 수 없는 하위 맵 노드는 제목이 빈 문자열이라 종류 글씨만
function formatTitledState(run: MeDashboardRun, t: Translate): string {
  const isProblem = run.state_kind === "problem";
  const base = run.state_title
    ? t(isProblem ? "home.dash.runs.stateProblem" : "home.dash.runs.stateNext", { title: run.state_title })
    : t(isProblem ? "home.dash.runs.stateProblemBare" : "home.dash.runs.stateNextBare");
  return run.state_more > 0 ? `${base} ${t("home.dash.runs.stateMore", { n: run.state_more })}` : base;
}
