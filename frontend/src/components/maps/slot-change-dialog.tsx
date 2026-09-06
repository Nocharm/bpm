"use client";

// 슬롯 변경 확인 다이얼로그 — dry_run 결과로 두 모드(관리자 즉시 적용 / L5 승인 요청)를 보여주는 공용 컴포넌트.
// framework-assign-modal이 쓰고, 삭제·복사의 슬롯 이관 흐름도 재사용한다 (spec 2026-09-06 §4.1·§7.2).
import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Clock, FolderTree, Link2, Network, ShieldCheck, Workflow, X } from "lucide-react";

import { postSlotChange, type SlotChangeIn, type SlotChangeOut } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { SLOT_ACTION_KEY } from "@/lib/framework-slot-state";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { UserPill } from "@/components/user-pill";
import { useI18n } from "@/lib/i18n";

interface Props {
  mapId: number;
  body: SlotChangeIn;
  preview: SlotChangeOut;
  onDone: (result: SlotChangeOut) => void;
  onClose: () => void;
}

export function SlotChangeDialog({ mapId, body, preview, onDone, onClose }: Props) {
  const { t } = useI18n();
  const [note, setNote] = useState(body.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selfApply = preview.self_apply;
  const danger = body.action === "unassign" || body.action === "delete";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onDone(await postSlotChange(mapId, { ...body, note, dry_run: false }));
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setBusy(false);
    }
  }

  // 단일 닫기 경로 — X·백드롭 mousedown·Esc(ModalBackdrop 내부) 전부 여기로 모은다.
  // busy 중 닫으면 늦게 도착하는 성공이 stale onDone(부모 모달까지 닫힘)을, 실패가 언마운트 후 setError를 부른다(리뷰 라운드1 #1).
  function handleClose() {
    if (busy) return;
    onClose();
  }

  return createPortal(
    <ModalBackdrop
      onClose={handleClose}
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="slot-change-dialog"
        className="summary-card-in flex w-full max-w-md flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                danger ? "bg-error/10 text-error" : "bg-accent-tint text-accent"
              }`}
            >
              {selfApply ? <ShieldCheck size={18} strokeWidth={1.5} /> : <ArrowLeftRight size={18} strokeWidth={1.5} />}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-body-strong text-ink">{t(SLOT_ACTION_KEY[body.action])}</h2>
              <span
                className={`inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-fine font-semibold ${
                  selfApply ? "bg-added/10 text-added" : "bg-changed/10 text-changed"
                }`}
              >
                {selfApply ? <ShieldCheck size={12} strokeWidth={1.5} /> : <Clock size={12} strokeWidth={1.5} />}
                {selfApply ? t("slot.modeApplies") : t("slot.modeNeedsApproval")}
              </span>
              <p className="text-fine text-ink-tertiary">{selfApply ? t("slot.selfApplyDesc") : t("slot.requestDesc")}</p>
            </div>
          </div>
          <button
            type="button"
            data-id="slot-change-close"
            aria-label={t("summary.close")}
            className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={handleClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-1 text-fine text-ink-secondary">
            <Workflow size={12} strokeWidth={1.5} className="text-ink-tertiary" />
            <span className="font-semibold text-ink">{preview.impact.home_canvas_nodes}</span>
            {t("slot.impact.home")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-1 text-fine text-ink-secondary">
            <Network size={12} strokeWidth={1.5} className="text-ink-tertiary" />
            <span className="font-semibold text-ink">{preview.impact.other_canvas_nodes}</span>
            {t("slot.impact.other")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-1 text-fine text-ink-secondary">
            <Link2 size={12} strokeWidth={1.5} className="text-ink-tertiary" />
            <span className="font-semibold text-ink">{preview.impact.referencing_maps}</span>
            {t("slot.impact.refs")}
          </span>
        </div>

        <ul className="flex flex-col gap-1.5">
          {preview.sides.map((side) => (
            <li
              key={side.category_id}
              className="flex flex-wrap items-center gap-1.5 rounded-sm border border-hairline bg-surface-alt px-2.5 py-1.5"
            >
              <FolderTree size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span
                className="min-w-0 flex-1 truncate text-fine text-ink-secondary"
                title={side.path ?? String(side.category_id)}
              >
                {side.path ?? side.category_id}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {side.approvers.length === 0 ? (
                  <span className="rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary">
                    {t("slot.noApprovers")}
                  </span>
                ) : (
                  side.approvers.map((login) => <UserPill key={login} loginId={login} />)
                )}
              </div>
            </li>
          ))}
        </ul>

        {!selfApply && (
          <label className="flex flex-col gap-1">
            <span className="text-fine text-ink-tertiary">{t("slot.noteLabel")}</span>
            <textarea
              data-id="slot-change-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("slot.notePlaceholder")}
              rows={2}
              disabled={busy}
              className="w-full resize-none rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink disabled:opacity-40"
            />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" data-id="slot-change-cancel" disabled={busy} className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40" onClick={handleClose}>
            {t("summary.cancel")}
          </button>
          <button
            type="button"
            data-id="slot-change-submit"
            disabled={busy}
            className={`rounded-sm px-3 py-1.5 text-caption text-on-accent disabled:opacity-40 ${
              danger ? "bg-error hover:opacity-90" : "bg-accent hover:bg-accent-focus"
            }`}
            onClick={() => void submit()}
          >
            {selfApply ? t("slot.applyNow") : t("slot.request")}
          </button>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
