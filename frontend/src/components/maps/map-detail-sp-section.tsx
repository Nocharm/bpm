"use client";

// 홈 맵 상세 — 서브프로세스 정보 섹션. SP 지정값과 원문 메모를 한 카드에: 부서 트리·담당자 목록(세로 타일) +
// 시스템·URL·GMP 스택 · 수행 지표 3열 · 입력물/산출물 결합 타일 + 시작/종료 조건. 메모가 있는 타일은 아이콘
// 점 + 호버 스왑 + 클릭 원문 팝오버(FallbackHint 읽기)이고, 대표값이 없을 때만 원문을 회색 작은 글씨로 타일에
// 노출(폴백 톤). 지정 안 됐고 값·메모도 없으면 렌더하지 않는다 (사용자 결정 2026-09-09, 목업 v5).
// 폭 ≥40rem(컨테이너 쿼리)에서 2열·3열 혼합, 그보다 좁으면 세로 쌓임.

import {
  Building2,
  ChevronRight,
  CornerDownRight,
  Flag,
  Link as LinkIcon,
  LogIn,
  LogOut,
  Monitor,
  Play,
  ShieldCheck,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { CurrencyPill, type CostUnit } from "@/components/cost-unit";
import { FallbackHint } from "@/components/fallback-hint";
import { PARAM_ICON } from "@/components/param-icons";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import { SectionHeader } from "@/components/section-header";
import type { DirectoryUser, MapDetail } from "@/lib/api";
import { parseAssignees } from "@/lib/assignee";
import { formatKst } from "@/lib/datetime";
import { useDirectory } from "@/lib/directory";
import { formatThousands } from "@/lib/duration";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";
import { formatDeptName } from "@/lib/korean-dept";
import { formatParamValue, PARAM_LABEL_KEY } from "@/lib/params";
import {
  buildDeptTreeLevels,
  countFilledSpTiles,
  hasSpContent,
  parseIoLines,
  resolveValueOrNote,
} from "@/lib/sp-detail";

interface MapDetailSpSectionProps {
  detail: MapDetail;
  // org_path → 한글 부서명(카드가 디렉터리에서 만든 조회표) — 부서 트리 레벨 표시명
  koreanDeptByPath: Map<string, string>;
}

// 값 있는/없는 타일 톤 — SpFieldTile readOnly와 동일한 두 단계
const FILLED_TONE = "border-accent-tint-border bg-accent-tint/40";
const EMPTY_TONE = "border-hairline bg-surface";
// 세로 타일 하단 페이드 — 클립 경계를 타일 틴트 색으로 흐리게(틴트 40% + 흰 바탕의 합성색)
const VERT_FADE_STYLE = {
  background: "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-accent-tint) 40%, var(--color-surface)))",
};

const str = (v: string | null | undefined): string => (v ?? "").trim();

export function MapDetailSpSection({ detail, koreanDeptByPath }: MapDetailSpSectionProps) {
  const { t, lang } = useI18n();
  const dir = useDirectory();
  const [collapsed, setCollapsed] = useState(false);
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);

  if (!hasSpContent(detail)) return null;

  const notSet = t("sp.tile.notSet");
  const designated = str(detail.sp_designated_at) !== "";

  // 원문 메모가 있는 타일 — 아이콘에 점, 호버 시 메모 아이콘으로 스왑, 클릭=원문 팝오버(읽기). 없으면 기본 아이콘.
  // 대표값이 없고 메모만 있으면 아이콘 톤도 임시값(tertiary)
  const noteIcon = (field: string, icon: LucideIcon, note: string, hasValue: boolean) =>
    note !== "" ? (
      <FallbackHint
        fallback={note}
        dataId={`map-detail-sp-note-${field}`}
        restIcon={icon}
        iconSize={16}
        padded={false}
        restClassName={hasValue ? "text-accent" : "text-ink-tertiary"}
      />
    ) : undefined;

  // 읽기 타일 — 대표값(또는 valueNode) 우선, 없으면 원문을 폴백 톤(점선·회색 작은 글씨 한 줄, 라벨 유지)으로
  const readTile = (
    field: string,
    icon: LucideIcon,
    label: string,
    value: string,
    note = "",
    valueNode?: ReactNode,
  ) => {
    const base = resolveValueOrNote(value, note);
    const shown = base.tone === "fallback" && valueNode != null ? { value: "", tone: "default" as const } : base;
    const isFallback = shown.tone === "fallback";
    const hasValue = !isFallback && (shown.value !== "" || valueNode != null);
    return (
      <SpFieldTile
        dataId={`map-detail-sp-tile-${field}`}
        icon={icon}
        iconSlot={noteIcon(field, icon, note, hasValue)}
        label={label}
        value={shown.value}
        valueNode={valueNode}
        valueTone={shown.tone}
        valueSize={isFallback ? "fine" : undefined}
        labelFixed={isFallback}
        placeholder={notSet}
        readOnly
      />
    );
  };

  const groupHeader = (dataId: string, open: boolean, onToggle: () => void, label: string, count: number) => (
    <button
      type="button"
      data-id={dataId}
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-5 w-full items-center gap-1 text-fine font-semibold text-ink-tertiary"
    >
      <ChevronRight size={12} strokeWidth={1.5} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      {label}
      {count > 0 && <span className="font-normal">({count})</span>}
    </button>
  );

  // 세로 타일 머리 행 — 아이콘 + 라벨 (+ 우측 슬롯). 값이 없으면 우측에 "미입력"
  const vertHead = (icon: LucideIcon, label: string, filled: boolean, right?: ReactNode) => {
    const Icon = icon;
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${filled ? "text-accent" : "text-ink-tertiary"}`} />
        <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{label}</span>
        {filled ? right : <span className="shrink-0 text-caption text-ink-muted">{notSet}</span>}
      </div>
    );
  };

  // ── BPM 속성 ──
  const deptPath = str(detail.sp_department);
  const deptLevels = buildDeptTreeLevels(deptPath);
  const names = parseAssignees(str(detail.sp_assignee));
  // 저장값은 영문 name — 디렉터리에서 name(또는 한글명) 일치로 인물 해석 (AssigneePills와 같은 규칙)
  const byName = new Map<string, DirectoryUser>();
  for (const user of dir.values()) {
    byName.set(user.name, user);
    if (user.korean_name) byName.set(user.korean_name, user);
  }
  const assigneeLabel = (name: string): string => {
    const user = byName.get(name);
    return user ? (lang === "ko" ? user.korean_name || user.name : user.name) : name;
  };
  const url = str(detail.sp_url);
  const gmpText = detail.sp_gmp ? formatGmp(detail.sp_gmp) : "";
  const attrCount = [
    deptPath !== "",
    names.length > 0,
    str(detail.sp_system) !== "" || str(detail.sp_system_fallback) !== "",
    url !== "",
    gmpText !== "" || str(detail.sp_gmp_fallback) !== "",
  ].filter(Boolean).length;

  // ── 수행 지표 ──
  const costUnit: CostUnit = str(detail.sp_cost_usd) !== "" ? "cost_usd" : "cost_krw";
  const costValue = formatThousands(str(costUnit === "cost_usd" ? detail.sp_cost_usd : detail.sp_cost_krw));
  const metricValues = {
    duration: formatParamValue("duration", detail.sp_duration),
    touch_time: formatParamValue("touch_time", detail.sp_touch_time),
    headcount: formatParamValue("headcount", detail.sp_headcount),
    annual_count: formatParamValue("annual_count", detail.sp_annual_count),
    fte: formatParamValue("fte", detail.sp_fte),
  };
  const metricCount = [
    metricValues.duration !== "" || str(detail.sp_total_time_fallback) !== "",
    metricValues.touch_time !== "" || str(detail.sp_touch_time_fallback) !== "",
    costValue !== "",
    metricValues.headcount !== "",
    metricValues.annual_count !== "" || str(detail.sp_frequency_fallback) !== "",
    metricValues.fte !== "",
  ].filter(Boolean).length;

  // ── 입출력 · 조건 ──
  const inputs = parseIoLines(detail.sp_input);
  const outputs = parseIoLines(detail.sp_output);
  const startCondition = str(detail.sp_start_condition);
  const endCondition = str(detail.sp_end_condition);
  const detailCount = [inputs.length > 0, outputs.length > 0, startCondition !== "", endCondition !== ""].filter(Boolean).length;
  const ioFilled = inputs.length > 0 || outputs.length > 0;

  // 입력물/산출물 반쪽 — 글머리 목록. 높이는 내용에 맞추고 상한은 3줄 클램프(넘치면 말줄임) (사용자 지시 2026-09-09)
  const ioHalf = (field: "input" | "output", icon: LucideIcon, label: string, items: string[]) => (
    <div data-id={`map-detail-sp-${field}`} className="flex min-h-0 flex-1 flex-col gap-1 px-2.5 py-1.5">
      {vertHead(icon, label, items.length > 0)}
      {items.length > 0 && (
        <ul className="line-clamp-3 text-fine leading-normal break-keep text-ink-secondary">
          {items.map((item, i) => (
            <li key={`${i}-${item}`} className="pl-2.5 -indent-2.5">
              {`• ${item}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // 시작/종료 조건 — 문장, 높이는 내용에 맞추고 상한은 3줄 클램프. 빈 타일은 머리 행만
  const conditionTile = (field: "start_condition" | "end_condition", icon: LucideIcon, label: string, text: string) => (
    <div
      data-id={`map-detail-sp-${field}`}
      className={`flex flex-col gap-1 overflow-hidden rounded-sm border px-2.5 py-1.5 ${text !== "" ? FILLED_TONE : EMPTY_TONE}`}
    >
      {vertHead(icon, label, text !== "")}
      {text !== "" && (
        <p className="line-clamp-3 text-fine leading-normal break-keep text-ink-secondary">{text}</p>
      )}
    </div>
  );

  return (
    <section data-id="map-detail-sp-section" className="@container rounded-md border border-hairline bg-surface p-3">
      <SectionHeader
        dataId="map-detail-sp-toggle"
        icon={Workflow}
        title={t("home.spSection")}
        count={countFilledSpTiles(detail)}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        right={
          <span className="flex shrink-0 items-center gap-1.5 text-fine text-ink-tertiary">
            {/* 지정 상태 필 — SP 지정 모달과 동일(영어 고정) */}
            {designated ? (
              <span
                data-id="map-detail-sp-status"
                className="rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-accent"
              >
                Designated
              </span>
            ) : (
              <span
                data-id="map-detail-sp-status"
                className="rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-ink-secondary"
              >
                Not designated
              </span>
            )}
            {/* 지정일 — "YYYY-MM-DD"(KST)만, 시각은 헤더에 과하다 */}
            {designated && <span>{formatKst(detail.sp_designated_at).slice(0, 10)}</span>}
          </span>
        }
      />
      {!collapsed && (
        <div className="mt-1 flex flex-col">
          {/* BPM 속성 — 부서·담당자 세로 타일(3행 높이, 넘치면 클립) + 시스템·URL·GMP 스택 */}
          <div className="py-1" data-id="map-detail-sp-attrs">
            {groupHeader("map-detail-sp-attrs-toggle", attrsOpen, () => setAttrsOpen((v) => !v), t("editor.bpmAttrs"), attrCount)}
            {attrsOpen && (
              <div className="ml-2 border-l border-divider pl-2">
                <div className="grid grid-cols-2 gap-1.5 py-1 @[40rem]:grid-cols-[1.5fr_1fr_3.5fr] @[40rem]:grid-rows-[repeat(3,auto)]">
                  {/* 세로 타일은 absolute로 셀을 채운다 — 행 높이는 스택 타일 3개가 정하고, 넘치는 트리·이름은 잘린다 */}
                  <div className="relative h-32 @[40rem]:row-span-3 @[40rem]:h-auto">
                    <div
                      data-id="map-detail-sp-department"
                      data-filled={deptPath !== "" ? "true" : "false"}
                      title={deptPath || undefined}
                      className={`absolute inset-0 flex flex-col gap-1.5 overflow-hidden rounded-sm border px-2.5 py-2 ${deptPath !== "" ? FILLED_TONE : EMPTY_TONE}`}
                    >
                      {vertHead(Building2, t("field.department"), deptPath !== "")}
                      {deptPath !== "" && (
                        <div className="flex min-h-0 flex-col gap-px text-fine leading-[1.3] text-ink-tertiary">
                          {deptLevels.map((lv) => (
                            <div
                              key={`${lv.depth}-${lv.path}`}
                              className="flex min-w-0 shrink-0 items-start gap-0.5"
                              style={{ paddingLeft: lv.depth * 6 }}
                            >
                              {lv.depth > 0 && (
                                <CornerDownRight size={10} strokeWidth={1.5} className="mt-[3px] shrink-0 text-ink-muted" />
                              )}
                              {lv.ellipsis ? (
                                <span>…</span>
                              ) : lv.leaf ? (
                                <span className="line-clamp-2 break-keep font-semibold text-accent">
                                  {formatDeptName(lv.path, lang, koreanDeptByPath)}
                                </span>
                              ) : (
                                <span className="min-w-0 truncate">{formatDeptName(lv.path, lang, koreanDeptByPath)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {deptPath !== "" && (
                        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-4" style={VERT_FADE_STYLE} />
                      )}
                    </div>
                  </div>
                  <div className="relative h-32 @[40rem]:row-span-3 @[40rem]:h-auto">
                    <div
                      data-id="map-detail-sp-assignee"
                      data-filled={names.length > 0 ? "true" : "false"}
                      className={`absolute inset-0 flex flex-col gap-1.5 overflow-hidden rounded-sm border px-2.5 py-2 ${names.length > 0 ? FILLED_TONE : EMPTY_TONE}`}
                    >
                      {vertHead(
                        Users,
                        t("field.assignee"),
                        names.length > 0,
                        <span className="shrink-0 text-fine text-ink-tertiary">{t("home.assigneeCount", { n: names.length })}</span>,
                      )}
                      {names.length > 0 && (
                        <div className="flex min-h-0 flex-col gap-0.5 text-fine leading-[1.3] text-ink-secondary">
                          {names.map((name) => (
                            <div key={name} className="flex min-w-0 shrink-0 items-center gap-1" title={name}>
                              <User size={11} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                              <span className="min-w-0 truncate">{assigneeLabel(name)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {names.length > 0 && (
                        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-4" style={VERT_FADE_STYLE} />
                      )}
                    </div>
                  </div>
                  <div className="col-span-2 @[40rem]:col-span-1">
                    {readTile("system", Monitor, t("field.system"), str(detail.sp_system), str(detail.sp_system_fallback))}
                  </div>
                  <div className="col-span-2 @[40rem]:col-span-1">
                    {readTile(
                      "url",
                      LinkIcon,
                      t("field.url"),
                      "",
                      "",
                      url !== "" ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          data-id="map-detail-sp-url-link"
                          className="min-w-0 truncate text-accent underline underline-offset-2"
                        >
                          {str(detail.sp_url_label) || url}
                        </a>
                      ) : undefined,
                    )}
                  </div>
                  <div className="col-span-2 @[40rem]:col-span-1">
                    {readTile(
                      "gmp",
                      ShieldCheck,
                      t("field.gmp"),
                      "",
                      str(detail.sp_gmp_fallback),
                      gmpText !== "" && detail.sp_gmp ? (
                        <span className="rounded-full px-1.5 py-0.5 text-fine font-normal" style={getGmpBadgeStyle(detail.sp_gmp)}>
                          {gmpText}
                        </span>
                      ) : undefined,
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 수행 지표 — 1행 타일 3열 */}
          <div className="py-1" data-id="map-detail-sp-metrics">
            {groupHeader("map-detail-sp-metrics-toggle", metricsOpen, () => setMetricsOpen((v) => !v), t("inspector.parameters"), metricCount)}
            {metricsOpen && (
              <div className="ml-2 border-l border-divider pl-2">
                <div className="grid grid-cols-2 gap-1.5 py-1 @[40rem]:grid-cols-3">
                  {readTile("duration", PARAM_ICON.duration, t(PARAM_LABEL_KEY.duration), metricValues.duration, str(detail.sp_total_time_fallback))}
                  {readTile("touch_time", PARAM_ICON.touch_time, t(PARAM_LABEL_KEY.touch_time), metricValues.touch_time, str(detail.sp_touch_time_fallback))}
                  {readTile("cost", PARAM_ICON[costUnit], t("field.costRun"), costValue, "", costValue !== "" ? <CurrencyPill unit={costUnit} /> : undefined)}
                  {readTile("headcount", PARAM_ICON.headcount, t(PARAM_LABEL_KEY.headcount), metricValues.headcount)}
                  {readTile("annual_count", PARAM_ICON.annual_count, t(PARAM_LABEL_KEY.annual_count), metricValues.annual_count, str(detail.sp_frequency_fallback))}
                  {readTile("fte", PARAM_ICON.fte, t(PARAM_LABEL_KEY.fte), metricValues.fte)}
                </div>
              </div>
            )}
          </div>

          {/* 입출력 · 조건 — 좌측 입력물+산출물 결합 타일(2행), 우측 위 시작 조건·아래 종료 조건 */}
          <div className="py-1" data-id="map-detail-sp-details">
            {groupHeader("map-detail-sp-details-toggle", detailsOpen, () => setDetailsOpen((v) => !v), t("inspector.details"), detailCount)}
            {detailsOpen && (
              <div className="ml-2 border-l border-divider pl-2">
                <div className="grid grid-cols-1 gap-1.5 py-1 @[40rem]:grid-cols-[5fr_7fr]">
                  <div
                    data-id="map-detail-sp-io"
                    className={`flex flex-col overflow-hidden rounded-sm border @[40rem]:row-span-2 ${ioFilled ? FILLED_TONE : EMPTY_TONE}`}
                  >
                    {ioHalf("input", LogIn, t("field.input"), inputs)}
                    <div className={`shrink-0 border-t ${ioFilled ? "border-accent-tint-border" : "border-hairline"}`} />
                    {ioHalf("output", LogOut, t("field.output"), outputs)}
                  </div>
                  {conditionTile("start_condition", Play, t("field.startCondition"), startCondition)}
                  {conditionTile("end_condition", Flag, t("field.endCondition"), endCondition)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
