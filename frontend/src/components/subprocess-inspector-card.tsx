"use client";

// 인스펙터 서브프로세스 카드 — 지정 상태 표시 + 지정/수정/해제.
// 지정은 다른 맵이 이 맵을 서브프로세스 노드로 연결(임베드)하기 위한 절차 — 노트로 안내.
// 변경은 게시된 버전이 열린 상태에서 오너·관리자만 가능(비활성 시 사유 노트 표시).

import { Info, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

import { deleteSubprocessDesignation, getMap, type MapDetail } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  SubprocessDesignationModal,
  type DesignationForm,
} from "@/components/permissions/subprocess-designation-modal";
import { formatDurationHm, formatThousands } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";

interface SubprocessInspectorCardProps {
  mapId: number;
  canManage: boolean; // 게시 버전 열림 && (오너 || sysadmin)
  disabledReason: string | null; // canManage=false일 때 비활성 사유(i18n 처리된 문자열)
  onToast?: (message: string) => void;
  // 지정/해제 성공 후 — page.tsx가 usage를 재조회해 Subprocess 탭 노출을 동기화
  onDesignationChange?: () => void;
}

export function SubprocessInspectorCard({
  mapId,
  canManage,
  disabledReason,
  onToast,
  onDesignationChange,
}: SubprocessInspectorCardProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<MapDetail | null>(null);
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
    description: "",
  });
  const [showUndesignate, setShowUndesignate] = useState(false);
  const [saving, setSaving] = useState(false);

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

  if (!detail) return null;

  const designated = detail.sp_designated_at != null;
  const publishedVersionId = detail.versions
    .filter((version) => version.status === "published")
    .reduce<number | null>((max, version) => (max === null || version.id > max ? version.id : max), null);

  const openModal = () => {
    setModalInitial({
      department: detail.sp_department ?? "",
      assignee: detail.sp_assignee ?? "",
      system: detail.sp_system ?? "",
      duration: detail.sp_duration ?? "",
      cost_krw: detail.sp_cost_krw ?? "",
      cost_usd: detail.sp_cost_usd ?? "",
      headcount: detail.sp_headcount ?? "",
      url: detail.sp_url ?? "",
      urlLabel: detail.sp_url_label ?? "",
      description: detail.sp_description ?? "",
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
      onToast?.(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setShowUndesignate(false);
    }
  };

  // 캔버스 노드 칩과 동일 표시형(₩/$ + 천단위 콤마) — process-node.tsx 컨벤션과 정합
  const formatCost = (raw: string | null | undefined, symbol: string): string => {
    const n = formatThousands(raw ?? "");
    return n ? `${symbol}${n}` : "";
  };

  const attrRows: { label: string; value: string | null | undefined }[] = [
    { label: t("field.department"), value: detail.sp_department },
    { label: t("field.assignee"), value: detail.sp_assignee },
    { label: t("field.system"), value: detail.sp_system },
    { label: t("field.duration"), value: formatDurationHm(detail.sp_duration ?? "") },
    { label: t("field.costKrw"), value: formatCost(detail.sp_cost_krw, "₩") },
    { label: t("field.costUsd"), value: formatCost(detail.sp_cost_usd, "$") },
    { label: t("field.headcount"), value: detail.sp_headcount },
    ...(detail.sp_description ? [{ label: t("field.description"), value: detail.sp_description }] : []),
  ];

  return (
    <section data-id="sp-inspector-card" className="rounded-md border border-hairline bg-surface-alt/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-fine font-semibold text-ink-tertiary">
          <Workflow size={14} strokeWidth={1.5} className="text-accent" />
          {t("inspector.spTitle")}
        </span>
        {/* 지정 상태 뱃지 — 영어 고정(승인상태 뱃지 규칙과 동일) */}
        {designated ? (
          <span className="rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
            Designated
          </span>
        ) : (
          <span className="rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary">
            Not designated
          </span>
        )}
      </div>

      {designated && (
        <div className="mb-2 flex flex-col">
          {attrRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 py-0.5">
              <span className="shrink-0 text-fine text-ink-secondary">{row.label}</span>
              <span className="min-w-0 truncate text-fine text-ink">{row.value || "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* 연결 절차 노트 — 한 줄 요약, 전체 설명은 툴팁 (batch2 ⑤) */}
      <p
        title={t("inspector.spNoteFull")}
        className="mb-2 flex items-start gap-1.5 rounded-sm bg-surface px-2 py-1.5 text-fine leading-snug text-ink-tertiary"
      >
        <Info size={12} strokeWidth={1.6} className="mt-px shrink-0" />
        {t("inspector.spNote")}
      </p>

      <div className="flex gap-1.5">
        {designated ? (
          <>
            <button
              type="button"
              data-id="sp-inspector-edit"
              className="rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
              onClick={openModal}
              disabled={!canManage || saving}
            >
              {t("perm.sp.edit")}
            </button>
            <button
              type="button"
              data-id="sp-inspector-remove"
              className="rounded-sm border border-error/40 px-2.5 py-1 text-fine text-error hover:bg-error/10 disabled:opacity-40"
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
            className="rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={openModal}
            disabled={!canManage || saving}
          >
            {t("perm.sp.designate")}
          </button>
        )}
      </div>

      {/* 비활성 사유 — 버튼은 항상 표시하되 왜 안 되는지 노트로 안내 */}
      {!canManage && disabledReason && (
        <p data-id="sp-inspector-reason" className="mt-1.5 text-fine text-ink-tertiary">
          {disabledReason}
        </p>
      )}

      {showModal && (
        <SubprocessDesignationModal
          mapId={mapId}
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
