// 홈 대시보드 — 내 승인 대기 큐(kind별 도넛 + 목록). status 파생 단계만(백엔드 무변경).
"use client";

import { useEffect, useMemo, useState } from "react";

import { listInboxApprovals, type InboxApproval } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Donut } from "@/components/charts/donut";

// kind → 토큰 색변수. checkout_transfer는 --color-warning(미존재) 대신 --color-changed 사용.
const KIND_COLOR: Record<InboxApproval["kind"], string> = {
  version_approval: "--color-accent",
  checkout_transfer: "--color-changed",
  approval_request: "--color-ink-tertiary",
};

interface ApprovalsCardProps { onSelect: (id: number) => void }

export function ApprovalsCard({ onSelect }: ApprovalsCardProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<InboxApproval[]>([]);
  useEffect(() => {
    let active = true;
    void listInboxApprovals().then((r) => { if (active) setItems(r); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const segments = useMemo(() => {
    const g = new Map<InboxApproval["kind"], number>();
    for (const a of items) g.set(a.kind, (g.get(a.kind) ?? 0) + 1);
    return [...g.entries()].map(([k, v]) => ({ key: k, value: v, colorVar: KIND_COLOR[k] }));
  }, [items]);
  return (
    <section data-id="home-needs-approval" className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-alt p-3">
      <div className="text-caption-strong text-ink">{t("home.needsApproval")}</div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-fine text-ink-tertiary">{t("home.allCaughtUp")}</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Donut segments={segments} size={104} />
            <ul className="flex flex-col gap-1 text-fine">
              {segments.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${s.colorVar})` }} />
                  <span className="text-ink-secondary">{t(`inbox.approvalKind.${s.key}`)}</span>
                  <span className="ml-auto text-ink-tertiary">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>
          <ul className="flex flex-col gap-1.5">
            {items.map((a) => (
              <li key={`${a.kind}:${a.id}`}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect(a.map_id); }}
                  className="flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">{a.map_name}</span>
                  {a.version_number != null && <span className="shrink-0 text-fine text-ink-tertiary">v{a.version_number}</span>}
                  <span className="shrink-0 text-fine text-ink-tertiary">{a.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
