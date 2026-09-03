"use client";

// 서브프로세스 지정/수정 모달 — 부서 필수(BPM 피커 재사용) + 필드 타일(2열) → 클릭 위치 입력 팝오버.
// 폭은 max-w-lg(512px) — 더 넓히면 시선 이동이 좌우로 길어진다(사용자 피드백 2026-09-03, 672px 폐기).
// 타일: 시스템·URL, 파라미터 7종(회당 5 + 참고치 2), Input/Output(항목 수). 팝오버 안에 안내·Σ·인터뷰 원문 메모.
// 설정 화면 패널과 에디터 인스펙터 카드·받은함이 공용으로 사용한다 (design 2026-09-03 followups §5).

import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Link as LinkIcon,
  LogIn,
  LogOut,
  Monitor,
  Sigma,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getGraph, putSubprocessDesignation, type Graph, type MapSummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { AutoHeight } from "@/components/auto-height";
import { BpmAttributePicker } from "@/components/bpm-attribute-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { MultiValueInput } from "@/components/multi-value-input";
import { PARAM_ICON } from "@/components/param-icons";
import { ParamInput } from "@/components/param-input";
import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import { formatDurationHm, formatThousands } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { assignSpIoIds } from "@/lib/io-items";
import {
  isCostFieldDisabled,
  PARAM_LABEL_KEY,
  readAttrsCollapsed,
  readDetailsCollapsed,
  readParamsCollapsed,
  SP_CONTEXT_FIELDS,
  SP_PARAM_FIELDS,
  writeAttrsCollapsed,
  writeDetailsCollapsed,
  writeParamsCollapsed,
  type SpContextField,
  type SpParamField,
} from "@/lib/params";
import { formatSumPreview, sumParamField } from "@/lib/param-sum";
import { isHttpUrl } from "@/lib/url";

export interface DesignationForm {
  department: string;
  assignee: string;
  system: string;
  duration: string;
  touch_time: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  // 담당자 기준 참고치 — 연결 맵 SP 노드 값과 별개(호버 참고) (design 2026-09-03 §4)
  annual_count: string;
  fte: string;
  // 인터뷰 원문 메모 — 타일 팝오버의 메모 칸. ""=지움 (design 2026-09-03 followups §2)
  total_time_fallback: string;
  touch_time_fallback: string;
  system_fallback: string;
  frequency_fallback: string;
  url: string;
  urlLabel: string;
  input: string;
  output: string;
  // 항목별 데이터 폼 — input/output 줄과 1:1 정렬 (2026-08-20)
  input_forms: string;
  output_forms: string;
  // SP IO 항목 id — 폼에서 편집하지 않는 현행 값. 저장 시 텍스트가 유지된 줄의 id를 승계하는 데만 쓴다
  // (id가 바뀌면 소비 맵의 미러가 댕글링→복사본으로 해산된다, io-linking §3)
  input_ids: string;
  output_ids: string;
  description: string;
}

interface SubprocessDesignationModalProps {
  mapId: number;
  publishedVersionId: number | null; // BPM 피커 후보 스코프
  // 현재 지정 여부 — 헤더 상태 필(영어 고정, SP 카드 뱃지와 동일 규칙) (사용자 결정 2026-08-20)
  designated?: boolean;
  initial: DesignationForm;
  onSaved: (updated: MapSummary) => void;
  onClose: () => void;
}

type ParamTile = SpParamField | SpContextField;
type TileField = ParamTile | "system" | "url" | "input" | "output";

// 파라미터 타일의 원문 메모 키 — 없는 필드는 메모 칸을 그리지 않는다
const NOTE_KEY: Partial<Record<TileField, "total_time_fallback" | "touch_time_fallback" | "system_fallback" | "frequency_fallback">> = {
  duration: "total_time_fallback",
  touch_time: "touch_time_fallback",
  system: "system_fallback",
  annual_count: "frequency_fallback",
};

const HINT_KEY: Record<TileField, MessageKey> = {
  duration: "sp.tile.hint.duration",
  touch_time: "sp.tile.hint.touch_time",
  cost_krw: "sp.tile.hint.cost_krw",
  cost_usd: "sp.tile.hint.cost_usd",
  headcount: "sp.tile.hint.headcount",
  annual_count: "sp.tile.hint.annual_count",
  fte: "sp.tile.hint.fte",
  system: "sp.tile.hint.system",
  url: "sp.tile.hint.url",
  input: "sp.tile.hint.input",
  output: "sp.tile.hint.output",
};

interface ActiveTile {
  field: TileField;
  at: { x: number; y: number };
  // 팝오버 로컬 초안 — 확정 시에만 form에 반영, Esc면 폐기
  value: string;
  note: string;
  extra: string; // url 라벨 / IO 폼 join
}

const INPUT_CLASS =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

const countLines = (joined: string): number => joined.split("\n").filter((line) => line.trim() !== "").length;

export function SubprocessDesignationModal({
  mapId,
  publishedVersionId,
  designated = false,
  initial,
  onSaved,
  onClose,
}: SubprocessDesignationModalProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<DesignationForm>(initial);
  // 섹션 아코디언 — 노드 편집 모달과 동일 구성·공유 영속 키 (사용자 결정 2026-08-20)
  const [attrsCollapsed, setAttrsCollapsed] = useState(readAttrsCollapsed);
  const [paramsCollapsed, setParamsCollapsed] = useState(readParamsCollapsed);
  const [detailsCollapsed, setDetailsCollapsed] = useState(readDetailsCollapsed);
  const anySectionOpen = !attrsCollapsed || !paramsCollapsed || !detailsCollapsed;
  const toggleAllSections = () => {
    const next = anySectionOpen; // true=모두 접기
    setAttrsCollapsed(next);
    writeAttrsCollapsed(next);
    setParamsCollapsed(next);
    writeParamsCollapsed(next);
    setDetailsCollapsed(next);
    writeDetailsCollapsed(next);
  };
  const filledAttrCount = [form.department, form.assignee, form.system, form.url]
    .filter((v) => v.trim() !== "").length;
  const filledParamCount = [...SP_PARAM_FIELDS, ...SP_CONTEXT_FIELDS].filter((f) => form[f] !== "").length;
  const filledDetailCount = [form.input, form.output].filter((v) => v.trim() !== "").length;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summing, setSumming] = useState(false);
  const [active, setActive] = useState<ActiveTile | null>(null);
  // 게시본 그래프 — 모달 수명 동안 1회만 fetch(Σ 반복 클릭·미리보기 계산에 재요청 안 함)
  const graphRef = useRef<Graph | null>(null);
  // Σ 미리보기(5종) 원시값 — 팝오버 안내 줄에 표시
  const [previews, setPreviews] = useState<Partial<Record<SpParamField, string>>>({});

  useEffect(() => {
    if (publishedVersionId === null) return;
    let activeLoad = true;
    void getGraph(publishedVersionId)
      .then((graph) => {
        graphRef.current = graph;
        if (!activeLoad) return;
        const next: Partial<Record<SpParamField, string>> = {};
        for (const field of SP_PARAM_FIELDS) next[field] = sumParamField(graph, field);
        setPreviews(next);
      })
      .catch((err) => {
        if (activeLoad) setError(humanizeApiError(err, t));
      });
    return () => {
      activeLoad = false;
    };
  }, [publishedVersionId, t]);

  const urlInvalid = form.url.trim() !== "" && !isHttpUrl(form.url);
  const isSumField = (field: TileField): field is SpParamField => (SP_PARAM_FIELDS as readonly string[]).includes(field);
  const isParamTile = (field: TileField): field is ParamTile =>
    isSumField(field) || (SP_CONTEXT_FIELDS as readonly string[]).includes(field);

  // ── 타일 표시값 ────────────────────────────────────────────────────────────
  const costText = (raw: string, symbol: string): string => {
    const n = formatThousands(raw);
    return n ? `${symbol}${n}` : "";
  };
  const tileValue = (field: TileField): string => {
    switch (field) {
      case "duration":
      case "touch_time":
        return formatDurationHm(form[field]);
      case "cost_krw":
        return costText(form.cost_krw, "₩");
      case "cost_usd":
        return costText(form.cost_usd, "$");
      case "headcount":
      case "annual_count":
      case "fte":
      case "system":
        return form[field];
      case "url":
        return form.url.trim() ? form.urlLabel.trim() || form.url.trim() : "";
      case "input":
      case "output": {
        const n = countLines(form[field]);
        return n > 0 ? t("sp.tile.items", { n }) : "";
      }
    }
  };
  const tileLabel = (field: TileField): string => {
    if (isParamTile(field)) return t(PARAM_LABEL_KEY[field]);
    if (field === "system") return t("field.system");
    if (field === "url") return t("field.url");
    return field === "input" ? t("sp.input") : t("sp.output");
  };
  const tileIcon = (field: TileField) => {
    if (isParamTile(field)) return PARAM_ICON[field];
    if (field === "system") return Monitor;
    if (field === "url") return LinkIcon;
    return field === "input" ? LogIn : LogOut;
  };

  // ── 팝오버 열기/확정/취소 ──────────────────────────────────────────────────
  function openTile(field: TileField, at: { x: number; y: number }) {
    const noteKey = NOTE_KEY[field];
    setActive({
      field,
      at,
      value: field === "url" ? form.url : form[field],
      note: noteKey ? form[noteKey] : "",
      extra: field === "url" ? form.urlLabel : field === "input" ? form.input_forms : field === "output" ? form.output_forms : "",
    });
  }

  function commitTile() {
    if (!active) return;
    const { field, value, note, extra } = active;
    const noteKey = NOTE_KEY[field];
    setForm((prev) => {
      const next: DesignationForm = { ...prev };
      if (field === "url") {
        next.url = value.trim();
        next.urlLabel = extra.trim();
      } else if (field === "input") {
        next.input = value;
        next.input_forms = extra;
      } else if (field === "output") {
        next.output = value;
        next.output_forms = extra;
      } else {
        next[field] = value;
      }
      if (noteKey) next[noteKey] = note.trim();
      return next;
    });
    setActive(null);
  }

  async function handleSum(field: SpParamField) {
    if (publishedVersionId === null) return;
    setSumming(true);
    setError(null);
    try {
      if (graphRef.current === null) graphRef.current = await getGraph(publishedVersionId);
      const total = sumParamField(graphRef.current, field);
      setActive((prev) => (prev && prev.field === field ? { ...prev, value: total } : prev));
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setSumming(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await putSubprocessDesignation(mapId, {
        department: form.department.trim(),
        assignee: form.assignee,
        system: form.system,
        duration: form.duration,
        touch_time: form.touch_time,
        cost_krw: form.cost_krw,
        cost_usd: form.cost_usd,
        headcount: form.headcount,
        annual_count: form.annual_count,
        fte: form.fte,
        total_time_fallback: form.total_time_fallback,
        touch_time_fallback: form.touch_time_fallback,
        system_fallback: form.system_fallback,
        frequency_fallback: form.frequency_fallback,
        url: form.url.trim(),
        url_label: form.urlLabel.trim(),
        input: form.input.trim(),
        output: form.output.trim(),
        input_forms: form.input_forms,
        output_forms: form.output_forms,
        // 전 줄 id 부여 — 텍스트가 그대로인 줄은 기존 id 승계(소비 맵 미러 유지), 개명·신규는 새 id
        input_ids: assignSpIoIds(form.input.trim(), initial.input, initial.input_ids),
        output_ids: assignSpIoIds(form.output.trim(), initial.output, initial.output_ids),
        description: form.description.trim(),
      });
      onSaved(updated);
    } catch (err) {
      setError(humanizeApiError(err, t));
      setSaving(false);
    }
  }

  // ── 팝오버 본문 ────────────────────────────────────────────────────────────
  const renderPopover = () => {
    if (!active) return null;
    const { field } = active;
    const noteKey = NOTE_KEY[field];
    const isIo = field === "input" || field === "output";
    const preview = isSumField(field) ? formatSumPreview(field, previews[field] ?? "") : undefined;
    const costLocked = isParamTile(field) && isCostFieldDisabled(field, form.cost_krw, form.cost_usd);
    return (
      <SpFieldPopover
        dataId={`sp-tile-popover-${field}`}
        anchor={active.at}
        title={tileLabel(field)}
        hint={costLocked ? t("sp.tile.costExclusive") : t(HINT_KEY[field])}
        width={isIo ? 420 : 320}
        enterCommits={!isIo}
        keysHint={isIo ? t("sp.tile.keysMultiline") : t("sp.tile.keys")}
        onCommit={commitTile}
        onCancel={() => setActive(null)}
      >
        {isParamTile(field) && (
          <div className="flex items-center gap-1.5">
            <ParamInput
              field={field}
              dataId={`sp-tile-input-${field}`}
              className={`${INPUT_CLASS} text-right disabled:opacity-40`}
              value={active.value}
              disabled={costLocked}
              ariaLabel={tileLabel(field)}
              placeholder={preview}
              onCommit={(next) => setActive((prev) => (prev ? { ...prev, value: next } : prev))}
            />
            {isSumField(field) && (
              <button
                type="button"
                data-id={`sp-tile-sum-${field}`}
                title={publishedVersionId === null ? t("sp.sumNeedsPublished") : t("sp.sumAllNodes")}
                aria-label={t("sp.sumAllNodes")}
                disabled={publishedVersionId === null || summing || costLocked}
                className="shrink-0 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
                onClick={() => void handleSum(field)}
              >
                <Sigma size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        )}
        {isSumField(field) && preview && (
          <p className="text-fine text-ink-tertiary">{t("sp.tile.sumPreview", { v: preview })}</p>
        )}
        {field === "system" && (
          <input
            data-id="sp-tile-input-system"
            className={INPUT_CLASS}
            maxLength={100}
            value={active.value}
            onChange={(e) => setActive((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
          />
        )}
        {field === "url" && (
          <div className="flex flex-col gap-1.5">
            <input
              data-id="sp-tile-input-url"
              className={INPUT_CLASS}
              maxLength={500}
              placeholder="https://"
              value={active.value}
              onChange={(e) => setActive((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
            />
            {active.value.trim() !== "" && !isHttpUrl(active.value) && (
              <p className="text-fine text-error">{t("subprocess.urlInvalid")}</p>
            )}
            <input
              data-id="sp-tile-input-url-label"
              className={`${INPUT_CLASS} disabled:opacity-40`}
              maxLength={100}
              placeholder={t("field.urlLabel")}
              value={active.extra}
              disabled={active.value.trim() === ""}
              onChange={(e) => setActive((prev) => (prev ? { ...prev, extra: e.target.value } : prev))}
            />
          </div>
        )}
        {isIo && (
          <div className="rounded-sm border border-hairline bg-surface-alt/40 px-2 py-1">
            <MultiValueInput
              dataId={`sp-tile-io-${field}`}
              label={tileLabel(field)}
              value={active.value}
              formsValue={active.extra}
              readOnly={false}
              onCommit={(joined, formsJoined) =>
                setActive((prev) => (prev ? { ...prev, value: joined, extra: formsJoined ?? "" } : prev))
              }
            />
          </div>
        )}
        {noteKey && (
          <label className="flex flex-col gap-1">
            <span className="text-fine text-ink-secondary">{t("sp.tile.note")}</span>
            <textarea
              data-id={`sp-tile-note-${field}`}
              className="min-h-[3rem] resize-y rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent"
              maxLength={200}
              placeholder={t("sp.tile.notePlaceholder")}
              value={active.note}
              onChange={(e) => setActive((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
            />
          </label>
        )}
      </SpFieldPopover>
    );
  };

  const renderTile = (field: TileField) => {
    const costLocked = isParamTile(field) && isCostFieldDisabled(field, form.cost_krw, form.cost_usd);
    return (
      <SpFieldTile
        key={field}
        dataId={`sp-tile-${field}`}
        icon={tileIcon(field)}
        label={tileLabel(field)}
        value={tileValue(field)}
        disabled={costLocked}
        disabledHint={t("sp.tile.costExclusive")}
        active={active?.field === field}
        onOpen={(at) => openTile(field, at)}
      />
    );
  };

  const sectionButton = (
    dataId: string,
    collapsed: boolean,
    onToggle: () => void,
    label: string,
    count: number,
  ) => (
    <button
      type="button"
      data-id={dataId}
      aria-expanded={!collapsed}
      className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink-tertiary"
      onClick={onToggle}
    >
      <ChevronRight size={12} strokeWidth={1.5} className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`} />
      {label}
      {count > 0 && <span className="font-normal">({count})</span>}
    </button>
  );

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-start justify-center bg-ink/20 px-4 pt-[7vh] backdrop-blur-sm"
    >
      <div
        data-id="subprocess-designation-modal"
        className="flex max-h-[84vh] w-full max-w-lg flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
      >
        <h2 className="flex shrink-0 items-center gap-2 text-body-strong text-ink">
          <Workflow size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">{t("perm.sp.designate")}</span>
          {/* 지정 상태 필 — SP 카드 뱃지와 동일(영어 고정) */}
          {designated ? (
            <span
              data-id="sp-designation-status-pill"
              className="shrink-0 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine font-normal text-accent"
            >
              Designated
            </span>
          ) : (
            <span
              data-id="sp-designation-status-pill"
              className="shrink-0 rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine font-normal text-ink-secondary"
            >
              Not designated
            </span>
          )}
        </h2>
        <p className="shrink-0 text-caption text-ink-tertiary">{t("perm.sp.modalHint")}</p>
        {/* 본문 스크롤 — 작은 창에서 위아래 넘침 방지(다른 모달과 동일, 사용자 결정 2026-08-20) */}
        <div className="scroll-soft -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {/* BPM attributes — 부서·담당자 피커 행 + 시스템·URL 타일 */}
          <div className="py-1" data-id="sp-designation-attrs">
            <div className="flex items-center gap-1">
              {sectionButton(
                "sp-designation-attrs-toggle",
                attrsCollapsed,
                () => {
                  const next = !attrsCollapsed;
                  setAttrsCollapsed(next);
                  writeAttrsCollapsed(next);
                },
                t("editor.bpmAttrs"),
                filledAttrCount,
              )}
              <button
                type="button"
                data-id="sp-designation-toggle-all-sections"
                className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                onClick={toggleAllSections}
              >
                {anySectionOpen ? (
                  <ChevronsDownUp size={13} strokeWidth={1.5} />
                ) : (
                  <ChevronsUpDown size={13} strokeWidth={1.5} />
                )}
                {t(anySectionOpen ? "inspector.collapseAll" : "inspector.expandAll")}
              </button>
            </div>
            <AutoHeight className="overflow-hidden">
              {!attrsCollapsed && (
                <div className="ml-2 flex flex-col gap-2 border-l border-divider pl-2">
                  <BpmAttributePicker
                    versionId={publishedVersionId}
                    assignee={form.assignee}
                    department={form.department}
                    readOnly={false}
                    onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                  />
                  <div className="grid grid-cols-2 gap-1.5" data-id="sp-designation-attr-tiles">
                    {(["system", "url"] as const).map(renderTile)}
                  </div>
                  {urlInvalid && <p className="text-fine text-error">{t("subprocess.urlInvalid")}</p>}
                </div>
              )}
            </AutoHeight>
          </div>
          {/* Metrics — 회당 5종(Σ) + 참고치 2종 타일 */}
          <div className="py-1" data-id="sp-designation-params">
            {sectionButton(
              "sp-designation-params-toggle",
              paramsCollapsed,
              () => {
                const next = !paramsCollapsed;
                setParamsCollapsed(next);
                writeParamsCollapsed(next);
              },
              t("inspector.parameters"),
              filledParamCount,
            )}
            <AutoHeight className="overflow-hidden">
              {!paramsCollapsed && (
                <div className="ml-2 border-l border-divider pl-2">
                  <div className="grid grid-cols-2 gap-1.5 py-1" data-id="sp-designation-param-tiles">
                    {[...SP_PARAM_FIELDS, ...SP_CONTEXT_FIELDS].map(renderTile)}
                  </div>
                </div>
              )}
            </AutoHeight>
          </div>
          {/* Details — Input/Output 타일(항목 수) + 설명 */}
          <div className="py-1" data-id="sp-designation-details">
            {sectionButton(
              "sp-designation-details-toggle",
              detailsCollapsed,
              () => {
                const next = !detailsCollapsed;
                setDetailsCollapsed(next);
                writeDetailsCollapsed(next);
              },
              t("inspector.details"),
              filledDetailCount,
            )}
            <AutoHeight className="overflow-hidden">
              {!detailsCollapsed && (
                <div className="ml-2 border-l border-divider pl-2">
                  <div className="grid grid-cols-2 gap-1.5 py-1" data-id="sp-designation-detail-tiles">
                    {(["input", "output"] as const).map(renderTile)}
                  </div>
                </div>
              )}
            </AutoHeight>
          </div>
          <div className="flex flex-col gap-1 border-t border-divider py-1">
            <span className="text-caption text-ink-secondary">{t("field.description")}</span>
            <textarea
              data-id="subprocess-designation-description"
              className="min-h-[4rem] resize-y rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>
        </div>
        {error && <p className="shrink-0 text-caption text-error">{error}</p>}
        <div className="flex shrink-0 justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("perm.sp.cancel")}
          </button>
          <button
            type="button"
            data-id="subprocess-designation-save"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            disabled={!form.department.trim() || saving || urlInvalid}
            onClick={() => void handleSave()}
          >
            {t("perm.sp.save")}
          </button>
        </div>
      </div>
      {renderPopover()}
    </ModalBackdrop>,
    document.body,
  );
}
