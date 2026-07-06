"use client";

// AI 챗 로그 설정(sysadmin) — 질문/답변 DB 적재 토글. 재배포 없이 즉시 적용, 테스트 기간 중 ON 예정.
import { Database, Info } from "lucide-react";
import { useEffect, useState } from "react";

import { getAppSettings, putAppSettings, type AppSettings } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

interface AiChatSettingsPanelProps {
  onToast?: (message: string) => void;
}

export function AiChatSettingsPanel({ onToast }: AiChatSettingsPanelProps) {
  const { t } = useI18n();
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAppSettings()
      .then((result) => {
        if (alive) setAppSettings(result);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const enabled = appSettings?.ai_chat_log_enabled ?? false;

  const toggleLogging = async () => {
    if (!appSettings || busy) return;
    setBusy(true);
    try {
      const next = await putAppSettings(!appSettings.ai_chat_log_enabled);
      setAppSettings(next);
      onToast?.(t(next.ai_chat_log_enabled ? "aiLog.enabledToast" : "aiLog.disabledToast"));
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : t("aiLog.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-body-strong text-ink">{t("aiLog.title")}</h2>
      <p className="mt-1 text-caption text-ink-secondary">{t("aiLog.desc")}</p>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-hairline p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
            <Database size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="text-caption-strong text-ink">{t("aiLog.toggleLabel")}</div>
            <div className="text-fine text-ink-tertiary">{t("aiLog.toggleHint")}</div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("aiLog.toggleLabel")}
          data-id="ai-log-toggle"
          disabled={appSettings === null || busy}
          onClick={() => void toggleLogging()}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
            enabled ? "bg-accent" : "bg-border-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all ${
              enabled ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div
          data-id="ai-log-active-notice"
          className="mt-3 flex items-start gap-2 rounded-sm border border-notice-border bg-notice p-2.5 text-fine text-ink-secondary"
        >
          <Info size={14} strokeWidth={1.6} className="mt-px shrink-0 text-changed" />
          {t("aiLog.activeNotice")}
        </div>
      )}

      {appSettings?.updated_at && (
        <p className="mt-2 text-fine text-ink-tertiary">
          {t("aiLog.updatedBy", {
            by: appSettings.updated_by ?? "-",
            at: formatKst(appSettings.updated_at),
          })}
        </p>
      )}
    </div>
  );
}
