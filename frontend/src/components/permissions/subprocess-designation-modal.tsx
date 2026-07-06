"use client";

// 서브프로세스 지정/수정 모달 — 부서 필수(BPM 피커 재사용), 시스템·소요시간 자유 입력.
// 설정 화면 패널과 에디터 인스펙터 카드가 공용으로 사용한다.

import { useState } from "react";
import { createPortal } from "react-dom";

import { putSubprocessDesignation, type MapSummary } from "@/lib/api";
import { BpmAttributePicker } from "@/components/bpm-attribute-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { useI18n } from "@/lib/i18n";

export interface DesignationForm {
  department: string;
  assignee: string;
  system: string;
  duration: string;
}

interface SubprocessDesignationModalProps {
  mapId: number;
  publishedVersionId: number | null; // BPM 피커 후보 스코프
  initial: DesignationForm;
  onSaved: (updated: MapSummary) => void;
  onClose: () => void;
}

const INPUT_CLASS =
  "rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:text-ink-tertiary focus:border-accent";

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

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await putSubprocessDesignation(mapId, {
        department: form.department.trim(),
        assignee: form.assignee,
        system: form.system,
        duration: form.duration,
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
          <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
            <span className="shrink-0 text-caption text-ink-secondary">{t("field.duration")}</span>
            <input
              data-id="subprocess-designation-duration"
              className={`${INPUT_CLASS} min-w-0 flex-1 text-right`}
              maxLength={50}
              value={form.duration}
              onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))}
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
            disabled={!form.department.trim() || saving}
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
