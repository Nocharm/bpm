// 고아 참조 페이지 히어로 — 제목·숫자 3개·범위 칩·다시 스캔(왼쪽)과 설명 그림·결과 범례·힌트(오른쪽). 설정 > 점검 > 고아 참조 페이지가 쓴다.
"use client";

import {
  FolderTree,
  Group,
  Map as MapIcon,
  MousePointer2,
  RefreshCw,
  Unlink,
  type LucideIcon,
} from "lucide-react";

import { RefAuditIllustration } from "@/components/ref-audit/ref-audit-illustration";
import { RefOutcomeChip } from "@/components/ref-audit/ref-outcome-chip";
import type { RefAuditData, RefOutcome } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  OUTCOME_TIP_KEY,
  REF_AUDIT_LEGEND,
  getHeroStats,
  getScopeChips,
  type ScopeChipKind,
} from "@/lib/ref-audit-view";

const SCOPE_ICON: Record<ScopeChipKind, LucideIcon> = {
  maps: MapIcon,
  groups: Group,
  categories: FolderTree,
};

const SCOPE_LABEL_KEY: Record<ScopeChipKind, MessageKey> = {
  maps: "refAudit.hero.scopeMaps",
  groups: "refAudit.hero.scopeGroups",
  categories: "refAudit.hero.scopeCategories",
};

// 범례 마지막 3개는 설명창을 칩 오른쪽 끝에 맞춰 왼쪽으로 펼친다(오른쪽 가장자리에서 잘리지 않게)
const LEGEND_TIP_END_COUNT = 3;

interface StatBoxProps {
  dataId: string;
  value: string;
  label: string;
  accent?: boolean;
}

function StatBox({ dataId, value, label, accent }: StatBoxProps) {
  return (
    <div data-id={dataId} className="flex min-w-0 flex-col gap-1 rounded-md border border-hairline bg-surface px-2.5 pb-[9px] pt-2.5">
      <b className={`text-tagline tabular-nums leading-none ${accent ? "text-accent" : "text-ink"}`}>{value}</b>
      <span className="truncate text-fine text-ink-tertiary">{label}</span>
    </div>
  );
}

interface LegendItemProps {
  outcome: RefOutcome;
  tipEnd: boolean;
}

// 결과 칩 + 올리면 뜨는 한 줄 설명(키보드 포커스도 동일)
function LegendItem({ outcome, tipEnd }: LegendItemProps) {
  const { t } = useI18n();
  const tipId = `ref-legend-tip-${outcome}`;
  return (
    <span
      data-id={`ref-legend-${outcome}`}
      tabIndex={0}
      aria-describedby={tipId}
      className="group/oc relative cursor-help rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <RefOutcomeChip outcome={outcome} />
      <span
        id={tipId}
        role="tooltip"
        className={`glass glass-dense pointer-events-none absolute bottom-[calc(100%+10px)] z-10 w-max max-w-[min(320px,72vw)] translate-y-1 rounded-md border px-[11px] py-[7px] text-fine leading-[1.4] text-ink-secondary opacity-0 transition-[opacity,translate] duration-150 group-hover/oc:translate-y-0 group-hover/oc:opacity-100 group-focus-visible/oc:translate-y-0 group-focus-visible/oc:opacity-100 ${tipEnd ? "right-[-8px]" : "left-[-8px]"}`}
      >
        {t(OUTCOME_TIP_KEY[outcome])}
      </span>
    </span>
  );
}

interface RefAuditHeroProps {
  page: RefAuditData | null;
  loading: boolean;
  onRescan: () => void;
}

export function RefAuditHero({ page, loading, onRescan }: RefAuditHeroProps) {
  const { t } = useI18n();
  const stats = getHeroStats(page);
  const scopeChips = getScopeChips(page?.scope);
  const show = (value: number): string => (page ? String(value) : "-");
  const scannedAt = page ? formatKstShort(page.generated_at) : "";

  return (
    <section
      data-id="ref-audit-hero"
      className="@container rounded-lg border border-hairline"
      style={{
        backgroundImage:
          "linear-gradient(180deg, var(--color-surface) 0%, color-mix(in srgb, var(--color-accent) 5%, var(--color-surface)) 100%)",
      }}
    >
      <div className="grid gap-7 px-6 pb-[18px] pt-[22px] @[960px]:grid-cols-[minmax(260px,1fr)_minmax(0,760px)]">
        <div className="flex min-w-0 max-w-[360px] flex-col gap-3">
          <span className="inline-flex items-center gap-1.5 text-fine font-semibold tracking-wide text-warn">
            <Unlink size={14} strokeWidth={1.5} aria-hidden />
            {t("refAudit.hero.eyebrow")}
          </span>
          <h2 className="text-tagline text-balance text-ink">{t("refAudit.hero.title")}</h2>
          <p className="text-caption text-ink-secondary">{t("refAudit.hero.desc")}</p>
          <div className="grid grid-cols-3 gap-2">
            <StatBox dataId="ref-audit-stat-departments" value={show(stats.departments)} label={t("refAudit.hero.statDepartments")} />
            <StatBox dataId="ref-audit-stat-users" value={show(stats.users)} label={t("refAudit.hero.statUsers")} />
            <StatBox dataId="ref-audit-stat-fix" value={show(stats.fixPlaces)} label={t("refAudit.hero.statFix")} accent />
          </div>
          {scopeChips.length > 0 ? (
            <div data-id="ref-audit-scope" className="flex flex-wrap items-center gap-1.5 text-fine text-ink-tertiary">
              <span>{t("refAudit.hero.scope")}</span>
              {scopeChips.map((chip) => {
                const Icon = SCOPE_ICON[chip.kind];
                return (
                  <span
                    key={chip.kind}
                    data-id={`ref-audit-scope-${chip.kind}`}
                    className="inline-flex h-[22px] items-center gap-1 rounded-full border border-hairline bg-surface px-2 text-ink-secondary"
                  >
                    <Icon size={12} strokeWidth={1.5} className="text-ink-tertiary" aria-hidden />
                    {t(SCOPE_LABEL_KEY[chip.kind], { n: chip.count })}
                  </span>
                );
              })}
            </div>
          ) : null}
          <div className="mt-auto flex items-center gap-2.5">
            <button
              type="button"
              data-id="ref-audit-rescan"
              disabled={loading}
              onClick={onRescan}
              className="inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
            >
              <RefreshCw size={14} strokeWidth={1.5} className={loading ? "motion-safe:animate-spin" : undefined} aria-hidden />
              {loading ? t("refAudit.hero.scanning") : t("refAudit.hero.rescan")}
            </button>
            {scannedAt ? (
              <span data-id="ref-audit-scanned-at" className="text-fine text-ink-tertiary">
                {t("refAudit.hero.scannedAt", { time: scannedAt })}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-2.5">
          <RefAuditIllustration />
          <div data-id="ref-audit-legend" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-fine text-ink-tertiary">{t("refAudit.hero.legendLabel")}</span>
            {REF_AUDIT_LEGEND.map((outcome, index) => (
              <LegendItem key={outcome} outcome={outcome} tipEnd={index >= REF_AUDIT_LEGEND.length - LEGEND_TIP_END_COUNT} />
            ))}
          </div>
          <span data-id="ref-audit-hint" className="inline-flex items-center gap-1.5 text-fine text-ink-tertiary">
            <MousePointer2 size={14} strokeWidth={1.5} aria-hidden />
            {t("refAudit.hero.hint")}
          </span>
        </div>
      </div>
    </section>
  );
}
