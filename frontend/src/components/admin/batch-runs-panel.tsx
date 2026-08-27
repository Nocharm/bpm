"use client";
// 배치 작업(DB 백업·HR 동기화) 최근 실행 상태 — 잡·결과별 최신 1행 (설정 > Batch jobs 탭, sysadmin 전용).
// 서버 기록: 백업=scripts/db-backup.sh(psql), HR=backend run_full_sync — 최신 성공·실패만 upsert 보전.

import { CheckCircle2, DatabaseBackup, Users, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { listBatchRuns, type BatchRun } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const JOBS = [
  { id: "db_backup", labelKey: "batch.job.db_backup", icon: DatabaseBackup },
  { id: "hr_sync", labelKey: "batch.job.hr_sync", icon: Users },
] as const;

export function BatchRunsPanel() {
  const { t } = useI18n();
  const [runs, setRuns] = useState<BatchRun[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    listBatchRuns()
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

  return (
    <div data-id="batch-runs-panel" className="max-w-2xl">
      <h2 className="text-body-strong text-ink">{t("batch.tab")}</h2>
      <p className="mt-1 text-caption text-ink-tertiary">{t("batch.desc")}</p>
      {failed && (
        <p data-id="batch-runs-error" className="mt-4 text-caption text-error">
          {t("batch.loadFailed")}
        </p>
      )}
      <div className="mt-4 space-y-3">
        {JOBS.map(({ id, labelKey, icon: Icon }) => {
          const byOutcome = new Map(
            (runs ?? []).filter((r) => r.job === id).map((r) => [r.outcome, r]),
          );
          const success = byOutcome.get("success");
          const failure = byOutcome.get("failure");
          // 최근 시도 = 두 기록 중 나중 것 — 그 결과가 현재 상태 배지
          const latest =
            success && failure
              ? new Date(success.ran_at) >= new Date(failure.ran_at)
                ? success
                : failure
              : (success ?? failure);
          return (
            <section
              key={id}
              data-id={`batch-run-${id}`}
              className="rounded-md border border-hairline bg-surface p-4"
            >
              <div className="flex items-center gap-2">
                <Icon size={16} strokeWidth={1.5} className="text-ink-tertiary" />
                <h3 className="text-caption-strong text-ink">{t(labelKey)}</h3>
                {latest ? (
                  <span
                    data-id={`batch-run-${id}-status`}
                    className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-fine ${
                      latest.outcome === "success"
                        ? "bg-added/10 text-added"
                        : "bg-error/10 text-error"
                    }`}
                  >
                    {latest.outcome === "success" ? (
                      <CheckCircle2 size={12} strokeWidth={1.5} />
                    ) : (
                      <XCircle size={12} strokeWidth={1.5} />
                    )}
                    {t(latest.outcome === "success" ? "batch.outcome.success" : "batch.outcome.failure")}
                  </span>
                ) : (
                  <span className="ml-auto text-fine text-ink-muted">{t("batch.noRuns")}</span>
                )}
              </div>
              {latest && (
                <dl className="mt-3 space-y-1.5 text-caption">
                  <div className="flex gap-3">
                    <dt className="w-24 shrink-0 text-ink-tertiary">{t("batch.lastAttempt")}</dt>
                    <dd className="text-ink">{formatKst(latest.ran_at)}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-24 shrink-0 text-ink-tertiary">{t("batch.lastSuccess")}</dt>
                    <dd className="min-w-0 text-ink">
                      {success ? formatKst(success.ran_at) : "—"}
                      {success?.detail && (
                        <span className="ml-2 break-all text-ink-muted">{success.detail}</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-24 shrink-0 text-ink-tertiary">{t("batch.lastFailure")}</dt>
                    <dd className="min-w-0 text-ink">
                      {failure ? formatKst(failure.ran_at) : "—"}
                      {failure?.detail && (
                        <span className="ml-2 break-all text-error">{failure.detail}</span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
