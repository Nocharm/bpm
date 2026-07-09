"use client";

// 부서 테이블 — 기본: 부서명 + 한글부서 + 인원수(호버 명단). 디버그 토글(org 보기) 시 인원수 대신 가변 orgLevels 컬럼 /
// Department table — name + korean-dept pills + member count (roster on hover). Org-view swaps count for org columns.
// orgLevels depth is VARIABLE — max depth computed at runtime, never hardcoded.

import { useEffect, useState } from "react";

import { type AdminDept, type AdminUser, getAdminUsers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { aggregateDeptKoreanDepts, formatRosterName, getDeptMembers } from "@/lib/korean-dept";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, TableCard } from "./admin-table";

const PILL =
  "inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-fine text-ink-secondary";

/** 인원수 호버 명단 툴팁 — 이름 필(언어 토글 연동), 25행 청킹. 충돌 툴팁과 동일한 호버 연속(pt-1 래퍼). */
function RosterHover({ members, count }: { members: AdminUser[]; count: number }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(members, "");
  return (
    <span
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-help text-ink-secondary underline decoration-dotted">{count}</span>
      {open && (
        <div className="absolute left-0 top-full z-10 pt-1">
          <div
            data-id="dept-roster-tooltip"
            className="flex max-h-64 w-72 flex-col items-start gap-1 overflow-y-auto rounded-md border border-hairline bg-surface p-2 shadow-lg"
          >
            {visible.map((m) => (
              <span key={m.login_id} className={PILL}>
                {formatRosterName(m, lang)}
              </span>
            ))}
            {hasMore && <span ref={sentinelRef} className="h-4 w-full" />}
          </div>
        </div>
      )}
    </span>
  );
}

export function DepartmentTable() {
  const { t } = useI18n();
  const [departments, setDepartments] = useState<AdminDept[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOrg, setShowOrg] = useState(false);

  useEffect(() => {
    getAdminUsers()
      .then((data) => {
        setDepartments(data.departments);
        setUsers(data.users);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // 25행씩 증분 렌더.
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(departments, "");

  // orgLevels 최대 깊이 동적 계산 — 절대 하드코딩 금지 /
  // Compute max orgLevels length dynamically across all departments.
  const maxOrgDepth = departments.reduce((max, d) => Math.max(max, d.org_levels.length), 0);
  const orgColIndices = Array.from({ length: maxOrgDepth }, (_, i) => i);
  const colCount = showOrg ? 2 + maxOrgDepth : 3;

  if (error) {
    return (
      <div className="text-caption text-error">Failed to load departments: {error}</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {/* 디버그 토글 — org 보기 / Debug toggle: org columns */}
        <label className="flex cursor-pointer items-center gap-2 text-fine text-ink-secondary">
          <input
            type="checkbox"
            checked={showOrg}
            onChange={(e) => setShowOrg(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t("perm.sysadmin.deptDebugToggle")}
        </label>
      </div>

      <TableCard>
        <thead>
          <tr className={ADMIN_HEAD_ROW}>
            <th className={ADMIN_TH}>{t("perm.sysadmin.deptColName")}</th>
            <th className={ADMIN_TH}>{t("admin.deptKrCol")}</th>
            {/* org 미보기 시 인원수 열 / member-count column when org view is off */}
            {!showOrg && <th className={ADMIN_TH}>{t("perm.sysadmin.deptColCount")}</th>}
            {showOrg &&
              orgColIndices.map((i) => (
                <th key={i} className={ADMIN_TH}>
                  {t("perm.sysadmin.deptOrgCol", { n: String(i + 1) })}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((dept, idx) => {
            const members = getDeptMembers(users, dept.org_levels);
            const candidates = aggregateDeptKoreanDepts(members);
            return (
              <tr key={idx} className={ADMIN_ROW} data-id="dept-row">
                <td className={ADMIN_TD}>{dept.name}</td>
                {/* 매핑된 한글부서 — 복수면 상하 나열, 필 + 인원수 */}
                <td className={ADMIN_TD} data-id="dept-kr-cell">
                  <div className="flex flex-col items-start gap-1">
                    {candidates.map((c) => (
                      <span key={c.value} className={PILL}>
                        {c.value}
                        <span className="text-ink-tertiary">{c.count}</span>
                      </span>
                    ))}
                  </div>
                </td>
                {!showOrg && (
                  <td className={ADMIN_TD}>
                    <RosterHover members={members} count={members.length} />
                  </td>
                )}
                {showOrg &&
                  orgColIndices.map((i) => (
                    <td key={i} className={`${ADMIN_TD} text-ink-tertiary`}>
                      {dept.org_levels[i] ?? ""}
                    </td>
                  ))}
              </tr>
            );
          })}
          {hasMore && (
            <tr ref={sentinelRef}>
              <td className={ADMIN_TD} colSpan={colCount} />
            </tr>
          )}
        </tbody>
      </TableCard>
    </div>
  );
}
