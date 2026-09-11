"use client";

// 홈 맵 상세 — 서브프로세스 정보 섹션. SP 지정값과 원문 메모를 한 카드에: 부서 필·담당자 인물 필(세로 타일) +
// 시스템·URL·GMP 스택 · 수행 지표 3열 · 입력물/산출물 결합 타일 + 시작/종료 조건. 메모가 있는 타일은 아이콘
// 점 + 호버 스왑 + 클릭 원문 팝오버(FallbackHint 읽기)이고, 대표값이 없을 때만 원문을 회색 작은 글씨로 타일에
// 노출(폴백 톤). 지정 안 됐고 값·메모도 없어도 섹션은 남긴다 — 톤다운 배경·헤더로 접힌 채 (사용자 지시 2026-09-10,
// 이전엔 미렌더). 폭 ≥40rem(컨테이너 쿼리)에서 2열·3열 혼합, 그보다 좁으면 세로 쌓임.

import {
  Building2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Flag,
  Link as LinkIcon,
  LogIn,
  LogOut,
  Monitor,
  Play,
  ShieldCheck,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { AssigneePills } from "@/components/assignee-pills";
import { CurrencyPill, type CostUnit } from "@/components/cost-unit";
import { DeptPill } from "@/components/dept-pill";
import { FallbackHint } from "@/components/fallback-hint";
import { deptLeaf } from "@/components/maps/dept-level-icon";
import { PARAM_ICON } from "@/components/param-icons";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import { SectionHeader } from "@/components/section-header";
import type { MapDetail } from "@/lib/api";
import { parseAssignees } from "@/lib/assignee";
import { formatKst } from "@/lib/datetime";
import { useDirectory } from "@/lib/directory";
import { resolveDataForm } from "@/lib/data-forms";
import { formatThousands } from "@/lib/duration";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";
import { formatParamValue, PARAM_LABEL_KEY } from "@/lib/params";
import { countFilledSpTiles, parseIoRows, resolveValueOrNote, type IoRow } from "@/lib/sp-detail";

interface MapDetailSpSectionProps {
  detail: MapDetail;
  // org_path → 한글 부서명(카드가 디렉터리에서 만든 조회표) — 부서 필의 UI 언어 이름·반대 언어 줄
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
  const designated = str(detail.sp_designated_at) !== "";
  // SP 미지정 맵은 비활성 느낌(톤다운 배경·헤더)으로 접힌 채 시작 (사용자 지시 2026-09-09)
  const [collapsed, setCollapsed] = useState(!designated);
  // 기본은 BPM 속성 + 수행 지표 헤더까지만 — 나머지(지표 타일·입출력)는 아코디언으로 접혀 있다.
  // 섹션 호버 시 헤더의 지정 필이 "모두 펼치기"로 바뀌고, 누르면 안의 그룹까지 전부 펼친다 (사용자 지시 2026-09-09)
  const [expanded, setExpanded] = useState(false);
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const expandAll = () => {
    setCollapsed(false);
    setExpanded(true);
    setAttrsOpen(true);
    setMetricsOpen(true);
    setDetailsOpen(true);
  };

  const notSet = t("sp.tile.notSet");
  // 빈 값 표기는 전부 짧은 대시 — 좁은 열에서 "미입력" 글자가 라벨을 밀지 않게, 담당자 타일과 통일 (사용자 지시 2026-09-11)
  const EMPTY_DASH = "–";

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
        placeholder={EMPTY_DASH}
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

  // 세로 타일 머리 행 — 아이콘 + 라벨 (+ 우측 슬롯). 값이 없으면 우측에 짧은 대시
  const vertHead = (icon: LucideIcon, label: string, filled: boolean, right?: ReactNode, emptyText = EMPTY_DASH) => {
    const Icon = icon;
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${filled ? "text-accent" : "text-ink-tertiary"}`} />
        <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{label}</span>
        {filled ? right : <span className="shrink-0 text-caption text-ink-muted">{emptyText}</span>}
      </div>
    );
  };

  // ── BPM 속성 ──
  const deptPath = str(detail.sp_department);
  // 저장값이 말단 이름뿐이면(라이브러리 행 규칙) 디렉터리에서 말단 일치 경로를 찾아 한글명을 조회한다 — DeptPill과 같은 규칙
  const deptOrgPath = (() => {
    if (deptPath === "" || deptPath.includes("/")) return deptPath;
    for (const user of dir.values()) {
      const path = user.org_path ?? "";
      if (path !== "" && deptLeaf(path) === deptPath) return path;
    }
    return deptPath;
  })();
  const deptLeafName = deptLeaf(deptOrgPath);
  const deptKorean = (koreanDeptByPath.get(deptOrgPath) ?? "").trim();
  // 필 = UI 언어 이름, 아랫줄 = 반대 언어 이름(톤다운). 반대 언어 이름을 모르면 아랫줄 생략 (사용자 지시 2026-09-09)
  const deptPrimary = lang === "ko" ? deptKorean || deptLeafName : deptLeafName;
  const deptSecondary = lang === "ko" ? (deptKorean !== "" ? deptLeafName : "") : deptKorean;
  const names = parseAssignees(str(detail.sp_assignee));
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
  const inputs = parseIoRows(detail.sp_input, detail.sp_input_forms);
  const outputs = parseIoRows(detail.sp_output, detail.sp_output_forms);
  const startCondition = str(detail.sp_start_condition);
  const endCondition = str(detail.sp_end_condition);
  const detailCount = [inputs.length > 0, outputs.length > 0, startCondition !== "", endCondition !== ""].filter(Boolean).length;
  const ioFilled = inputs.length > 0 || outputs.length > 0;

  // 항목별 데이터 형식 필 — 카탈로그에 있으면 아이콘 동반(MultiValueInput 읽기 필과 같은 문법), 미지는 글자만.
  // align-middle + 행 줄높이(18px)와 같은 높이 + -top-px 보정(실측 0.8px 하향 상쇄) → 행 글자와 세로 중앙이 맞는다.
  // 긴 형식명은 8rem에서 말줄임(제목 속성에 전문)
  const formPill = (form: string) => {
    const matched = resolveDataForm(form);
    const FormIcon = matched?.icon;
    const label = matched?.value ?? form;
    return (
      <span
        title={form}
        // indent-0 — 글머리 행의 음수 들여쓰기가 필 안까지 상속돼 아이콘과 글자가 겹치는 것을 막는다
        className="relative -top-px ml-1 inline-flex h-[18px] max-w-[8rem] shrink-0 items-center gap-0.5 rounded-xs border border-hairline bg-surface px-1 indent-0 align-middle text-[11px] leading-none font-normal text-ink-tertiary"
      >
        {FormIcon && <FormIcon size={10} strokeWidth={1.5} className="shrink-0" />}
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  };

  // 입력물/산출물 반쪽 — 글머리 목록 + 항목별 데이터 형식. 3행 남짓까지 보이고 넘치면 목록 안에서 세로 스크롤
  const ioHalf = (field: "input" | "output", icon: LucideIcon, label: string, rows: IoRow[]) => (
        // flex-1(균등 분할) 대신 자연 높이 — 항목이 여럿이면 결합 타일이 커지고 그리드 행이 따라 늘어난다.
    // 균등 분할이면 3줄 클램프 전에 반쪽 높이에서 글자가 잘린다(실측)
    <div data-id={`map-detail-sp-${field}`} className="flex flex-col gap-1 px-2.5 py-1.5">
      {vertHead(icon, label, rows.length > 0)}
      {rows.length > 0 && (
        // 항목이 많으면 반쪽 안에서 세로 스크롤(3행 남짓 노출 + 다음 행 살짝 보여 "더 있음" 암시).
        // scroll-soft — 평소 막대를 숨기고 호버 때만 (사용자 지시 2026-09-09)
        <ul className="scroll-soft max-h-16 text-fine leading-normal break-keep text-ink-secondary">
          {rows.map((row, i) => (
            <li
              key={`${i}-${row.text}`}
              data-id={`map-detail-sp-${field}-row`}
              // 행 단위 호버 — 어느 항목을 읽는지 짚어주는 표시일 뿐 클릭 동작은 없다(커서·눌림 없음)
              className="rounded-xs pr-1 pl-2.5 -indent-2.5 transition-colors duration-150 hover:bg-surface-alt"
            >
              {`• ${row.text}`}
              {row.form !== "" && formPill(row.form)}
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
    <section
      data-id="map-detail-sp-section"
      data-expanded={expanded ? "true" : "false"}
      // named group — 무명 `group`이면 섹션 호버가 안의 모든 타일(`group` 루트)의 메모 아이콘 스왑까지 일괄로
      // 켜버린다(.group:hover .note-swap-*). 섹션 호버는 "모두 펼치기" 버튼만 반응해야 한다 (사용자 지시 2026-09-10)
      className={`group/sp @container rounded-md border border-hairline p-3 ${designated ? "bg-surface" : "bg-surface-alt"}`}
    >
      <SectionHeader
        dataId="map-detail-sp-toggle"
        icon={Workflow}
        title={t("home.spSection")}
        count={countFilledSpTiles(detail)}
        collapsed={collapsed}
        muted={!designated}
        onToggle={() => setCollapsed((v) => !v)}
        right={
          <span className="relative flex shrink-0 items-center whitespace-nowrap text-fine text-ink-tertiary">
            {/* 섹션 호버 시 상태 필 왼쪽에 페이드로 나타나는 모두 펼치기/접기 — 필은 그대로, 줄바꿈 없음 */}
            <button
              type="button"
              data-id="map-detail-sp-expand-all"
              aria-expanded={expanded}
              onClick={() => (expanded ? setExpanded(false) : expandAll())}
              className="pointer-events-none absolute top-1/2 right-full mr-1.5 flex -translate-y-1/2 items-center gap-1 rounded-sm px-1.5 py-0.5 text-fine whitespace-nowrap text-ink-tertiary opacity-0 transition-opacity duration-150 group-hover/sp:pointer-events-auto group-hover/sp:opacity-100 hover:bg-surface-alt hover:text-ink focus-visible:pointer-events-auto focus-visible:opacity-100"
            >
              {expanded ? <ChevronsDownUp size={13} strokeWidth={1.5} /> : <ChevronsUpDown size={13} strokeWidth={1.5} />}
              {t(expanded ? "inspector.collapseAll" : "inspector.expandAll")}
            </button>
            {/* 지정 상태 필(SP 지정 모달과 동일, 영어 고정) + 지정일 */}
            <span data-id="map-detail-sp-status-wrap" className="flex items-center gap-1.5">
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
          </span>
        }
      />
      {!collapsed && (
        <div className="mt-1 flex flex-col">
          {/* BPM 속성 — 부서(자연 높이)·담당자(클립) 세로 타일 + 시스템 / GMP·URL(1:2) 2행 스택 */}
          <div className="py-1" data-id="map-detail-sp-attrs">
            {groupHeader("map-detail-sp-attrs-toggle", attrsOpen, () => setAttrsOpen((v) => !v), t("editor.bpmAttrs"), attrCount)}
            {attrsOpen && (
              <div className="ml-2 border-l border-divider pl-2">
                {/* 열 비율 — 부서 1.75 : 담당자 1.28(이전 1.5의 85%) : 시스템 스택 3 (사용자 지시 2026-09-10) */}
                <div className="grid grid-cols-2 gap-1.5 py-1 @[40rem]:grid-cols-[1.75fr_1.28fr_3fr] @[40rem]:grid-rows-[repeat(2,auto)]">
                  {/* 부서는 값이 있으면 필 자체가 타일(헤더 생략) — 없을 때만 비활성 헤더 타일 (사용자 지시 2026-09-09, 2026-09-11 재확인).
                      필의 여백·아이콘 크기는 빈 타일 머리 행과 동일(DeptPill fill: px-2.5 py-2, 아이콘 16)이라 두 상태의 위치·크기가 같다.
                      자연 높이라 긴 부서명이 다 보이고, 행 높이를 이 타일이 정한다(담당자는 그 높이에 맞춰 클립) */}
                  <div className="flex @[40rem]:row-span-2" data-id="map-detail-sp-department" data-filled={deptPath !== "" ? "true" : "false"}>
                    {deptPath !== "" ? (
                      // 저장값(리프명) 그대로 넘긴다 — 필의 고아 판정은 유효 리프 집합과 저장값을 대조하므로
                      // 해석된 슬래시 경로를 주면 정상 부서도 늘 경고로 떴다(2026-09-10). 경로 해석은 필이 다시 한다
                      <DeptPill
                        department={deptPath}
                        label={deptPrimary}
                        subLabel={deptSecondary || undefined}
                        variant="block"
                        fill
                        dataId="map-detail-sp-department-pill"
                      />
                    ) : (
                      <div className={`flex min-w-0 flex-1 flex-col gap-1.5 rounded-sm border px-2.5 py-2 ${EMPTY_TONE}`}>
                        {vertHead(Building2, t("field.department"), false)}
                      </div>
                    )}
                  </div>
                  <div className="relative h-32 @[40rem]:row-span-2 @[40rem]:h-auto">
                    <div
                      data-id="map-detail-sp-assignee"
                      data-filled={names.length > 0 ? "true" : "false"}
                      className={`absolute inset-0 flex flex-col gap-1.5 overflow-hidden rounded-sm border px-2.5 py-2 ${names.length > 0 ? FILLED_TONE : EMPTY_TONE}`}
                    >
                      {/* 담당자 미입력은 "Not set" 대신 짧은 대시 — 좁아진 열(1.28fr)에서 글자가 라벨을 밀지 않게 (사용자 지시 2026-09-10) */}
                      {vertHead(
                        Users,
                        t("field.assignee"),
                        names.length > 0,
                        <span className="shrink-0 text-fine text-ink-tertiary">{t("home.assigneeCount", { n: names.length })}</span>,
                      )}
                      {names.length > 0 && (
                        <div className="min-h-0">
                          {/* 인물 필 — 호버 0.7초/클릭으로 인물 카드(이름·아이디·말단 부서·조직 경로), 줄바꿈 나열 */}
                          <AssigneePills assignee={str(detail.sp_assignee)} dataIdPrefix="map-detail-sp" align="start" />
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
                  {/* GMP·URL — 시스템 아래 한 줄. URL은 값이 있을 때만 폭(1:2)을 차지하고, 없으면 아이콘 타일로
                      줄어 GMP가 남는 폭을 가져간다 (사용자 지시 2026-09-09) */}
                  <div className={`col-span-2 grid gap-1.5 @[40rem]:col-span-1 ${url !== "" ? "grid-cols-[1fr_2fr]" : "grid-cols-[1fr_auto]"}`}>
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
                    {url !== "" ? (
                      readTile(
                        "url",
                        LinkIcon,
                        t("field.url"),
                        "",
                        "",
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          data-id="map-detail-sp-url-link"
                          className="min-w-0 truncate text-accent underline underline-offset-2"
                        >
                          {str(detail.sp_url_label) || url}
                        </a>,
                      )
                    ) : (
                      <div
                        data-id="map-detail-sp-tile-url"
                        data-filled="false"
                        title={`${t("field.url")}: ${notSet}`}
                        className={`flex w-9 items-center justify-center rounded-sm border ${EMPTY_TONE}`}
                      >
                        <LinkIcon size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 수행 지표 헤더는 항상 보인다(접힘 기본 높이의 경계). 접혀 있으면 헤더 클릭도 모두 펼치기 */}
          <div className="py-1" data-id="map-detail-sp-metrics">
            {groupHeader(
              "map-detail-sp-metrics-toggle",
              expanded && metricsOpen,
              () => (expanded ? setMetricsOpen((v) => !v) : expandAll()),
              t("inspector.parameters"),
              metricCount,
            )}
          </div>
          {/* 아코디언 — 지표 타일 + 입출력·조건. grid-rows 0fr↔1fr 전환(멤버 카드 펼침과 같은 패턴) */}
          <div
            data-id="map-detail-sp-accordion"
            className={`grid transition-[grid-template-rows] duration-350 ease-smooth ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="min-h-0 overflow-hidden">
              {metricsOpen && (
                <div className="-mt-1 mb-1 ml-2 border-l border-divider pl-2">
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
          </div>
        </div>
      )}
    </section>
  );
}
