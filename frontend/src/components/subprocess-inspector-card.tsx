"use client";

// 인스펙터 서브프로세스 카드 — 지정 상태 표시 + 지정/수정/해제.
// 지정은 다른 맵이 이 맵을 서브프로세스 노드로 연결(임베드)하기 위한 절차 — 노트로 안내.
// 변경은 게시된 버전이 열린 상태에서 오너·관리자만 가능(비활성 시 사유 노트 표시).

import {
  ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Boxes, BriefcaseBusiness, Building2, ChevronRight, Flag, Info,
  Link as LinkIcon, LogIn, LogOut, Monitor, Network, Play, User, Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  ApiError,
  createSpDesignationRequest,
  deleteSubprocessDesignation,
  getMap,
  getPendingSpDesignationRequest,
  type ApprovalRequest,
  type MapDetail,
  type SubprocessUsage,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { AssigneePills } from "@/components/assignee-pills";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { CostUnit } from "@/components/cost-unit";
import { DeptPill } from "@/components/dept-pill";
import { PARAM_ICON } from "@/components/param-icons";
import {
  SubprocessDesignationModal,
  type DesignationForm,
} from "@/components/permissions/subprocess-designation-modal";
import { RoleChip } from "@/components/role-chip";
import { Tooltip } from "@/components/tooltip";
import { formatSystem } from "@/lib/catalogs";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { formatParamValue, PARAM_LABEL_KEY, type ParamField } from "@/lib/params";
import { toSafeHref } from "@/lib/url";

// 카드 접힘 — 기본 접힘, 세션 동안 유지(sessionStorage) + 탭 간(에디터 노드/맵/승인탭 3마운트) 공유.
const SP_OPEN_KEY = "bpm.inspector.spOpen";

// 지표 칸 짧은 라벨 — 3열 칸에 "회당 소요시간(h)" 같은 전체 라벨이 안 들어간다(전체 라벨은 title로)
const METRIC_LABEL_KEY: Record<ParamField, MessageKey> = {
  duration: "inspector.spMetric.duration",
  touch_time: "inspector.spMetric.touch",
  cost_krw: "inspector.spMetric.cost",
  cost_usd: "inspector.spMetric.cost",
  headcount: "inspector.spMetric.headcount",
  annual_count: "field.annualCount",
  fte: "field.fte",
};

// 접힘 요약 값 표기 — 아이콘만으로 뜻이 모호한 값에 단위를 붙인다(소요시간·비용은 값 자체가 단위를 가진다)
const SUMMARY_FORMAT_KEY: Partial<Record<ParamField, MessageKey>> = {
  headcount: "inspector.spSum.headcount",
  touch_time: "inspector.spSum.touch",
  annual_count: "inspector.spSum.annual",
  fte: "inspector.spSum.fte",
};

interface SummaryItem {
  key: string;
  node: ReactNode;
}

// 접힘 요약 줄 — 폭에 들어가는 만큼 앞에서부터 보이고 남은 개수는 +n 칩(누르면 카드 펼침, 사용자 결정 2026-10-22).
// 넘친 항목은 지우지 않고 invisible+absolute로 흐름에서만 뺀다 — 폭을 계속 잴 수 있어야 넓어질 때 다시 나온다.
// 첫 항목은 늘 보이고 모자라면 말줄임(긴 부서명이 +n 뒤로 숨지 않게).
function SpSummaryLine({ items, onExpand }: { items: SummaryItem[]; onExpand: () => void }) {
  const { t } = useI18n();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [fitCount, setFitCount] = useState(items.length);
  const itemsKey = items.map((item) => item.key).join("|");

  // 행 폭·항목 폭이 바뀔 때마다 다시 센다 — 항목 집합이 바뀌면 관찰을 새로 건다(observe 직후 첫 콜백이 측정)
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const itemEls = Array.from(row.querySelectorAll<HTMLElement>("[data-sum-item]"));
    const moreEl = row.querySelector<HTMLElement>("[data-sum-more]");
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      const reserve = gap + (moreEl?.offsetWidth ?? 0);
      let used = 0;
      let count = 0;
      for (let i = 0; i < itemEls.length; i++) {
        const next = used + (i > 0 ? gap : 0) + itemEls[i].offsetWidth;
        // 뒤에 남는 항목이 있으면 +n 칩 자리까지 들어가야 한다
        if (next + (i < itemEls.length - 1 ? reserve : 0) > row.clientWidth) break;
        used = next;
        count = i + 1;
      }
      setFitCount(count);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const el of itemEls) observer.observe(el);
    return () => observer.disconnect();
  }, [itemsKey]);

  const shown = Math.max(1, Math.min(fitCount, items.length));
  const hidden = items.length - shown;
  return (
    <div ref={rowRef} data-id="sp-inspector-summary" className="relative flex min-w-0 items-center gap-2.5 overflow-hidden">
      {items.map((item, index) => (
        <span
          key={item.key}
          data-sum-item
          data-id={`sp-inspector-sum-${item.key}`}
          // 첫 항목은 혼자 남았을 때만 줄어든다 — 늘 줄어들게 두면 뒤 항목에 밀려 찌그러진 폭이 측정돼 뒤 항목이 자리를 차지한다
          className={index >= shown ? "invisible absolute" : index === 0 && shown === 1 ? "flex min-w-0" : "flex shrink-0"}
        >
          {item.node}
        </span>
      ))}
      <button
        type="button"
        data-sum-more
        data-id="sp-inspector-sum-more"
        title={t("inspector.spSumMore", { n: hidden })}
        aria-label={t("inspector.spSumMore", { n: hidden })}
        className={`shrink-0 rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-secondary hover:border-accent hover:text-accent ${
          hidden > 0 ? "" : "invisible absolute"
        }`}
        onClick={onExpand}
      >
        +{hidden}
      </button>
    </div>
  );
}

// 펼친 카드의 묶음 머리 — 작은 굵은 라벨 + 오른쪽으로 이어지는 실선
function GroupHead({ dataId, label }: { dataId: string; label: string }) {
  return (
    <p data-id={dataId} className="mb-1.5 mt-3 flex items-center gap-2 text-fine font-semibold text-ink-tertiary first:mt-2">
      {label}
      <span aria-hidden className="h-px flex-1 bg-hairline" />
    </p>
  );
}

interface SubprocessInspectorCardProps {
  mapId: number;
  canManage: boolean; // 게시 버전 열림 && (오너 || sysadmin)
  disabledReason: string | null; // canManage=false일 때 비활성 사유(i18n 처리된 문자열, 표시용)
  // disabledReason의 구분값 — 문자열 비교 대신 이걸로 분기(R10)
  disabledReasonKind?: "needPublished" | "ownerOnly" | null;
  onToast?: (message: string, tone?: "error") => void;
  // 지정/해제 성공 후 — page.tsx가 usage를 재조회해 Subprocess 탭 노출을 동기화
  onDesignationChange?: () => void;
  // needPublished 사유일 때 "게시본 가기" 버튼 — page.tsx의 switchVersion 위임(R10)
  onGoToPublished?: (versionId: number) => void;
  // 역참조(Linked from) — page.tsx의 spUsage 공유(카드별 재조회 방지). 지정된 맵에서만 섹션 노출.
  usage?: SubprocessUsage | null;
}

export function SubprocessInspectorCard({
  mapId,
  canManage,
  disabledReason,
  disabledReasonKind,
  onToast,
  onDesignationChange,
  onGoToPublished,
  usage,
}: SubprocessInspectorCardProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalInitial, setModalInitial] = useState<DesignationForm>({
    department: "",
    assignee: "",
    assignee_role: "",
    system: "",
    duration: "",
    touch_time: "",
    cost_krw: "",
    cost_usd: "",
    headcount: "",
    annual_count: "",
    fte: "",
    total_time_fallback: "",
    touch_time_fallback: "",
    system_fallback: "",
    frequency_fallback: "",
    start_condition: "",
    end_condition: "",
    url: "",
    urlLabel: "",
    input: "",
    input_forms: "",
    input_ids: "",
    output: "",
    output_forms: "",
    output_ids: "",
    description: "",
  });
  const [showUndesignate, setShowUndesignate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  // 등록 요청(kind==="ownerOnly" && 미지정) 전용 — pending 조회 결과·발송 상태(R10)
  const [spPending, setSpPending] = useState<ApprovalRequest | null>(null);
  const [spRequestBusy, setSpRequestBusy] = useState(false);
  const [spRequestError, setSpRequestError] = useState<string | null>(null);
  useEffect(() => {
    const stored = window.sessionStorage.getItem(SP_OPEN_KEY);
    if (stored !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(stored === "1"); // one-time hydration restore from sessionStorage
    }
  }, []);
  // Linked from 하위 아코디언 — 기본 접힘·영속 없음(매번 눌러서 연다, 사용자 결정 2026-08-27)
  const [linkedOpen, setLinkedOpen] = useState(false);
  const toggleOpen = () => {
    const next = !open;
    window.sessionStorage.setItem(SP_OPEN_KEY, next ? "1" : "0");
    setOpen(next);
    if (!next) setLinkedOpen(false); // 카드를 접으면 하위 섹션도 초기화
  };

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch(() => {
        // 조회 실패 시 카드만 비표시(인스펙터 다른 섹션에 영향 없음)
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  // designated는 훅 의존값이라 조기 return보다 앞에 계산(detail 로드 전엔 false 취급)
  const designated = detail !== null && detail.sp_designated_at != null;

  // 미지정+ownerOnly일 때만 등록 요청 pending 조회 — 그 외 분기는 요청 버튼 자체가 안 보이므로 생략
  useEffect(() => {
    if (disabledReasonKind !== "ownerOnly" || designated) return;
    let active = true;
    void getPendingSpDesignationRequest(mapId)
      .then((req) => {
        if (active) setSpPending(req);
      })
      .catch(() => {
        // 조회 실패 — 버튼만 노출, 클릭 시 서버가 재검증
      });
    return () => {
      active = false;
    };
  }, [mapId, disabledReasonKind, designated]);

  const handleRequestRegistration = async () => {
    setSpRequestBusy(true);
    setSpRequestError(null);
    try {
      // 발원=자기 맵(from_map_id=mapId) — 카드가 보고 있는 맵 자신의 지정을 오너에게 요청
      const created = await createSpDesignationRequest(mapId, mapId);
      setSpPending(created);
      onToast?.(t("library.requestSent"));
    } catch (err) {
      setSpRequestError(humanizeApiError(err, t));
      if (err instanceof ApiError && err.status === 409) {
        // 이미 대기 중인 요청 — 최신 상태로 갱신해 pending 뷰로 전환
        try {
          setSpPending(await getPendingSpDesignationRequest(mapId));
        } catch {
          // 재조회 실패 — 에러 문구만 유지
        }
      }
    } finally {
      setSpRequestBusy(false);
    }
  };

  if (!detail) return null;

  const publishedVersionId = detail.versions
    .filter((version) => version.status === "published")
    .reduce<number | null>((max, version) => (max === null || version.id > max ? version.id : max), null);

  const openModal = () => {
    setModalInitial({
      department: detail.sp_department ?? "",
      assignee: detail.sp_assignee ?? "",
      assignee_role: detail.sp_assignee_role ?? "",
      system: detail.sp_system ?? "",
      duration: detail.sp_duration ?? "",
      touch_time: detail.sp_touch_time ?? "",
      cost_krw: detail.sp_cost_krw ?? "",
      cost_usd: detail.sp_cost_usd ?? "",
      headcount: detail.sp_headcount ?? "",
      annual_count: detail.sp_annual_count ?? "",
      fte: detail.sp_fte ?? "",
      total_time_fallback: detail.sp_total_time_fallback ?? "",
      touch_time_fallback: detail.sp_touch_time_fallback ?? "",
      system_fallback: detail.sp_system_fallback ?? "",
      frequency_fallback: detail.sp_frequency_fallback ?? "",
      start_condition: detail.sp_start_condition ?? "",
      end_condition: detail.sp_end_condition ?? "",
      url: detail.sp_url ?? "",
      urlLabel: detail.sp_url_label ?? "",
      input: detail.sp_input ?? "",
      input_forms: detail.sp_input_forms ?? "",
      input_ids: detail.sp_input_ids ?? "",
      output: detail.sp_output ?? "",
      output_forms: detail.sp_output_forms ?? "",
      output_ids: detail.sp_output_ids ?? "",
      description: detail.description ?? "",
    });
    setShowModal(true);
  };

  const handleUndesignate = async () => {
    setSaving(true);
    try {
      const updated = await deleteSubprocessDesignation(mapId);
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      onToast?.(t("perm.sp.removed"));
      onDesignationChange?.();
    } catch (err) {
      onToast?.(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
      setShowUndesignate(false);
    }
  };

  // 지정값 — 접힘은 핵심값 요약 한 줄, 펼침은 담당·수행 지표·흐름 세 묶음(사용자 결정 2026-10-22, 시안 D 접힘 + C 펼침).
  // 값 있는 것만 그리고 빈 항목은 맨 아래 "미입력 N" 한 줄로 모은다 — 빈 값 "-" 나열이 채워진 값을 가렸다(2026-10-21).
  const text = (raw: string | null | undefined): string => (raw ?? "").trim();
  const countLines = (raw: string | null | undefined): number =>
    text(raw).split("\n").filter((line) => line.trim() !== "").length;
  const params: Record<ParamField, string | null | undefined> = {
    duration: detail.sp_duration,
    touch_time: detail.sp_touch_time,
    cost_krw: detail.sp_cost_krw,
    cost_usd: detail.sp_cost_usd,
    headcount: detail.sp_headcount,
    annual_count: detail.sp_annual_count,
    fte: detail.sp_fte,
  };
  const costUnit: CostUnit = text(detail.sp_cost_usd) ? "cost_usd" : "cost_krw";
  const department = text(detail.sp_department);
  const assignee = text(detail.sp_assignee);
  const role = text(detail.sp_assignee_role);
  const system = text(formatSystem(detail.sp_system, t("system.other")));
  const url = text(detail.sp_url);
  const urlHref = toSafeHref(url);
  const ioCount = { input: countLines(detail.sp_input), output: countLines(detail.sp_output) };
  const startCondition = text(detail.sp_start_condition);
  const endCondition = text(detail.sp_end_condition);
  const description = text(detail.description);
  // 통화는 배타 계약이라 한 칸 — 라벨은 Subprocess 탭 비용 타일과 같은 "회당 추가비용"
  const paramLabel = (field: ParamField): string =>
    field === costUnit ? t("field.costRun") : t(PARAM_LABEL_KEY[field]);
  const metricFields: ParamField[] = ["duration", "touch_time", costUnit, "headcount", "annual_count", "fte"];
  // 지표 칸은 6칸 고정(빈 값도 자리를 지킨다) — 3열 2행
  const metrics = metricFields.map((field) => ({ field, value: formatParamValue(field, params[field]) }));
  // 지표 칸 숫자 크기 — 가장 긴 값에 맞춰 카드 단위로 17 → 14 → 12px(칸마다 다르면 줄이 들쭉날쭉하다).
  // 360px 인스펙터의 3열 칸 본문은 약 82px — 17px는 8자, 14px는 ₩2,000,000(10자)까지 들어간다(실측 2026-10-22).
  // 더 좁은 폭(최소 300px)에서 넘치는 값은 말줄임 + title
  const longestMetric = Math.max(0, ...metrics.map((metric) => metric.value.length));
  const metricValueSize =
    longestMetric > 10 ? "text-fine font-semibold" : longestMetric > 8 ? "text-caption-strong" : "text-body-strong";
  const notSetTitle = (label: string): string => `${label}: ${t("sp.tile.notSet")}`;

  // 빈 값 자리 — 펼친 카드는 모든 항목을 늘 같은 자리에 두고, 빈 것은 점선·흐린 글자로 비활성처럼 보인다
  // ("미입력 N" 별도 줄 대체, 사용자 결정 2026-10-22). pill = 부서·담당자 필 모양, chip = 역할·시스템·URL·입출력 칩 모양
  const emptyChip = (icon: LucideIcon, label: string, dataId: string, shape: "pill" | "chip" = "chip") => {
    const Icon = icon;
    return (
      <span
        data-id={dataId}
        title={notSetTitle(label)}
        className={`inline-flex items-center gap-1 border border-dashed border-hairline py-0.5 text-fine text-ink-muted ${
          shape === "pill" ? "rounded-full px-2" : "rounded-sm px-1.5"
        }`}
      >
        <Icon size={11} strokeWidth={1.5} className="shrink-0" />
        {label}
      </span>
    );
  };

  // 접힘 요약 — 부서 → 소요 → 비용 → 인원 → 실작업 → 연간 → FTE 순으로 폭이 허락하는 만큼
  const summaryOrder: ParamField[] = ["duration", costUnit, "headcount", "touch_time", "annual_count", "fte"];
  const summaryItems: SummaryItem[] = [
    ...(department !== ""
      ? [{ key: "department", node: <DeptPill department={department} dataId="sp-inspector-sum-department-pill" /> }]
      : []),
    ...summaryOrder.flatMap((field) => {
      const value = formatParamValue(field, params[field]);
      if (value === "") return [];
      const Icon: LucideIcon = PARAM_ICON[field];
      const formatKey = SUMMARY_FORMAT_KEY[field];
      return [
        {
          key: field,
          node: (
            <span title={paramLabel(field)} className="inline-flex items-center gap-1 whitespace-nowrap text-fine text-ink-secondary">
              <Icon size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
              {formatKey ? t(formatKey, { v: value }) : value}
            </span>
          ),
        },
      ];
    }),
  ];

  // 흐름 묶음 단계 — 시작 조건 → 입출력 → 종료 조건, 세 단계 고정(빈 단계는 흐리게)
  const ioChip = (icon: LucideIcon, label: string, n: number, dataId: string) => {
    if (n === 0) return emptyChip(icon, label, `${dataId}-empty`);
    const Icon = icon;
    return (
      <span
        data-id={dataId}
        title={t("sp.tile.items", { n })}
        className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-secondary"
      >
        <Icon size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
        {`${label} ${n}`}
      </span>
    );
  };
  const flowSteps: { key: string; icon: LucideIcon; filled: boolean; label?: string; body: ReactNode }[] = [
    { key: "start", icon: Play, filled: startCondition !== "", label: t("field.startCondition"), body: startCondition },
    {
      key: "io",
      icon: ArrowDown,
      filled: ioCount.input > 0 || ioCount.output > 0,
      body: (
        <span className="flex flex-wrap gap-1.5">
          {ioChip(LogIn, t("sp.input"), ioCount.input, "sp-inspector-io-input")}
          {ioChip(LogOut, t("sp.output"), ioCount.output, "sp-inspector-io-output")}
        </span>
      ),
    },
    { key: "end", icon: Flag, filled: endCondition !== "", label: t("field.endCondition"), body: endCondition },
  ];

  return (
    <section data-id="sp-inspector-card" className="rounded-md border border-hairline bg-surface-alt/50 p-3">
      <button
        type="button"
        data-id="sp-inspector-toggle"
        data-acc-toggle
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={toggleOpen}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`shrink-0 text-ink-tertiary transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          {/* 제목 강조 — 틴트 배지 + 진한 제목(엣지 편집 헤더와 같은 문법, 사용자 결정 2026-10-21) */}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
            <Workflow size={14} strokeWidth={1.5} />
          </span>
          <span className="truncate text-caption-strong text-ink">{t("inspector.spTitle")}</span>
          {/* 연결 절차 안내 — 호버 툴팁(제목 옆) */}
          <span onClick={(e) => e.stopPropagation()}>
            {/* 안내 툴팁 — 문장 대신 아이콘+키워드 행, 보완 설명은 회색 보조 텍스트 (사용자 결정 2026-08-20) */}
            <Tooltip
              content={
                <span className="flex flex-col gap-1.5 py-0.5">
                  <span className="flex items-center gap-1.5">
                    <Network size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                    <span className="text-caption-strong text-ink">{t("inspector.spNoteKwLibrary")}</span>
                    <span className="text-fine text-ink-tertiary">{t("inspector.spNoteKwLibrarySub")}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Boxes size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                    <span className="text-caption-strong text-ink">{t("inspector.spNoteKwEmbed")}</span>
                    <span className="text-fine text-ink-tertiary">{t("inspector.spNoteKwEmbedSub")}</span>
                  </span>
                  <span className="border-t border-divider pt-1 text-fine text-ink-tertiary">
                    {t("inspector.spNoteHint")}
                  </span>
                </span>
              }
            >
              <Info
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-ink-tertiary transition-colors hover:text-accent"
              />
            </Tooltip>
          </span>
        </span>
        {/* 지정 상태 뱃지 — 영어 고정(승인상태 뱃지 규칙과 동일). 접힘 상태에서도 항상 보임(헤더는 항상 렌더) */}
        {designated ? (
          <span className="shrink-0 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
            Designated
          </span>
        ) : (
          <span className="shrink-0 rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary">
            Not designated
          </span>
        )}
      </button>

      {/* 접힘 요약 — 카드는 기본 접힘이라 머리 아래 한 줄로 핵심값을 보인다. 왼쪽 18px = 화살표 12 + 간격 6(배지 시작선) */}
      {!open && designated && summaryItems.length > 0 && (
        <div className="mt-2 pl-[18px]">
          <SpSummaryLine items={summaryItems} onExpand={toggleOpen} />
        </div>
      )}

      {open && (
        <>
          {designated && (
            <div data-id="sp-inspector-attrs" className="flex flex-col">
              <GroupHead dataId="sp-inspector-group-owner" label={t("inspector.spGroupOwner")} />
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {department !== "" ? (
                  <DeptPill department={department} dataId="sp-inspector-department-pill" />
                ) : (
                  emptyChip(Building2, t("field.department"), "sp-inspector-department-empty", "pill")
                )}
                {role !== "" ? (
                  <RoleChip role={role} dataId="sp-inspector-role-chip" />
                ) : (
                  emptyChip(BriefcaseBusiness, t("field.assigneeRole"), "sp-inspector-role-empty")
                )}
                {assignee !== "" ? (
                  <AssigneePills assignee={assignee} dataIdPrefix="sp-inspector" />
                ) : (
                  emptyChip(User, t("field.assignee"), "sp-inspector-assignee-empty", "pill")
                )}
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-fine text-ink-secondary">
                {system !== "" ? (
                  <span data-id="sp-inspector-system" title={t("field.system")} className="inline-flex min-w-0 items-center gap-1">
                    <Monitor size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                    <span className="min-w-0 truncate">{system}</span>
                  </span>
                ) : (
                  emptyChip(Monitor, t("field.system"), "sp-inspector-system-empty")
                )}
                {url !== "" ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <LinkIcon size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                    {/* 링크 필 — AttributeReadRows와 같은 모양(새 탭, 라벨 우선). 위험한 스킴(javascript: 등)은 글자만 */}
                    {urlHref === null ? (
                      <span data-id="sp-inspector-url-text" title={url} className="min-w-0 truncate">
                        {text(detail.sp_url_label) || url}
                      </span>
                    ) : (
                      <a
                        href={urlHref}
                        target="_blank"
                        rel="noreferrer"
                        data-id="sp-inspector-url-pill"
                        title={url}
                        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink transition-colors hover:border-accent hover:text-accent"
                      >
                        <span className="min-w-0 truncate">{text(detail.sp_url_label) || url}</span>
                      </a>
                    )}
                  </span>
                ) : (
                  emptyChip(LinkIcon, t("field.url"), "sp-inspector-url-empty")
                )}
              </div>

              <GroupHead dataId="sp-inspector-group-metrics" label={t("inspector.parameters")} />
              {/* 3열 칸 — 칸 사이 1px 간격에 바탕(hairline)이 비쳐 구분선이 된다. 빈 칸은 회색 바탕·흐린 글자로 자리만 지킨다 */}
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline">
                {metrics.map(({ field, value }) => {
                  const Icon = PARAM_ICON[field];
                  const filled = value !== "";
                  return (
                    <div
                      key={field}
                      data-id={`sp-inspector-metric-${field}`}
                      data-filled={filled}
                      title={filled ? `${paramLabel(field)}: ${value}` : notSetTitle(paramLabel(field))}
                      className={`min-w-0 p-2 ${filled ? "bg-surface" : "bg-surface-alt"}`}
                    >
                      <span className={`flex min-w-0 items-center gap-1 text-fine ${filled ? "text-ink-tertiary" : "text-ink-muted"}`}>
                        <Icon size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                        <span className="min-w-0 truncate">{t(METRIC_LABEL_KEY[field])}</span>
                      </span>
                      <span className={`mt-1 block truncate ${metricValueSize} ${filled ? "text-ink" : "text-ink-muted"}`}>
                        {filled ? value : "–"}
                      </span>
                    </div>
                  );
                })}
              </div>

              <GroupHead dataId="sp-inspector-group-flow" label={t("inspector.spGroupFlow")} />
              <div className="relative flex flex-col gap-2.5 pl-[26px]">
                {/* 세로 레일 — 단계 점(19px) 가운데를 잇는다 */}
                <span aria-hidden className="absolute bottom-3 left-[9px] top-3 w-px bg-accent-tint-border" />
                {flowSteps.map(({ key, icon: StepIcon, filled, label, body }) => (
                  <div key={key} data-id={`sp-inspector-flow-${key}`} data-filled={filled} className="relative min-w-0">
                    <span
                      className={`absolute -left-[26px] top-0 flex h-[19px] w-[19px] items-center justify-center rounded-full border bg-surface ${
                        filled ? "border-accent-tint-border text-accent" : "border-hairline text-ink-muted"
                      }`}
                    >
                      <StepIcon size={10} strokeWidth={1.5} />
                    </span>
                    {label ? (
                      <div title={filled ? undefined : notSetTitle(label)}>
                        <p className={`text-fine ${filled ? "text-ink-tertiary" : "text-ink-muted"}`}>{label}</p>
                        <p className={`mt-0.5 break-words text-caption ${filled ? "text-ink" : "text-ink-muted"}`}>
                          {filled ? body : "–"}
                        </p>
                      </div>
                    ) : (
                      body
                    )}
                  </div>
                ))}
              </div>

              <p
                data-id="sp-inspector-description"
                data-filled={description !== ""}
                title={description !== "" ? description : notSetTitle(t("field.description"))}
                className={`mt-3 line-clamp-2 whitespace-pre-line border-l-2 border-divider pl-2 text-caption ${
                  description !== "" ? "text-ink-secondary" : "text-ink-muted"
                }`}
              >
                {description !== "" ? description : t("field.description")}
              </p>
            </div>
          )}

          {/* 액션 행 — 좌측 지정/수정+해제, 우측(ml-auto) 사유별 액션(R10에서 이동, R6 W4). 버튼이 항상 있어 행 자체가 앵커.
              라벨은 한 줄 고정(nowrap) — 폭이 모자라면 마지막 버튼이 다음 줄로 내려간다(flex-wrap, 사용자 요청 2026-09-03). */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {designated ? (
              <>
                <button
                  type="button"
                  data-id="sp-inspector-edit"
                  className="whitespace-nowrap rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
                  onClick={openModal}
                  disabled={!canManage || saving}
                >
                  {t("perm.sp.edit")}
                </button>
                <button
                  type="button"
                  data-id="sp-inspector-remove"
                  className="whitespace-nowrap rounded-sm border border-error/40 px-2.5 py-1 text-fine text-error hover:bg-error/10 disabled:opacity-40"
                  onClick={() => setShowUndesignate(true)}
                  disabled={!canManage || saving}
                >
                  {t("perm.sp.undesignate")}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-id="sp-inspector-designate"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
                onClick={openModal}
                disabled={!canManage || saving}
              >
                <Workflow size={14} strokeWidth={1.5} />
                {t("perm.sp.designate")}
              </button>
            )}

            {!canManage && disabledReason && (
              <>
                {disabledReasonKind === "needPublished" && publishedVersionId !== null && onGoToPublished && (
                  <button
                    type="button"
                    data-id="sp-go-published"
                    className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt"
                    onClick={() => onGoToPublished(publishedVersionId)}
                  >
                    <ArrowRight size={14} strokeWidth={1.5} />
                    {t("inbox.sp.goPublished")}
                  </button>
                )}

                {disabledReasonKind === "ownerOnly" &&
                  !designated &&
                  (spPending ? (
                    <Tooltip
                      content={`${spPending.requested_by} · ${formatKstShort(spPending.created_at)}`}
                      className="ml-auto"
                    >
                      <span className="inline-flex">
                        <button
                          type="button"
                          data-id="sp-request-registration"
                          className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-40"
                          disabled
                        >
                          <BadgeCheck size={14} strokeWidth={1.5} />
                          {t("sp.request.pendingLabel")}
                        </button>
                      </span>
                    </Tooltip>
                  ) : (
                    <button
                      type="button"
                      data-id="sp-request-registration"
                      className="ml-auto inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-40"
                      onClick={() => void handleRequestRegistration()}
                      disabled={spRequestBusy}
                    >
                      <BadgeCheck size={14} strokeWidth={1.5} />
                      {t("sp.request.ctaSelf")}
                    </button>
                  ))}
              </>
            )}
          </div>

          {/* 비활성 사유 — 순수 노트(버튼은 위 액션 행으로 이동, R6 W4) */}
          {!canManage && disabledReason && (
            <p data-id="sp-inspector-reason" className="mt-1.5 text-fine text-ink-tertiary">
              {disabledReason}
            </p>
          )}
          {spRequestError && (
            <p data-id="sp-request-error" className="mt-1 text-fine text-error">
              {spRequestError}
            </p>
          )}

          {/* Linked from — 역참조 목록(Subprocess 탭과 동일 행 디자인). 지정된 맵에서만. */}
          {designated && usage?.designated && (
            <div className="mt-2 border-t border-divider pt-2">
              <button
                type="button"
                data-id="sp-linked-from-toggle"
                data-acc-toggle
                aria-expanded={linkedOpen}
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setLinkedOpen((v) => !v)}
              >
                <span className="flex items-center gap-1.5 text-fine font-semibold text-ink-tertiary">
                  <ChevronRight
                    size={12}
                    strokeWidth={1.5}
                    className={`shrink-0 transition-transform duration-150 ${linkedOpen ? "rotate-90" : ""}`}
                  />
                  {t("inspector.spUsageLinkedFrom")}
                </span>
                <span className="shrink-0 text-fine text-ink-tertiary">{usage.used_by.length}</span>
              </button>
              {linkedOpen && (
                <div className="mt-1.5">
                  {usage.used_by.length === 0 ? (
                    <p className="rounded-sm border border-hairline bg-surface px-2.5 py-2 text-fine text-ink-tertiary">
                      {t("inspector.spUsageEmpty")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {usage.used_by.map((entry) => (
                        <li key={entry.map_id}>
                          <Link
                            href={`/maps/${entry.map_id}`}
                            data-id="sp-card-linked-row"
                            className="group flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2.5 py-1.5 transition-colors hover:bg-surface-alt"
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
                    <p className="mt-1.5 text-fine text-ink-tertiary">
                      {t("inspector.spUsageHidden", { n: usage.hidden_count })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showModal && (
        <SubprocessDesignationModal
          mapId={mapId}
          designated={designated}
          publishedVersionId={publishedVersionId}
          initial={modalInitial}
          onSaved={(updated) => {
            setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
            onToast?.(t("perm.sp.saved"));
            onDesignationChange?.();
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {showUndesignate && (
        <ConfirmDialog
          title={t("perm.sp.undesignateTitle")}
          message={t("perm.sp.undesignateWarn")}
          confirmLabel={t("perm.sp.undesignate")}
          cancelLabel={t("perm.sp.cancel")}
          danger
          icon={<Workflow size={28} strokeWidth={1.5} />}
          onConfirm={() => void handleUndesignate()}
          onClose={() => setShowUndesignate(false)}
        />
      )}
    </section>
  );
}
