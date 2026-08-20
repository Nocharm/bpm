// 인스펙터 I/O & Conditions 카드 — 레이지 세이브(버퍼 편집, 헤더 Save 버튼).
// (사용자 결정 2026-08-20: 자동 저장 → 명시 저장). 노드 전환 리셋은 부모 key 리마운트가 담당.
// SP 노드는 링크 맵 sp_* 값을 read-only 상속 렌더 — 저장 대상이 아니라 Save 버튼 없음.
"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  DETAIL_FIELD_ICONS,
  NodeDetailsFields,
  type NodeDetailsPatch,
} from "@/components/node-details-fields";
import { useI18n } from "@/lib/i18n";
import { readDetailsCollapsed, writeDetailsCollapsed } from "@/lib/params";

type DetailField = keyof NodeDetailsPatch;

const DETAIL_FIELDS: readonly DetailField[] = [
  "input", "output", "input_forms", "output_forms", "data_form", "start_condition", "end_condition",
];
// 헤더 채움 카운트는 주 필드 5종만 — 항목별 폼은 IO의 부속값이라 세지 않는다
const COUNT_FIELDS: readonly DetailField[] = [
  "input", "output", "data_form", "start_condition", "end_condition",
];

// SP 상속 표시용 — IO 원문과 항목별 폼(줄 1:1 정렬)을 행 목록으로 결합
function splitWithForms(value: string | null | undefined, forms: string | null | undefined) {
  const formLines = (forms ?? "").split("\n");
  return (value ?? "")
    .split("\n")
    .map((v, i) => ({ text: v.trim(), form: (formLines[i] ?? "").trim() }))
    .filter((r) => r.text !== "");
}

interface NodeDetailsCardProps {
  nodeKey: string;
  isSubprocess: boolean;
  // 노드 저장값(서버 반영분) — 버퍼(draft)가 이 위에 겹친다
  values: Record<DetailField, string>;
  // SP 노드의 링크 맵 상속값(read-only)
  sp?: {
    input?: string | null;
    output?: string | null;
    input_forms?: string | null;
    output_forms?: string | null;
    start_condition?: string | null;
    end_condition?: string | null;
  };
  readOnly: boolean;
  onSave: (patch: NodeDetailsPatch) => void;
}

export function NodeDetailsCard({
  nodeKey, isSubprocess, values, sp, readOnly, onSave,
}: NodeDetailsCardProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(readDetailsCollapsed);
  // 레이지 세이브 버퍼 — 원본과 같아진 키는 제거해 dirty 판정을 정확히 유지
  const [draft, setDraft] = useState<NodeDetailsPatch>({});

  const shown = (field: DetailField): string => draft[field] ?? values[field];
  const dirty = Object.keys(draft).length > 0;

  const mergePatch = (patch: NodeDetailsPatch) => {
    setDraft((prev) => {
      const merged = { ...prev };
      for (const field of DETAIL_FIELDS) {
        const next = patch[field];
        if (next === undefined) continue;
        if (next === values[field]) delete merged[field];
        else merged[field] = next;
      }
      return merged;
    });
  };

  const filledCount = isSubprocess
    ? [sp?.input, sp?.output, sp?.start_condition, sp?.end_condition]
        .filter((v) => (v ?? "") !== "").length
    : COUNT_FIELDS.filter((f) => shown(f) !== "").length;

  return (
    <div data-id="inspector-details" className="rounded-md border border-hairline p-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-id="inspector-details-toggle"
          data-acc-toggle
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeDetailsCollapsed(next);
          }}
        >
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
          {t("inspector.details")}
          {filledCount > 0 && <span className="font-normal text-ink-tertiary">({filledCount})</span>}
        </button>
        {!isSubprocess && !readOnly && (
          <button
            type="button"
            data-id="inspector-details-save"
            disabled={!dirty}
            className={`shrink-0 rounded-sm px-2 py-0.5 text-fine ${
              dirty ? "bg-accent text-on-accent hover:bg-accent-focus" : "text-ink-muted"
            } disabled:opacity-50`}
            onClick={() => {
              onSave(draft);
              setDraft({});
            }}
          >
            {t("section.save")}
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="ml-2 border-l border-divider pl-2">
          {isSubprocess ? (
            <>
              {/* 링크 맵 라이브 참조 — sp가 소스(지정 어트리뷰트 카드와 동일 규약).
                  IO는 항목별 데이터 폼을 " · form" 접미로 함께 상속 표시 */}
              {([
                ["input", "field.input", splitWithForms(sp?.input, sp?.input_forms), DETAIL_FIELD_ICONS.input],
                ["output", "field.output", splitWithForms(sp?.output, sp?.output_forms), DETAIL_FIELD_ICONS.output],
              ] as const).map(([id, labelKey, items, RowIcon]) => (
                <div
                  key={id}
                  data-id={`inspector-detail-${id}`}
                  className="flex items-start justify-between gap-2 border-t border-divider py-1"
                >
                  <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
                    <RowIcon size={12} strokeWidth={1.5} className="text-ink-muted" />
                    {t(labelKey)}
                  </span>
                  <span className="min-w-0 text-right text-caption text-ink">
                    {items.length === 0
                      ? "-"
                      : items.map((r, i) => (
                          <span key={i} className="block">
                            <span className="text-fine tabular-nums text-ink-muted">{i + 1}. </span>
                            {r.text}
                            {r.form !== "" && (
                              <span className="text-fine text-ink-tertiary"> · {r.form}</span>
                            )}
                          </span>
                        ))}
                  </span>
                </div>
              ))}
              {([
                ["start-condition", "field.startCondition", sp?.start_condition, DETAIL_FIELD_ICONS.start_condition],
                ["end-condition", "field.endCondition", sp?.end_condition, DETAIL_FIELD_ICONS.end_condition],
              ] as const).map(([id, labelKey, value, RowIcon]) => (
                <div
                  key={id}
                  data-id={`inspector-detail-${id}`}
                  className="flex items-start justify-between gap-2 border-t border-divider py-1"
                >
                  <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
                    <RowIcon size={12} strokeWidth={1.5} className="text-ink-muted" />
                    {t(labelKey)}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap text-right text-caption text-ink">
                    {value || "-"}
                  </span>
                </div>
              ))}
              <p className="mt-1.5 text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>
            </>
          ) : (
            <>
              <NodeDetailsFields
                idPrefix="inspector-detail"
                nodeKey={nodeKey}
                input={shown("input")}
                output={shown("output")}
                inputForms={shown("input_forms")}
                outputForms={shown("output_forms")}
                dataForm={shown("data_form")}
                startCondition={shown("start_condition")}
                endCondition={shown("end_condition")}
                readOnly={readOnly}
                onPatch={mergePatch}
              />
              {dirty && (
                <p className="py-0.5 text-fine text-ink-tertiary">{t("section.unsavedHint")}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
