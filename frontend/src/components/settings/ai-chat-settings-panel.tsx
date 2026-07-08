"use client";

// AI 챗 설정(sysadmin) — 보존 상한(대화 수·메시지 수·보관 일수) + 로딩 중 기능 팁 관리.
import { Database, Lightbulb } from "lucide-react";
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
  const [limitsDraft, setLimitsDraft] = useState({ sessions: "", messages: "", days: "" });

  useEffect(() => {
    let alive = true;
    void getAppSettings()
      .then((result) => {
        if (alive) {
          setAppSettings(result);
          setTipsDraft(result.ai_chat_tips.join("\n"));
          setLimitsDraft({
            sessions: String(result.ai_chat_max_sessions_per_map),
            messages: String(result.ai_chat_max_messages_per_session),
            days: String(result.ai_chat_retention_days),
          });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 상한 저장 — 세 필드 모두 범위 검증 후 한 번에 PUT(범위 밖은 서버 422 전에 로컬 차단)
  const saveLimits = async () => {
    if (busy) return;
    const sessions = Number(limitsDraft.sessions);
    const messages = Number(limitsDraft.messages);
    const days = Number(limitsDraft.days);
    const inRange = (value: number, lo: number, hi: number) =>
      Number.isInteger(value) && value >= lo && value <= hi;
    if (!inRange(sessions, 1, 200) || !inRange(messages, 10, 2000) || !inRange(days, 7, 3650)) {
      onToast?.(t("aiLog.invalidNumber"));
      return;
    }
    setBusy(true);
    try {
      const next = await putAppSettings({
        ai_chat_max_sessions_per_map: sessions,
        ai_chat_max_messages_per_session: messages,
        ai_chat_retention_days: days,
      });
      setAppSettings(next);
      onToast?.(t("aiLog.limitsSaved"));
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

      <div className="mt-4 rounded-md border border-hairline p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
            <Database size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="text-caption-strong text-ink">{t("aiLog.limitsTitle")}</div>
            <div className="text-fine text-ink-tertiary">{t("aiLog.limitsDesc")}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {(
            [
              ["sessions", "aiLog.maxSessionsLabel", "ai-limit-sessions"],
              ["messages", "aiLog.maxMessagesLabel", "ai-limit-messages"],
              ["days", "aiLog.retentionLabel", "ai-limit-days"],
            ] as const
          ).map(([field, labelKey, dataId]) => (
            <label key={field} className="flex items-center justify-between gap-3 text-caption text-ink-secondary">
              <span className="min-w-0">{t(labelKey)}</span>
              <input
                type="number"
                data-id={dataId}
                value={limitsDraft[field]}
                disabled={appSettings === null || busy}
                onChange={(event) =>
                  setLimitsDraft((prev) => ({ ...prev, [field]: event.target.value }))
                }
                className="w-24 rounded-sm border border-hairline px-2 py-1 text-right text-caption tabular-nums outline-none focus:border-accent disabled:bg-surface-alt"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            data-id="ai-limits-save"
            onClick={() => void saveLimits()}
            disabled={appSettings === null || busy}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
          >
            {t("aiLog.limitsSave")}
          </button>
        </div>
      </div>

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
