"use client";

// 서브프로세스 지정 패널 — 오너 전용. 지정/수정 모달(부서 필수) + 해제 확인(사용처 경고·잠금 안내). (spec 2026-07-06)

import { useEffect, useState } from "react";
import { Workflow } from "lucide-react";

import {
  deleteSubprocessDesignation,
  getDirectory,
  getMap,
  type MapDetail,
} from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  SubprocessDesignationModal,
  type DesignationForm,
} from "@/components/permissions/subprocess-designation-modal";
import { formatKst } from "@/lib/datetime";
import { formatDurationHm } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";

interface SubprocessDesignationPanelProps {
  mapId: string;
  onToast: (message: string) => void;
}

export function SubprocessDesignationPanel({ mapId, onToast }: SubprocessDesignationPanelProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
  // login_id → 표시명 — 최근 변경자 이름 우선 표기(디렉터리 해석, 실패 시 id)
  const [names, setNames] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);
  const [modalInitial, setModalInitial] = useState<DesignationForm>({
    department: "",
    assignee: "",
    system: "",
    duration: "",
    cost_krw: "",
    cost_usd: "",
    headcount: "",
    url: "",
    urlLabel: "",
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
    setModalInitial({
      department: detail?.sp_department ?? "",
      assignee: detail?.sp_assignee ?? "",
      system: detail?.sp_system ?? "",
      duration: detail?.sp_duration ?? "",
      cost_krw: detail?.sp_cost_krw ?? "",
      cost_usd: detail?.sp_cost_usd ?? "",
      headcount: detail?.sp_headcount ?? "",
      url: detail?.sp_url ?? "",
      urlLabel: detail?.sp_url_label ?? "",
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
    { label: t("field.duration"), value: formatDurationHm(detail.sp_duration ?? "") },
    { label: t("field.costKrw"), value: detail.sp_cost_krw },
    { label: t("field.costUsd"), value: detail.sp_cost_usd },
    { label: t("field.headcount"), value: detail.sp_headcount },
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

      {/* 지정/수정 모달 — 공용 컴포넌트(에디터 인스펙터 카드와 공유) */}
      {showModal && (
        <SubprocessDesignationModal
          mapId={Number(mapId)}
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
