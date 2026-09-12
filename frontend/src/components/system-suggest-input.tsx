"use client";

// 시스템 입력 — SuggestInput(관리 목록 자동완성) + 커밋 정규화(commitSystem): 목록 일치=표기 저장, 자유값=Other +
// 원문 메모(system_fallback). 기존 메모가 다른 내용이면 항상 교체/추가/취소 3지 선택을 띄운다 — 행 모드(인스펙터)는
// ModalBackdrop 다이얼로그(z 1300, 인스펙터 위에 떠도 무방), 필드 모드(타일 팝오버, z 1350)는 다이얼로그가 팝오버
// 아래로 숨으므로 입력 아래 인라인 줄로 대신한다 (design 2026-09-12).
// 인스펙터 시스템 행·노드 편집 모달·SP 지정 모달 시스템 팝오버가 공유.

import { useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { SuggestInput } from "@/components/suggest-input";
import { appendSystemNote, commitSystem, OTHER_SYSTEM, useCatalogs } from "@/lib/catalogs";
import { useI18n } from "@/lib/i18n";

interface SystemSuggestInputProps {
  system: string;
  systemFallback: string;
  mode: "row" | "field";
  dataId: string;
  autoFocus?: boolean;
  onCommit: (patch: { system: string; system_fallback: string }, keptNote: boolean) => void;
}

// 행 모드 전용 — 인스펙터 위에 뜨는 확인 다이얼로그(ConfirmDialog와 같은 ModalBackdrop 포털 패턴)
function SystemNoteChoiceDialog({
  value, onReplace, onAppend, onCancel,
}: {
  value: string;
  onReplace: () => void;
  onAppend: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return createPortal(
    <ModalBackdrop
      onClose={onCancel}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="system-note-choice"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{t("catalog.systemNoteChoiceTitle")}</h2>
          <p className="text-caption text-ink-secondary">{t("catalog.systemNoteChoiceBody", { value })}</p>
        </div>
        <div className="flex w-full justify-end gap-2">
          <button
            type="button"
            data-id="system-note-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onCancel}
          >
            {t("catalog.systemNoteCancel")}
          </button>
          <button
            type="button"
            data-id="system-note-append"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onAppend}
          >
            {t("catalog.systemNoteAppend")}
          </button>
          <button
            type="button"
            data-id="system-note-replace"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
            onClick={onReplace}
          >
            {t("catalog.systemNoteReplace")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}

// 필드 모드 전용 — 팝오버(z 1350) 안이라 다이얼로그가 가려지므로 입력 아래 인라인 줄로 같은 3택을 준다
function SystemNoteChoiceInline({
  value, onReplace, onAppend, onCancel,
}: {
  value: string;
  onReplace: () => void;
  onAppend: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-id="system-note-choice"
      className="flex items-center gap-1.5 rounded-sm border border-accent-tint-border bg-accent-tint/40 px-2 py-1 text-fine text-ink-secondary"
    >
      <span className="min-w-0 flex-1">{t("catalog.systemNoteChoiceBody", { value })}</span>
      <button
        type="button"
        data-id="system-note-cancel"
        className="shrink-0 rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink hover:bg-surface-alt"
        onClick={onCancel}
      >
        {t("catalog.systemNoteCancel")}
      </button>
      <button
        type="button"
        data-id="system-note-append"
        className="shrink-0 rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink hover:bg-surface-alt"
        onClick={onAppend}
      >
        {t("catalog.systemNoteAppend")}
      </button>
      <button
        type="button"
        data-id="system-note-replace"
        className="shrink-0 rounded-xs bg-accent px-1.5 py-0.5 text-fine text-on-accent hover:bg-accent-focus"
        onClick={onReplace}
      >
        {t("catalog.systemNoteReplace")}
      </button>
    </div>
  );
}

export function SystemSuggestInput({
  system, systemFallback, mode, dataId, autoFocus, onCommit,
}: SystemSuggestInputProps) {
  const { t } = useI18n();
  const { systems } = useCatalogs();
  // 원문 메모 교체/추가/취소 선택 대기 중인 자유입력값(trim 완료)
  const [pending, setPending] = useState<{ raw: string } | null>(null);

  const handleCommit = (raw: string) => {
    const result = commitSystem(raw, systems, systemFallback);
    if (result.keptNote) {
      setPending({ raw: raw.trim() });
      return;
    }
    onCommit({ system: result.system, system_fallback: result.system_fallback }, false);
  };

  const handleReplace = () => {
    if (pending === null) return;
    onCommit({ system: OTHER_SYSTEM, system_fallback: pending.raw }, false);
    setPending(null);
  };
  const handleAppend = () => {
    if (pending === null) return;
    onCommit({ system: OTHER_SYSTEM, system_fallback: appendSystemNote(systemFallback, pending.raw) }, false);
    setPending(null);
  };
  // 취소 — onCommit 호출 없이 대기만 해제. SuggestInput 값은 그대로라 resyncPending으로 원래 값으로 되돌아간다
  const handleCancel = () => setPending(null);

  return (
    <>
      <SuggestInput
        mode={mode}
        dataId={dataId}
        value={system}
        options={systems}
        maxLength={100}
        autoFocus={autoFocus}
        placeholder={t("catalog.systemPlaceholder")}
        ariaLabel={t("field.system")}
        onCommit={handleCommit}
      />
      {pending !== null && mode === "row" && (
        <SystemNoteChoiceDialog
          value={pending.raw}
          onReplace={handleReplace}
          onAppend={handleAppend}
          onCancel={handleCancel}
        />
      )}
      {pending !== null && mode === "field" && (
        <SystemNoteChoiceInline
          value={pending.raw}
          onReplace={handleReplace}
          onAppend={handleAppend}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}
