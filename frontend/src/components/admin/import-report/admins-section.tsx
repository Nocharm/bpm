"use client";

// 카테고리 관리자(파일 admins, 인터뷰 0.5) — 추가만 하므로 "누가 어디에" 한 줄씩(사용자 필 + 코드·카테고리명).
// 미등재 로그인은 경고 톤. 행 호버=그 계보 코드를 가진 파일 강조.

import { ShieldCheck } from "lucide-react";
import { useRef } from "react";

import { useI18n } from "@/lib/i18n";
import type { AdminChangeEntry, InterviewIndex, ReportRelations } from "@/lib/interview-report";
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

export function tagsOfAdmin(row: AdminChangeEntry, relations: ReportRelations): RelatedTags {
  return { maps: [], files: relations.filesOfCategory.get(row.code) ?? [] };
}

// 계보 코드 → 이름 — 업로드 파일들의 체인에서 처음 맞는 것
function nameOfCategory(code: string, index: InterviewIndex): string {
  for (const file of index.files) {
    const hit = file.chain.find((step) => step.code === code);
    if (hit) return hit.name;
  }
  return "";
}

interface AdminsSectionProps {
  rows: AdminChangeEntry[];
  index: InterviewIndex;
  relations: ReportRelations;
  focus: ReportFocus | null;
  onHover: (tags: RelatedTags | null) => void;
}

export function AdminsSection({ rows, index, relations, focus, onHover }: AdminsSectionProps) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const keyOf = (row: AdminChangeEntry) => `${row.code}|${row.login}`;
  const ordered = orderByRelation(rows, (row) => tagsOfAdmin(row, relations), focus);
  useFlipOrder(bodyRef, ordered.map(keyOf).join("|"));
  const unknownCount = rows.filter((row) => row.state === "unknown").length;

  return (
    <ReportSection
      dataId="interview-import-admins"
      title={t("framework.importCategoryAdmins")}
      Icon={ShieldCheck}
      pills={
        <span
          data-id="interview-admins-count"
          className={`${PILL_BASE} tabular-nums ${
            unknownCount > 0 ? "border-changed/40 bg-changed/10 text-changed" : "border-hairline bg-surface-alt text-ink-secondary"
          }`}
        >
          {rows.length}
        </span>
      }
      tip={t("framework.report.adminsTip")}
      isEmpty={rows.length === 0}
      emptyText={t("framework.report.adminsEmpty")}
      bodyRef={bodyRef}
      footer={
        rows.length > 0 ? (
          <p className="border-t border-divider px-2.5 py-1.5 text-fine text-ink-tertiary">
            {t("framework.importCategoryAdminsHint")}
          </p>
        ) : null
      }
    >
      <ul className="flex flex-col">
        {ordered.map((row) => {
          const i = rows.indexOf(row);
          const tags = tagsOfAdmin(row, relations);
          const state = relationClass(tags, focus, true);
          const name = nameOfCategory(row.code, index);
          return (
            <li
              key={keyOf(row)}
              data-flip-key={keyOf(row)}
              data-id={`interview-admin-row-${i}`}
              data-state={row.state}
              className={`flex items-center gap-2 border-b border-divider px-2.5 py-1.5 transition-[background-color,opacity] duration-350 ease-smooth last:border-b-0 ${
                ROW_STATE_CLASS[state]
              }`}
              onMouseEnter={() => onHover(tags)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center">
                  <PersonPill login={row.login} />
                </span>
                <span className="truncate text-fine text-ink-tertiary">
                  <span className="font-mono">{row.code}</span>
                  {name ? ` · ${name}` : ""}
                </span>
              </span>
              <span
                className={`${PILL_BASE} ${
                  row.state === "unknown"
                    ? "border-changed/40 bg-changed/10 text-changed"
                    : "border-accent/30 bg-accent-tint text-accent"
                }`}
              >
                {row.state === "unknown"
                  ? t("framework.importMsgCategoryAdminUnknown")
                  : t("framework.importMsgCategoryAdminAdded")}
              </span>
            </li>
          );
        })}
      </ul>
    </ReportSection>
  );
}
