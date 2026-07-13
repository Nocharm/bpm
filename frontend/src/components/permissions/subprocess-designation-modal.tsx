"use client";

// 서브프로세스 지정/수정 모달 — 부서 필수(BPM 피커 재사용), 시스템 자유 입력 + SP 파라미터 4종(Σ 합산 지원).
// 설정 화면 패널과 에디터 인스펙터 카드가 공용으로 사용한다.

import { Sigma } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getGraph, putSubprocessDesignation, type Graph, type MapSummary } from "@/lib/api";
import { BpmAttributePicker } from "@/components/bpm-attribute-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { ParamInput } from "@/components/param-input";
import { useI18n } from "@/lib/i18n";
import { isCostFieldDisabled, PARAM_LABEL_KEY, SP_PARAM_FIELDS, type SpParamField } from "@/lib/params";
import { formatSumPreview, sumParamField } from "@/lib/param-sum";
import { isHttpUrl } from "@/lib/url";

export interface DesignationForm {
  department: string;
  assignee: string;
  system: string;
  duration: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  url: string;
  urlLabel: string;
}

interface SubprocessDesignationModalProps {
  mapId: number;
  publishedVersionId: number | null; // BPM 피커 후보 스코프
  initial: DesignationForm;
  onSaved: (updated: MapSummary) => void;
  onClose: () => void;
}

const INPUT_CLASS =
  "rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

export function SubprocessDesignationModal({
  mapId,
  publishedVersionId,
  initial,
  onSaved,
  onClose,
}: SubprocessDesignationModalProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<DesignationForm>(initial);
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
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [publishedVersionId]);

  // placeholder는 표시 전용(저장 안 됨) — 값이 이미 있으면 HTML 기본 동작으로 자동 숨김
  function previewText(field: SpParamField): string | undefined {
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
      setError(err instanceof Error ? err.message : String(err));
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
        cost_krw: form.cost_krw,
        cost_usd: form.cost_usd,
        headcount: form.headcount,
        url: form.url.trim(),
        url_label: form.urlLabel.trim(),
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="subprocess-designation-modal"
        className="flex w-full max-w-sm flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
      >
        <h2 className="text-body-strong text-ink">{t("perm.sp.designate")}</h2>
        <p className="text-caption text-ink-tertiary">{t("perm.sp.modalHint")}</p>
        <div className="flex flex-col">
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
              className={`${INPUT_CLASS} min-w-0 flex-1 text-right`}
              maxLength={100}
              value={form.system}
              onChange={(e) => setForm((prev) => ({ ...prev, system: e.target.value }))}
            />
          </div>
          {SP_PARAM_FIELDS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-2 border-t border-divider py-1">
              <span className="shrink-0 text-caption text-ink-secondary">{t(PARAM_LABEL_KEY[key])}</span>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                <ParamInput
                  field={key}
                  dataId={`subprocess-designation-${key}`}
                  className={`${INPUT_CLASS} min-w-0 flex-1 text-right disabled:opacity-40`}
                  value={form[key]}
                  disabled={isCostFieldDisabled(key, form.cost_krw, form.cost_usd)}
                  ariaLabel={t(PARAM_LABEL_KEY[key])}
                  placeholder={previewText(key)}
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
          <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
            <span className="shrink-0 text-caption text-ink-secondary">{t("field.url")}</span>
            <input
              data-id="subprocess-designation-url"
              className={`${INPUT_CLASS} min-w-0 flex-1 text-right`}
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
              className={`${INPUT_CLASS} min-w-0 flex-1 text-right disabled:opacity-40`}
              maxLength={100}
              value={form.urlLabel}
              disabled={form.url.trim() === ""}
              onChange={(e) => setForm((prev) => ({ ...prev, urlLabel: e.target.value }))}
            />
          </div>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
        <div className="flex justify-end gap-2">
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
