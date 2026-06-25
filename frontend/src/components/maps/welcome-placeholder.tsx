"use client";

// 빈 상태/미선택 자리 — 맵이 없거나 선택되지 않았을 때 보여주는 환영 플레이스홀더.

import { Plus, Workflow } from "lucide-react";

import { useI18n } from "@/lib/i18n";

export function WelcomePlaceholder({ onCreate }: { onCreate?: () => void }) {
  const { t } = useI18n();
  return (
    <div
      data-id="welcome-placeholder"
      className="flex flex-1 flex-col items-center justify-center gap-4 rounded-sm border border-dashed border-divider bg-surface-pearl p-10 text-center"
    >
      <div className="rounded-full bg-accent-tint p-4">
        <Workflow size={28} strokeWidth={1.5} className="text-accent" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-tagline text-ink">{t("home.welcomeTitle")}</p>
        <p className="mx-auto max-w-sm text-caption text-ink-tertiary">{t("home.welcomeSubtitle")}</p>
      </div>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-2 text-caption-strong text-on-accent hover:bg-accent-focus"
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("home.welcomeCta")}
        </button>
      )}
    </div>
  );
}
