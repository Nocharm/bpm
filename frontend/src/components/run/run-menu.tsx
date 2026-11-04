"use client";

// 실행 진입 메뉴 — 맵 화면 상단바의 "Run" 버튼과 압축 드롭다운(내가 참여한 진행 중 3줄 + 최근 끝난 1줄 + 모든 실행 보기 + 새 실행,
// design run-check §4.1). Draft·결재 중·거절 버전과 업무 체계 캔버스에선 버튼이 꺼지고 이유를 툴팁으로 보인다.
// 드롭다운은 AI 메뉴와 같은 플로팅 크롬(z-1100, 바깥 누름·Esc 닫기), 본문은 열 때마다 마운트돼 목록을 다시 읽는다.

import { useEffect, useRef, useState } from "react";
import { ChevronRight, ListChecks, Plus } from "lucide-react";

import { listRuns, type Run } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getRunMenuDisabledReason, humanizeRunError } from "@/lib/run-view";
import { useAgo } from "@/lib/use-ago";
import { Tooltip } from "@/components/tooltip";

// 드롭다운 줄 수 — 진행 중 3 + 끝난 1 (design §4.1 [판단: 줄 수])
const OPEN_ROWS = 3;

interface RunMenuProps {
  mapId: number;
  versionStatus: string;
  isFrameworkMap: boolean;
  onOpenRun: (runId: number, versionId: number) => void;
  onNewRun: () => void;
  // 모든 실행 창 열기 — 없으면 "모든 실행 보기" 줄을 숨긴다(누를 곳 없는 버튼을 두지 않는다)
  onShowAll?: () => void;
}

interface RunMenuRows {
  open: Run[];
  ended: Run | null;
}

export function RunMenu({ mapId, versionStatus, isFrameworkMap, onOpenRun, onNewRun, onShowAll }: RunMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const disabledReason = getRunMenuDisabledReason(versionStatus, isFrameworkMap);

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
    if (disabledReason === null) setOpen((value) => !value);
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
      {open && (
        <RunMenuPopover
          mapId={mapId}
          onOpenRun={(runId, versionId) => pick(() => onOpenRun(runId, versionId))}
          onNewRun={() => pick(onNewRun)}
          onShowAll={onShowAll ? () => pick(onShowAll) : undefined}
        />
      )}
    </div>
  );
}

interface RunMenuPopoverProps {
  mapId: number;
  onOpenRun: (runId: number, versionId: number) => void;
  onNewRun: () => void;
  onShowAll?: () => void;
}

// 드롭다운 본문 — 열 때마다 새로 마운트돼 목록을 다시 읽고, 상대 시각(useAgo는 마운트 시점이 기준)도 그때로 맞춘다
function RunMenuPopover({ mapId, onOpenRun, onNewRun, onShowAll }: RunMenuPopoverProps) {
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
      <p className="px-2 pb-1 pt-1.5 text-fine font-semibold text-ink-tertiary">{t("run.menu.openHeading")}</p>
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
      {onShowAll && (
        <button
          type="button"
          data-id="run-menu-all"
          className="mt-1 flex w-full items-center justify-between rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink hover:bg-accent-tint hover:text-accent"
          onClick={onShowAll}
        >
          {t("run.menu.showAll")}
          <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />
        </button>
      )}
      <button
        type="button"
        data-id="run-menu-new"
        className="mt-1 flex w-full items-center gap-1.5 border-t border-hairline px-2 pb-1 pt-2 text-caption font-semibold text-accent hover:bg-accent-tint"
        onClick={onNewRun}
      >
        <Plus size={14} strokeWidth={1.5} className="shrink-0" />
        {t("run.menu.new")}
      </button>
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
