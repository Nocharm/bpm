// 노드 상세(승격) 필드 편집 — 인스펙터 Details 카드와 노드 편집 모달이 공유.
// Data form은 Input/Output에 종속된 값(흘러가는 자료의 형식)이라 IO 그룹 안에 들여쓰기로
// 배치한다 — 조건(start/end)과 동등한 형제 필드로 보이지 않게 (design 2026-08-19 §5.1).
"use client";

import { MultiValueInput } from "@/components/multi-value-input";
import { useI18n } from "@/lib/i18n";

export interface NodeDetailsPatch {
  input?: string;
  output?: string;
  data_form?: string;
  start_condition?: string;
  end_condition?: string;
}

interface NodeDetailsFieldsProps {
  input: string;
  output: string;
  dataForm: string;
  startCondition: string;
  endCondition: string;
  readOnly: boolean;
  // data-id 접두 — 표면별 구분("inspector-detail" | "modal-detail")
  idPrefix: string;
  // 노드 전환 리마운트 키(MultiValueInput 행 버퍼 리셋)
  nodeKey: string;
  onPatch: (patch: NodeDetailsPatch) => void;
}

export function NodeDetailsFields({
  input, output, dataForm, startCondition, endCondition,
  readOnly, idPrefix, nodeKey, onPatch,
}: NodeDetailsFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      {/* IO 그룹 — Data form은 이 그룹의 종속 행(들여쓰기 + 세로선) */}
      <MultiValueInput
        key={`${nodeKey}-input`}
        dataId={`${idPrefix}-input`}
        label={t("field.input")}
        value={input}
        readOnly={readOnly}
        onCommit={(joined) => onPatch({ input: joined })}
      />
      <MultiValueInput
        key={`${nodeKey}-output`}
        dataId={`${idPrefix}-output`}
        label={t("field.output")}
        value={output}
        readOnly={readOnly}
        onCommit={(joined) => onPatch({ output: joined })}
      />
      <div className="ml-2 flex items-center justify-between gap-2 border-l border-divider py-0.5 pl-2">
        <span className="shrink-0 text-fine text-ink-tertiary">{t("field.dataForm")}</span>
        {readOnly ? (
          <span data-id={`${idPrefix}-data-form`} className="min-w-0 truncate text-right text-fine text-ink-secondary">
            {dataForm || "—"}
          </span>
        ) : (
          <input
            data-id={`${idPrefix}-data-form`}
            className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-right text-fine text-ink-secondary hover:bg-surface-alt focus:bg-surface-alt focus:outline-none"
            maxLength={50}
            value={dataForm}
            placeholder="structured / document / tacit"
            title={dataForm || undefined}
            onChange={(event) => onPatch({ data_form: event.target.value })}
          />
        )}
      </div>
      {/* 조건 — IO와 동등한 형제 필드. 긴 문장은 말줄임 유지(사용자 결정 2026-08-20) */}
      {([
        ["start_condition", "field.startCondition", startCondition],
        ["end_condition", "field.endCondition", endCondition],
      ] as const).map(([key, labelKey, value]) => (
        <div key={key} className="flex items-center justify-between gap-2 border-t border-divider py-1">
          <span className="shrink-0 text-caption text-ink-secondary">{t(labelKey)}</span>
          {readOnly ? (
            <span className="min-w-0 truncate text-right text-caption text-ink" title={value || undefined}>
              {value || "—"}
            </span>
          ) : (
            <input
              data-id={`${idPrefix}-${key.replace(/_/g, "-")}`}
              className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-right text-caption text-ink hover:bg-surface-alt focus:bg-surface-alt focus:outline-none"
              value={value}
              title={value || undefined}
              onChange={(event) => onPatch({ [key]: event.target.value })}
            />
          )}
        </div>
      ))}
    </>
  );
}
