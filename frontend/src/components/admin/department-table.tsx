"use client";

// 부서 테이블 — 기본: 부서명 + 인원수. 디버그 토글(org 보기) 시 인원수 대신 가변 orgLevels 컬럼 /
// Department table — default: name + member count. Org-view toggle swaps the count for variable orgLevels columns.
// orgLevels depth is VARIABLE — max depth computed at runtime, never hardcoded.

import { useEffect, useState } from "react";

import { type AdminDept, type AdminUser, getAdminUsers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, TableCard } from "./admin-table";

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

  // orgLevels 최대 깊이 동적 계산 — 절대 하드코딩 금지 /
  // Compute max orgLevels length dynamically across all departments.
  const maxOrgDepth = departments.reduce((max, d) => Math.max(max, d.org_levels.length), 0);
  const orgColIndices = Array.from({ length: maxOrgDepth }, (_, i) => i);

  // 부서별 인원수 — org_levels 전체 경로 일치로 집계(말단명 충돌 방지) / member count by full path.
  const memberCount = (dept: AdminDept): number => {
    const path = dept.org_levels.join("/");
    return users.filter((u) => u.org_levels.join("/") === path).length;
  };

  if (error) {
    return (
      <div className="text-caption text-error">Failed to load departments: {error}</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
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

      <TableCard>
        <thead>
          <tr className={ADMIN_HEAD_ROW}>
            <th className={ADMIN_TH}>{t("perm.sysadmin.deptColName")}</th>
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
          {departments.map((dept, idx) => (
            <tr key={idx} className={ADMIN_ROW}>
              <td className={ADMIN_TD}>{dept.name}</td>
              {!showOrg && (
                <td className={`${ADMIN_TD} text-ink-secondary`}>{memberCount(dept)}</td>
              )}
              {showOrg &&
                orgColIndices.map((i) => (
                  <td key={i} className={`${ADMIN_TD} text-ink-tertiary`}>
                    {dept.org_levels[i] ?? ""}
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
      </TableCard>
    </div>
  );
}
