// 고아 참조 상세 창 — 카드 하나를 대체·제거(대상 피커·모드)하고, 줄 판정을 미리보기로 갱신해 확인 뒤 적용한다. 고아 참조 페이지가 카드를 누르면 연다.
"use client";

import { ArrowLeftRight, ArrowRight, Building2, RefreshCw, Trash2, UserX, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { RefDetailLines } from "@/components/ref-audit/ref-detail-lines";
import { RefDetailTarget, type RefTargetChoice } from "@/components/ref-audit/ref-detail-target";
import { RefOutcomeChip } from "@/components/ref-audit/ref-outcome-chip";
import { Tooltip } from "@/components/tooltip";
import { postRefApply, postRefPreview, type RefApplyResult, type RefCard, type RefPreviewLine } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { OUTCOME_META } from "@/lib/ref-audit";
import {
  buildApplyBatches,
  buildPreviewBatches,
  canApplySelection,
  canRemoveCard,
  getApplyButton,
  getCheckedKeys,
  getDialogMeta,
  getForecast,
  getUserCardView,
  mergePreview,
  shouldWarnOpenEditor,
  type RefMode,
} from "@/lib/ref-audit-view";

interface RefDetailDialogProps {
  card: RefCard;
  onClose: () => void;
  // 적용 묶음마다의 결과 - 페이지가 토스트·재조회를 맡는다. isPartial=뒤 묶음이 실패해 창을 열어 둔 채 앞 결과만 알리는 경우
  onApplied: (results: RefApplyResult[], isPartial?: boolean) => void;
}

// 미리보기 응답이 어느 (모드, 대상) 조합의 것인지 — 지금 조합과 같을 때만 줄에 덮는다
function getPreviewKey(mode: RefMode, toValue: string): string {
  return `${mode}|${toValue}`;
}

export function RefDetailDialog({ card, onClose, onApplied }: RefDetailDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<RefMode>("replace");
  const [target, setTarget] = useState<RefTargetChoice | null>(null);
  // 해제한 줄만 기억한다 — 체크할 수 있는 줄은 기본으로 체크되고, 미리보기로 판정이 바뀌어도 해제는 남는다
  const [uncheckedKeys, setUncheckedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [preview, setPreview] = useState<{ key: string; lines: RefPreviewLine[] } | null>(null);
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isPreviewFailed, setIsPreviewFailed] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  // 마지막 미리보기 요청 번호 — 늦게 도착한 앞 요청의 응답은 버린다(디바운스 없이 마지막 요청만 반영)
  const previewSeqRef = useRef(0);

  const toValue = target?.value ?? "";
  const previewKey = getPreviewKey(mode, toValue);
  // 대상을 고르기 전(또는 응답 전)에는 스캔 판정을 그대로 쓴다
  const lines = preview?.key === previewKey ? mergePreview(card.lines, preview.lines) : card.lines;
  const isPreviewing = previewingKey === previewKey;
  const checkedKeys = getCheckedKeys(lines, mode, uncheckedKeys);
  const forecast = getForecast(lines, mode, checkedKeys);
  const meta = getDialogMeta(card);
  const applyButton = getApplyButton(mode);
  const isRemove = mode === "remove";
  const canRemove = canRemoveCard(card);
  const canApply = canApplySelection({
    total: forecast.total,
    mode,
    toValue,
    isPreviewCurrent: preview?.key === previewKey,
    isPreviewing,
    isApplying,
  });

  const metaParts = [
    card.sub || (card.kind === "user" ? t("refAudit.nameOnly") : ""),
    meta.maps > 0 ? t("refAudit.dlg.maps", { n: meta.maps }) : "",
    t("refAudit.dlg.places", { n: meta.places }),
  ].filter(Boolean);

  function requestPreview(nextMode: RefMode, nextValue: string) {
    previewSeqRef.current += 1;
    const seq = previewSeqRef.current;
    const key = getPreviewKey(nextMode, nextValue);
    const bodies = buildPreviewBatches(card.kind, card.lines, nextMode, nextValue);
    setError("");
    setIsPreviewFailed(false);
    if (bodies.length === 0) {
      setPreviewingKey(null);
      return;
    }
    setPreviewingKey(key);
    Promise.all(bodies.map((body) => postRefPreview(body)))
      .then((responses) => {
        if (seq !== previewSeqRef.current) return;
        setPreview({ key, lines: responses.flatMap((response) => response.lines) });
        setPreviewingKey(null);
      })
      .catch((err: unknown) => {
        if (seq !== previewSeqRef.current) return;
        setError(humanizeApiError(err, t));
        setIsPreviewFailed(true);
        setPreviewingKey(null);
      });
  }

  function handleModeChange(next: RefMode) {
    if (next === mode) return;
    setMode(next);
    requestPreview(next, toValue);
  }

  function handlePick(choice: RefTargetChoice) {
    setTarget(choice);
    requestPreview(mode, choice.value);
  }

  function handleClearTarget() {
    setTarget(null);
    requestPreview(mode, "");
  }

  function handleToggle(key: string) {
    setUncheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleClose() {
    if (!isApplying) onClose();
  }

  async function handleConfirm() {
    setIsApplying(true);
    setError("");
    const results: RefApplyResult[] = [];
    try {
      // 묶음은 차례로 — 같은 맵의 다음 묶음이 앞 묶음이 만든 Draft를 다시 쓰게 한다
      for (const body of buildApplyBatches(card.kind, lines, checkedKeys, mode, toValue)) {
        results.push(await postRefApply(body));
      }
    } catch (err) {
      setError(humanizeApiError(err, t));
      setIsApplying(false);
      setIsConfirming(false);
      // 앞 묶음은 이미 반영됐다 - 토스트·재조회·빨간 점을 갱신하고 창은 열어 둔 채 오류를 보인다
      if (results.length > 0) onApplied(results, true);
      return;
    }
    onApplied(results);
  }

  const confirmLines: ConfirmLine[] = [...forecast.outcomes].map(([outcome, count]) => {
    const { icon: Icon, labelKey } = OUTCOME_META[outcome];
    return { icon: <Icon size={14} strokeWidth={1.5} />, text: `${t(labelKey)} ${count}` };
  });
  if (shouldWarnOpenEditor(lines, checkedKeys)) {
    confirmLines.push({ icon: <RefreshCw size={14} strokeWidth={1.5} />, text: t("refAudit.confirm.reloadEditor"), tone: "accent" });
  }

  const removeButton = (
    <button
      type="button"
      data-id="ref-detail-mode-remove"
      aria-pressed={isRemove}
      disabled={!canRemove}
      onClick={() => handleModeChange("remove")}
      className={`inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 text-caption disabled:cursor-not-allowed disabled:text-ink-muted disabled:line-through ${isRemove ? "bg-error/10 text-error" : "text-ink-secondary hover:bg-surface-alt"}`}
    >
      <Trash2 size={14} strokeWidth={1.5} aria-hidden />
      {t("refAudit.act.remove")}
    </button>
  );

  return createPortal(
    <ModalBackdrop
      onClose={handleClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("refAudit.dlg.label", { name: card.label })}
        data-id="ref-detail-dialog"
        className="window-open flex max-h-[min(88vh,860px)] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border glass glass-dense"
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          {card.kind === "dept" ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-sm border border-dashed border-warn/40 bg-warn/10 text-warn">
              <Building2 size={18} strokeWidth={1.5} aria-hidden />
            </span>
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-ink-muted bg-surface-alt text-body-strong text-ink-tertiary">
              {getUserCardView(card).initial}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="truncate text-body-strong text-ink">{card.label}</h2>
            <span data-id="ref-detail-meta" className="truncate text-fine text-ink-tertiary">
              {metaParts.join(" · ")}
            </span>
          </div>
          <button
            type="button"
            data-id="ref-detail-close"
            aria-label={t("action.close")}
            onClick={handleClose}
            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-y border-divider bg-surface-pearl px-5 py-3">
          <span
            data-id="ref-detail-from"
            className={`inline-flex h-[34px] min-w-0 max-w-full items-center gap-1.5 rounded-sm border border-dashed border-warn bg-warn/10 px-3 text-caption-strong text-warn ${isRemove ? "line-through decoration-2" : ""}`}
          >
            {card.kind === "dept" ? (
              <Building2 size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
            ) : (
              <UserX size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
            )}
            <span className="truncate">{card.label}</span>
          </span>
          <ArrowRight size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />
          {isRemove ? (
            <span
              data-id="ref-detail-erase"
              className="inline-flex h-[34px] items-center gap-1.5 rounded-sm border border-error/30 bg-error/10 px-3 text-caption text-error"
            >
              <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              {t("refAudit.dlg.erase")}
            </span>
          ) : (
            <RefDetailTarget kind={card.kind} target={target} onPick={handlePick} onClear={handleClearTarget} />
          )}
          <span className="ml-auto inline-flex gap-0.5 rounded-sm border border-hairline bg-surface p-0.5">
            <button
              type="button"
              data-id="ref-detail-mode-replace"
              aria-pressed={!isRemove}
              onClick={() => handleModeChange("replace")}
              className={`inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 text-caption ${isRemove ? "text-ink-secondary hover:bg-surface-alt" : "bg-accent-tint text-accent"}`}
            >
              <ArrowLeftRight size={14} strokeWidth={1.5} aria-hidden />
              {t("refAudit.act.replace")}
            </button>
            {canRemove ? removeButton : <Tooltip label={t("refAudit.deptReplaceOnly")}>{removeButton}</Tooltip>}
          </span>
        </div>

        <RefDetailLines lines={lines} mode={mode} checkedKeys={checkedKeys} onToggle={handleToggle} />

        {error ? (
          <div
            data-id="ref-detail-error"
            role="alert"
            className="mx-5 mb-2 flex items-center gap-2 rounded-sm border border-error/30 bg-error/5 px-3 py-2 text-fine text-error"
          >
            <p className="min-w-0 flex-1">{error}</p>
            {isPreviewFailed ? (
              <button
                type="button"
                data-id="ref-detail-retry"
                onClick={() => requestPreview(mode, toValue)}
                className="shrink-0 rounded-sm border border-error/30 px-2 py-0.5 text-fine text-error hover:bg-error/10"
              >
                {t("refAudit.dlg.retry")}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5 border-t border-divider bg-surface px-5 pb-4 pt-3">
          <div
            data-id="ref-detail-forecast"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-fine text-ink-tertiary"
          >
            <span className="mr-0.5">{t("refAudit.dlg.forecast")}</span>
            {isPreviewing ? (
              <span>{t("refAudit.dlg.previewing")}</span>
            ) : forecast.total > 0 ? (
              [...forecast.outcomes].map(([outcome, count]) => (
                <RefOutcomeChip key={outcome} outcome={outcome} count={count} />
              ))
            ) : (
              <span>{t("refAudit.dlg.noneChecked")}</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-id="ref-detail-cancel"
              onClick={handleClose}
              className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              data-id="ref-detail-apply"
              disabled={!canApply}
              onClick={() => setIsConfirming(true)}
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-caption text-on-accent disabled:opacity-40 ${applyButton.tone === "error" ? "bg-error hover:opacity-90" : "bg-accent hover:bg-accent-focus"}`}
            >
              {isRemove ? (
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              ) : (
                <ArrowLeftRight size={14} strokeWidth={1.5} aria-hidden />
              )}
              {t(applyButton.labelKey, { n: forecast.total })}
            </button>
          </div>
        </div>
      </div>

      {isConfirming ? (
        <ConfirmDialog
          dialogId="ref-detail-confirm"
          title={t(isRemove ? "refAudit.confirm.removeTitle" : "refAudit.confirm.replaceTitle", { from: card.label })}
          message={
            isRemove
              ? t("refAudit.confirm.removeMsg", { from: card.label, n: forecast.total })
              : t("refAudit.confirm.replaceMsg", { from: card.label, to: target?.label ?? "", n: forecast.total })
          }
          lines={confirmLines}
          confirmLabel={t(isRemove ? "refAudit.act.remove" : "refAudit.act.replace")}
          cancelLabel={t("common.cancel")}
          danger={isRemove}
          confirmDisabled={isApplying}
          onConfirm={() => void handleConfirm()}
          onClose={() => {
            if (!isApplying) setIsConfirming(false);
          }}
        />
      ) : null}
    </ModalBackdrop>,
    document.body,
  );
}
