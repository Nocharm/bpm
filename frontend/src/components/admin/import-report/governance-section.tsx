"use client";

// 거버넌스 확인 — dry-run governance[]를 맵별로 묶어 "현재 → 전달"을 보여주고, 행마다 유지/교체 드롭다운(아이콘 포함).
// 굵은 값 = 적용 뒤 남는 값, 버려지는 값은 취소선. 체크한 (code, field)만 apply가 교체 (spec 2026-09-03 §6).
// apply 결과 보기(applied=true)는 드롭다운 대신 적용/유지 배지. 오너·승인자는 사용자 필, 행 호버=우측 그 맵 강조.

import { ArrowRight, ListChecks, Repeat, Undo2 } from "lucide-react";
import { useRef } from "react";

import type { GovernanceDiff, GovernanceField } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { governanceKey, groupGovernanceDiffs, type ReportRelations } from "@/lib/interview-report";
import {
  orderByRelation,
  relationClass,
  type RelatedTags,
  type ReportFocus,
} from "@/lib/interview-report-focus";
import { useFlipOrder } from "@/lib/use-flip-order";

import { PersonPill } from "./person-pill";
import { PILL_BASE, ROW_STATE_CLASS } from "./report-bits";
import { ReportSection } from "./report-section";

const FIELD_LABEL: Record<GovernanceField, MessageKey> = {
  owner: "framework.governance.field.owner",
  department: "framework.governance.field.department",
  approvers: "framework.governance.field.approvers",
  notes: "framework.governance.field.notes",
};

const LOGIN_RE = /^[\w.@-]+$/;

// 값 한 쪽 — final(적용 뒤 남는 값)은 굵게, 아니면 취소선+흐림. 오너·승인자는 로그인 → 사용자 필
function GovernanceValue({ text, field, final }: { text: string; field: GovernanceField; final: boolean }) {
  const { t } = useI18n();
  if (!text) {
    return (
      <span className={final ? "font-semibold text-ink" : "text-ink-tertiary line-through"}>
        {t("framework.governance.empty")}
      </span>
    );
  }
  if (field === "owner" || field === "approvers") {
    const logins = text.split(",").map((s) => s.trim()).filter(Boolean);
    return (
      <span className={`inline-flex min-w-0 flex-wrap items-center gap-1 ${final ? "" : "opacity-55 [&_span]:line-through"}`}>
        {logins.map((login) =>
          LOGIN_RE.test(login) ? <PersonPill key={login} login={login} /> : <span key={login}>{login}</span>,
        )}
      </span>
    );
  }
  return (
    <span className={`min-w-0 truncate ${final ? "font-semibold text-ink" : "text-ink-tertiary line-through"}`} title={text}>
      {text}
    </span>
  );
}

interface GovernanceSectionProps {
  diffs: GovernanceDiff[];
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onToggleAll: (next: boolean) => void;
  applied: boolean;
  relations: ReportRelations;
  focus: ReportFocus | null;
  onHover: (tags: RelatedTags | null) => void;
}

export function GovernanceSection({
  diffs,
  checked,
  onToggle,
  onToggleAll,
  applied,
  relations,
  focus,
  onHover,
}: GovernanceSectionProps) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const groups = groupGovernanceDiffs(diffs);
  const tagsOf = (code: string): RelatedTags => {
    const file = relations.fileOfMap.get(code);
    return { maps: [code], files: file === undefined ? [] : [file] };
  };
  const ordered = orderByRelation(groups, (group) => tagsOf(group.code), focus);
  useFlipOrder(bodyRef, ordered.map((g) => g.code).join("|"));
  const allChecked = diffs.length > 0 && diffs.every((d) => checked.has(governanceKey(d)));

  return (
    <ReportSection
      dataId="import-governance-review"
      title={t("framework.governance.title")}
      Icon={ListChecks}
      pills={
        <>
          <span
            data-id="import-governance-count"
            className={`${PILL_BASE} tabular-nums ${
              diffs.length > 0 ? "border-changed/40 bg-changed/10 text-changed" : "border-hairline bg-surface-alt text-ink-secondary"
            }`}
          >
            {diffs.length}
          </span>
          {diffs.length > 0 && (
            <span className="hidden truncate text-fine text-ink-tertiary lg:inline">{t("framework.report.governanceBold")}</span>
          )}
          {!applied && diffs.length > 0 && (
            <button
              type="button"
              data-id="import-governance-check-all"
              className="shrink-0 rounded-sm px-1.5 py-0.5 text-fine text-accent hover:bg-accent-tint"
              onClick={() => onToggleAll(!allChecked)}
            >
              {allChecked ? t("framework.governance.clear") : t("framework.governance.checkAll")}
            </button>
          )}
        </>
      }
      tip={t("framework.report.governanceTip")}
      isEmpty={groups.length === 0}
      emptyText={t("framework.governance.none")}
      emptyDataId="import-governance-none"
      bodyRef={bodyRef}
      bodyClassName="max-h-80"
    >
      <ul className="flex flex-col">
        {ordered.map((group) => {
          const tags = tagsOf(group.code);
          const state = relationClass(tags, focus, true);
          return (
            <li
              key={group.code}
              data-flip-key={group.code}
              data-id={`import-governance-map-${group.code}`}
              className={`border-b border-divider transition-[background-color,opacity] duration-350 ease-smooth last:border-b-0 ${
                ROW_STATE_CLASS[state]
              }`}
              onMouseEnter={() => onHover(tags)}
              onMouseLeave={() => onHover(null)}
            >
              <div className="flex items-baseline gap-1.5 px-2.5 pt-1.5">
                <span className="truncate text-caption-strong text-ink">{group.name}</span>
                <span className="shrink-0 font-mono text-fine text-ink-tertiary">{group.code}</span>
              </div>
              <ul className="flex flex-col gap-0.5 px-2.5 pb-1.5 pt-0.5">
                {group.diffs.map((d) => {
                  const key = governanceKey(d);
                  const replace = applied ? d.applied : checked.has(key);
                  return (
                    <li
                      key={key}
                      data-id={`import-governance-row-${d.code}-${d.field}`}
                      className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 py-0.5 text-fine"
                    >
                      <span className="text-ink-secondary">{t(FIELD_LABEL[d.field])}</span>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <GovernanceValue text={d.current} field={d.field} final={!replace} />
                        <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                        <GovernanceValue text={d.delivered} field={d.field} final={replace} />
                      </div>
                      {applied ? (
                        <span
                          data-id={`import-governance-result-${d.code}-${d.field}`}
                          className={`${PILL_BASE} justify-center ${
                            d.applied ? "border-changed/40 bg-changed/10 text-changed" : "border-hairline bg-surface text-ink-tertiary"
                          }`}
                        >
                          {d.applied ? t("framework.governance.applied") : t("framework.governance.kept")}
                        </span>
                      ) : (
                        <label
                          data-id={`import-governance-select-${d.code}-${d.field}`}
                          className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${
                            replace
                              ? "border-changed/40 bg-changed/10 text-changed"
                              : "border-hairline bg-surface text-ink-secondary"
                          }`}
                        >
                          {replace ? <Repeat size={12} strokeWidth={1.5} /> : <Undo2 size={12} strokeWidth={1.5} />}
                          <select
                            data-id={`import-governance-check-${d.code}-${d.field}`}
                            value={replace ? "replace" : "keep"}
                            onChange={() => onToggle(key)}
                            className="cursor-pointer bg-transparent text-fine text-inherit outline-none"
                          >
                            <option value="keep">{t("framework.governance.keepShort")}</option>
                            <option value="replace">{t("framework.governance.replace")}</option>
                          </select>
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </ReportSection>
  );
}
