"use client";

// 실행 체크(Run) 숫자 설정(sysadmin) — 방치 알림·자동 중단·요약 일수와 진행 중·영구 보존 상한 7개. 설정 > Runs 탭.
import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";

import { getAppSettings, putAppSettings, type AppSettings } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { validateRunLimits, type RunLimitsDraft } from "@/lib/run-view";
import { SettingsTabHeader } from "@/components/settings/settings-tab-header";

interface RunSettingsPanelProps {
  onToast?: (message: string, tone?: "error") => void;
}

type DraftField = keyof RunLimitsDraft;

interface LimitRow {
  field: DraftField;
  labelKey: MessageKey;
}

const DAY_ROWS: LimitRow[] = [
  { field: "warn", labelKey: "run.admin.warnDays" },
  { field: "stop", labelKey: "run.admin.stopDays" },
  { field: "summary", labelKey: "run.admin.summaryDays" },
];

const CAP_ROWS: LimitRow[] = [
  { field: "openSolo", labelKey: "run.admin.openSolo" },
  { field: "openShared", labelKey: "run.admin.openShared" },
  { field: "keepShared", labelKey: "run.admin.keepShared" },
  { field: "keepSolo", labelKey: "run.admin.keepSolo" },
];

const EMPTY_DRAFT: RunLimitsDraft = {
  warn: "",
  stop: "",
  summary: "",
  openSolo: "",
  openShared: "",
  keepShared: "",
  keepSolo: "",
};

function toDraft(settings: AppSettings): RunLimitsDraft {
  return {
    warn: String(settings.run_idle_warn_days),
    stop: String(settings.run_idle_stop_days),
    summary: String(settings.run_summary_days),
    openSolo: String(settings.run_open_solo_cap),
    openShared: String(settings.run_open_shared_cap),
    keepShared: String(settings.run_keep_shared_cap),
    keepSolo: String(settings.run_keep_solo_cap),
  };
}

export function RunSettingsPanel({ onToast }: RunSettingsPanelProps) {
  const { t } = useI18n();
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<RunLimitsDraft>(EMPTY_DRAFT);

  useEffect(() => {
    let alive = true;
    void getAppSettings()
      .then((result) => {
        if (alive) {
          setAppSettings(result);
          setDraft(toDraft(result));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 초안은 입력 중 늘 파생 — 오류가 있으면 저장을 막고 이유를 그 자리에 보인다
  const problemKey = appSettings === null ? null : validateRunLimits(draft);

  const saveLimits = async () => {
    if (busy || appSettings === null) return;
    const invalidKey = validateRunLimits(draft);
    if (invalidKey) {
      onToast?.(t(invalidKey), "error");
      return;
    }
    setBusy(true);
    try {
      const next = await putAppSettings({
        run_idle_warn_days: Number(draft.warn),
        run_idle_stop_days: Number(draft.stop),
        run_summary_days: Number(draft.summary),
        run_open_solo_cap: Number(draft.openSolo),
        run_open_shared_cap: Number(draft.openShared),
        run_keep_shared_cap: Number(draft.keepShared),
        run_keep_solo_cap: Number(draft.keepSolo),
      });
      setAppSettings(next);
      setDraft(toDraft(next));
      onToast?.(t("run.admin.saved"));
    } catch (err) {
      onToast?.(humanizeApiError(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const renderRows = (rows: LimitRow[]) =>
    rows.map(({ field, labelKey }) => (
      <label key={field} className="flex items-center justify-between gap-3 text-caption text-ink-secondary">
        <span className="min-w-0">{t(labelKey)}</span>
        <input
          type="number"
          data-id={`run-limit-${field}`}
          value={draft[field]}
          disabled={appSettings === null || busy}
          onChange={(event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }))}
          className="w-24 rounded-sm border border-hairline px-2 py-1 text-right text-caption tabular-nums outline-none focus:border-accent disabled:bg-surface-alt"
        />
      </label>
    ));

  return (
    <div className="max-w-xl" data-id="run-settings-panel">
      <SettingsTabHeader title={t("run.admin.title")} description={t("run.admin.desc")} />

      <div className="mt-4 rounded-md border border-hairline p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
            <ListChecks size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 text-fine text-ink-tertiary">{t("run.admin.rangeHint")}</div>
        </div>

        <div className="mt-3 text-caption-title text-ink">{t("run.admin.daysTitle")}</div>
        <div className="mt-2 grid grid-cols-1 gap-2">{renderRows(DAY_ROWS)}</div>

        <div className="mt-4 text-caption-title text-ink">{t("run.admin.capsTitle")}</div>
        <div className="mt-2 grid grid-cols-1 gap-2">{renderRows(CAP_ROWS)}</div>

        {problemKey ? (
          <p role="alert" data-id="run-settings-error" className="mt-3 rounded-sm bg-error/5 px-2 py-1 text-fine text-error">
            {t(problemKey)}
          </p>
        ) : null}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            data-id="run-settings-save"
            onClick={() => void saveLimits()}
            disabled={appSettings === null || busy || problemKey !== null}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
          >
            {t("run.admin.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
