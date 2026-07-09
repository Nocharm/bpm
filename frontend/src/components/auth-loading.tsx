"use client";

import { Loader2, Workflow } from "lucide-react";

import { useI18n } from "@/lib/i18n";

// 인증 전환 중 풀스크린 로딩 — 로그인 카드와 같은 브랜드 시각 언어.
// animate-item-in 페이드로 짧은 전환(즉시 리다이렉트)에선 거의 안 보이고, 길면 자연스럽게 나타난다.
export function AuthLoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center bg-surface-pearl">
      <div data-id="auth-loading" className="animate-item-in flex flex-col items-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-tint">
          <Workflow size={28} strokeWidth={1.7} className="text-accent" />
        </div>
        <div className="flex items-center gap-2">
          <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-ink-tertiary" />
          <p className="text-caption text-ink-muted">{t("auth.signingIn")}</p>
        </div>
      </div>
    </div>
  );
}
