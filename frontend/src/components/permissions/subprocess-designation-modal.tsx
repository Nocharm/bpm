"use client";

// 서브프로세스 지정/수정 모달 — 부서 필수(BPM 피커 재사용), 시스템 자유 입력 + SP 파라미터 4종(Σ 합산 지원).
// 설정 화면 패널과 에디터 인스펙터 카드가 공용으로 사용한다.

import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Sigma, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getGraph, putSubprocessDesignation, type Graph, type MapSummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { AutoHeight } from "@/components/auto-height";
import { BpmAttributePicker } from "@/components/bpm-attribute-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { MultiValueInput } from "@/components/multi-value-input";
import { ParamInput } from "@/components/param-input";
import { useI18n } from "@/lib/i18n";
import {
  isCostFieldDisabled,
  PARAM_LABEL_KEY,
  readAttrsCollapsed,
  readDetailsCollapsed,
  readParamsCollapsed,
  SP_PARAM_FIELDS,
  writeAttrsCollapsed,
  writeDetailsCollapsed,
  writeParamsCollapsed,
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
  url: string;
  urlLabel: string;
  input: string;
  output: string;
  // 항목별 데이터 폼 — input/output 줄과 1:1 정렬 (2026-08-20)
  input_forms: string;
  output_forms: string;
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

const INPUT_CLASS =
  "rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

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
  const filledParamCount = SP_PARAM_FIELDS.filter((f) => form[f] !== "").length;
  const filledDetailCount = [form.input, form.output].filter((v) => v.trim() !== "").length;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summing, setSumming] = useState(false);
  // 게시본 그래프 — 모달 수명 동안 1회만 fetch(Σ 반복 클릭·미리보기 계산에 재요청 안 함)
  const graphRef = useRef<Graph | null>(null);
  // Σ 미리보기(4종) 원시값 — placeholder 표시형은 렌더 중 formatSumPreview로 파생
  const [previews, setPreviews] = useState<Partial<Record<SpParamField, string>>>({});

  // 모달 오픈 시 게시본이 있으면 그래프를 1회 로드해 4개 Σ 미리보기를 계산(design §4.1)
  useEffect(() => {
    if (publishedVersionId === null) return;
    let active = true;
    void getGraph(publishedVersionId)
      .then((graph) => {
        graphRef.current = graph;
        if (!active) return;
        const next: Partial<Record<SpParamField, string>> = {};
        for (const field of SP_PARAM_FIELDS) next[field] = sumParamField(graph, field);
        setPreviews(next);
      })
      .catch((err) => {
        if (active) setError(humanizeApiError(err, t));
      });
    return () => {
      active = false;
    };
  }, [publishedVersionId, t]);

  // placeholder는 표시 전용(저장 안 됨) — 값이 이미 있으면 HTML 기본 동작으로 자동 숨김
  function getPreviewText(field: SpParamField): string | undefined {
    return formatSumPreview(field, previews[field] ?? "");
  }

  // 지정 URL 클라이언트 검증 — 비어있지 않으면 http(s) 강제(액션 바 노출 게이트와 동일 규칙)
  const urlInvalid = form.url.trim() !== "" && !isHttpUrl(form.url);

  async function handleSum(field: SpParamField) {
    if (publishedVersionId === null) return;
    setSumming(true);
    setError(null);
    try {
      if (graphRef.current === null) graphRef.current = await getGraph(publishedVersionId);
      const total = sumParamField(graphRef.current, field);
      setForm((prev) => ({ ...prev, [field]: total }));
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
        url: form.url.trim(),
        url_label: form.urlLabel.trim(),
        input: form.input.trim(),
        output: form.output.trim(),
        input_forms: form.input_forms,
        output_forms: form.output_forms,
        description: form.description.trim(),
      });
      onSaved(updated);
    } catch (err) {
      setError(humanizeApiError(err, t));
      setSaving(false);
    }
  }

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-start justify-center bg-ink/20 px-4 pt-[9vh] backdrop-blur-sm"
    >
      <div
        data-id="subprocess-designation-modal"
        className="flex max-h-[82vh] w-full max-w-sm flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
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
          {/* BPM attributes — 노드 편집 모달과 동일 섹션 구성 + 우측 모두 접기/펼치기 */}
          <div className="py-1" data-id="sp-designation-attrs">
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-id="sp-designation-attrs-toggle"
                aria-expanded={!attrsCollapsed}
                className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink-tertiary"
                onClick={() => {
                  const next = !attrsCollapsed;
                  setAttrsCollapsed(next);
                  writeAttrsCollapsed(next);
                }}
              >
                <ChevronRight
                  size={12}
                  strokeWidth={1.5}
                  className={`transition-transform duration-150 ${attrsCollapsed ? "" : "rotate-90"}`}
                />
                {t("editor.bpmAttrs")}
                {filledAttrCount > 0 && <span className="font-normal">({filledAttrCount})</span>}
              </button>
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
                <div className="ml-2 border-l border-divider pl-2">
                  <BpmAttributePicker
                    versionId={publishedVersionId}
                    assignee={form.assignee}
                    department={form.department}
                    readOnly={false}
                    onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                  />
                  <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
                    <span className="shrink-0 text-caption text-ink-secondary">{t("field.system")}</span>
                    <input
                      data-id="subprocess-designation-system"
                      className={`${INPUT_CLASS} w-44 shrink-0 text-right`}
                      maxLength={100}
                      value={form.system}
                      onChange={(e) => setForm((prev) => ({ ...prev, system: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
                    <span className="shrink-0 text-caption text-ink-secondary">{t("field.url")}</span>
                    <input
                      data-id="subprocess-designation-url"
                      className={`${INPUT_CLASS} w-44 shrink-0 text-right`}
                      maxLength={500}
                      value={form.url}
                      onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                    />
                  </div>
                  {urlInvalid && (
                    <p className="py-0.5 text-right text-fine text-error">{t("subprocess.urlInvalid")}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
                    <span className="shrink-0 text-caption text-ink-secondary">{t("field.urlLabel")}</span>
                    <input
                      data-id="subprocess-designation-url-label"
                      className={`${INPUT_CLASS} w-44 shrink-0 text-right disabled:opacity-40`}
                      maxLength={100}
                      value={form.urlLabel}
                      disabled={form.url.trim() === ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, urlLabel: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </AutoHeight>
          </div>
          {/* Metrics — SP 파라미터 5종 + Σ */}
          <div className="py-1" data-id="sp-designation-params">
            <button
              type="button"
              data-id="sp-designation-params-toggle"
              aria-expanded={!paramsCollapsed}
              className="flex w-full items-center gap-1 text-fine font-semibold text-ink-tertiary"
              onClick={() => {
                const next = !paramsCollapsed;
                setParamsCollapsed(next);
                writeParamsCollapsed(next);
              }}
            >
              <ChevronRight
                size={12}
                strokeWidth={1.5}
                className={`transition-transform duration-150 ${paramsCollapsed ? "" : "rotate-90"}`}
              />
              {t("inspector.parameters")}
              {filledParamCount > 0 && <span className="font-normal">({filledParamCount})</span>}
            </button>
            <AutoHeight className="overflow-hidden">
              {!paramsCollapsed && (
                <div className="ml-2 border-l border-divider pl-2">
          {SP_PARAM_FIELDS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-2 border-t border-divider py-1">
              <span className="shrink-0 text-caption text-ink-secondary">{t(PARAM_LABEL_KEY[key])}</span>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                <ParamInput
                  field={key}
                  dataId={`subprocess-designation-${key}`}
                  className={`${INPUT_CLASS} w-44 shrink-0 text-right disabled:opacity-40`}
                  value={form[key]}
                  disabled={isCostFieldDisabled(key, form.cost_krw, form.cost_usd)}
                  ariaLabel={t(PARAM_LABEL_KEY[key])}
                  placeholder={getPreviewText(key)}
                  onCommit={(next) => setForm((prev) => ({ ...prev, [key]: next }))}
                />
                <button
                  type="button"
                  data-id={`subprocess-designation-sum-${key}`}
                  title={publishedVersionId === null ? t("sp.sumNeedsPublished") : t("sp.sumAllNodes")}
                  aria-label={t("sp.sumAllNodes")}
                  disabled={
                    publishedVersionId === null || summing || isCostFieldDisabled(key, form.cost_krw, form.cost_usd)
                  }
                  className="shrink-0 rounded-sm border border-hairline px-1.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
                  onClick={() => void handleSum(key)}
                >
                  <Sigma size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))}
                </div>
              )}
            </AutoHeight>
          </div>
          {/* I/O & Conditions — 개행 복수 + 항목별 데이터 폼(노드 인스펙터와 동일 편집기) */}
          <div className="py-1" data-id="sp-designation-details">
            <button
              type="button"
              data-id="sp-designation-details-toggle"
              aria-expanded={!detailsCollapsed}
              className="flex w-full items-center gap-1 text-fine font-semibold text-ink-tertiary"
              onClick={() => {
                const next = !detailsCollapsed;
                setDetailsCollapsed(next);
                writeDetailsCollapsed(next);
              }}
            >
              <ChevronRight
                size={12}
                strokeWidth={1.5}
                className={`transition-transform duration-150 ${detailsCollapsed ? "" : "rotate-90"}`}
              />
              {t("inspector.details")}
              {filledDetailCount > 0 && <span className="font-normal">({filledDetailCount})</span>}
            </button>
            <AutoHeight className="overflow-hidden">
              {!detailsCollapsed && (
                <div className="ml-2 border-l border-divider pl-2">
                  <MultiValueInput
                    dataId="subprocess-designation-input"
                    label={t("sp.input")}
                    value={form.input}
                    formsValue={form.input_forms}
                    readOnly={false}
                    onCommit={(joined, formsJoined) =>
                      setForm((prev) => ({ ...prev, input: joined, input_forms: formsJoined ?? "" }))
                    }
                  />
                  <div className="border-t border-divider">
                    <MultiValueInput
                      dataId="subprocess-designation-output"
                      label={t("sp.output")}
                      value={form.output}
                      formsValue={form.output_forms}
                      readOnly={false}
                      onCommit={(joined, formsJoined) =>
                        setForm((prev) => ({ ...prev, output: joined, output_forms: formsJoined ?? "" }))
                      }
                    />
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
    </ModalBackdrop>,
    document.body,
  );
}
