"use client";

// 서브프로세스 패널 — 오너 전용 단일 표면(2026-10-01, 종전 "조건 · GMP" 카드 흡수). 타일 그리드는 지정 여부와
// 무관하게 항상 보이고, 인터뷰 승격 필드(GMP·시작/종료 조건·소요/실작업시간·시스템)는 타일 클릭 팝오버로
// 바로 편집(PATCH /maps/{id}/process-fields, design 2026-08-19 §5) + 원문 메모(FallbackHint) 아이콘 슬롯.
// 나머지(부서·역할·담당자·비용·인원·IO·URL)는 지정/수정 모달(부서 필수, 게시본 필요) 경로. 해제는 확인 모달
// (사용처 경고·잠금 안내, spec 2026-07-06). 푸터에 최근 변경자(PersonHoverCard)·시각.

import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  BriefcaseBusiness,
  Building2,
  Check,
  Clock,
  FileText,
  Link2,
  Monitor,
  Pencil,
  Repeat,
  ShieldCheck,
  Timer,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import {
  deleteSubprocessDesignation,
  getDirectory,
  getMap,
  patchProcessFields,
  type MapDetail,
  type ProcessFieldsBody,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeptPill } from "@/components/dept-pill";
import { FallbackHint } from "@/components/fallback-hint";
import { ParamInput } from "@/components/param-input";
import { PersonHoverCard } from "@/components/person-hover-card";
import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import {
  SubprocessDesignationModal,
  type DesignationForm,
} from "@/components/permissions/subprocess-designation-modal";
import { buildPopoverActionLabels } from "@/components/popover-action-bar";
import { formatKst } from "@/lib/datetime";
import { formatDurationHm, formatThousands } from "@/lib/duration";
import { formatGmp, getGmpBadgeStyle, GMP_OPTIONS } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";
import { formatVersionMarker } from "@/lib/version-name";

interface SubprocessDesignationPanelProps {
  mapId: string;
  onToast: (message: string, tone?: "error") => void;
}

// 타일에서 바로 편집하는 승격 필드 — PATCH /process-fields 키와 1:1
type EditableKey = "gmp" | "start_condition" | "end_condition" | "duration" | "touch_time" | "system";

const INPUT_CLASS =
  "w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink focus:border-accent focus:outline-none";

export function SubprocessDesignationPanel({ mapId, onToast }: SubprocessDesignationPanelProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  // login_id → 표시명 — 최근 변경자 이름 우선 표기(디렉터리 해석, 실패 시 id)
  const [names, setNames] = useState<Record<string, string>>({});
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
  const [error, setError] = useState<string | null>(null);
  // 타일 편집 팝오버 — 로컬 초안, 확정 시에만 PATCH. Esc면 폐기
  const [editing, setEditing] = useState<{ key: EditableKey; at: { x: number; y: number }; draft: string } | null>(null);

  useEffect(() => {
    let active = true;
    void getMap(Number(mapId))
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((err) => {
        if (active) setError(humanizeApiError(err, t));
      });
    void getDirectory()
      .then((dir) => {
        if (active) {
          setNames(Object.fromEntries(dir.users.map((u) => [u.id, u.name])));
        }
      })
      .catch(() => {
        // 디렉터리 실패 시 login_id 그대로 표시 — 표시용이라 치명적이지 않음
      });
    return () => {
      active = false;
    };
  }, [mapId, t]);

  if (!detail) {
    return error ? (
      <p className="text-caption text-error">{error}</p>
    ) : (
      <p className="text-caption text-ink-tertiary">…</p>
    );
  }

  const designated = detail.sp_designated_at != null;
  // 게시 버전(최대 id) — 지정 가드 + BPM 피커의 후보 스코프
  const publishedVersionId = detail.versions
    .filter((v) => v.status === "published")
    .reduce<number | null>((max, v) => (max === null || v.id > max ? v.id : max), null);
  const hasPublished = publishedVersionId !== null;

  const changedBy = detail.sp_changed_by;
  const changedByName = changedBy ? (names[changedBy] ?? changedBy) : null;

  function openModal() {
    // 재지정/수정 프리필 — 해제돼도 서버가 어트리뷰트를 유지
    setModalInitial({
      department: detail?.sp_department ?? "",
      assignee: detail?.sp_assignee ?? "",
      assignee_role: detail?.sp_assignee_role ?? "",
      system: detail?.sp_system ?? "",
      duration: detail?.sp_duration ?? "",
      touch_time: detail?.sp_touch_time ?? "",
      cost_krw: detail?.sp_cost_krw ?? "",
      cost_usd: detail?.sp_cost_usd ?? "",
      headcount: detail?.sp_headcount ?? "",
      annual_count: detail?.sp_annual_count ?? "",
      fte: detail?.sp_fte ?? "",
      total_time_fallback: detail?.sp_total_time_fallback ?? "",
      touch_time_fallback: detail?.sp_touch_time_fallback ?? "",
      system_fallback: detail?.sp_system_fallback ?? "",
      frequency_fallback: detail?.sp_frequency_fallback ?? "",
      start_condition: detail?.sp_start_condition ?? "",
      end_condition: detail?.sp_end_condition ?? "",
      url: detail?.sp_url ?? "",
      urlLabel: detail?.sp_url_label ?? "",
      input: detail?.sp_input ?? "",
      input_forms: detail?.sp_input_forms ?? "",
      input_ids: detail?.sp_input_ids ?? "",
      output: detail?.sp_output ?? "",
      output_forms: detail?.sp_output_forms ?? "",
      output_ids: detail?.sp_output_ids ?? "",
      description: detail?.description ?? "",
    });
    setError(null);
    setShowModal(true);
  }

  async function handleUndesignate() {
    setSaving(true);
    try {
      const updated = await deleteSubprocessDesignation(Number(mapId));
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      onToast(t("perm.sp.removed"));
    } catch (err) {
      onToast(humanizeApiError(err, t), "error");
    } finally {
      setSaving(false);
      setShowUndesignate(false);
    }
  }

  // 승격 필드 저장 — 언급한 키만 PATCH, 응답(MapSummary)을 상세에 병합
  async function saveFields(patch: ProcessFieldsBody) {
    try {
      const updated = await patchProcessFields(Number(mapId), patch);
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      onToast(t("perm.processFields.saved"));
    } catch (err) {
      onToast(humanizeApiError(err, t), "error");
    }
  }

  // 캔버스 노드 칩과 동일 표시형(₩/$ + 천단위 콤마) — process-node.tsx 컨벤션과 정합
  const formatCost = (raw: string | null | undefined, symbol: string): string => {
    const n = formatThousands(raw ?? "");
    return n ? `${symbol}${n}` : "";
  };
  const publishedVersion = detail.versions.find((v) => v.id === publishedVersionId) ?? null;
  const empty = t("perm.sp.empty");
  const labels = buildPopoverActionLabels(t);
  const str = (v: string | null | undefined) => v ?? "";

  // 원문 메모 아이콘 슬롯 — 타일 아이콘 자리에서 호버 시 노트 아이콘으로 스왑, 클릭하면 원문 열람·수정
  const noteIcon = (key: string, icon: LucideIcon, note: string, hasValue: boolean, save: (text: string) => void) => (
    <FallbackHint
      fallback={note}
      dataId={`sp-note-${key}`}
      restIcon={icon}
      iconSize={16}
      padded={false}
      restClassName={hasValue ? "text-accent" : "text-ink-tertiary"}
      onSaveFallback={save}
    />
  );

  // 현재 값(편집 키 기준) — 팝오버 초안의 기준값
  const currentOf = (key: EditableKey): string =>
    key === "gmp"
      ? str(detail.sp_gmp)
      : key === "start_condition"
        ? str(detail.sp_start_condition)
        : key === "end_condition"
          ? str(detail.sp_end_condition)
          : key === "duration"
            ? str(detail.sp_duration)
            : key === "touch_time"
              ? str(detail.sp_touch_time)
              : str(detail.sp_system);
  const openEdit = (key: EditableKey) => (at: { x: number; y: number }) => setEditing({ key, at, draft: currentOf(key) });

  // 타일 명세 — 짧은 값 1칸, 문장·목록은 2칸(wide). 비어도 타일을 남겨 어떤 항목이 빠졌는지 보인다
  interface Tile {
    key: string;
    icon: LucideIcon;
    label: string;
    value: string;
    wide?: boolean;
    valueSize?: "caption" | "fine";
    edit?: EditableKey;
    iconSlot?: React.ReactNode;
  }
  const costValue = formatCost(detail.sp_cost_krw, "₩") || formatCost(detail.sp_cost_usd, "$");
  const tiles: Tile[] = [
    { key: "role", icon: BriefcaseBusiness, label: t("field.assigneeRole"), value: str(detail.sp_assignee_role) },
    { key: "assignee", icon: User, label: t("field.assignee"), value: str(detail.sp_assignee) },
    {
      key: "system", icon: Monitor, label: t("field.system"), value: str(detail.sp_system), edit: "system",
      iconSlot: noteIcon("system", Monitor, str(detail.sp_system_fallback), str(detail.sp_system) !== "", (text) => void saveFields({ system_fallback: text })),
    },
    {
      key: "duration", icon: Clock, label: t("field.duration"), value: formatDurationHm(str(detail.sp_duration)), edit: "duration",
      iconSlot: noteIcon("duration", Clock, str(detail.sp_total_time_fallback), str(detail.sp_duration) !== "", (text) => void saveFields({ total_time_fallback: text })),
    },
    {
      key: "touch", icon: Timer, label: t("field.touchTime"), value: formatDurationHm(str(detail.sp_touch_time)), edit: "touch_time",
      iconSlot: noteIcon("touch", Timer, str(detail.sp_touch_time_fallback), str(detail.sp_touch_time) !== "", (text) => void saveFields({ touch_time_fallback: text })),
    },
    { key: "cost", icon: Banknote, label: t("field.costKrw"), value: costValue },
    { key: "headcount", icon: Users, label: t("field.headcount"), value: str(detail.sp_headcount) },
    {
      // 연간 건수 대표값은 이 맵을 참조하는 SP 노드 행에서 입력 — 여기선 원문 메모만 (design 2026-08-19 §1.2)
      key: "annual", icon: Repeat, label: t("field.annualCount"), value: str(detail.sp_annual_count),
      iconSlot: noteIcon("annual", Repeat, str(detail.sp_frequency_fallback), str(detail.sp_annual_count) !== "", (text) => void saveFields({ frequency_fallback: text })),
    },
    { key: "fte", icon: Users, label: t("field.fte"), value: str(detail.sp_fte) },
    { key: "start", icon: ArrowUpFromLine, label: t("field.startCondition"), value: str(detail.sp_start_condition), wide: true, valueSize: "fine", edit: "start_condition" },
    { key: "end", icon: ArrowDownToLine, label: t("field.endCondition"), value: str(detail.sp_end_condition), wide: true, valueSize: "fine", edit: "end_condition" },
    { key: "input", icon: ArrowDownToLine, label: t("sp.input"), value: str(detail.sp_input), wide: true, valueSize: "fine" },
    { key: "output", icon: ArrowUpFromLine, label: t("sp.output"), value: str(detail.sp_output), wide: true, valueSize: "fine" },
    { key: "url", icon: Link2, label: t("field.url"), value: detail.sp_url ? (detail.sp_url_label || detail.sp_url) : "", wide: true, valueSize: "fine" },
    { key: "description", icon: FileText, label: t("field.description"), value: str(detail.description), wide: true, valueSize: "fine" },
  ];

  const editingDirty = editing !== null && editing.draft !== currentOf(editing.key);
  const commitEdit = () => {
    if (!editing) return;
    if (editingDirty) void saveFields({ [editing.key]: editing.draft.trim() });
  };
  const editTitle = (key: EditableKey) =>
    key === "gmp"
      ? t("field.gmp")
      : key === "start_condition"
        ? t("field.startCondition")
        : key === "end_condition"
          ? t("field.endCondition")
          : key === "duration"
            ? t("field.duration")
            : key === "touch_time"
              ? t("field.touchTime")
              : t("field.system");
  const editHint = (key: EditableKey) =>
    key === "gmp"
      ? t("sp.tile.hint.gmp")
      : key === "start_condition"
        ? t("sp.tile.hint.start_condition")
        : key === "end_condition"
          ? t("sp.tile.hint.end_condition")
          : key === "duration"
            ? t("sp.tile.hint.duration")
            : key === "touch_time"
              ? t("sp.tile.hint.touch_time")
              : t("sp.tile.hint.system");

  return (
    <div data-id="subprocess-designation-panel" className="flex flex-col gap-3">
      <p className="text-caption text-ink-tertiary">{t("perm.sp.hint")}</p>

      {/* @container — 타일 열 수는 섹션 폭에 따라 2열↔4열(헤더 액션도 좁으면 줄바꿈), 사용자 요청 2026-10-01 */}
      <div className="@container overflow-hidden rounded-md border border-hairline">
        {/* 헤더 — 지정 상태(Designated/미지정) + 게시본 기준 + 노출 안내, 우측 액션 */}
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline bg-surface-pearl px-3.5 py-2.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
              designated ? "bg-accent-tint text-accent" : "bg-surface-alt text-ink-tertiary"
            }`}
          >
            <Workflow size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-caption-strong text-ink">{designated ? "Designated" : t("perm.sp.notDesignated")}</span>
              {designated && publishedVersion && (
                <span className="rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                  {t("perm.sp.publishedBasis", { v: formatVersionMarker(publishedVersion, detail.versions) })}
                </span>
              )}
            </div>
            <div className="text-fine text-ink-tertiary">
              {designated ? t("perm.sp.inLibrary") : hasPublished ? t("perm.sp.tilesEditableHint") : t("perm.sp.requiresPublished")}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {designated ? (
              <>
                <button
                  type="button"
                  data-id="subprocess-designation-edit"
                  className="inline-flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
                  onClick={openModal}
                  disabled={saving}
                >
                  <Pencil size={14} strokeWidth={1.5} />
                  {t("perm.sp.edit")}
                </button>
                <button
                  type="button"
                  data-id="subprocess-designation-remove"
                  className="rounded-sm border border-error/40 px-2.5 py-1 text-caption text-error hover:bg-error/10 disabled:opacity-60"
                  onClick={() => setShowUndesignate(true)}
                  disabled={saving}
                >
                  {t("perm.sp.undesignate")}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-id="subprocess-designation-designate"
                className="rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
                onClick={openModal}
                disabled={!hasPublished || saving}
              >
                {t("perm.sp.designate")}
              </button>
            )}
          </div>
        </div>

        {/* 타일 그리드 — 부서는 DeptPill(조직 카드), 승격 필드는 클릭 편집, 나머지는 읽기 타일 */}
        <div className="grid grid-cols-2 gap-2 p-3 @[44rem]:grid-cols-4">
          <SpFieldTile
            dataId="sp-tile-department"
            icon={Building2}
            label={t("field.department")}
            value=""
            valueNode={
              detail.sp_department ? (
                <DeptPill department={detail.sp_department} dataId="sp-tile-department-pill" />
              ) : undefined
            }
            placeholder={empty}
            wide
            readOnly
            labelFixed
          />
          <SpFieldTile
            dataId="sp-tile-gmp"
            icon={ShieldCheck}
            iconSlot={noteIcon("gmp", ShieldCheck, str(detail.sp_gmp_fallback), str(detail.sp_gmp) !== "", (text) => void saveFields({ gmp_fallback: text }))}
            label={t("field.gmp")}
            value=""
            valueNode={
              formatGmp(detail.sp_gmp) ? (
                <span className="rounded-full px-1.5 py-0.5 text-fine" style={getGmpBadgeStyle(detail.sp_gmp)}>
                  {formatGmp(detail.sp_gmp)}
                </span>
              ) : undefined
            }
            placeholder={t("perm.processFields.gmpUnset")}
            wide
            labelFixed
            active={editing?.key === "gmp"}
            onOpen={openEdit("gmp")}
          />
          {tiles.map((tile) => (
            <SpFieldTile
              key={tile.key}
              dataId={`sp-tile-${tile.key}`}
              icon={tile.icon}
              iconSlot={tile.iconSlot}
              label={tile.label}
              value={tile.value}
              valueSize={tile.valueSize}
              placeholder={empty}
              wide={tile.wide}
              readOnly={tile.edit === undefined}
              labelFixed
              active={tile.edit !== undefined && editing?.key === tile.edit}
              onOpen={tile.edit ? openEdit(tile.edit) : undefined}
            />
          ))}
        </div>

        {/* 푸터 — 최근 변경자(호버 카드)·시각 */}
        {changedBy && (
          <div className="flex items-center gap-1.5 border-t border-divider px-3.5 py-2 text-fine text-ink-tertiary">
            {t("perm.sp.lastChanged")}
            <PersonHoverCard userId={changedBy} className="text-ink-secondary underline decoration-dotted underline-offset-2">
              {changedByName}
            </PersonHoverCard>
            {changedByName !== changedBy ? <span>({changedBy})</span> : null}
            {detail.sp_changed_at ? <span>· {formatKst(detail.sp_changed_at)} KST</span> : null}
          </div>
        )}
      </div>

      {/* 승격 필드 편집 팝오버 — GMP는 분류 목록, 시간은 ParamInput(H.MM), 나머지는 텍스트 */}
      {editing && (
        <SpFieldPopover
          dataId={`sp-popover-${editing.key}`}
          anchor={editing.at}
          title={editTitle(editing.key)}
          hint={editHint(editing.key)}
          dirty={editingDirty}
          onApply={commitEdit}
          onCommit={() => {
            commitEdit();
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
          labels={labels}
        >
          {editing.key === "gmp" ? (
            <div className="flex flex-col gap-0.5" role="listbox">
              {[{ value: "", label: t("perm.processFields.gmpUnset"), colorVar: null }, ...GMP_OPTIONS].map((option) => {
                const selected = editing.draft === option.value;
                return (
                  <button
                    key={option.value || "unset"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-id={`sp-gmp-option-${option.value || "unset"}`}
                    className={`flex items-center gap-2 rounded-sm px-2 py-1 text-left text-caption transition-colors ${
                      selected ? "bg-accent-tint text-accent" : "text-ink hover:bg-surface-alt"
                    }`}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, draft: option.value } : prev))}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-surface-chip"
                      style={option.colorVar ? { backgroundColor: `var(${option.colorVar})` } : undefined}
                    />
                    <span className="flex-1">{option.label}</span>
                    {selected && <Check size={13} strokeWidth={1.5} />}
                  </button>
                );
              })}
            </div>
          ) : editing.key === "duration" || editing.key === "touch_time" ? (
            <ParamInput
              field={editing.key}
              dataId={`sp-input-${editing.key}`}
              className={INPUT_CLASS}
              value={editing.draft}
              ariaLabel={editTitle(editing.key)}
              onCommit={(next) => setEditing((prev) => (prev ? { ...prev, draft: next } : prev))}
            />
          ) : (
            <input
              data-id={`sp-input-${editing.key}`}
              className={INPUT_CLASS}
              maxLength={editing.key === "system" ? 100 : undefined}
              value={editing.draft}
              onChange={(e) => setEditing((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
            />
          )}
        </SpFieldPopover>
      )}

      {/* 지정/수정 모달 — 공용 컴포넌트(에디터 인스펙터 카드와 공유) */}
      {showModal && (
        <SubprocessDesignationModal
          mapId={Number(mapId)}
          designated={designated}
          publishedVersionId={publishedVersionId}
          initial={modalInitial}
          onSaved={(updated) => {
            setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
            onToast(t("perm.sp.saved"));
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* 해제 확인 — 사용처 경고·잠금 안내 */}
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
    </div>
  );
}
