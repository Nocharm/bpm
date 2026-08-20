// 노드 상세(승격) 필드 편집 — 인스펙터 Details 카드와 노드 편집 모달이 공유.
// 데이터 폼은 IO 항목별 값(input_forms/output_forms, 줄 1:1 정렬)이 정본 — 노드 레벨 data_form은
// 임포트 착지 폴백이라 항목별 값이 하나도 없을 때만 참고 행으로 표시 (사용자 결정 2026-08-20).
"use client";

import { FileType, Flag, LogIn, LogOut, Play, type LucideIcon } from "lucide-react";

import { MultiValueInput } from "@/components/multi-value-input";
import { useI18n } from "@/lib/i18n";

// I/O & Conditions 행 아이콘(12px) — 인스펙터·편집 모달·SP 상속 표시가 공유 (사용자 결정 2026-08-20)
export const DETAIL_FIELD_ICONS = {
  input: LogIn,
  output: LogOut,
  data_form: FileType,
  start_condition: Play,
  end_condition: Flag,
} satisfies Record<string, LucideIcon>;

export interface NodeDetailsPatch {
  input?: string;
  output?: string;
  input_forms?: string;
  output_forms?: string;
  data_form?: string;
  start_condition?: string;
  end_condition?: string;
}

interface NodeDetailsFieldsProps {
  input: string;
  output: string;
  // 항목별 데이터 폼 — input/output 줄과 1:1 정렬 (2026-08-20)
  inputForms: string;
  outputForms: string;
  dataForm: string;
  startCondition: string;
  endCondition: string;
  readOnly: boolean;
  // data-id 접두 — 표면별 구분("inspector-detail" | "modal-detail")
  idPrefix: string;
  // 노드 전환 리마운트 키(MultiValueInput 행 버퍼 리셋)
  nodeKey: string;
  // 편집 입력 통일 폭 — 인스펙터 w-32(기본), 편집 모달 w-44 (사용자 결정 2026-08-20)
  inputWidth?: string;
  onPatch: (patch: NodeDetailsPatch) => void;
}

export function NodeDetailsFields({
  input, output, inputForms, outputForms, dataForm, startCondition, endCondition,
  readOnly, idPrefix, nodeKey, inputWidth = "w-32", onPatch,
}: NodeDetailsFieldsProps) {
  const { t } = useI18n();
  // 편집 가능 입력 — 영역 상시 노출·통일 폭·포커스 보더 (사용자 결정 2026-08-20)
  // 폭은 상한 — 인스펙터가 좁아지면 함께 줄어 경계 안 유지 (사용자 결정 2026-08-20)
  const editableInput = `${inputWidth} min-w-0 truncate rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-right focus:border-accent focus:outline-none`;
  // 노드 레벨 data_form 폴백 행 — 항목별 폼이 하나라도 생기면 숨김(항목별 값이 정본)
  const showLegacyDataForm = inputForms === "" && outputForms === "";
  return (
    <>
      {/* IO 그룹 — 항목별 데이터 폼 열 포함(placeholder "form") */}
      <MultiValueInput
        key={`${nodeKey}-input`}
        dataId={`${idPrefix}-input`}
        label={t("field.input")}
        icon={DETAIL_FIELD_ICONS.input}
        value={input}
        formsValue={inputForms}
        readOnly={readOnly}
        onCommit={(joined, formsJoined) => onPatch({ input: joined, input_forms: formsJoined ?? "" })}
      />
      <MultiValueInput
        key={`${nodeKey}-output`}
        dataId={`${idPrefix}-output`}
        label={t("field.output")}
        icon={DETAIL_FIELD_ICONS.output}
        value={output}
        formsValue={outputForms}
        readOnly={readOnly}
        onCommit={(joined, formsJoined) => onPatch({ output: joined, output_forms: formsJoined ?? "" })}
      />
      {showLegacyDataForm && (
        <div className="ml-2 flex items-center justify-between gap-2 border-l border-divider py-0.5 pl-2">
          <span className="inline-flex shrink-0 items-center gap-1 text-fine text-ink-tertiary">
            <FileType size={12} strokeWidth={1.5} className="text-ink-muted" />
            {t("field.dataForm")}
          </span>
          {readOnly ? (
            <span data-id={`${idPrefix}-data-form`} className="min-w-0 truncate text-right text-fine text-ink-secondary">
              {dataForm || "-"}
            </span>
          ) : (
            <input
              data-id={`${idPrefix}-data-form`}
              className={`${editableInput} text-fine text-ink-secondary`}
              maxLength={50}
              value={dataForm}
              placeholder="structured / document / tacit"
              title={dataForm || undefined}
              onChange={(event) => onPatch({ data_form: event.target.value })}
            />
          )}
        </div>
      )}
      {/* 조건 — IO와 동등한 형제 필드. 긴 문장은 말줄임 유지(사용자 결정 2026-08-20) */}
      {([
        ["start_condition", "field.startCondition", startCondition],
        ["end_condition", "field.endCondition", endCondition],
      ] as const).map(([key, labelKey, value]) => {
        const RowIcon = DETAIL_FIELD_ICONS[key];
        // 스페이서는 IO 그룹↔조건 경계(시작 조건 위)에만 (사용자 결정 2026-08-20)
        return (
        <div
          key={key}
          className={`flex items-center justify-between gap-2 py-1 ${
            key === "start_condition" ? "border-t border-divider" : ""
          }`}
        >
          <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
            <RowIcon size={12} strokeWidth={1.5} className="text-ink-muted" />
            {t(labelKey)}
          </span>
          {readOnly ? (
            <span className="min-w-0 truncate text-right text-caption text-ink" title={value || undefined}>
              {value || "-"}
            </span>
          ) : (
            <input
              data-id={`${idPrefix}-${key.replace(/_/g, "-")}`}
              className={`${editableInput} text-caption text-ink`}
              value={value}
              title={value || undefined}
              onChange={(event) => onPatch({ [key]: event.target.value })}
            />
          )}
        </div>
        );
      })}
    </>
  );
}
