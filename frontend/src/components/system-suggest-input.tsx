"use client";

// 시스템 입력 — SuggestInput(관리 목록 자동완성) + 커밋 정규화(commitSystem): 목록 일치=표기 저장, 자유값=Other +
// 원문 메모(system_fallback). 기존 메모가 다른 내용이면 confirmReplace 표면(인스펙터 행)은 ConfirmDialog로
// 교체/유지를 묻고, 타일 팝오버(메모 칸이 같이 보임)는 keptNote만 알려 안내문을 띄운다 (design 2026-09-11 §4.2).
// 인스펙터 시스템 행·노드 편집 모달·SP 지정 모달 시스템 팝오버가 공유.

import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SuggestInput } from "@/components/suggest-input";
import { commitSystem, OTHER_SYSTEM, useCatalogs } from "@/lib/catalogs";
import { useI18n } from "@/lib/i18n";

interface SystemSuggestInputProps {
  system: string;
  systemFallback: string;
  mode: "row" | "field";
  dataId: string;
  // true면 기존 원문 메모가 다를 때 교체 확인 다이얼로그(인스펙터 행). false면 keptNote로만 알린다(팝오버)
  confirmReplace?: boolean;
  autoFocus?: boolean;
  onCommit: (patch: { system: string; system_fallback: string }, keptNote: boolean) => void;
}

export function SystemSuggestInput({
  system, systemFallback, mode, dataId, confirmReplace = false, autoFocus, onCommit,
}: SystemSuggestInputProps) {
  const { t } = useI18n();
  const { systems } = useCatalogs();
  // 원문 메모 교체 확인 대기 중인 입력값
  const [pending, setPending] = useState<string | null>(null);

  const handleCommit = (raw: string) => {
    const result = commitSystem(raw, systems, systemFallback);
    if (result.keptNote && confirmReplace) {
      setPending(raw.trim());
      return;
    }
    onCommit({ system: result.system, system_fallback: result.system_fallback }, result.keptNote);
  };

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
      {pending !== null && (
        <ConfirmDialog
          title={t("catalog.systemReplaceNoteTitle")}
          message={t("catalog.systemReplaceNoteBody", { value: pending })}
          confirmLabel={t("catalog.systemReplaceNoteConfirm")}
          cancelLabel={t("catalog.systemKeepNote")}
          onConfirm={() => {
            onCommit({ system: OTHER_SYSTEM, system_fallback: pending }, false);
            setPending(null);
          }}
          onClose={() => {
            onCommit({ system: OTHER_SYSTEM, system_fallback: systemFallback }, true);
            setPending(null);
          }}
        />
      )}
    </>
  );
}
