// 미선택 우측 공용 다이제스트 — 카테고리별 건수 + 미읽음 + 힌트. Inbox/Notices 공유.
"use client";

import { useI18n } from "@/lib/i18n";

interface DigestStat { icon: React.ReactNode; label: string; count: number }
interface ActivityDigestProps {
  title: string;
  stats: DigestStat[];
  unreadCount?: number;
  hint?: string;
  children?: React.ReactNode;
}

export function ActivityDigest({ title, stats, unreadCount, hint, children }: ActivityDigestProps) {
  const { t } = useI18n();
  return (
    <div data-id="activity-digest" className="flex h-full flex-col gap-4 p-6">
      <div className="text-caption-strong text-ink">{title}</div>
      <ul className="flex flex-col gap-2">
        {stats.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-caption">
            <span className="text-ink-tertiary">{s.icon}</span>
            <span className="text-ink-secondary">{s.label}</span>
            <span className="ml-auto text-ink">{s.count}</span>
          </li>
        ))}
      </ul>
      {unreadCount != null && (
        <div className="rounded-sm bg-accent-tint px-3 py-2 text-caption text-accent">
          {t("digest.unread", { n: unreadCount })}
        </div>
      )}
      {children}
      {hint && <p className="mt-auto text-fine text-ink-tertiary">{hint}</p>}
    </div>
  );
}
