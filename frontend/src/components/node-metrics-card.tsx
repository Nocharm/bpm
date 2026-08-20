// 인스펙터 수행 지표 카드 — 레이지 세이브(버퍼 편집, 헤더 Save 버튼) + 비용 통화 토글 한 행
// (사용자 결정 2026-08-20: 자동 저장 → 명시 저장, 통화는 배타라 ₩/$ 세그먼트 전환).
// 노드 전환 리셋은 부모의 key 리마운트가 담당. SP 노드 상속 5필드는 read-only 표시 유지.
"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { FallbackHint } from "@/components/fallback-hint";
import { PARAM_ICON } from "@/components/param-icons";
import { ParamInput } from "@/components/param-input";
import { useI18n } from "@/lib/i18n";
import {
  formatParamValue,
  PARAM_FIELDS,
  PARAM_LABEL_KEY,
  readParamsCollapsed,
  writeParamsCollapsed,
  type ParamField,
} from "@/lib/params";

type CostField = "cost_krw" | "cost_usd";

interface NodeMetricsCardProps {
  nodeType: string;
  // 노드 저장값(서버 반영분) — 버퍼(draft)가 이 위에 겹친다
  values: Record<ParamField, string>;
  editableParams: readonly ParamField[];
  // SP 노드의 상속 표시값(비편집) — 링크 맵 지정값
  inheritedDisplay: (field: ParamField) => string;
  // SP 노드 annual_count 힌트 — 링크 맵 인터뷰 빈도 원문
  frequencyFallback?: string | null;
  readOnly: boolean;
  onSave: (patch: Partial<Record<ParamField, string>>) => void;
}

export function NodeMetricsCard({
  nodeType, values, editableParams, inheritedDisplay, frequencyFallback, readOnly, onSave,
}: NodeMetricsCardProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(readParamsCollapsed);
  // 레이지 세이브 버퍼 — 원본과 같아진 키는 제거해 dirty 판정을 정확히 유지
  const [draft, setDraft] = useState<Partial<Record<ParamField, string>>>({});
  // 통화 토글로 소거될 기존 값 안내 — Undo가 전환 전 상태로 복원
  const [costNotice, setCostNotice] = useState<{ field: CostField; value: string } | null>(null);
  const [activeCurrency, setActiveCurrency] = useState<CostField>(
    values.cost_usd !== "" ? "cost_usd" : "cost_krw",
  );

  const shown = (field: ParamField): string => draft[field] ?? values[field];
  const dirty = Object.keys(draft).length > 0;
  const isSubprocess = nodeType === "subprocess";
  const canEditCost = editableParams.includes("cost_krw");

  const commit = (field: ParamField, next: string) => {
    setDraft((prev) => {
      const merged = { ...prev };
      if (next === values[field]) delete merged[field];
      else merged[field] = next;
      return merged;
    });
  };

  const switchCurrency = (target: CostField) => {
    if (target === activeCurrency) return;
    const current = activeCurrency;
    const currentValue = shown(current);
    if (currentValue !== "") {
      // 배타 계약 — 전환하면 기존 통화 값은 저장 시 삭제된다는 안내 + 되돌리기 (사용자 결정 2026-08-20)
      commit(current, "");
      setCostNotice({ field: current, value: currentValue });
    }
    setActiveCurrency(target);
  };

  const undoCurrencySwitch = () => {
    if (costNotice === null) return;
    const other: CostField = costNotice.field === "cost_krw" ? "cost_usd" : "cost_krw";
    setDraft((prev) => {
      const merged = { ...prev };
      delete merged[costNotice.field]; // 소거 취소 → 원본 값 복원
      delete merged[other]; // 전환 후 입력했던 새 통화 값도 폐기
      return merged;
    });
    setActiveCurrency(costNotice.field);
    setCostNotice(null);
  };

  const handleSave = () => {
    onSave(draft);
    setDraft({});
    setCostNotice(null);
  };

  const filledCount = editableParams.filter((f) => shown(f)).length;

  // 행 렌더 목록 — 비용 2필드는 한 행으로 접음(cost_usd 자리는 스킵)
  const rowFields = PARAM_FIELDS.filter((f) => f !== "cost_usd");

  return (
    <div data-id="inspector-params" className="rounded-md border border-hairline p-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-id="inspector-params-toggle"
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 text-fine font-semibold text-ink"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeParamsCollapsed(next);
          }}
        >
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
          {t("inspector.parameters")}
          {filledCount > 0 && <span className="font-normal text-ink-tertiary">({filledCount})</span>}
        </button>
        {!readOnly && editableParams.length > 0 && (
          <button
            type="button"
            data-id="inspector-params-save"
            disabled={!dirty}
            className={`shrink-0 rounded-sm px-2 py-0.5 text-fine ${
              dirty ? "bg-accent text-on-accent hover:bg-accent-focus" : "text-ink-muted"
            } disabled:opacity-50`}
            onClick={handleSave}
          >
            {t("section.save")}
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="ml-2 border-l border-divider pl-2">
          {rowFields.map((key) => {
            const isCostRow = key === "cost_krw";
            const field: ParamField = isCostRow ? activeCurrency : key;
            const RowIcon = PARAM_ICON[field];
            const editable = editableParams.includes(field);
            return (
              <div key={key} className="flex items-center justify-between gap-2 py-1">
                <span className="inline-flex shrink-0 items-center gap-1 text-caption text-ink-secondary">
                  <RowIcon size={12} strokeWidth={1.5} className="text-ink-muted" />
                  {isCostRow ? t("field.costRun") : t(PARAM_LABEL_KEY[key])}
                </span>
                {/* 통화 세그먼트 — 배타 계약이라 한 번에 한 통화만 (전환 시 반대 값 소거 안내) */}
                {isCostRow && canEditCost && !readOnly && (
                  <span className="inline-flex shrink-0 overflow-hidden rounded-sm border border-hairline">
                    {(["cost_krw", "cost_usd"] as const).map((currency) => (
                      <button
                        key={currency}
                        type="button"
                        data-id={`inspector-cost-currency-${currency === "cost_krw" ? "krw" : "usd"}`}
                        aria-pressed={activeCurrency === currency}
                        className={`px-1.5 py-0.5 text-fine ${
                          activeCurrency === currency
                            ? "bg-accent-tint text-accent"
                            : "text-ink-tertiary hover:bg-surface-alt"
                        }`}
                        onClick={() => switchCurrency(currency)}
                      >
                        {currency === "cost_krw" ? "₩" : "$"}
                      </button>
                    ))}
                  </span>
                )}
                {editable ? (
                  <ParamInput
                    key={field} // 통화 전환 시 focused 상태 리셋
                    field={field}
                    dataId={`inspector-param-${field}`}
                    className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-right text-caption text-ink hover:bg-surface-alt focus:bg-surface-alt focus:outline-none disabled:hover:bg-transparent"
                    value={shown(field)}
                    disabled={readOnly}
                    ariaLabel={isCostRow ? t("field.costRun") : t(PARAM_LABEL_KEY[field])}
                    onCommit={(next) => commit(field, next)}
                  />
                ) : (
                  <span
                    data-id={`inspector-param-${field}`}
                    className="min-w-0 flex-1 truncate px-1 py-0.5 text-right text-caption text-ink"
                  >
                    {(isCostRow
                      ? inheritedDisplay("cost_krw") || inheritedDisplay("cost_usd")
                      : inheritedDisplay(field)) || "—"}
                  </span>
                )}
                {key === "annual_count" && isSubprocess && (
                  <FallbackHint dataId="inspector-annual-count-hint" fallback={frequencyFallback} />
                )}
              </div>
            );
          })}
          {costNotice !== null && (
            <div
              data-id="inspector-cost-clear-notice"
              className="flex items-center justify-between gap-2 py-0.5 text-fine text-error"
            >
              <span className="min-w-0">
                {t("metrics.clearOnSave", { v: formatParamValue(costNotice.field, costNotice.value) })}
              </span>
              <button
                type="button"
                data-id="inspector-cost-clear-undo"
                className="shrink-0 rounded-sm px-1.5 py-0.5 text-fine text-accent hover:bg-accent-tint"
                onClick={undoCurrencySwitch}
              >
                {t("metrics.undoSwitch")}
              </button>
            </div>
          )}
          {dirty && (
            <p className="py-0.5 text-fine text-ink-tertiary">{t("section.unsavedHint")}</p>
          )}
          {isSubprocess && (
            <p className="py-1 text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>
          )}
        </div>
      )}
    </div>
  );
}
