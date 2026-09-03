"use client";

// 서브프로세스 지정/수정 모달 — 부서(필수)·담당자는 행 타일, 나머지는 필드 타일(2열) → 클릭 위치 입력 팝오버.
// 폭은 max-w-lg(512px) — 더 넓히면 시선 이동이 좌우로 길어진다(사용자 피드백 2026-09-03, 672px 폐기).
// 타일: 시스템·URL, 파라미터(회당 4 — 비용은 단위 탭이 있는 한 타일 — + 참고치 2), Input/Output(항목 수).
// 팝오버 안에 안내·Σ·인터뷰 원문 메모. 설정 화면 패널과 에디터 인스펙터 카드·받은함이 공용으로 사용한다
// (design 2026-09-03 followups §5, 비용 단일 타일·부서/담당자 행 타일은 사용자 결정 2026-09-03).

import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Flag,
  Link as LinkIcon,
  LogIn,
  LogOut,
  Monitor,
  Play,
  Plus,
  Sigma,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getGraph, putSubprocessDesignation, type Graph, type MapSummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { AutoHeight } from "@/components/auto-height";
import { FallbackHint } from "@/components/fallback-hint";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { MultiValueInput, type MultiValueInputHandle } from "@/components/multi-value-input";
import { PARAM_ICON } from "@/components/param-icons";
import { ParamInput } from "@/components/param-input";
import { DeptAssigneeTiles } from "@/components/permissions/attribute-tiles";
import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import { buildPopoverActionLabels } from "@/components/popover-action-bar";
import { CostUnitTabs, CurrencyPill, type CostUnit } from "@/components/cost-unit";
import { formatDurationHm, formatThousands } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { assignSpIoIds } from "@/lib/io-items";
import {
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
  // 시작·종료 조건 — 링크 맵 지정값(SP 노드가 읽기 상속). 지정 모달 타일이 함께 저장 (2026-09-03)
  start_condition: string;
  end_condition: string;
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

// 비용은 ₩/$ 두 필드를 한 타일로 접는다 — 팝오버 앞 단위 탭으로 고르고 다른 통화는 저장 시 비운다
type ParamTile = Exclude<SpParamField, CostUnit> | "cost" | SpContextField;
type TileField = ParamTile | "system" | "url" | "input" | "output" | "start_condition" | "end_condition";

// 타일 순서 — 회당 4(비용 단일) + 참고치 2
const PARAM_TILES: readonly ParamTile[] = ["duration", "touch_time", "cost", "headcount", ...SP_CONTEXT_FIELDS];

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
  cost: "sp.tile.hint.cost",
  headcount: "sp.tile.hint.headcount",
  annual_count: "sp.tile.hint.annual_count",
  fte: "sp.tile.hint.fte",
  system: "sp.tile.hint.system",
  url: "sp.tile.hint.url",
  input: "sp.tile.hint.input",
  output: "sp.tile.hint.output",
  start_condition: "sp.tile.hint.start_condition",
  end_condition: "sp.tile.hint.end_condition",
};

interface ActiveTile {
  field: TileField;
  at: { x: number; y: number };
  // 팝오버 로컬 초안 — 확정 시에만 form에 반영, Esc면 폐기
  value: string;
  note: string;
  extra: string; // url 라벨 / IO 폼 join
  unit: CostUnit; // 비용 타일의 통화 탭
}

const INPUT_CLASS =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

const countLines = (joined: string): number => joined.split("\n").filter((line) => line.trim() !== "").length;

// 저장된 비용의 통화 — 둘 다 비면 ₩ 기본
const costUnitOf = (form: { cost_krw: string; cost_usd: string }): CostUnit =>
  form.cost_usd !== "" ? "cost_usd" : "cost_krw";

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
  const filledDetailCount = [form.input, form.output, form.start_condition, form.end_condition]
    .filter((v) => v.trim() !== "").length;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summing, setSumming] = useState(false);
  const [active, setActive] = useState<ActiveTile | null>(null);
  // IO 플라이아웃 편집기 핸들 — 푸터 '+ Add'가 행을 추가한다
  const ioRef = useRef<MultiValueInputHandle | null>(null);
  // 게시본 그래프 — 모달 수명 동안 1회만 fetch(Σ 반복 클릭·미리보기 계산에 재요청 안 함)
  const graphRef = useRef<Graph | null>(null);
  // Σ 미리보기(5종) 원시값 — 팝오버 안내 줄에 표시
  const [previews, setPreviews] = useState<Partial<Record<SpParamField, string>>>({});
  const labels = buildPopoverActionLabels(t);

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
  const isParamTile = (field: TileField): field is ParamTile => (PARAM_TILES as readonly string[]).includes(field);
  // Σ 대상 — 회당 지표(참고치 2종 제외). 비용은 현재 단위 필드로 합산
  const sumFieldOf = (tile: ActiveTile): SpParamField | null => {
    if (tile.field === "cost") return tile.unit;
    return (SP_PARAM_FIELDS as readonly string[]).includes(tile.field) ? (tile.field as SpParamField) : null;
  };

  // ── 타일 표시값 ────────────────────────────────────────────────────────────
  const tileValue = (field: TileField): string => {
    switch (field) {
      case "duration":
      case "touch_time":
        return formatDurationHm(form[field]);
      case "cost":
        return formatThousands(form[costUnitOf(form)]);
      case "headcount":
      case "annual_count":
      case "fte":
      case "system":
      case "start_condition":
      case "end_condition":
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
    if (field === "cost") return t("field.costRun");
    if (isParamTile(field)) return t(PARAM_LABEL_KEY[field]);
    if (field === "system") return t("field.system");
    if (field === "url") return t("field.url");
    if (field === "start_condition") return t("field.startCondition");
    if (field === "end_condition") return t("field.endCondition");
    return field === "input" ? t("sp.input") : t("sp.output");
  };
  const tileIcon = (field: TileField) => {
    if (field === "cost") return PARAM_ICON[costUnitOf(form)];
    if (isParamTile(field)) return PARAM_ICON[field];
    if (field === "system") return Monitor;
    if (field === "url") return LinkIcon;
    if (field === "start_condition") return Play;
    if (field === "end_condition") return Flag;
    return field === "input" ? LogIn : LogOut;
  };

  // ── 팝오버 열기/확정/취소 ──────────────────────────────────────────────────
  // 폼의 현재 확정값을 팝오버 초안 형태로 — 열 때 초기값, 열린 뒤엔 dirty 판정 기준
  function readTileDraft(field: TileField): Pick<ActiveTile, "value" | "note" | "extra" | "unit"> {
    const noteKey = NOTE_KEY[field];
    const unit = costUnitOf(form);
    return {
      value: field === "url" ? form.url : field === "cost" ? form[unit] : form[field],
      note: noteKey ? form[noteKey] : "",
      extra: field === "url" ? form.urlLabel : field === "input" ? form.input_forms : field === "output" ? form.output_forms : "",
      unit,
    };
  }

  function openTile(field: TileField, at: { x: number; y: number }) {
    setActive({ field, at, ...readTileDraft(field) });
  }

  const tileDirty = (() => {
    if (!active) return false;
    const base = readTileDraft(active.field);
    return (
      active.value !== base.value ||
      active.note.trim() !== base.note.trim() ||
      active.extra !== base.extra ||
      (active.field === "cost" && active.unit !== base.unit)
    );
  })();

  // 초안 → 폼 반영(팝오버는 열어둠) — 메뉴 "Save"
  function applyTile() {
    if (!active) return;
    const { field, value, note, extra, unit } = active;
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
      } else if (field === "cost") {
        // 통화 배타 — 고른 단위에만 값, 다른 통화는 비운다
        next.cost_krw = unit === "cost_krw" ? value : "";
        next.cost_usd = unit === "cost_usd" ? value : "";
      } else {
        next[field] = value;
      }
      if (noteKey) next[noteKey] = note.trim();
      return next;
    });
  }

  // 반영 + 닫기 — Enter·주 버튼(변경 있을 때)·바깥 클릭(변경 있을 때)·메뉴 "Save and close"
  function commitTile() {
    applyTile();
    setActive(null);
  }

  async function handleSum(field: SpParamField) {
    if (publishedVersionId === null) return;
    setSumming(true);
    setError(null);
    try {
      if (graphRef.current === null) graphRef.current = await getGraph(publishedVersionId);
      const total = sumParamField(graphRef.current, field);
      setActive((prev) => (prev ? { ...prev, value: total } : prev));
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
        start_condition: form.start_condition.trim(),
        end_condition: form.end_condition.trim(),
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
    const sumField = sumFieldOf(active);
    const preview = sumField ? formatSumPreview(sumField, previews[sumField] ?? "") : undefined;
    // 입력 필드 — 비용은 고른 단위 필드로 포맷·정규화
    const inputField = field === "cost" ? active.unit : isParamTile(field) ? field : null;
    return (
      <SpFieldPopover
        dataId={`sp-tile-popover-${field}`}
        anchor={active.at}
        title={tileLabel(field)}
        hint={field === "cost" ? t("sp.tile.costUnitHint") : t(HINT_KEY[field])}
        width={isIo ? 420 : 320}
        enterCommits={!isIo}
        dirty={tileDirty}
        onApply={applyTile}
        labels={labels}
        footerStart={
          isIo ? (
            <button
              type="button"
              data-id={`sp-tile-io-${field}-add`}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt"
              onClick={() => ioRef.current?.addRow()}
            >
              <Plus size={12} strokeWidth={1.5} />
              {t("io.addNew")}
            </button>
          ) : undefined
        }
        onCommit={commitTile}
        onCancel={() => setActive(null)}
      >
        {inputField && (
          <div className="flex items-center gap-1.5">
            {field === "cost" && (
              <CostUnitTabs
                dataId="sp-tile-cost-unit"
                value={active.unit}
                onChange={(unit) => setActive((prev) => (prev ? { ...prev, unit } : prev))}
              />
            )}
            <ParamInput
              key={inputField}
              field={inputField}
              dataId={`sp-tile-input-${field}`}
              className={`${INPUT_CLASS} text-right`}
              value={active.value}
              ariaLabel={tileLabel(field)}
              placeholder={preview}
              onCommit={(next) => setActive((prev) => (prev ? { ...prev, value: next } : prev))}
            />
            {sumField && (
              <button
                type="button"
                data-id={`sp-tile-sum-${field}`}
                title={publishedVersionId === null ? t("sp.sumNeedsPublished") : t("sp.sumAllNodes")}
                aria-label={t("sp.sumAllNodes")}
                disabled={publishedVersionId === null || summing}
                className="shrink-0 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
                onClick={() => void handleSum(sumField)}
              >
                <Sigma size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        )}
        {sumField && preview && (
          <p className="text-fine text-ink-tertiary">{t("sp.tile.sumPreview", { v: preview })}</p>
        )}
        {(field === "system" || field === "start_condition" || field === "end_condition") && (
          <input
            data-id={`sp-tile-input-${field}`}
            className={INPUT_CLASS}
            maxLength={field === "system" ? 100 : undefined}
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
            {/* 팝오버 제목이 이미 필드명 — 편집기는 헤드리스, '+ Add'는 푸터(OK 줄 맨 앞) (폼 선택·삭제는 그대로) */}
            <MultiValueInput
              ref={ioRef}
              dataId={`sp-tile-io-${field}`}
              label={tileLabel(field)}
              headless
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
    const noteKey = NOTE_KEY[field];
    return (
      <SpFieldTile
        key={field}
        dataId={`sp-tile-${field}`}
        icon={tileIcon(field)}
        label={tileLabel(field)}
        value={tileValue(field)}
        // 조건은 문장 — 값 글자를 한 단계 작게
        valueSize={field === "start_condition" || field === "end_condition" ? "fine" : undefined}
        // 비용 타일 — 선택한 단위를 필로(값 있을 때만)
        valueNode={field === "cost" && tileValue("cost") !== "" ? <CurrencyPill unit={costUnitOf(form)} /> : undefined}
        // 원문 메모 필드 — 타일 호버 시 아이콘이 메모 아이콘으로 바뀌고, 눌러 바로 보고 고친다(폼 버퍼에 반영).
        // 팝오버 안 메모 칸과 같은 값 (사용자 피드백 2026-09-03)
        iconSlot={
          noteKey ? (
            <FallbackHint
              dataId={`sp-tile-note-icon-${field}`}
              fallback={form[noteKey]}
              restIcon={tileIcon(field)}
              iconSize={16}
              padded={false}
              restClassName={tileValue(field) !== "" ? "text-accent" : "text-ink-tertiary"}
              onSaveFallback={(text) => setForm((prev) => ({ ...prev, [noteKey]: text }))}
            />
          ) : undefined
        }
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
          {/* BPM attributes — 부서·담당자 행 타일 + 시스템·URL 타일 */}
          <div className="py-1" data-id="sp-designation-attrs">
            {/* 헤더 행 h-5 고정 — 세 섹션이 접혔을 때 같은 높이('모두 펼치기' 버튼 유무와 무관) */}
            <div className="flex h-5 items-center gap-1">
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
                // -my-1 — 호버 배경용 세로 패딩이 헤더 행 높이를 키우지 않게(다른 섹션 헤더와 같은 높이)
                className="-my-1 flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-ink"
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
                  <div className="grid grid-cols-2 gap-1.5 py-1" data-id="sp-designation-attr-tiles">
                    <DeptAssigneeTiles
                      versionId={publishedVersionId}
                      department={form.department}
                      assignee={form.assignee}
                      dataIdPrefix="sp-tile"
                      labels={labels}
                      onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                    />
                    {(["system", "url"] as const).map(renderTile)}
                  </div>
                  {urlInvalid && <p className="text-fine text-error">{t("subprocess.urlInvalid")}</p>}
                </div>
              )}
            </AutoHeight>
          </div>
          {/* Metrics — 회당 4종(Σ, 비용은 단위 탭 한 타일) + 참고치 2종 타일 */}
          <div className="py-1" data-id="sp-designation-params">
            <div className="flex h-5 items-center gap-1">
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
            </div>
            <AutoHeight className="overflow-hidden">
              {!paramsCollapsed && (
                <div className="ml-2 border-l border-divider pl-2">
                  <div className="grid grid-cols-2 gap-1.5 py-1" data-id="sp-designation-param-tiles">
                    {PARAM_TILES.map(renderTile)}
                  </div>
                </div>
              )}
            </AutoHeight>
          </div>
          {/* Details — Input/Output 타일(항목 수) + 시작·종료 조건 + 설명 */}
          <div className="py-1" data-id="sp-designation-details">
            <div className="flex h-5 items-center gap-1">
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
            </div>
            <AutoHeight className="overflow-hidden">
              {!detailsCollapsed && (
                <div className="ml-2 border-l border-divider pl-2">
                  <div className="grid grid-cols-2 gap-1.5 py-1" data-id="sp-designation-detail-tiles">
                    {(["input", "output", "start_condition", "end_condition"] as const).map(renderTile)}
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
