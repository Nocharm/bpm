"use client";
// 배치 작업(DB 백업·HR 동기화) 최근 실행 상태 — 잡·결과별 최신 1행 (설정 > Batch jobs 탭, sysadmin 전용).
// 서버 기록: 백업=scripts/db-backup.sh(psql), HR=backend run_full_sync — 최신 성공·실패만 upsert 보전.
// DB 백업 카드는 온디맨드 실행(Backup now)·백업 파일 목록·로컬 다운로드까지 담당한다.

import { CheckCircle2, DatabaseBackup, Download, Play, Users, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  downloadBackupFile,
  listBackups,
  listBatchRuns,
  runBackupNow,
  type BackupFile,
  type BatchRun,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const JOBS = [
  { id: "db_backup", labelKey: "batch.job.db_backup", icon: DatabaseBackup },
  { id: "hr_sync", labelKey: "batch.job.hr_sync", icon: Users },
] as const;

// requested(postgres 사이드카 경로) 폴링 — 5초 폴링 사이드카 + 덤프 시간 여유
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 10;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function BatchRunsPanel() {
  const { t } = useI18n();
  const [runs, setRuns] = useState<BatchRun[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [backups, setBackups] = useState<BackupFile[] | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refreshRuns = useCallback(() => {
    listBatchRuns()
      .then((rows) => {
        if (aliveRef.current) setRuns(rows);
      })
      .catch(() => {
        if (aliveRef.current) setFailed(true);
      });
  }, []);

  const refreshBackups = useCallback(async (): Promise<BackupFile[]> => {
    const files = await listBackups();
    if (aliveRef.current) setBackups(files);
    return files;
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refreshRuns();
    refreshBackups().catch(() => {
      if (aliveRef.current) setBackups([]);
    });
    return () => {
      aliveRef.current = false;
    };
  }, [refreshRuns, refreshBackups]);

  const handleBackupNow = useCallback(async () => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupNotice(null);
    const prevNewest = backups?.[0]?.filename ?? null;
    try {
      const result = await runBackupNow();
      if (result.status === "completed") {
        await refreshBackups();
        refreshRuns();
        setBackupNotice(t("batch.backup.completed"));
        return;
      }
      // requested — 사이드카(≤5s 폴링)가 트리거를 소비해 덤프를 만들 때까지 목록을 폴링
      setBackupNotice(t("batch.backup.requested"));
      for (let attempt = 0; attempt < POLL_MAX_TRIES; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (!aliveRef.current) return;
        const files = await refreshBackups().catch(() => null);
        if (files && files.length > 0 && files[0].filename !== prevNewest) {
          refreshRuns();
          setBackupNotice(t("batch.backup.completed"));
          return;
        }
      }
      refreshRuns();
      setBackupNotice(t("batch.backup.pending"));
    } catch (error) {
      setBackupError(humanizeApiError(error, t));
    } finally {
      if (aliveRef.current) setBackupBusy(false);
    }
  }, [backups, refreshBackups, refreshRuns, t]);

  const handleDownload = useCallback(
    async (filename: string) => {
      setBackupError(null);
      try {
        const blob = await downloadBackupFile(filename);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        setBackupError(humanizeApiError(error, t));
      }
    },
    [t],
  );

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
                {id === "db_backup" && (
                  <button
                    type="button"
                    data-id="backup-run-now"
                    onClick={handleBackupNow}
                    disabled={backupBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-50"
                  >
                    <Play size={12} strokeWidth={1.5} />
                    {backupBusy ? t("batch.backup.running") : t("batch.backup.now")}
                  </button>
                )}
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
              {id === "db_backup" && (
                <div data-id="backup-files" className="mt-4 border-t border-hairline pt-3">
                  <h4 className="text-fine font-semibold text-ink-tertiary">
                    {t("batch.backup.files")}
                  </h4>
                  {backupNotice && (
                    <p data-id="backup-notice" className="mt-1.5 text-fine text-accent">
                      {backupNotice}
                    </p>
                  )}
                  {backupError && (
                    <p data-id="backup-error" className="mt-1.5 text-fine text-error">
                      {backupError}
                    </p>
                  )}
                  {backups === null ? (
                    <p className="mt-2 text-fine text-ink-muted">…</p>
                  ) : backups.length === 0 ? (
                    <p data-id="backup-files-empty" className="mt-2 text-fine text-ink-muted">
                      {t("batch.backup.none")}
                    </p>
                  ) : (
                    <ul
                      data-id="backup-file-list"
                      className="mt-2 max-h-56 space-y-1 overflow-y-auto"
                    >
                      {backups.map((file) => (
                        <li
                          key={file.filename}
                          data-id={`backup-file-${file.filename}`}
                          className="flex items-center gap-3 rounded-sm px-1.5 py-1 text-caption hover:bg-surface-alt"
                        >
                          <span className="min-w-0 truncate font-mono text-fine text-ink">
                            {file.filename}
                          </span>
                          <span className="ml-auto shrink-0 text-fine text-ink-tertiary">
                            {formatSize(file.size)}
                          </span>
                          <span className="shrink-0 text-fine text-ink-muted">
                            {formatKst(file.modified_at)}
                          </span>
                          <button
                            type="button"
                            data-id={`backup-download-${file.filename}`}
                            title={t("batch.backup.download")}
                            onClick={() => handleDownload(file.filename)}
                            className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-accent-tint hover:text-accent"
                          >
                            <Download size={14} strokeWidth={1.5} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
