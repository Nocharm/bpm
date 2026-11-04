// 홈 대시보드 펼침 목록(진행 중 실행 · 알림 · 내 피드백)의 거르기·정렬 기억과 실행 줄 거르기·정렬 — 순수 함수 (design 2026-11-04 §4.8).
// 기억은 브라우저 localStorage `bpm.home.lists` 한 키(내보내기 열 선택과 같은 방식). 읽기·쓰기가 실패하거나 모르는 값이면 기본값으로 동작한다.

import type { FeedbackItem, FeedbackKind, MeDashboardRun } from "@/lib/api";
import { FEEDBACK_KINDS } from "@/lib/feedback-meta";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notification-categories";

export type RunListFilter = "all" | "problem" | "idle" | "shared" | "solo";
export type RunListSort = "urgent" | "recent" | "progress" | "map";
export type NotiReadFilter = "unread" | "all";
export type FeedbackStatusFilter = "open" | "all";

export interface HomeListPrefs {
  runFilter: RunListFilter;
  runSort: RunListSort;
  notiRead: NotiReadFilter;
  notiCat: NotificationCategory | "all";
  fbStatus: FeedbackStatusFilter;
  fbKind: FeedbackKind | "all";
}

export const RUN_LIST_FILTERS: RunListFilter[] = ["all", "problem", "idle", "shared", "solo"];
export const RUN_LIST_SORTS: RunListSort[] = ["urgent", "recent", "progress", "map"];
const NOTI_READ_FILTERS: NotiReadFilter[] = ["unread", "all"];
const FEEDBACK_STATUS_FILTERS: FeedbackStatusFilter[] = ["open", "all"];

export const DEFAULT_HOME_LIST_PREFS: HomeListPrefs = {
  runFilter: "all",
  runSort: "urgent",
  notiRead: "unread",
  notiCat: "all",
  fbStatus: "open",
  fbKind: "all",
};

const STORAGE_KEY = "bpm.home.lists";

// 저장값이 허용 목록에 있으면 그 값, 아니면 기본값 — 필드마다 따로 판정해 하나가 깨져도 나머지는 살린다
function pickAllowed<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((value) => value === raw) ?? fallback;
}

/** 저장된 선택 — 사생활 모드·차단(throw)·깨진 JSON·모르는 값은 기본값으로 수렴. */
export function loadHomeListPrefs(): HomeListPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_HOME_LIST_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_HOME_LIST_PREFS };
    const fields = new Map<string, unknown>(Object.entries(parsed));
    const d = DEFAULT_HOME_LIST_PREFS;
    return {
      runFilter: pickAllowed(fields.get("runFilter"), RUN_LIST_FILTERS, d.runFilter),
      runSort: pickAllowed(fields.get("runSort"), RUN_LIST_SORTS, d.runSort),
      notiRead: pickAllowed(fields.get("notiRead"), NOTI_READ_FILTERS, d.notiRead),
      notiCat: pickAllowed<NotificationCategory | "all">(fields.get("notiCat"), ["all", ...NOTIFICATION_CATEGORIES], d.notiCat),
      fbStatus: pickAllowed(fields.get("fbStatus"), FEEDBACK_STATUS_FILTERS, d.fbStatus),
      fbKind: pickAllowed<FeedbackKind | "all">(fields.get("fbKind"), ["all", ...FEEDBACK_KINDS], d.fbKind),
    };
  } catch {
    return { ...DEFAULT_HOME_LIST_PREFS };
  }
}

/** 선택 저장 — 실패(차단·용량)해도 화면의 선택은 state로 살아 있으니 이번 세션만 유지하면 된다. */
export function saveHomeListPrefs(prefs: HomeListPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 편의 저장일 뿐 — 다음 방문에 기본값으로 돌아갈 뿐이다
  }
}

/** "곧 중단"은 문제와 별개라 is_idle로 판정한다(R20) — 문제이면서 방치된 실행은 두 필 모두에 든다. */
export function filterRuns(runs: MeDashboardRun[], filter: RunListFilter): MeDashboardRun[] {
  switch (filter) {
    case "all":
      return runs;
    case "problem":
      return runs.filter((run) => run.state_kind === "problem");
    case "idle":
      return runs.filter((run) => run.is_idle);
    case "shared":
      return runs.filter((run) => run.scope === "shared");
    case "solo":
      return runs.filter((run) => run.scope === "solo");
  }
}

export function countRunFilters(runs: MeDashboardRun[]): Record<RunListFilter, number> {
  return {
    all: runs.length,
    problem: filterRuns(runs, "problem").length,
    idle: filterRuns(runs, "idle").length,
    shared: filterRuns(runs, "shared").length,
    solo: filterRuns(runs, "solo").length,
  };
}

// 급한 순 묶음 — 문제 → 곧 중단 → 나머지(서버 정렬 _RUN_KIND_ORDER와 같은 순서)
function getUrgencyRank(run: MeDashboardRun): number {
  if (run.state_kind === "problem") return 0;
  return run.is_idle ? 1 : 2;
}

function getProgressRatio(run: MeDashboardRun): number {
  return run.total > 0 ? run.done / run.total : 0;
}

/** 정렬된 새 배열 — 묶음·값이 같으면 마지막 손댄 때가 최근인 것이 먼저. */
export function sortRuns(runs: MeDashboardRun[], sort: RunListSort): MeDashboardRun[] {
  const byRecent = (a: MeDashboardRun, b: MeDashboardRun): number =>
    Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at);
  const compare: Record<RunListSort, (a: MeDashboardRun, b: MeDashboardRun) => number> = {
    urgent: (a, b) => getUrgencyRank(a) - getUrgencyRank(b) || byRecent(a, b),
    recent: byRecent,
    progress: (a, b) => getProgressRatio(a) - getProgressRatio(b) || byRecent(a, b),
    map: (a, b) => a.map_name.localeCompare(b.map_name, "ko") || byRecent(a, b),
  };
  return [...runs].sort(compare[sort]);
}

/** 피드백의 마지막 갱신 시각 — 응답에 updated_at이 없어 작성·본문 수정·답글·완료 시각 중 가장 늦은 것. */
export function getFeedbackUpdatedAt(item: FeedbackItem): string {
  let latest = item.created_at;
  for (const iso of [item.body_edited_at, item.reply_at, item.done_at]) {
    if (iso !== null && Date.parse(iso) > Date.parse(latest)) latest = iso;
  }
  return latest;
}

/** 내 피드백(작성자 = 현재 로그인)만, 최근 갱신 순. 로그인을 모르면 빈 목록. */
export function selectMyFeedback(items: FeedbackItem[], loginId: string): FeedbackItem[] {
  if (loginId === "") return [];
  return items
    .filter((item) => item.author === loginId)
    .sort((a, b) => Date.parse(getFeedbackUpdatedAt(b)) - Date.parse(getFeedbackUpdatedAt(a)));
}
