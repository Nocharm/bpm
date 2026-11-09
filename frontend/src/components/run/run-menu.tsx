"use client";

// 실행 진입 메뉴 — 맵 화면 상단바의 "Run" 버튼과 압축 드롭다운(내가 참여한 진행 중 3줄 + 최근 끝난 1줄 + 새 실행,
// design run-check §4.1). 모든 실행 보기는 머리 줄 오른쪽 작은 아이콘 버튼(호버 툴팁, 사용자 결정 2026-11-05). Draft·결재 중·거절 버전에선
// 새 Run 자리에 "게시본으로 가기"를 두고(사용자 결정 2026-11-09), 게시본이 없는 맵과 업무 체계 캔버스에선 버튼이 꺼지고 이유를 툴팁으로 보인다.
// 드롭다운은 AI 메뉴와 같은 플로팅 크롬(z-1100, 바깥 누름·Esc 닫기), 본문은 열 때마다 마운트돼 목록을 다시 읽는다.
// Run을 해 본 적 없는 사람에게는 버튼 아래 소개 말풍선(run-intro-bubble.tsx)을 잠깐 띄운다(사용자 결정 2026-11-08).

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowRight, ListChecks, ListTree, Plus } from "lucide-react";

import { listRuns, type Run } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { isRunIntroDone, markRunIntroDone, RUN_INTRO_DELAY_MS, shouldShowRunIntro } from "@/lib/run-intro";
import { getRunMenuDisabledReason, getRunMenuMode, humanizeRunError } from "@/lib/run-view";
import { useAgo } from "@/lib/use-ago";
import { RunIntroBubble } from "@/components/run/run-intro-bubble";
import { Tooltip } from "@/components/tooltip";

// 드롭다운 줄 수 — 진행 중 3 + 끝난 1 (design §4.1 [판단: 줄 수])
const OPEN_ROWS = 3;

interface RunMenuProps {
  mapId: number;
  versionStatus: string;
  isFrameworkMap: boolean;
  // 게시본·지난 게시본이 하나라도 있는지 — Draft에서 "게시본으로 가기"를 둘지 정한다
  hasRunnableVersion: boolean;
  onOpenRun: (runId: number, versionId: number) => void;
  onNewRun: () => void;
  // 게시본으로 전환 — Draft·결재 중·거절 버전에서 새 Run 대신
  onGoToPublished: () => void;
  // 모든 실행 창 열기 — 없으면 "모든 실행 보기" 줄을 숨긴다(누를 곳 없는 버튼을 두지 않는다)
  onShowAll?: () => void;
  // Run 화면이나 새 Run 창이 열려 있음 — 소개 말풍선을 띄우지 않고, 떠 있으면 거둔다
  introSuppressed: boolean;
}

interface RunMenuRows {
  open: Run[];
  ended: Run | null;
}

export function RunMenu({
  mapId,
  versionStatus,
  isFrameworkMap,
  hasRunnableVersion,
  onOpenRun,
  onNewRun,
  onGoToPublished,
  onShowAll,
  introSuppressed,
}: RunMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [isIntroShown, setIsIntroShown] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const mode = getRunMenuMode(versionStatus, isFrameworkMap, hasRunnableVersion);
  const disabledReason = getRunMenuDisabledReason(mode);
  const isRunMap = mode !== "framework";

  // Run 화면·새 Run 창이 열리면 떠 있던 소개를 거둔다(렌더 중 조정 — 닫힌 뒤 다시 뜨지 않게 상태에서 지운다)
  if (isIntroShown && introSuppressed) setIsIntroShown(false);

  const revealIntro = useEffectEvent((hasMyRuns: boolean) => {
    if (hasMyRuns) markRunIntroDone(); // 이 배포 전에 Run을 써 본 사람 — 다시 묻지 않는다
    if (shouldShowRunIntro({ isDone: isRunIntroDone(), isRunMap, isSuppressed: introSuppressed || open, hasMyRuns })) {
      setIsIntroShown(true);
    }
  });

  // Run 소개 — 업무 체계 캔버스가 아니고 아직 Run을 해 본 적 없으면, 이 맵의 내 Run 기록을 확인하고 잠시 뒤 띄운다.
  // 메뉴 모양이 바뀌면(Draft에서 게시본으로 가기 등) 다시 확인해 그 버전에 맞는 말풍선을 띄운다
  useEffect(() => {
    if (!isRunMap || isRunIntroDone()) return;
    let active = true;
    let timer: number | undefined;
    Promise.all([listRuns(mapId, { tab: "open", mine: true }), listRuns(mapId, { tab: "ended", mine: true })])
      .then(([openList, endedList]) => {
        if (!active) return;
        const hasMyRuns = openList.items.length > 0 || endedList.items.length > 0;
        timer = window.setTimeout(() => revealIntro(hasMyRuns), hasMyRuns ? 0 : RUN_INTRO_DELAY_MS);
      })
      .catch((err: unknown) => {
        // 소개는 부가 안내라 목록을 못 읽으면 조용히 건너뛴다(Run 메뉴 자체는 열 때 다시 읽고 오류를 보인다)
        console.warn("run intro: listing my runs failed", { mapId, err });
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isRunMap, mode, mapId]);

  useEffect(() => {
    if (!open) return;
    const handleDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handleDown, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleDown, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleToggle = () => {
    if (disabledReason !== null) return;
    setIsIntroShown(false); // 메뉴를 직접 열었으면 소개는 할 일을 다 했다
    setOpen((value) => !value);
  };

  const handleIntroAction = () => {
    setIsIntroShown(false);
    if (mode === "goPublished") onGoToPublished();
    else onNewRun();
  };

  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  const trigger = (
    <button
      type="button"
      data-id="run-menu"
      aria-disabled={disabledReason !== null}
      aria-expanded={open}
      className={
        "inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-caption " +
        (disabledReason !== null
          ? "cursor-not-allowed text-ink-tertiary opacity-60"
          : `text-ink-secondary hover:bg-surface-alt${open ? " bg-surface-alt text-ink" : ""}`)
      }
      onClick={handleToggle}
    >
      <ListChecks size={16} strokeWidth={1.5} />
      {t("run.menu.button")}
    </button>
  );

  return (
    <div className="relative" ref={rootRef}>
      {disabledReason !== null ? <Tooltip content={t(disabledReason)}>{trigger}</Tooltip> : trigger}
      {isIntroShown && mode !== "framework" && !open && (
        <RunIntroBubble mode={mode} onAction={handleIntroAction} onDismiss={() => setIsIntroShown(false)} />
      )}
      {open && (
        <RunMenuPopover
          mapId={mapId}
          onOpenRun={(runId, versionId) => pick(() => onOpenRun(runId, versionId))}
          isGoToPublished={mode === "goPublished"}
          onNewRun={() => pick(mode === "goPublished" ? onGoToPublished : onNewRun)}
          onShowAll={onShowAll ? () => pick(onShowAll) : undefined}
        />
      )}
    </div>
  );
}

interface RunMenuPopoverProps {
  mapId: number;
  onOpenRun: (runId: number, versionId: number) => void;
  // 새 Run 자리가 "게시본으로 가기"인지(Draft·결재 중·거절 버전)
  isGoToPublished: boolean;
  onNewRun: () => void;
  onShowAll?: () => void;
}

// 드롭다운 본문 — 열 때마다 새로 마운트돼 목록을 다시 읽고, 상대 시각(useAgo는 마운트 시점이 기준)도 그때로 맞춘다
function RunMenuPopover({ mapId, onOpenRun, isGoToPublished, onNewRun, onShowAll }: RunMenuPopoverProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const [rows, setRows] = useState<RunMenuRows | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listRuns(mapId, { tab: "open", mine: true }), listRuns(mapId, { tab: "ended", mine: true })])
      .then(([openList, endedList]) => {
        if (active) setRows({ open: openList.items.slice(0, OPEN_ROWS), ended: endedList.items[0] ?? null });
      })
      .catch((err: unknown) => {
        if (active) setLoadError(humanizeRunError(err, t));
      });
    return () => {
      active = false;
    };
  }, [mapId, t]);

  const formatSub = (run: Run, when: string): string => {
    const scope =
      run.scope === "shared"
        ? t("run.scope.sharedCount", { n: run.participants.length })
        : t("run.scope.solo");
    const version = run.version_number !== null ? `v${run.version_number}` : run.version_label;
    return [scope, version, when].filter(Boolean).join(" · ");
  };

  const endedRun = rows?.ended ?? null;
  return (
    <div
      data-id="run-menu-pop"
      className="absolute right-0 top-full z-[1100] mt-1 w-72 rounded-md border p-1 glass glass-dense"
    >
      <div className="flex items-center justify-between gap-2 pl-2 pt-0.5">
        <p className="text-fine font-semibold text-ink-tertiary">{t("run.menu.openHeading")}</p>
        {onShowAll && (
          <Tooltip label={t("run.menu.showAll")}>
            <button
              type="button"
              data-id="run-menu-all"
              aria-label={t("run.menu.showAll")}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-tertiary hover:bg-surface-alt hover:text-accent"
              onClick={onShowAll}
            >
              <ListTree size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
      </div>
      {loadError !== null ? (
        <p data-id="run-menu-error" className="px-2 py-1.5 text-fine text-error">
          {loadError}
        </p>
      ) : rows === null ? (
        <p data-id="run-menu-loading" className="px-2 py-1.5 text-fine text-ink-tertiary">
          {t("common.loading")}
        </p>
      ) : rows.open.length === 0 ? (
        <p data-id="run-menu-empty" className="px-2 py-1.5 text-fine text-ink-tertiary">
          {t("run.menu.emptyOpen")}
        </p>
      ) : (
        rows.open.map((run) => (
          <RunMenuRow
            key={run.id}
            run={run}
            sub={formatSub(run, ago(run.last_activity_at))}
            onOpen={() => onOpenRun(run.id, run.version_id)}
          />
        ))
      )}
      {endedRun !== null && (
        <>
          <p className="px-2 pb-1 pt-2 text-fine font-semibold text-ink-tertiary">{t("run.menu.endedHeading")}</p>
          <RunMenuRow
            run={endedRun}
            sub={formatSub(endedRun, ago(endedRun.ended_at))}
            onOpen={() => onOpenRun(endedRun.id, endedRun.version_id)}
          />
        </>
      )}
      {isGoToPublished ? (
        <div className="mt-1 border-t border-hairline pt-1.5">
          <p data-id="run-menu-go-published-hint" className="px-2 text-fine text-ink-tertiary">
            {t("run.menu.goPublishedHint")}
          </p>
          <button
            type="button"
            data-id="run-menu-go-published"
            className="mt-0.5 flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-caption font-semibold text-accent hover:bg-accent-tint"
            onClick={onNewRun}
          >
            <ArrowRight size={14} strokeWidth={1.5} className="shrink-0" />
            {t("run.menu.goPublished")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-id="run-menu-new"
          className="mt-1 flex w-full items-center gap-1.5 border-t border-hairline px-2 pb-1 pt-2 text-caption font-semibold text-accent hover:bg-accent-tint"
          onClick={onNewRun}
        >
          <Plus size={14} strokeWidth={1.5} className="shrink-0" />
          {t("run.menu.new")}
        </button>
      )}
    </div>
  );
}

interface RunMenuRowProps {
  run: Run;
  sub: string;
  onOpen: () => void;
}

function RunMenuRow({ run, sub, onOpen }: RunMenuRowProps) {
  const { t } = useI18n();
  const { done, total } = run.progress;
  const isEnded = run.status !== "open";
  return (
    <button
      type="button"
      data-id={`run-menu-row-${run.id}`}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-alt"
      onClick={onOpen}
    >
      <span className="truncate text-caption-strong text-ink" title={run.name}>
        {run.name}
      </span>
      <span className="row-span-2 flex items-center gap-1.5 text-fine tabular-nums text-ink-secondary">
        {isEnded ? (
          <span
            className={`rounded-full border px-1.5 py-px text-fine ${
              run.status === "done"
                ? "border-added/40 bg-added/10 text-added"
                : "border-hairline bg-surface-alt text-ink-secondary"
            }`}
          >
            {run.status === "done" ? t("run.menu.resultDone") : t("run.menu.resultStopped")}
          </span>
        ) : (
          <>
            <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-alt">
              <span
                className="block h-full rounded-full bg-run-done"
                style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
              />
            </span>
            {done}/{total}
          </>
        )}
      </span>
      <span className="truncate text-fine text-ink-tertiary">{sub}</span>
    </button>
  );
}
