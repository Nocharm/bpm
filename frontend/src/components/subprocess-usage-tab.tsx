"use client";

// 인스펙터 Subprocess 탭 — 지정 메타(버전·시점·행위자) + 이 맵을 링크한 부모 맵 목록(역참조).
// 탭 자체는 지정된 맵에서만 노출 — page.tsx가 designated일 때만 슬롯을 주입한다.

import { ArrowUpRight, Info, Workflow } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

import { UserPill } from "@/components/user-pill";
import { type SubprocessUsage } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

interface SubprocessUsageTabProps {
  usage: SubprocessUsage;
}

export function SubprocessUsageTab({ usage }: SubprocessUsageTabProps) {
  const { t } = useI18n();
  const versionText =
    usage.designated_version_number != null
      ? `v${usage.designated_version_number}${usage.designated_version_label ? ` · ${usage.designated_version_label}` : ""}`
      : (usage.designated_version_label ?? "—");
  return (
    <div data-id="sp-usage-tab" className="flex flex-col gap-4">
      {/* 지정 메타 — 버전·시점·행위자 (SP 카드와 동일 박스 스타일) */}
      <section className="rounded-md border border-hairline bg-surface-alt/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-fine font-semibold text-ink-tertiary">
            <Workflow size={14} strokeWidth={1.5} className="text-accent" />
            {t("inspector.spUsageMetaTitle")}
          </span>
          {/* 지정 상태 뱃지 — 영어 고정(승인상태 뱃지 규칙과 동일) */}
          <span className="rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
            Designated
          </span>
        </div>
        <div className="flex flex-col">
          <MetaRow label={t("inspector.spUsageVersion")}>
            <span className="truncate text-fine font-medium text-ink">{versionText}</span>
          </MetaRow>
          <MetaRow label={t("inspector.spUsageDesignatedAt")}>
            <span className="text-fine text-ink">
              {usage.designated_at ? formatKst(usage.designated_at) : "—"}
            </span>
          </MetaRow>
          <MetaRow label={t("inspector.spUsageBy")}>
            {usage.changed_by ? (
              <UserPill loginId={usage.changed_by} />
            ) : (
              <span className="text-fine text-ink-tertiary">—</span>
            )}
          </MetaRow>
          {usage.changed_at && usage.changed_at !== usage.designated_at && (
            <MetaRow label={t("inspector.spUsageUpdatedAt")}>
              <span className="text-fine text-ink">{formatKst(usage.changed_at)}</span>
            </MetaRow>
          )}
        </div>
        {/* 지정은 버전을 박제하지 않는다 — 임베드가 항상 최신 게시본을 따른다는 안내 */}
        <p className="mt-2 flex items-start gap-1.5 rounded-sm bg-surface px-2 py-1.5 text-fine leading-snug text-ink-tertiary">
          <Info size={12} strokeWidth={1.6} className="mt-px shrink-0" />
          {t("inspector.spUsageFollowsLatest")}
        </p>
      </section>

      {/* 역참조 목록 — 이 맵을 서브프로세스로 연결한 부모 맵(라이브 버전 기준) */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-fine font-semibold text-ink">{t("inspector.spUsageLinkedFrom")}</span>
          <span className="text-fine text-ink-tertiary">{usage.used_by.length}</span>
        </div>
        {usage.used_by.length === 0 ? (
          <p className="rounded-sm border border-hairline bg-surface-alt/50 px-2.5 py-2 text-fine text-ink-tertiary">
            {t("inspector.spUsageEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {usage.used_by.map((entry) => (
              <li key={entry.map_id}>
                <Link
                  href={`/maps/${entry.map_id}`}
                  data-id="sp-usage-row"
                  className="group flex items-center gap-2 rounded-sm border border-hairline px-2.5 py-2 transition-colors hover:bg-surface-alt"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption text-ink">{entry.name}</span>
                    {entry.owning_department && (
                      <span
                        title={entry.owning_department}
                        className="block truncate text-fine text-ink-tertiary"
                      >
                        {entry.owning_department}
                      </span>
                    )}
                  </span>
                  {entry.node_count > 1 && (
                    <span
                      title={t("inspector.spUsageLinkCount", { n: entry.node_count })}
                      className="shrink-0 rounded-xs bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
                    >
                      ×{entry.node_count}
                    </span>
                  )}
                  <ArrowUpRight
                    size={14}
                    strokeWidth={1.5}
                    className="shrink-0 text-ink-tertiary transition-colors group-hover:text-accent"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {usage.hidden_count > 0 && (
          <p data-id="sp-usage-hidden" className="mt-1.5 text-fine text-ink-tertiary">
            {t("inspector.spUsageHidden", { n: usage.hidden_count })}
          </p>
        )}
      </section>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="shrink-0 text-fine text-ink-secondary">{label}</span>
      {children}
    </div>
  );
}
