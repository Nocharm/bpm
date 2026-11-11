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
  const withCount = stats.filter((s) => s.count > 0);
  const withoutCount = stats.filter((s) => s.count === 0);
  return (
    <div data-id="activity-digest" className="flex h-full flex-col gap-4 p-6">
      <div className="text-caption-strong text-ink">{title}</div>
      {/* 건수가 있는 종류만 칩으로, 0건은 한 줄로 묶는다 — 이름과 숫자가 패널 양 끝으로 벌어져 비어 보이던 문제 */}
      {withCount.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {withCount.map((s) => (
            <li
              key={s.label}
              className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption"
            >
              <span className="text-ink-tertiary">{s.icon}</span>
              <span className="text-ink-secondary">{s.label}</span>
              <span className="font-semibold text-ink">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
      {withoutCount.length > 0 && (
        <p data-id="activity-digest-zero" className="text-fine text-ink-tertiary">
          {t("digest.zeroKinds", { names: withoutCount.map((s) => s.label).join(", ") })}
        </p>
      )}
      {unreadCount != null && (
        <div className="rounded-sm bg-accent-tint px-3 py-2 text-caption text-accent">
          {t("digest.unread", { n: unreadCount })}
        </div>
      )}
      {children}
      {hint && <p className="text-fine text-ink-tertiary">{hint}</p>}
    </div>
  );
}
