"use client";

// 인스펙터 Subprocess 탭 — 지정 메타(버전·시점·행위자) + 이 맵을 링크한 부모 맵 목록(역참조)
// + 지정 파라미터(읽기 타일 1열 — 지정 모달과 같은 타일, 오너·관리자는 헤더 '수정'으로 모달 열기,
// 사용자 결정 2026-09-03). 빈 값도 "미입력" 타일로 남겨 누락을 드러내고, 대표값 없이 원문 메모만 있으면
// 메모를 임시값 스타일로 보여준다. 게시본이 아닌 버전을 열었으면 워터마크 + 게시본으로 이동 버튼(수정 자리).
// 탭 자체는 지정된 맵에서만 노출 — page.tsx가 designated일 때만 슬롯을 주입한다.

import {
  ArrowUpRight, BadgeCheck, Info, Link as LinkIcon, LogIn, LogOut, Monitor, Pencil, Workflow, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { CurrencyPill, type CostUnit } from "@/components/cost-unit";
import { FallbackHint } from "@/components/fallback-hint";
import { MultiValueInput } from "@/components/multi-value-input";
import { PARAM_ICON } from "@/components/param-icons";
import { DeptAssigneeTiles } from "@/components/permissions/attribute-tiles";
import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import { SubprocessDesignationModal, type DesignationForm } from "@/components/permissions/subprocess-designation-modal";
import { buildPopoverActionLabels } from "@/components/popover-action-bar";
import { Tooltip } from "@/components/tooltip";
import { UserPill } from "@/components/user-pill";
import { getMap, type MapDetail, type MapSummary, type SubprocessUsage } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { formatThousands } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";
import { formatParamValue, PARAM_LABEL_KEY } from "@/lib/params";

interface SubprocessUsageTabProps {
  usage: SubprocessUsage;
  mapId: number;
  // 지정 수정 게이트 — 게시본 열림 && (오너 || sysadmin). 없으면 읽기만
  canManage?: boolean;
  // 지금 열려 있는 버전 — 게시본이 아니면 파라미터 위에 워터마크 + '게시본으로 이동'(수정 버튼 자리)
  currentVersionId?: number | null;
  onGoPublished?: (versionId: number) => void;
  onDesignationChange?: () => void;
}

const countLines = (joined: string): number => joined.split("\n").filter((line) => line.trim() !== "").length;

// 맵 상세 → 지정 모달 초기 폼 (SP 카드 openModal과 동일 매핑)
function toDesignationForm(detail: MapSummary): DesignationForm {
  return {
    department: detail.sp_department ?? "",
    assignee: detail.sp_assignee ?? "",
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
    url: detail.sp_url ?? "",
    urlLabel: detail.sp_url_label ?? "",
    input: detail.sp_input ?? "",
    input_forms: detail.sp_input_forms ?? "",
    input_ids: detail.sp_input_ids ?? "",
    output: detail.sp_output ?? "",
    output_forms: detail.sp_output_forms ?? "",
    output_ids: detail.sp_output_ids ?? "",
    description: detail.description ?? "",
  };
}

export function SubprocessUsageTab({
  usage, mapId, canManage = false, currentVersionId, onGoPublished, onDesignationChange,
}: SubprocessUsageTabProps) {
  const { t } = useI18n();
  const labels = buildPopoverActionLabels(t);
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [showModal, setShowModal] = useState(false);
  // 입출력 열람 팝오버 — 목록을 열어야만 보이는 항목이라 읽기 타일도 클릭 가능
  const [viewIo, setViewIo] = useState<{ field: "input" | "output"; at: { x: number; y: number } } | null>(null);

  // 지정 값은 맵 상세에 있다 — usage(지정 변경 시 재조회되는 객체)가 바뀔 때마다 함께 갱신
  useEffect(() => {
    let alive = true;
    void getMap(mapId)
      .then((result) => {
        if (alive) setDetail(result);
      })
      .catch(() => {
        // 조회 실패 시 지정 파라미터 섹션만 비표시
      });
    return () => {
      alive = false;
    };
  }, [mapId, usage]);

  const versionText =
    usage.designated_version_number != null
      ? `v${usage.designated_version_number}${usage.designated_version_label ? ` · ${usage.designated_version_label}` : ""}`
      : (usage.designated_version_label ?? "-");

  const form = detail ? toDesignationForm(detail) : null;
  const publishedVersionId =
    detail?.versions
      .filter((version) => version.status === "published")
      .reduce<number | null>((max, version) => (max === null || version.id > max ? version.id : max), null) ?? null;
  const costUnit: CostUnit = form?.cost_usd ? "cost_usd" : "cost_krw";
  const costValue = form ? formatThousands(form[costUnit]) : "";
  const ioCount = (field: "input" | "output") => (form ? countLines(form[field]) : 0);
  // 게시본을 열고 있는지 — 아니면 지정값 위에 워터마크(지정은 게시본 기준 값). 호출부가 버전을 안 주면 판정 생략
  const publishedOpen =
    currentVersionId == null ? true : publishedVersionId !== null && currentVersionId === publishedVersionId;
  const notSet = t("sp.tile.notSet");
  // 원문 메모가 있는 파라미터 — 행 호버 시 아이콘이 메모 아이콘으로 바뀌는 FallbackHint(읽기), 없으면 기본 아이콘.
  // 대표값이 없고 메모만 있으면 아이콘 톤도 임시값(tertiary)
  const noteIcon = (field: string, icon: LucideIcon, note: string, hasValue: boolean) =>
    note.trim() !== "" ? (
      <FallbackHint
        fallback={note}
        dataId={`sp-usage-note-${field}`}
        restIcon={icon}
        iconSize={16}
        padded={false}
        restClassName={hasValue ? "text-accent" : "text-ink-tertiary"}
      />
    ) : undefined;
  // 대표값 우선, 없으면 원문 메모를 임시값으로 — 둘 다 없으면 빈 값(placeholder가 "미입력"을 그린다)
  const valueOrNote = (value: string, note: string): { value: string; tone: "default" | "fallback" } =>
    value.trim() !== ""
      ? { value, tone: "default" }
      : note.trim() !== ""
        ? { value: note.trim(), tone: "fallback" }
        : { value: "", tone: "default" };
  const noteOnlyPill = (
    <span className="shrink-0 rounded-xs bg-surface-alt px-1 py-0 text-fine not-italic text-ink-tertiary">
      {t("sp.tile.noteOnly")}
    </span>
  );

  return (
    <div data-id="sp-usage-tab" className="flex flex-col gap-4">
      {/* 지정 메타 — 버전·시점·행위자 (SP 카드와 동일 박스 스타일) */}
      <section className="rounded-md border border-hairline bg-surface-alt/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-fine font-semibold text-ink-tertiary">
            <Workflow size={14} strokeWidth={1.5} className="text-accent" />
            {t("inspector.spUsageMetaTitle")}
            {/* 임베드는 항상 최신 게시본을 따른다는 안내 — 호버 툴팁(제목 옆) */}
            <Tooltip content={t("inspector.spUsageFollowsLatest")}>
              <Info size={14} strokeWidth={1.5} className="text-ink-tertiary" />
            </Tooltip>
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
              {usage.designated_at ? formatKst(usage.designated_at) : "-"}
            </span>
          </MetaRow>
          <MetaRow label={t("inspector.spUsageBy")}>
            {usage.changed_by ? (
              <UserPill loginId={usage.changed_by} />
            ) : (
              <span className="text-fine text-ink-tertiary">-</span>
            )}
          </MetaRow>
          {usage.changed_at && usage.changed_at !== usage.designated_at && (
            <MetaRow label={t("inspector.spUsageUpdatedAt")}>
              <span className="text-fine text-ink">{formatKst(usage.changed_at)}</span>
            </MetaRow>
          )}
        </div>
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

      {/* 지정 파라미터 — 지정 모달과 같은 타일(정적, 1열). 빈 값도 "미입력"으로 남기고, 대표값 없이 원문 메모만
          있으면 메모를 임시값 스타일(점선·기울임)로 보여준다. 입출력은 클릭해 목록 열람 (사용자 요청 2026-09-03) */}
      {form && (
        <section data-id="sp-usage-params">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-fine font-semibold text-ink">{t("inspector.spUsageParamsTitle")}</span>
            {publishedOpen ? (
              canManage && publishedVersionId !== null && (
                <button
                  type="button"
                  data-id="sp-usage-edit"
                  className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt hover:text-ink"
                  onClick={() => setShowModal(true)}
                >
                  <Pencil size={12} strokeWidth={1.5} />
                  {t("inspector.spUsageEdit")}
                </button>
              )
            ) : (
              // 게시본이 아닌 버전 — 지정값은 게시본 기준이라 수정 대신 게시본으로 이동(액센트 테두리)
              publishedVersionId !== null &&
              onGoPublished && (
                <button
                  type="button"
                  data-id="sp-usage-go-published"
                  className="inline-flex items-center gap-1 rounded-sm border border-accent px-2 py-0.5 text-fine text-accent hover:bg-accent-tint"
                  onClick={() => onGoPublished(publishedVersionId)}
                >
                  <BadgeCheck size={12} strokeWidth={1.5} />
                  {t("inspector.spUsageGoPublished")}
                </button>
              )
            )}
          </div>
          <div className="relative">
            {!publishedOpen && (
              // 워터마크 — 캔버스 스탬프와 같은 모티프(기울임·보더·저불투명), 타일 위에 겹쳐 클릭은 통과
              <div
                data-id="sp-usage-not-published"
                className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden"
              >
                <span className="-rotate-[14deg] select-none whitespace-nowrap rounded-md border-[3px] border-ink-tertiary px-4 py-1 text-[20px] font-semibold tracking-widest text-ink-tertiary opacity-[0.18]">
                  {publishedVersionId === null ? t("inspector.spUsageNoPublished") : t("inspector.spUsageNotPublished")}
                </span>
              </div>
            )}
            <div className={`flex flex-col gap-1.5 ${publishedOpen ? "" : "opacity-80"}`} data-id="sp-usage-param-tiles">
              {/* 좁은 인스펙터 — 1열 행 타일. 원문 메모가 있는 파라미터는 행 호버 시 아이콘이 메모 아이콘으로
                  바뀌고(메모 점 표시) 클릭하면 원문 팝오버(읽기) (사용자 결정 2026-09-03) */}
              <DeptAssigneeTiles
                versionId={null}
                department={form.department}
                assignee={form.assignee}
                readOnly
                placeholder={notSet}
                dataIdPrefix="sp-usage-tile"
                labels={labels}
                onChange={() => {}}
              />
              {(() => {
                const system = valueOrNote(form.system, form.system_fallback);
                return (
                  <SpFieldTile
                    dataId="sp-usage-tile-system"
                    icon={Monitor}
                    iconSlot={noteIcon("system", Monitor, form.system_fallback, form.system.trim() !== "")}
                    label={t("field.system")}
                    value={system.value}
                    valueTone={system.tone}
                    valueNode={system.tone === "fallback" ? noteOnlyPill : undefined}
                    placeholder={notSet}
                    wide
                    readOnly
                  />
                );
              })()}
              <SpFieldTile
                dataId="sp-usage-tile-url"
                icon={LinkIcon}
                label={t("field.url")}
                value={form.url.trim() ? form.urlLabel.trim() || form.url.trim() : ""}
                placeholder={notSet}
                wide
                readOnly
              />
              {(["duration", "touch_time"] as const).map((field) => {
                const note = field === "duration" ? form.total_time_fallback : form.touch_time_fallback;
                const shown = valueOrNote(form[field] !== "" ? formatParamValue(field, form[field]) : "", note);
                return (
                  <SpFieldTile
                    key={field}
                    dataId={`sp-usage-tile-${field}`}
                    icon={PARAM_ICON[field]}
                    iconSlot={noteIcon(field, PARAM_ICON[field], note, form[field] !== "")}
                    label={t(PARAM_LABEL_KEY[field])}
                    value={shown.value}
                    valueTone={shown.tone}
                    valueNode={shown.tone === "fallback" ? noteOnlyPill : undefined}
                    placeholder={notSet}
                    wide
                    readOnly
                  />
                );
              })}
              <SpFieldTile
                dataId="sp-usage-tile-cost"
                icon={PARAM_ICON[costUnit]}
                label={t("field.costRun")}
                value={costValue}
                valueNode={costValue !== "" ? <CurrencyPill unit={costUnit} /> : undefined}
                placeholder={notSet}
                wide
                readOnly
              />
              {(["headcount", "annual_count", "fte"] as const).map((field) => {
                const note = field === "annual_count" ? form.frequency_fallback : "";
                const shown = valueOrNote(form[field], note);
                return (
                  <SpFieldTile
                    key={field}
                    dataId={`sp-usage-tile-${field}`}
                    icon={PARAM_ICON[field]}
                    iconSlot={field === "annual_count" ? noteIcon(field, PARAM_ICON[field], note, form[field] !== "") : undefined}
                    label={t(PARAM_LABEL_KEY[field])}
                    value={shown.value}
                    valueTone={shown.tone}
                    valueNode={shown.tone === "fallback" ? noteOnlyPill : undefined}
                    placeholder={notSet}
                    wide
                    readOnly
                  />
                );
              })}
              {(["input", "output"] as const).map((field) =>
                ioCount(field) > 0 ? (
                  <SpFieldTile
                    key={field}
                    dataId={`sp-usage-tile-${field}`}
                    icon={field === "input" ? LogIn : LogOut}
                    label={field === "input" ? t("sp.input") : t("sp.output")}
                    value={t("sp.tile.items", { n: ioCount(field) })}
                    wide
                    active={viewIo?.field === field}
                    onOpen={(at) => setViewIo({ field, at })}
                  />
                ) : (
                  <SpFieldTile
                    key={field}
                    dataId={`sp-usage-tile-${field}`}
                    icon={field === "input" ? LogIn : LogOut}
                    label={field === "input" ? t("sp.input") : t("sp.output")}
                    value=""
                    placeholder={notSet}
                    wide
                    readOnly
                  />
                ),
              )}
            </div>
          </div>
        </section>
      )}

      {viewIo && form && (
        <SpFieldPopover
          dataId={`sp-usage-popover-${viewIo.field}`}
          anchor={viewIo.at}
          title={viewIo.field === "input" ? t("sp.input") : t("sp.output")}
          hint={t("sp.tile.readOnlyHint")}
          width={420}
          dirty={false}
          readOnly
          closeLabel={t("summary.close")}
          onApply={() => {}}
          onCommit={() => setViewIo(null)}
          onCancel={() => setViewIo(null)}
          labels={labels}
        >
          <MultiValueInput
            dataId={`sp-usage-io-${viewIo.field}`}
            label={viewIo.field === "input" ? t("sp.input") : t("sp.output")}
            headless
            value={form[viewIo.field]}
            formsValue={viewIo.field === "input" ? form.input_forms : form.output_forms}
            readOnly
            onCommit={() => {}}
          />
        </SpFieldPopover>
      )}

      {showModal && form && detail && (
        <SubprocessDesignationModal
          mapId={mapId}
          publishedVersionId={publishedVersionId}
          designated
          initial={form}
          onSaved={() => {
            // 저장본은 usage 재조회 → 상세 재조회 경로로 돌아온다(응답은 versions 없는 요약이라 직접 못 넣음)
            setShowModal(false);
            onDesignationChange?.();
          }}
          onClose={() => setShowModal(false)}
        />
      )}
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
