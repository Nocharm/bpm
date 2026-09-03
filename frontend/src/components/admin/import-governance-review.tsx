// 재임포트 거버넌스 확인 — dry-run governance[]를 맵별로 묶어 "현재 → 전달" + 체크박스로 보여준다.
// 체크한 (code, field)만 apply가 교체하고 나머지는 현재값 유지 (spec 2026-09-03 §6).
// apply 결과 보기(applied=true)는 체크박스 대신 적용/유지 배지.
"use client";

import { ArrowRight } from "lucide-react";

import type { GovernanceDiff, GovernanceField } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { governanceKey, groupGovernanceDiffs } from "@/lib/interview-report";

interface ImportGovernanceReviewProps {
  diffs: GovernanceDiff[];
  checked: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (next: boolean) => void;
  applied: boolean;
}

const FIELD_LABEL: Record<GovernanceField, MessageKey> = {
  owner: "framework.governance.field.owner",
  department: "framework.governance.field.department",
  approvers: "framework.governance.field.approvers",
};

export function ImportGovernanceReview({ diffs, checked, onToggle, onToggleAll, applied }: ImportGovernanceReviewProps) {
  const { t } = useI18n();
  const groups = groupGovernanceDiffs(diffs);
  const allChecked = diffs.length > 0 && diffs.every((d) => checked.has(governanceKey(d)));

  return (
    <div data-id="import-governance-review" className="flex flex-col gap-1.5 rounded-sm border border-hairline">
      <div className="flex items-center gap-2 border-b border-divider bg-surface-alt px-2 py-1.5">
        <span className="shrink-0 text-caption-strong text-ink">{t("framework.governance.title")}</span>
        <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{t("framework.governance.hint")}</span>
        {!applied && diffs.length > 0 && (
          <button
            type="button"
            data-id="import-governance-check-all"
            className="shrink-0 rounded-sm px-2 py-0.5 text-fine text-accent hover:bg-accent-tint"
            onClick={() => onToggleAll(!allChecked)}
          >
            {allChecked ? t("framework.governance.clear") : t("framework.governance.checkAll")}
          </button>
        )}
      </div>
      {groups.length === 0 ? (
        <p data-id="import-governance-none" className="px-2 pb-1.5 text-fine text-ink-tertiary">
          {t("framework.governance.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 px-2 pb-2">
          {groups.map((group) => (
            <li key={group.code} data-id={`import-governance-map-${group.code}`} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-caption text-ink">{group.name}</span>
                <span className="shrink-0 font-mono text-fine text-ink-tertiary">{group.code}</span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.diffs.map((d) => {
                  const key = governanceKey(d);
                  const on = applied ? d.applied : checked.has(key);
                  return (
                    <li
                      key={key}
                      data-id={`import-governance-row-${d.code}-${d.field}`}
                      className={`flex items-center gap-2 rounded-sm px-2 py-1 text-fine ${
                        on ? "bg-changed/10" : "bg-surface"
                      }`}
                    >
                      {applied ? (
                        <span
                          data-id={`import-governance-result-${d.code}-${d.field}`}
                          className={`w-24 shrink-0 rounded-sm border px-1 text-center ${
                            d.applied ? "border-changed/40 text-changed" : "border-hairline text-ink-tertiary"
                          }`}
                        >
                          {d.applied ? t("framework.governance.applied") : t("framework.governance.kept")}
                        </span>
                      ) : (
                        <label className="flex w-24 shrink-0 items-center gap-1">
                          <input
                            type="checkbox"
                            data-id={`import-governance-check-${d.code}-${d.field}`}
                            className="accent-[var(--color-accent)]"
                            checked={on}
                            onChange={() => onToggle(key)}
                          />
                          <span className={on ? "text-changed" : "text-ink-tertiary"}>
                            {on ? t("framework.governance.replace") : t("framework.governance.keep")}
                          </span>
                        </label>
                      )}
                      <span className="w-24 shrink-0 text-ink-secondary">{t(FIELD_LABEL[d.field])}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-tertiary" title={d.current}>
                        {d.current || t("framework.governance.empty")}
                      </span>
                      <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                      <span className={`min-w-0 flex-1 truncate ${on ? "text-changed" : "text-ink"}`} title={d.delivered}>
                        {d.delivered}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
