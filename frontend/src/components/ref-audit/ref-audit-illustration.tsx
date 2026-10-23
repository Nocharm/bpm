// 고아 참조 설명 그림 — 오늘의 조직도 ↔ 맵(설정·노드)·그룹·카테고리와 그 위 경우별 호버 도움말 8개. RefAuditHero가 쓴다.
"use client";

import { ArrowLeftRight, Trash2, TriangleAlert, Unlink, Users, type LucideIcon } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { SOURCE_ICON } from "@/lib/ref-audit";
import {
  HERO_VIEWBOX,
  REF_AUDIT_CASES,
  SETTINGS_CHIPS,
  SETTINGS_CHIP_H,
  SETTINGS_CHIP_Y,
  splitCaption,
  type RefAuditCase,
} from "@/lib/ref-audit-view";

// 불투명 경고 틴트 — 반투명 틴트(fill-warn/10)는 뒤의 조직도 선이 비쳐서 가려야 하는 배지·칩에 쓰지 못한다
const WARN_TINT = "fill-[color-mix(in_srgb,var(--color-warn)_8%,var(--color-surface))]";
const ARROW_ID = "ref-ill-arrow";
const DOTS_ID = "ref-ill-dots";

// 조직도 안 유령(없어진) 상자 — 점선 윤곽 + 흐린 글자
function GhostText({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={12} className="fill-ink-muted">
      {children}
    </text>
  );
}

function OrgText({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={12} className="fill-ink-secondary">
      {children}
    </text>
  );
}

function BadgeText({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-warn">
      {children}
    </text>
  );
}

interface CaseActChipProps {
  icon: LucideIcon;
  className: string;
  label: string;
  sub?: string;
}

// 설명창 안 "누가/대체/제거" 칩 — 보기 전용(조작 아님)
function CaseActChip({ icon: Icon, className, label, sub }: CaseActChipProps) {
  return (
    <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-fine ${className}`}>
      <Icon size={13} strokeWidth={1.5} aria-hidden />
      {label}
      {sub ? <span className="opacity-80">{sub}</span> : null}
    </span>
  );
}

const TIP_V_CLASS: Record<RefAuditCase["tipV"], string> = {
  down: "top-[calc(100%+10px)]",
  up: "bottom-[calc(100%+10px)]",
};
const TIP_H_CLASS: Record<RefAuditCase["tipH"], string> = {
  center: "left-1/2 -translate-x-1/2",
  end: "right-[-8px]",
};

const CHIP_INERT = "border-hairline bg-surface-alt text-ink-secondary";
const CHIP_REPLACE = "border-accent-tint-border bg-accent-tint text-accent";
const CHIP_REMOVE = "border-error/30 bg-error/10 text-error";
const CHIP_OFF = "border-hairline bg-surface text-ink-muted line-through";

// 그림 위 경우 버튼 1개 + 호버/키보드 포커스로 뜨는 설명창(어디 / 누가 / 대체·제거 / 주의 한 줄)
function CaseHelp({ spec }: { spec: RefAuditCase }) {
  const { t } = useI18n();
  const Icon = SOURCE_ICON[spec.id];
  const tipId = `ref-case-tip-${spec.id}`;
  const label = t(spec.labelKey);
  const NoteIcon = spec.note?.icon;
  const removeLabel = t("refAudit.act.remove");
  const removeSub = spec.remove === "people"
    ? t("refAudit.act.peopleOnly")
    : spec.remove === "assignee"
      ? t("refAudit.act.assigneeOnly")
      : undefined;

  return (
    <div
      className="group/case absolute z-10 -translate-x-1/2 -translate-y-1/2 focus-within:z-20 hover:z-20"
      style={{ left: `${spec.x}%`, top: `${spec.y}%` }}
    >
      <button
        type="button"
        data-id={`ref-case-${spec.id}`}
        aria-label={label}
        aria-describedby={tipId}
        className="ref-case-halo relative grid size-[26px] place-items-center rounded-full border border-accent-tint-border bg-surface p-0 text-accent shadow-md transition-[background-color,color,scale] duration-150 group-hover/case:scale-[1.08] group-hover/case:bg-accent group-hover/case:text-on-accent focus-visible:scale-[1.08] focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Icon size={14} strokeWidth={1.5} aria-hidden />
      </button>
      <div
        id={tipId}
        role="tooltip"
        className={`glass glass-dense pointer-events-none absolute z-10 w-[min(236px,72vw)] translate-y-1 rounded-md border px-3.5 py-3 text-left opacity-0 transition-[opacity,translate] duration-150 group-hover/case:translate-y-0 group-hover/case:opacity-100 group-has-[:focus-visible]/case:translate-y-0 group-has-[:focus-visible]/case:opacity-100 ${TIP_V_CLASS[spec.tipV]} ${TIP_H_CLASS[spec.tipH]}`}
      >
        <div className="flex items-center gap-2 text-caption-strong text-ink">
          <Icon size={14} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
          {label}
        </div>
        <div className="mb-2.5 ml-6 mt-1 text-fine leading-[1.4] text-ink-tertiary">{t(spec.whereKey)}</div>
        <div className="flex flex-wrap gap-1.5">
          <CaseActChip icon={Users} className={CHIP_INERT} label={t(spec.whoKey)} />
          <CaseActChip
            icon={ArrowLeftRight}
            className={spec.replace ? CHIP_REPLACE : CHIP_OFF}
            label={t("refAudit.act.replace")}
          />
          <CaseActChip
            icon={Trash2}
            className={spec.remove === false ? CHIP_OFF : CHIP_REMOVE}
            label={removeLabel}
            sub={removeSub}
          />
        </div>
        {spec.note && NoteIcon ? (
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-divider pt-2 text-fine leading-[1.4] text-ink-secondary">
            <NoteIcon size={13} strokeWidth={1.5} className="shrink-0 text-warn" aria-hidden />
            {t(spec.note.key)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RefAuditIllustration() {
  const { t } = useI18n();
  const chipText = {
    owner: t("refAudit.fig.chipOwner"),
    approver: t("refAudit.fig.chipApprover"),
    collab: t("refAudit.fig.chipCollab"),
    owningDept: t("refAudit.fig.chipOwningDept"),
  } as const;
  const orphanChips: ReadonlySet<string> = new Set(["approver", "owningDept"]);
  const nameOnlyLines = splitCaption(t("refAudit.fig.nameOnly"));

  return (
    <div
      data-id="ref-audit-illustration"
      className="relative w-full"
      style={{ aspectRatio: `${HERO_VIEWBOX.width} / ${HERO_VIEWBOX.height}` }}
    >
      <svg
        viewBox={`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`}
        role="img"
        aria-label={t("refAudit.fig.alt")}
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          <pattern id={DOTS_ID} width={12} height={12} patternUnits="userSpaceOnUse">
            <circle cx={2} cy={2} r={1} className="fill-canvas-dot" />
          </pattern>
          <marker id={ARROW_ID} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="fill-border-strong" />
          </marker>
        </defs>

        {/* 오늘의 조직도 */}
        <rect x={8} y={8} width={236} height={244} rx={14} className="fill-surface stroke-hairline" />
        <text x={24} y={31} fontSize={11} className="fill-ink-tertiary">{t("refAudit.fig.org")}</text>
        <path d="M126 70 V83 H64 V96 M126 83 H197 V96" strokeWidth={1.2} className="fill-none stroke-border-strong" />
        <path d="M64 122 V135 H46 V148" strokeWidth={1.2} className="fill-none stroke-border-strong" />
        <path d="M64 135 H124 V148" strokeWidth={1.2} strokeDasharray="3 3" className="fill-none stroke-ink-muted" />
        <path d="M46 174 V204" strokeWidth={1.2} className="fill-none stroke-border-strong" />
        <path d="M197 122 V204" strokeWidth={1.2} className="fill-none stroke-border-strong" />
        <path d="M124 174 V204" strokeWidth={1.2} strokeDasharray="3 3" className="fill-none stroke-ink-muted" />
        <rect x={76} y={44} width={100} height={26} rx={6} className="fill-surface stroke-border-strong" />
        <OrgText x={126} y={61.5}>{t("refAudit.fig.hq")}</OrgText>
        <rect x={20} y={96} width={88} height={26} rx={6} className="fill-surface stroke-border-strong" />
        <OrgText x={64} y={113.5}>{t("refAudit.fig.division1")}</OrgText>
        <rect x={156} y={96} width={82} height={26} rx={6} className="fill-surface stroke-border-strong" />
        <OrgText x={197} y={113.5}>{t("refAudit.fig.division2")}</OrgText>
        <rect x={12} y={148} width={68} height={26} rx={6} className="fill-surface stroke-border-strong" />
        <OrgText x={46} y={165.5}>{t("refAudit.fig.teamA")}</OrgText>
        <rect x={88} y={148} width={72} height={26} rx={6} strokeDasharray="4 3" className="fill-none stroke-ink-muted" />
        <GhostText x={124} y={165.5}>{t("refAudit.fig.teamB")}</GhostText>
        <rect x={166} y={152} width={52} height={18} rx={9} className={`${WARN_TINT} stroke-warn/30`} />
        <BadgeText x={192} y={164.5}>{t("refAudit.fig.gone")}</BadgeText>
        <rect x={12} y={204} width={68} height={24} rx={12} className="fill-surface stroke-border-strong" />
        <OrgText x={46} y={220}>{t("refAudit.fig.me")}</OrgText>
        <rect x={88} y={204} width={72} height={24} rx={12} strokeDasharray="4 3" className="fill-none stroke-ink-muted" />
        <GhostText x={124} y={220}>{t("refAudit.fig.userA")}</GhostText>
        <rect x={104} y={232} width={40} height={16} rx={8} className={`${WARN_TINT} stroke-warn/30`} />
        <BadgeText x={124} y={243.5}>{t("refAudit.fig.left")}</BadgeText>
        <rect x={164} y={204} width={66} height={24} rx={12} className="fill-surface stroke-border-strong" />
        <OrgText x={197} y={220}>{t("refAudit.fig.coworker")}</OrgText>

        {/* 끊긴 고리 */}
        <path d="M246 130 H262" strokeWidth={1.3} strokeDasharray="3 3" className="fill-none stroke-warn" />
        <path d="M298 130 H314" strokeWidth={1.3} strokeDasharray="3 3" className="fill-none stroke-warn" />
        <circle cx={280} cy={130} r={17} className="fill-surface stroke-warn/30" />
        <Unlink x={270} y={120} size={20} strokeWidth={2} className="text-warn" />
        <text x={280} y={166} textAnchor="middle" fontSize={11} fontWeight={600} className="fill-warn">
          <tspan x={280}>{nameOnlyLines[0]}</tspan>
          {nameOnlyLines[1] ? <tspan x={280} dy={13}>{nameOnlyLines[1]}</tspan> : null}
        </text>

        {/* 데모 맵 창: 제목·버전 · 설정 칩 · 캔버스 */}
        <rect x={316} y={8} width={436} height={188} rx={12} className="fill-surface stroke-hairline" />
        <text x={332} y={31} fontSize={13} fontWeight={600} className="fill-ink">Employee Onboarding</text>
        <rect x={476} y={19} width={56} height={18} rx={9} className="fill-accent-tint" />
        <text x={504} y={31.5} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-accent">Draft</text>
        <path d="M316 40 H752" className="fill-none stroke-divider" />
        {SETTINGS_CHIPS.map((chip) => {
          const orphan = orphanChips.has(chip.id);
          return (
            <g key={chip.id}>
              <rect
                x={chip.x}
                y={SETTINGS_CHIP_Y}
                width={chip.w}
                height={SETTINGS_CHIP_H}
                rx={SETTINGS_CHIP_H / 2}
                strokeDasharray={orphan ? "3 2" : undefined}
                className={orphan ? `${WARN_TINT} stroke-warn` : "fill-surface-alt stroke-hairline"}
              />
              <text
                x={chip.x + chip.w / 2}
                y={SETTINGS_CHIP_Y + 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={orphan ? 600 : 400}
                className={orphan ? "fill-warn" : "fill-ink-secondary"}
              >
                {chipText[chip.id]}
              </text>
            </g>
          );
        })}
        <rect x={324} y={80} width={420} height={108} rx={8} className="fill-canvas" />
        <rect x={324} y={80} width={420} height={108} rx={8} fill={`url(#${DOTS_ID})`} />
        <path d="M424 124 H468" strokeWidth={1.5} markerEnd={`url(#${ARROW_ID})`} className="fill-none stroke-border-strong" />
        <path d="M584 124 H616" strokeWidth={1.5} markerEnd={`url(#${ARROW_ID})`} className="fill-none stroke-border-strong" />
        <rect x={352} y={106} width={72} height={36} rx={18} strokeWidth={1.5} className="fill-surface-pearl stroke-ink-tertiary" />
        <OrgText x={388} y={128.5}>Start</OrgText>
        <rect x={472} y={106} width={112} height={36} rx={6} strokeWidth={1.5} className="fill-surface-pearl stroke-ink-tertiary" />
        <OrgText x={528} y={128.5}>Process Request</OrgText>
        <rect x={620} y={106} width={116} height={36} rx={6} strokeWidth={1.5} className="fill-surface-pearl stroke-subprocess" />
        <rect x={624} y={110} width={108} height={28} rx={4} strokeWidth={1} className="fill-surface-pearl stroke-subprocess" />
        <OrgText x={678} y={128.5}>Order Fulfillment</OrgText>
        <text x={388} y={161} textAnchor="middle" fontSize={11} className="fill-ink-tertiary">
          {`${t("refAudit.fig.teamA")} · ${t("refAudit.fig.me")}`}
        </text>
        <TriangleAlert x={503} y={151} size={12} strokeWidth={2} className="text-warn" />
        <text x={519} y={161} fontSize={11} fontWeight={600} className="fill-warn">{t("refAudit.fig.teamB")}</text>
        <TriangleAlert x={622} y={151} size={12} strokeWidth={2} className="text-warn" />
        <text x={638} y={161} fontSize={11} fontWeight={600} className="fill-warn">{t("refAudit.fig.spAssignee")}</text>

        {/* 그룹 · 업무 체계 카테고리 */}
        <rect x={316} y={206} width={208} height={46} rx={10} className="fill-surface stroke-hairline" />
        <text x={330} y={224} fontSize={11} className="fill-ink-tertiary">{t("refAudit.fig.groupCap")}</text>
        <rect x={330} y={230} width={52} height={16} rx={8} className="fill-surface-alt stroke-hairline" />
        <text x={356} y={241.5} textAnchor="middle" fontSize={10} className="fill-ink-secondary">{t("refAudit.fig.me")}</text>
        <rect x={388} y={230} width={64} height={16} rx={8} strokeDasharray="3 2" className={`${WARN_TINT} stroke-warn`} />
        <text x={420} y={241.5} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-warn">{t("refAudit.fig.userF")}</text>
        <rect x={536} y={206} width={216} height={46} rx={10} className="fill-surface stroke-hairline" />
        <text x={550} y={224} fontSize={11} className="fill-ink-tertiary">{t("refAudit.fig.categoryCap")}</text>
        <rect x={550} y={230} width={100} height={16} rx={8} strokeDasharray="3 2" className={`${WARN_TINT} stroke-warn`} />
        <text x={600} y={241.5} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-warn">
          {t("refAudit.fig.chipCategoryAdmin")}
        </text>
      </svg>
      {REF_AUDIT_CASES.map((spec) => (
        <CaseHelp key={spec.id} spec={spec} />
      ))}
    </div>
  );
}
