"use client";

// 좌측 사이드바 "실행" 탭 — 실행 모드 맵 화면에서 상태 변경 이력과 코멘트를 최근 순으로 섞어 보인다(사용자 결정 2026-11-05,
// 오른쪽 인스펙터의 노드 속성과 함께 보려고 왼쪽에 둔다). 단계를 고르면 그 단계 것이 먼저(이 단계 · 전체 전환), 전체에선 줄의
// 단계 이름을 눌러 캔버스에서 그 단계로 간다. 이어진 같은 단계 줄은 한 묶음(단계 이름 한 번, 같은 사람 이름 생략, 날이 바뀌면
// 날짜 구분 줄, lib/run-history)이고, 묶음에 마우스를 올리면 캔버스의 그 노드를 강조한다(onHoverStep).
// 이력은 서버가 볼 수 있는 범위만 준다(listRunHistory). 실행이 바뀌면(동작·코멘트·폴링) 다시 읽는다.

import { useEffect, useEffectEvent, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Check,
  Hourglass,
  ListX,
  MessageCircle,
  Play,
  RotateCcw,
  Square,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import { listRunHistory, type RunHistoryItem } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useDirectoryState } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { RunGraph } from "@/lib/run-graph";
import { groupRunHistory } from "@/lib/run-history";
import { formatRunDay, humanizeRunError, splitRunNodeKey } from "@/lib/run-view";
import type { RunSession } from "@/lib/use-run-session";

type HistoryMode = "step" | "all";

// 이력 줄 아이콘·문구 — BE RunEvent.action 값마다. 모르는 값은 기본 아이콘과 원문
const ACTION_ICON: Record<string, LucideIcon> = {
  start: Play,
  complete: Check,
  problem: AlertCircle,
  resolve: CheckCircle2,
  unstart: Undo2,
  undo: Undo2,
  cleared: ListX,
  loop: RotateCcw,
  stop: Square,
  reopen: Play,
  auto_stop: Hourglass,
};

const ACTION_LABEL: Record<string, MessageKey> = {
  start: "run.history.action.start",
  complete: "run.history.action.complete",
  problem: "run.history.action.problem",
  resolve: "run.history.action.resolve",
  unstart: "run.history.action.unstart",
  undo: "run.history.action.undo",
  cleared: "run.history.action.cleared",
  loop: "run.history.action.loop",
  stop: "run.history.action.stop",
  reopen: "run.history.action.reopen",
  auto_stop: "run.history.action.autoStop",
};

// 동작 글씨 색 — 아이콘과 같은 뜻, 글씨는 한 단계 진하게(완료·해결 초록, 문제·함께 취소 빨강, 시작·다시 열기 악센트)
const ACTION_TEXT_TONE: Record<string, string> = {
  complete: "text-run-done",
  resolve: "text-run-done",
  problem: "text-run-problem",
  cleared: "text-run-problem",
  start: "text-accent",
  reopen: "text-accent",
};

// 아이콘 색 — 상태 색(globals.css --color-run-*)과 같은 뜻
const ACTION_TONE: Record<string, string> = {
  complete: "text-run-done",
  resolve: "text-run-done",
  problem: "text-run-problem",
  cleared: "text-run-problem",
  start: "text-accent",
  reopen: "text-accent",
};

interface RunHistoryPanelProps {
  session: RunSession;
  graphs: ReadonlyMap<string, RunGraph> | null;
  // 캔버스에서 고른 실행 노드 키 — 실행 그래프에 없는 노드면 null로 준다
  selectedKey: string | null;
  onSelect: (key: string) => void;
  // 줄에 올린 동안 캔버스에서 강조할 노드 키 — null이면 풀기
  onHoverStep: (key: string | null) => void;
}

interface LoadedHistory {
  key: string;
  items: RunHistoryItem[] | null;
  failure: { cause: unknown } | null;
}

export function RunHistoryPanel({ session, graphs, selectedKey, onSelect, onHoverStep }: RunHistoryPanelProps) {
  const { t } = useI18n();
  const { users } = useDirectoryState();
  const { detail } = session;
  const [mode, setMode] = useState<HistoryMode>("step");
  const [loaded, setLoaded] = useState<LoadedHistory | null>(null);
  const isStepMode = mode === "step" && selectedKey !== null;
  const target = isStepMode && selectedKey !== null ? splitRunNodeKey(selectedKey) : null;
  const targetScope = target?.scopePath ?? null;
  const targetNode = target?.nodeId ?? null;
  // 실행이 바뀌면(동작·코멘트 고치기·폴링) 같은 조건으로 다시 읽는다 — 마지막 손댄 때가 바뀐다
  const requestKey = `${detail.id}|${targetScope ?? "*"}|${targetNode ?? "*"}|${detail.last_activity_at}|${detail.status}`;

  useEffect(() => {
    let active = true;
    const scope = targetScope === null || targetNode === null ? undefined : { scopePath: targetScope, nodeId: targetNode };
    listRunHistory(detail.id, scope)
      .then((items) => {
        if (active) setLoaded({ key: requestKey, items, failure: null });
      })
      .catch((err: unknown) => {
        if (active) setLoaded({ key: requestKey, items: null, failure: { cause: err } });
      });
    return () => {
      active = false;
    };
  }, [requestKey, detail.id, targetScope, targetNode]);

  // 탭을 바꾸거나 실행을 닫아 패널이 사라지면 강조도 푼다 — 올려 둔 줄은 mouseleave 없이 사라진다
  const clearHoverOnUnmount = useEffectEvent(() => onHoverStep(null));
  useEffect(() => () => clearHoverOnUnmount(), []);

  const isLoading = loaded === null || loaded.key !== requestKey;
  const items = loaded?.items ?? null;
  // 이어진 같은 날·같은 단계 줄을 묶는다 — 날짜는 KST 달력 날짜
  const groups = items === null ? [] : groupRunHistory(items, (iso) => formatKst(iso).slice(0, 10));
  const nameOf = (login: string | null) =>
    login === null ? t("run.history.system") : (users.get(login)?.name ?? login);
  const getStepTitle = (item: RunHistoryItem): string => {
    if (item.node_title) return item.node_title;
    if (item.node_id === null) return "";
    return graphs?.get(item.scope_path)?.nodes.find((node) => node.id === item.node_id)?.title ?? "";
  };
  const selectedTitle =
    target !== null ? (graphs?.get(target.scopePath)?.nodes.find((node) => node.id === target.nodeId)?.title ?? "") : "";

  return (
    <section data-id="run-history" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body-strong text-ink">{t("run.history.title")}</h2>
        {selectedKey !== null && (
          <div
            role="group"
            aria-label={t("run.history.modeLabel")}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5"
          >
            {(["step", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                data-id={`run-history-mode-${key}`}
                aria-pressed={mode === key}
                className={`rounded-xs px-2 py-0.5 text-fine transition-colors ${
                  mode === key ? "bg-accent-tint font-semibold text-accent" : "text-ink-secondary hover:bg-surface-alt"
                }`}
                onClick={() => setMode(key)}
              >
                {t(key === "step" ? "run.history.modeStep" : "run.history.modeAll")}
              </button>
            ))}
          </div>
        )}
      </div>
      <p data-id="run-history-scope" className="break-words text-fine font-light leading-snug text-ink-tertiary">
        {isStepMode ? t("run.history.scopeStep", { title: selectedTitle || t("run.downstream.untitled") }) : t("run.history.scopeAll")}
      </p>
      {detail.status === "summarized" ? (
        <p data-id="run-history-summarized" className="py-6 text-center text-caption text-ink-tertiary">
          {t("run.history.summarized")}
        </p>
      ) : loaded !== null && loaded.failure !== null && !isLoading ? (
        <p data-id="run-history-error" className="py-6 text-center text-caption text-error">
          {humanizeRunError(loaded.failure.cause, t)}
        </p>
      ) : items === null ? (
        <p data-id="run-history-loading" className="py-6 text-center text-caption text-ink-tertiary">
          {t("common.loading")}
        </p>
      ) : items.length === 0 ? (
        <p data-id="run-history-empty" className="py-6 text-center text-caption text-ink-tertiary">
          {t(isStepMode ? "run.history.emptyStep" : "run.history.empty")}
        </p>
      ) : (
        <ol
          data-id="run-history-list"
          aria-busy={isLoading}
          className={`flex flex-col gap-1 transition-opacity ${isLoading ? "opacity-60" : ""}`}
        >
          {groups.map((group) => {
            const first = group.entries[0].item;
            const stepTitle = getStepTitle(first);
            const { stepKey } = group;
            // 이 단계 보기는 모두 같은 단계라 머리(단계 이름)를 쓰지 않는다
            const isHeaderShown = !isStepMode;
            return (
              <li
                key={group.key}
                data-id={`run-history-group-${group.key}`}
                className="flex flex-col"
                onMouseEnter={stepKey !== null ? () => onHoverStep(stepKey) : undefined}
                onMouseLeave={stepKey !== null ? () => onHoverStep(null) : undefined}
              >
                {group.isNewDay && (
                  <p
                    data-id={`run-history-day-${group.day}`}
                    className="mb-1 mt-2 flex items-center gap-2 text-fine font-semibold tracking-widest text-ink-muted"
                  >
                    <span className="shrink-0">{formatRunDay(first.created_at, t)}</span>
                    <span aria-hidden className="h-px flex-1 bg-hairline" />
                  </p>
                )}
                <div className="-mx-1 rounded-sm px-1 py-1 transition-colors duration-150 hover:bg-surface-alt">
                  {isHeaderShown &&
                    (stepKey !== null ? (
                      <button
                        type="button"
                        data-id={`run-history-step-${group.key}`}
                        className="flex max-w-full items-center gap-1.5 text-left text-[15px] font-semibold leading-tight text-ink transition-colors duration-150 hover:text-accent"
                        title={stepTitle}
                        onClick={() => onSelect(stepKey)}
                      >
                        <span className="truncate">{stepTitle || t("run.downstream.untitled")}</span>
                        {group.entries.length > 1 && (
                          <span className="shrink-0 rounded-full bg-accent-tint px-1.5 font-mono text-[11px] leading-4 text-accent">
                            {group.entries.length}
                          </span>
                        )}
                      </button>
                    ) : (
                      <p className="text-[15px] font-semibold leading-tight text-ink-secondary">{t("run.history.runLevel")}</p>
                    ))}
                  <ul className={`flex flex-col gap-1 ${isHeaderShown ? "ml-1 mt-1 border-l border-hairline pl-2" : ""}`}>
                    {group.entries.map(({ item, isSameActor }) => {
                      const Icon = item.kind === "comment" ? MessageCircle : (ACTION_ICON[item.action ?? ""] ?? Check);
                      const tone =
                        item.kind === "comment" ? "text-ink-tertiary" : (ACTION_TONE[item.action ?? ""] ?? "text-ink-tertiary");
                      const labelKey = item.action !== null ? ACTION_LABEL[item.action] : undefined;
                      const what =
                        item.kind === "comment"
                          ? t("run.history.comment")
                          : labelKey !== undefined
                            ? t(labelKey)
                            : (item.action ?? "");
                      const stamp = formatKst(item.created_at);
                      return (
                        <li key={`${item.kind}-${item.id}`} data-id={`run-history-${item.kind}-${item.id}`} className="flex gap-2">
                          <span className={`mt-0.5 shrink-0 ${tone}`}>
                            <Icon size={14} strokeWidth={1.5} />
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex items-baseline justify-between gap-2">
                              {/* 동작이 먼저 — 좁은 사이드바에서 잘리는 쪽은 사람 이름. 바로 위 줄과 같은 사람이면 이름을 다시 쓰지 않는다(lib/run-history) */}
                              <span className="min-w-0 truncate" title={`${what} · ${nameOf(item.actor)}`}>
                                {/* 동작은 상태 색의 굵은 글씨, 사람은 작고 가는 글씨 — 한 줄에서 무엇을 했는지가 먼저 읽히게 */}
                                <span className={`text-caption-strong ${item.kind === "comment" ? "text-ink-secondary" : (ACTION_TEXT_TONE[item.action ?? ""] ?? "text-ink")}`}>
                                  {what}
                                </span>
                                {!isSameActor && (
                                  <span className="text-fine font-light text-ink-tertiary"> · {nameOf(item.actor)}</span>
                                )}
                              </span>
                              <time
                                dateTime={item.created_at}
                                className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted"
                                title={stamp}
                              >
                                {stamp.slice(11)}
                              </time>
                            </div>
                            {item.kind === "comment" && item.body !== null && (
                              <p className="whitespace-pre-wrap break-words border-l-2 border-accent-tint-border pl-2 text-[13px] font-light leading-relaxed text-ink">
                                {item.body}
                                {item.edited_at !== null && (
                                  <span className="ml-1 text-fine text-ink-tertiary">{t("run.pop.commentEditedTag")}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
