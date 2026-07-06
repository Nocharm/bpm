"use client";

// 서브프로세스 지정 패널 — 오너 전용. 지정/수정 모달(부서 필수) + 해제 확인(사용처 경고·잠금 안내). (spec 2026-07-06)

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Workflow } from "lucide-react";

import {
  deleteSubprocessDesignation,
  getDirectory,
  getMap,
  putSubprocessDesignation,
  type MapDetail,
} from "@/lib/api";
import { BpmAttributePicker } from "@/components/bpm-attribute-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

interface SubprocessDesignationPanelProps {
  mapId: string;
  onToast: (message: string) => void;
}

interface DesignationForm {
  department: string;
  assignee: string;
  system: string;
  duration: string;
}

const INPUT_CLASS =
  "rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:text-ink-tertiary focus:border-accent";

export function SubprocessDesignationPanel({ mapId, onToast }: SubprocessDesignationPanelProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  // login_id → 표시명 — 최근 변경자 이름 우선 표기(디렉터리 해석, 실패 시 id)
  const [names, setNames] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<DesignationForm>({
    department: "",
    assignee: "",
    system: "",
    duration: "",
  });
  const [showUndesignate, setShowUndesignate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMap(Number(mapId))
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
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
  }, [mapId]);

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
    setForm({
      department: detail?.sp_department ?? "",
      assignee: detail?.sp_assignee ?? "",
      system: detail?.sp_system ?? "",
      duration: detail?.sp_duration ?? "",
    });
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await putSubprocessDesignation(Number(mapId), {
        department: form.department.trim(),
        assignee: form.assignee,
        system: form.system,
        duration: form.duration,
      });
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      onToast(t("perm.sp.saved"));
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUndesignate() {
    setSaving(true);
    try {
      const updated = await deleteSubprocessDesignation(Number(mapId));
      setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      onToast(t("perm.sp.removed"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setShowUndesignate(false);
    }
  }

  const attrRows: { label: string; value: string | null | undefined }[] = [
    { label: t("field.department"), value: detail.sp_department },
    { label: t("field.assignee"), value: detail.sp_assignee },
    { label: t("field.system"), value: detail.sp_system },
    { label: t("field.duration"), value: detail.sp_duration },
  ];

  return (
    <div data-id="subprocess-designation-panel" className="flex max-w-xl flex-col gap-3">
      <p className="text-caption text-ink-tertiary">{t("perm.sp.hint")}</p>

      {designated ? (
        <>
          {/* 지정 상태 카드 — 어트리뷰트 요약 + 최근 변경 */}
          <div className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt p-3">
            <div className="mb-1 flex items-center gap-2">
              <Workflow size={16} strokeWidth={1.5} className="text-accent" />
              <span className="rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
                Designated
              </span>
            </div>
            {attrRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2 py-0.5">
                <span className="shrink-0 text-caption text-ink-secondary">{row.label}</span>
                <span className="min-w-0 truncate text-caption text-ink">
                  {row.value || "—"}
                </span>
              </div>
            ))}
            {changedByName && (
              <p className="mt-1 border-t border-divider pt-1.5 text-fine text-ink-tertiary">
                {t("perm.sp.lastChanged")} {changedByName}
                {changedBy && changedByName !== changedBy ? ` (${changedBy})` : ""}
                {detail.sp_changed_at ? ` · ${formatKst(detail.sp_changed_at)}` : ""}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-id="subprocess-designation-edit"
              className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
              onClick={openModal}
              disabled={saving}
            >
              {t("perm.sp.edit")}
            </button>
            <button
              type="button"
              data-id="subprocess-designation-remove"
              className="rounded-sm border border-error/40 px-3 py-1.5 text-caption text-error hover:bg-error/10 disabled:opacity-60"
              onClick={() => setShowUndesignate(true)}
              disabled={saving}
            >
              {t("perm.sp.undesignate")}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <button
              type="button"
              data-id="subprocess-designation-designate"
              className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
              onClick={openModal}
              disabled={!hasPublished || saving}
            >
              {t("perm.sp.designate")}
            </button>
          </div>
          {!hasPublished && (
            <p className="text-fine text-ink-tertiary">{t("perm.sp.requiresPublished")}</p>
          )}
        </div>
      )}

      {/* 지정/수정 모달 — 부서 필수(BPM 피커 재사용), 시스템·소요시간 자유 입력 */}
      {showModal &&
        createPortal(
          <ModalBackdrop
            onClose={() => setShowModal(false)}
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
                  <span className="shrink-0 text-caption text-ink-secondary">
                    {t("field.system")}
                  </span>
                  <input
                    data-id="subprocess-designation-system"
                    className={`${INPUT_CLASS} min-w-0 flex-1 text-right`}
                    maxLength={100}
                    value={form.system}
                    onChange={(e) => setForm((prev) => ({ ...prev, system: e.target.value }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
                  <span className="shrink-0 text-caption text-ink-secondary">
                    {t("field.duration")}
                  </span>
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
                  onClick={() => setShowModal(false)}
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
