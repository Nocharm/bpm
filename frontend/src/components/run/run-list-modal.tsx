"use client";

// 모든 실행 창 — 맵의 실행을 진행 중·끝남·요약 세 탭으로 훑는 새 창(실행 메뉴 "모든 실행 보기", design run-check §4.3·§4.6).
// 이름·LOT 검색(250ms 디바운스)·"내가 참여한 것만"·"영구 보존만" 거르기, 8줄 쪽 나눔, 줄마다 영구 보존 책갈피.
// 요약된 실행은 열 수 없고 한 줄 집계(결과·기간·버전·문제 단계 수·참여자)만 보인다. 목록은 서버가 거르고 나눈다(listRuns).
// 위 "이 맵 · 다른 맵" 칸 — 다른 맵은 내가 참여한 다른 맵의 실행(listMyRuns)이고 줄마다 맵 이름, 누르면 그 맵의 실행 화면으로
// 간다(사용자 결정 2026-11-05: 끝난 실행만 남아도 맵을 찾지 않고 연다).

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Map as MapIcon, Search, X } from "lucide-react";

import { listMyRuns, listRuns, patchRun, type Run, type RunList, type RunListTab, type RunSummaryInfo } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/me";
import { formatRunDay, formatRunSummaryParts, formatSummaryCountdown, humanizeRunError } from "@/lib/run-view";
import { useAgo } from "@/lib/use-ago";
import { CheckInput } from "@/components/check-input";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { Pagination } from "@/components/pagination";
import { Tooltip } from "@/components/tooltip";
import { UserPill } from "@/components/user-pill";

// 이름 검색 디바운스(ms) — 한 글자마다 서버를 부르지 않는다
const SEARCH_DEBOUNCE_MS = 250;

const TABS: readonly RunListTab[] = ["open", "ended", "summary"];

// 위 칸 — 이 맵의 실행 · 내가 참여한 다른 맵의 실행
type RunListSection = "here" | "other";
const SECTIONS: readonly RunListSection[] = ["here", "other"];

type ToastFn = (msg: string, tone?: "error") => void;

interface RunListModalProps {
  mapId: number;
  onClose: () => void;
  // 다른 맵 칸의 줄은 그 맵 id를 함께 준다 — 맵 화면이 그 맵의 실행 주소로 간다
  onOpenRun: (runId: number, versionId: number, mapId: number) => void;
  onToast: ToastFn;
  // 맵 오너 — 공유 실행의 영구 보존은 시작한 사람과 맵 오너만 켜고 끈다(서버 can_keep과 같은 기준)
  isMapOwner?: boolean;
}

// 한 번의 읽기 결과 — 어느 조건(key)에서 읽었는지 같이 둬서 "읽는 중"을 이펙트 안 setState 없이 파생한다
interface LoadedRuns {
  key: string;
  list: RunList | null;
  // 읽기 실패 — 문구는 그릴 때 현재 언어로 만든다(이펙트가 t에 매이지 않게)
  failure: { cause: unknown } | null;
}

export function RunListModal({ mapId, onClose, onOpenRun, onToast, isMapOwner = false }: RunListModalProps) {
  const { t } = useI18n();
  const me = useMe()?.username ?? null;
  const [section, setSection] = useState<RunListSection>("here");
  const [tab, setTab] = useState<RunListTab>("open");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [isMineOnly, setIsMineOnly] = useState(false);
  const [isKeptOnly, setIsKeptOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<LoadedRuns | null>(null);
  // 책갈피를 바꾼 뒤 같은 조건으로 다시 읽는다
  const [reloadKey, setReloadKey] = useState(0);
  const [busyRunId, setBusyRunId] = useState<number | null>(null);
  const appliedQueryRef = useRef("");
  // 요약 전 남은 날 계산의 기준 시각 — 창을 연 때
  const [now] = useState(() => new Date());

  // 요약 탭엔 영구 보존이 없다(요약된 실행은 보존할 수 없다) — 거르기도 숨기고 서버에도 보내지 않는다.
  // 다른 맵 칸은 이미 내가 참여한 실행만이라 두 거르기를 모두 숨긴다
  const isOther = section === "other";
  const isKeptFilterShown = tab !== "summary" && !isOther;
  const keptParam = isKeptFilterShown && isKeptOnly;
  const mineParam = !isOther && isMineOnly;
  const requestKey = `${section}|${tab}|${query}|${mineParam}|${keptParam}|${page}|${reloadKey}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = queryInput.trim();
      if (next === appliedQueryRef.current) return;
      appliedQueryRef.current = next;
      setQuery(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    let active = true;
    const request =
      section === "other"
        ? listMyRuns({ tab, q: query, page, excludeMapId: mapId })
        : listRuns(mapId, { tab, q: query, mine: mineParam, kept: keptParam, page });
    request
      .then((list) => {
        if (!active) return;
        // 마지막 쪽의 마지막 줄이 사라졌으면(책갈피를 꺼서 "영구 보존만"에서 빠짐 등) 한 쪽 앞으로
        if (list.items.length === 0 && list.total > 0 && page > 1) {
          setPage(Math.max(1, Math.ceil(list.total / list.page_size)));
          return;
        }
        setLoaded({ key: requestKey, list, failure: null });
      })
      .catch((err: unknown) => {
        if (active) setLoaded({ key: requestKey, list: null, failure: { cause: err } });
      });
    return () => {
      active = false;
    };
  }, [mapId, section, tab, query, mineParam, keptParam, page, requestKey]);

  const isLoading = loaded === null || loaded.key !== requestKey;
  const list = loaded?.list ?? null;

  const handleTab = (next: RunListTab) => {
    if (next === tab) return;
    setTab(next);
    setPage(1);
  };

  const handleSection = (next: RunListSection) => {
    if (next === section) return;
    setSection(next);
    setPage(1);
  };

  const handleToggleKeep = async (run: Run) => {
    setBusyRunId(run.id);
    try {
      await patchRun(run.id, { keep: !run.keep });
      onToast(run.keep ? t("run.bar.keepOff") : t("run.bar.keepOn"));
      setReloadKey((value) => value + 1);
    } catch (err) {
      onToast(humanizeRunError(err, t), "error");
      // 먼저 바뀌었을 수 있다(상한·권한) — 줄을 최신으로
      setReloadKey((value) => value + 1);
    } finally {
      setBusyRunId(null);
    }
  };

  const handleOpen = (run: Run) => {
    onClose();
    onOpenRun(run.id, run.version_id, run.map_id);
  };

  const pageSize = list?.page_size ?? 8;
  const rangeFrom = list === null || list.items.length === 0 ? 0 : (list.page - 1) * pageSize + 1;
  const rangeTo = list === null ? 0 : rangeFrom + list.items.length - 1;

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="run-list-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("run.list.title")}
        className="flex h-[min(42rem,calc(100vh-4rem))] w-full max-w-xl flex-col gap-3 rounded-md border p-5 glass glass-dense"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-body-strong text-ink">{t("run.list.title")}</h2>
          <button
            type="button"
            data-id="run-list-close"
            aria-label={t("run.list.close")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div role="tablist" aria-label={t("run.list.sections")} className="flex shrink-0 gap-4 border-b border-hairline">
          {SECTIONS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              data-id={`run-list-section-${key}`}
              aria-selected={section === key}
              className={`-mb-px border-b-2 px-0.5 pb-1.5 text-caption transition-colors ${
                section === key
                  ? "border-accent font-semibold text-ink"
                  : "border-transparent text-ink-secondary hover:text-ink"
              }`}
              onClick={() => handleSection(key)}
            >
              {t(`run.list.section.${key}`)}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label={t("run.list.tabs")}
          className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-sm border border-hairline bg-surface p-0.5"
        >
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              data-id={`run-list-tab-${key}`}
              aria-pressed={tab === key}
              className={`rounded-xs px-3 py-1 text-caption transition-colors ${
                tab === key ? "bg-accent-tint font-semibold text-accent" : "text-ink-secondary hover:bg-surface-alt"
              }`}
              onClick={() => handleTab(key)}
            >
              {t(`run.list.tab.${key}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex min-w-48 flex-1 items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-caption text-ink">
            <Search size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            <input
              data-id="run-list-search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={t(isOther ? "run.list.searchOther" : "run.list.search")}
              aria-label={t(isOther ? "run.list.searchOther" : "run.list.search")}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-muted"
            />
          </label>
          {!isOther && (
            <label className="flex cursor-pointer items-center gap-1.5 text-caption text-ink-secondary">
              <CheckInput
                data-id="run-list-mine"
                checked={isMineOnly}
                onChange={() => {
                  setIsMineOnly((value) => !value);
                  setPage(1);
                }}
              />
              {t("run.list.mine")}
            </label>
          )}
          {isKeptFilterShown && (
            <label className="flex cursor-pointer items-center gap-1.5 text-caption text-ink-secondary">
              <CheckInput
                data-id="run-list-kept-only"
                checked={isKeptOnly}
                onChange={() => {
                  setIsKeptOnly((value) => !value);
                  setPage(1);
                }}
              />
              {t("run.list.kept")}
            </label>
          )}
        </div>

        <div
          data-id="run-list-rows"
          aria-busy={isLoading}
          className={`min-h-0 flex-1 overflow-auto border-t border-hairline transition-opacity ${
            isLoading && list !== null ? "opacity-60" : ""
          }`}
        >
          {loaded === null ? (
            <p data-id="run-list-loading" className="py-7 text-center text-caption text-ink-tertiary">
              {t("common.loading")}
            </p>
          ) : loaded.failure !== null && !isLoading ? (
            <p data-id="run-list-error" className="py-7 text-center text-caption text-error">
              {humanizeRunError(loaded.failure.cause, t)}
            </p>
          ) : list !== null && list.items.length === 0 && !isLoading ? (
            <p data-id="run-list-empty" className="py-7 text-center text-caption text-ink-tertiary">
              {t(isOther ? "run.list.emptyOther" : "run.list.empty")}
            </p>
          ) : (
            <ul>
              {(list?.items ?? []).map((run) => (
                <RunListRow
                  key={run.id}
                  run={run}
                  now={now}
                  showMap={run.map_id !== mapId}
                  canKeep={run.starter === me || (run.scope === "shared" && isMapOwner && run.map_id === mapId)}
                  isBusy={busyRunId === run.id}
                  onOpen={() => handleOpen(run)}
                  onToggleKeep={() => void handleToggleKeep(run)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-7 items-center justify-between gap-2">
          <span data-id="run-list-range" className="text-fine tabular-nums text-ink-tertiary">
            {list !== null && list.total > 0 ? t("run.list.range", { from: rangeFrom, to: rangeTo, total: list.total }) : ""}
          </span>
          <Pagination dataId="run-list-pager" total={list?.total ?? 0} pageSize={pageSize} page={page} onPage={setPage} />
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}

interface RunListRowProps {
  run: Run;
  now: Date;
  // 다른 맵의 실행 — 부제 맨 앞에 맵 이름
  showMap: boolean;
  canKeep: boolean;
  isBusy: boolean;
  onOpen: () => void;
  onToggleKeep: () => void;
}

// 줄 하나 — 모양은 줄의 상태(진행 중·끝남·요약됨)가 정한다. 탭이 바뀌는 사이 남은 이전 줄도 제 모양으로 그려진다
function RunListRow({ run, now, showMap, canKeep, isBusy, onOpen, onToggleKeep }: RunListRowProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const isOpen = run.status === "open";
  const versionMarker = run.version_number !== null ? `v${run.version_number}` : run.version_label;
  const scopeLabel =
    run.scope === "shared" ? t("run.scope.sharedCount", { n: run.participants.length }) : t("run.scope.solo");
  const keptTag = (
    <span className="shrink-0 whitespace-nowrap font-semibold text-accent">
      {t("run.list.keptTag")}
    </span>
  );

  if (run.status === "summarized" && run.summary !== null) {
    return (
      <li data-id={`run-list-row-${run.id}`} className="flex items-center gap-2 border-b border-hairline py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-caption-strong text-ink" title={run.name}>
            {run.name}
          </span>
          <SummarySub summary={run.summary} />
        </div>
        <ResultChip isDone={run.summary.result === "completed"} />
        <span className="w-8 shrink-0" />
      </li>
    );
  }

  const parts: ReactNode[] = [scopeLabel, versionMarker];
  if (showMap) {
    parts.unshift(
      <span data-id={`run-list-map-${run.id}`} className="flex min-w-0 items-center gap-1 text-ink-secondary" title={run.map_name}>
        <MapIcon size={12} strokeWidth={1.5} className="shrink-0" />
        <span className="truncate">{run.map_name}</span>
      </span>,
    );
  }
  if (isOpen) {
    parts.push(ago(run.last_activity_at));
    if (run.keep) parts.push(keptTag);
  } else {
    if (run.ended_at !== null) parts.push(t("run.list.endedOn", { day: formatRunDay(run.ended_at, t) }));
    if (run.keep) {
      parts.push(keptTag);
    } else {
      const daysLeft = formatSummaryCountdown(run.summarize_after, now);
      if (daysLeft !== null) parts.push(daysLeft === 0 ? t("run.list.summarySoon") : t("run.list.summaryIn", { n: daysLeft }));
    }
  }
  const { done, total } = run.progress;
  const keepLabel = run.keep ? t("run.list.keepOff", { name: run.name }) : t("run.list.keepOn", { name: run.name });

  return (
    <li data-id={`run-list-row-${run.id}`} className="flex items-center gap-2 border-b border-hairline py-2">
      <button
        type="button"
        data-id={`run-list-open-${run.id}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm text-left hover:bg-surface-alt"
        onClick={onOpen}
      >
        <span className="truncate text-caption-strong text-ink" title={run.name}>
          {run.name}
        </span>
        <SubLine parts={parts} />
      </button>
      {isOpen ? (
        <span className="flex shrink-0 items-center gap-1.5 text-fine tabular-nums text-ink-secondary">
          <span className="h-1 w-10 overflow-hidden rounded-full bg-hairline">
            <span
              className="block h-full rounded-full bg-run-done"
              style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
            />
          </span>
          {done}/{total}
        </span>
      ) : (
        <ResultChip isDone={run.status === "done"} />
      )}
      <span className="flex w-8 shrink-0 justify-center">
        {canKeep ? (
          <Tooltip label={keepLabel}>
            <button
              type="button"
              data-id={`run-list-keep-${run.id}`}
              aria-pressed={run.keep}
              aria-label={keepLabel}
              disabled={isBusy}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-surface-alt disabled:opacity-60 ${
                run.keep ? "text-accent" : "text-ink-tertiary"
              }`}
              onClick={onToggleKeep}
            >
              <Bookmark size={16} strokeWidth={1.5} fill={run.keep ? "currentColor" : "none"} />
            </button>
          </Tooltip>
        ) : (
          run.keep && (
            <span data-id={`run-list-kept-${run.id}`} className="inline-flex h-7 w-7 items-center justify-center text-accent">
              <Bookmark size={16} strokeWidth={1.5} fill="currentColor" />
            </span>
          )
        )}
      </span>
    </li>
  );
}

function SubLine({ parts }: { parts: ReactNode[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden text-fine text-ink-tertiary">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true">·</span>}
          {typeof part === "string" ? <span className="whitespace-nowrap">{part}</span> : part}
        </Fragment>
      ))}
    </span>
  );
}

// 요약 줄의 부제 — 기간 · 버전 · 문제 단계 수 · 참여자("박서연 외 2명")
function SummarySub({ summary }: { summary: RunSummaryInfo }) {
  const { t } = useI18n();
  const people = summary.participants.length > 0 ? summary.participants : [summary.starter];
  const parts: ReactNode[] = formatRunSummaryParts(summary, t);
  parts.push(
    <span className="flex min-w-0 items-center gap-1">
      <UserPill loginId={people[0]} />
      {people.length > 1 && (
        <span className="whitespace-nowrap">{t("run.list.andOthers", { n: people.length - 1 })}</span>
      )}
    </span>,
  );
  return <SubLine parts={parts} />;
}

function ResultChip({ isDone }: { isDone: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-px text-fine ${
        isDone ? "border-added/40 bg-added/10 text-added" : "border-hairline bg-surface-alt text-ink-secondary"
      }`}
    >
      {isDone ? t("run.menu.resultDone") : t("run.menu.resultStopped")}
    </span>
  );
}
