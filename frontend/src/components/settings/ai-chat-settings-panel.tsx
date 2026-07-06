"use client";

// AI 챗 설정(sysadmin) — 질문/답변 DB 적재 토글(테스트 기간 중 ON 예정) + 로딩 중 기능 팁 관리.
import { Database, Info, Lightbulb } from "lucide-react";
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
  const [tipsDraft, setTipsDraft] = useState(""); // 한 줄당 팁 1개 편집 초안

  useEffect(() => {
    let alive = true;
    void getAppSettings()
      .then((result) => {
        if (alive) {
          setAppSettings(result);
          setTipsDraft(result.ai_chat_tips.join("\n"));
        }
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
      const next = await putAppSettings({
        ai_chat_log_enabled: !appSettings.ai_chat_log_enabled,
      });
      setAppSettings(next);
      onToast?.(t(next.ai_chat_log_enabled ? "aiLog.enabledToast" : "aiLog.disabledToast"));
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : t("aiLog.error"));
    } finally {
      setBusy(false);
    }
  };

  // 팁 저장 — 한 줄당 1개, 빈 줄 무시. 전부 지우고 저장하면 서버가 기본 20종으로 복원.
  const saveTips = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const tips = tipsDraft
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const next = await putAppSettings({ ai_chat_tips: tips });
      setAppSettings(next);
      setTipsDraft(next.ai_chat_tips.join("\n"));
      onToast?.(t("aiLog.tipsSaved"));
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

      {/* 기능 팁 관리 — 이전 기록 로딩 중 채팅에 노출되는 FAQ성 팁 (한 줄당 1개) */}
      <div className="mt-8">
        <h3 className="flex items-center gap-1.5 text-caption-strong text-ink">
          <Lightbulb size={15} strokeWidth={1.6} className="text-accent" />
          {t("aiLog.tipsTitle")}
        </h3>
        <p className="mt-1 text-fine text-ink-tertiary">{t("aiLog.tipsDesc")}</p>
        <textarea
          data-id="ai-tips-editor"
          value={tipsDraft}
          onChange={(event) => setTipsDraft(event.target.value)}
          rows={12}
          disabled={appSettings === null || busy}
          className="mt-2 w-full resize-y rounded-sm border border-hairline px-3 py-2 text-caption leading-relaxed outline-none focus:border-accent disabled:bg-surface-alt"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-fine text-ink-tertiary">
            {t("aiLog.tipsCount", {
              n: tipsDraft.split("\n").filter((line) => line.trim()).length,
            })}
          </span>
          <button
            type="button"
            data-id="ai-tips-save"
            onClick={() => void saveTips()}
            disabled={appSettings === null || busy}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
          >
            {t("aiLog.tipsSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
