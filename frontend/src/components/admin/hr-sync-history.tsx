"use client";
// HR 전체 동기화 회차 이력 — 회차 요약 행 + 펼치면 바뀐 사람 목록 (설정 > Batch jobs 탭 HR 카드, BatchRunsPanel 전용).
// 대량 퇴직도 동기화를 멈추지 않고 기록한다(사용자 결정 2026-10-19) — 그 회차는 Mass departure 배지로 띄운다.

import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import {
  getHrSyncRun,
  listHrSyncRuns,
  type HrSyncChangeKind,
  type HrSyncRun,
  type HrSyncRunDetail,
} from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

// 펼친 목록 순서 — 사고 추적에 먼저 필요한 퇴직·삭제가 위
const CHANGE_KINDS: HrSyncChangeKind[] = ["deactivated", "deleted", "reactivated", "created", "duplicates"];

type DetailState = HrSyncRunDetail | "loading" | "error";

export function HrSyncHistory() {
  const { t } = useI18n();
  const [runs, setRuns] = useState<HrSyncRun[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, DetailState>>({});

  useEffect(() => {
    let alive = true;
    listHrSyncRuns()
      .then((rows) => {
        if (alive) setRuns(rows);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleToggle = (runId: number) => {
    if (openId === runId) {
      setOpenId(null);
      return;
    }
    setOpenId(runId);
    if (details[runId] && details[runId] !== "error") return;
    setDetails((prev) => ({ ...prev, [runId]: "loading" }));
    getHrSyncRun(runId)
      .then((detail) => setDetails((prev) => ({ ...prev, [runId]: detail })))
      .catch(() => setDetails((prev) => ({ ...prev, [runId]: "error" })));
  };

  return (
    <div data-id="hr-sync-history" className="mt-4 border-t border-hairline pt-3">
      <h4 className="text-fine font-semibold text-ink-tertiary">{t("batch.hr.history")}</h4>
      <p className="mt-0.5 text-fine text-ink-muted">{t("batch.hr.historyHint")}</p>
      {failed ? (
        <p data-id="hr-sync-history-error" className="mt-2 text-fine text-error">
          {t("batch.loadFailed")}
        </p>
      ) : runs === null ? (
        <p className="mt-2 text-fine text-ink-muted">…</p>
      ) : runs.length === 0 ? (
        <p data-id="hr-sync-history-empty" className="mt-2 text-fine text-ink-muted">
          {t("batch.hr.none")}
        </p>
      ) : (
        <ul data-id="hr-sync-history-list" className="mt-2 max-h-96 space-y-1 overflow-y-auto">
          {runs.map((run) => {
            const isOpen = openId === run.id;
            const counts = CHANGE_KINDS.filter((kind) => run[kind] > 0);
            return (
              <li key={run.id} data-id={`hr-sync-run-${run.id}`}>
                <button
                  type="button"
                  data-id={`hr-sync-run-toggle-${run.id}`}
                  aria-expanded={isOpen}
                  onClick={() => handleToggle(run.id)}
                  className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-sm px-1.5 py-1 text-left text-caption hover:bg-surface-alt"
                >
                  <ChevronRight
                    size={14}
                    strokeWidth={1.5}
                    className={`shrink-0 text-ink-tertiary transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
                  />
                  {run.outcome === "success" ? (
                    <CheckCircle2 size={14} strokeWidth={1.5} className="shrink-0 text-added" />
                  ) : (
                    <XCircle size={14} strokeWidth={1.5} className="shrink-0 text-error" />
                  )}
                  <span className="shrink-0 text-ink">{formatKst(run.ran_at)}</span>
                  {run.mass_departure && (
                    <span
                      data-id={`hr-sync-run-mass-${run.id}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-fine text-warn"
                    >
                      <AlertTriangle size={12} strokeWidth={1.5} />
                      {t("batch.hr.mass")}
                    </span>
                  )}
                  {run.outcome === "failure" ? (
                    <span className="min-w-0 break-all text-fine text-error">{run.detail}</span>
                  ) : (
                    <span className="min-w-0 text-fine text-ink-tertiary">
                      {[
                        t("batch.hr.scanned", { count: run.scanned }),
                        ...counts.map((kind) => t(`batch.hr.count.${kind}`, { count: run[kind] })),
                      ].join(" · ")}
                    </span>
                  )}
                </button>
                {isOpen && <HrSyncRunPeople state={details[run.id]} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HrSyncRunPeople({ state }: { state: DetailState | undefined }) {
  const { t } = useI18n();
  if (state === undefined || state === "loading") {
    return <p className="ml-8 py-1 text-fine text-ink-muted">…</p>;
  }
  if (state === "error") {
    return <p className="ml-8 py-1 text-fine text-error">{t("batch.hr.detailFailed")}</p>;
  }
  const groups = CHANGE_KINDS.filter((kind) => state.changes[kind].length > 0);
  if (groups.length === 0) {
    return (
      <p data-id={`hr-sync-run-nochange-${state.id}`} className="ml-8 py-1 text-fine text-ink-muted">
        {t("batch.hr.noChanges")}
      </p>
    );
  }
  return (
    <div data-id={`hr-sync-run-people-${state.id}`} className="ml-8 mt-1 space-y-2 pb-2">
      {groups.map((kind) => (
        <section key={kind} data-id={`hr-sync-run-${state.id}-${kind}`}>
          <h5 className="text-fine font-semibold text-ink-secondary">
            {t(`batch.hr.kind.${kind}`)} · {state.changes[kind].length}
          </h5>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
            {state.changes[kind].map((person) => (
              <li
                key={person.login_id}
                className="flex min-w-0 items-baseline gap-2 text-fine"
              >
                <span className="shrink-0 text-ink">{person.name || person.login_id}</span>
                <span className="shrink-0 font-mono text-ink-muted">{person.login_id}</span>
                {person.department && (
                  <span className="min-w-0 truncate text-ink-tertiary">{person.department}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
