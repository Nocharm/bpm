"use client";

// 비용 단위(₩/$) 공용 조각 — 타일 팝오버 앞의 단위 탭박스와 타일에 찍히는 통화 필.
// 비용은 통화 배타(cost_krw/cost_usd 동시 입력 불가)라 한 타일에서 단위를 고른다 (사용자 결정 2026-09-03).

export type CostUnit = "cost_krw" | "cost_usd";

export const COST_UNIT_SYMBOL: Record<CostUnit, string> = { cost_krw: "₩", cost_usd: "$" };
const COST_UNIT_CODE: Record<CostUnit, string> = { cost_krw: "KRW", cost_usd: "USD" };

interface CostUnitTabsProps {
  dataId: string;
  value: CostUnit;
  onChange: (unit: CostUnit) => void;
}

// 세그먼트 탭 — 눌린 쪽이 액센트 틴트. 입력 앞에 놓여 "단위 → 값" 순서로 읽힌다
export function CostUnitTabs({ dataId, value, onChange }: CostUnitTabsProps) {
  return (
    <span data-id={dataId} role="tablist" className="inline-flex shrink-0 overflow-hidden rounded-sm border border-hairline">
      {(["cost_krw", "cost_usd"] as const).map((unit) => (
        <button
          key={unit}
          type="button"
          role="tab"
          data-id={`${dataId}-${unit === "cost_krw" ? "krw" : "usd"}`}
          aria-selected={value === unit}
          title={COST_UNIT_CODE[unit]}
          className={`px-2 py-1 text-caption transition-colors duration-150 ${
            value === unit ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:bg-surface-alt"
          }`}
          onClick={() => onChange(unit)}
        >
          {COST_UNIT_SYMBOL[unit]}
        </button>
      ))}
    </span>
  );
}

// 타일의 통화 필 — 선택된 단위를 값 앞에 작게
export function CurrencyPill({ unit }: { unit: CostUnit }) {
  return (
    <span
      data-id="cost-unit-pill"
      className="inline-flex shrink-0 items-center rounded-full border border-accent-tint-border bg-accent-tint px-1.5 py-0 text-[10px] leading-4 text-accent"
    >
      {COST_UNIT_SYMBOL[unit]} {COST_UNIT_CODE[unit]}
    </span>
  );
}
