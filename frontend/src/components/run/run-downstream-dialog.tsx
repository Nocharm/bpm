"use client";

// 뒤 단계 함께 취소 확인 — 실행 버튼 줄의 완료 취소가 이미 진행된 뒤 단계에 막힐 때(run-action-bar). 마우스로 열면 확인 버튼이
// 누른 자리에 떠서 두 번 누르기로 끝나고, 키보드로 열면 가운데에 떠 확인 버튼에 포커스가 있어 Enter를 한 번 더 누르면 된다
// (사용자 결정 2026-11-05). 눌러 둔 키의 반복은 막는다 — 완료 취소를 누른 Enter가 이어져 확인까지 가지 않게.

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Undo2 } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { placeRunConfirm } from "@/lib/run-actions";
import { ModalBackdrop } from "@/components/modal-backdrop";

// 이름을 다 늘어놓을 뒤 단계 수 — 넘으면 "외 n개"
const LISTED_STEPS = 6;

interface RunDownstreamDialogProps {
  // 함께 지울 뒤 단계 이름(흐름 순서) — 화면이 셀 수 없었으면(서버 409) 비고 fallbackTitle을 보인다
  titles: string[];
  fallbackTitle: string | null;
  // 이 단계가 하위 맵 기록이 있는 하위프로세스 — 하위 맵 기록도 함께 지워진다고 알린다
  includesSubMap: boolean;
  // 누른 자리(화면 px) — 키보드로 열었으면 null(가운데)
  origin: { x: number; y: number } | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function RunDownstreamDialog({
  titles,
  fallbackTitle,
  includesSubMap,
  origin,
  busy,
  onConfirm,
  onClose,
}: RunDownstreamDialogProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const names = titles.length > 0 ? titles : fallbackTitle !== null ? [fallbackTitle] : [];
  const listed = names.slice(0, LISTED_STEPS);
  const rest = names.length - listed.length;

  // 자리와 포커스 — 그리기 전에 재서 옮긴다(left/top/visibility는 이 이펙트가 단독 소유)
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const confirm = confirmRef.current;
    if (!panel || !confirm) return;
    if (origin !== null) {
      const panelRect = panel.getBoundingClientRect();
      const buttonRect = confirm.getBoundingClientRect();
      const place = placeRunConfirm(
        origin,
        { width: panelRect.width, height: panelRect.height },
        {
          x: buttonRect.left - panelRect.left + buttonRect.width / 2,
          y: buttonRect.top - panelRect.top + buttonRect.height / 2,
        },
        { width: window.innerWidth, height: window.innerHeight },
      );
      panel.style.left = `${place.left}px`;
      panel.style.top = `${place.top}px`;
      panel.style.visibility = "visible";
    }
    confirm.focus({ preventScroll: true });
  }, [origin]);

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className={`fixed inset-0 z-[1200] bg-ink/20 px-4 ${origin === null ? "flex items-center justify-center" : ""}`}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="run-downstream-title"
        data-id="run-downstream-dialog"
        className={`flex w-80 flex-col gap-3 rounded-md border p-4 glass glass-dense ${
          origin !== null ? "invisible fixed left-0 top-0" : ""
        }`}
        onKeyDown={(event) => {
          if (event.repeat) event.preventDefault();
        }}
      >
        <h2 id="run-downstream-title" className="flex items-center gap-2 text-body-strong text-ink">
          <Undo2 size={16} strokeWidth={1.5} className="shrink-0 text-run-problem" />
          {t("run.downstream.title")}
        </h2>
        <p className="text-caption text-ink-secondary">{t("run.downstream.desc")}</p>
        {listed.length > 0 && (
          <ul data-id="run-downstream-steps" className="flex flex-col gap-1 rounded-sm bg-surface-alt px-2.5 py-2">
            {listed.map((name, index) => (
              <li key={`${index}:${name}`} className="truncate text-caption text-ink" title={name}>
                {name || t("run.downstream.untitled")}
              </li>
            ))}
            {rest > 0 && <li className="text-fine text-ink-tertiary">{t("run.downstream.more", { n: rest })}</li>}
          </ul>
        )}
        <p className="text-fine text-ink-tertiary">
          {includesSubMap ? t("run.downstream.subMapNote") : t("run.downstream.note")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="run-downstream-cancel"
            className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("run.downstream.keep")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-id="run-downstream-confirm"
            disabled={busy}
            className="rounded-sm bg-run-problem px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-run-problem/85 disabled:opacity-50"
            onClick={onConfirm}
          >
            {t("run.downstream.confirm")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
