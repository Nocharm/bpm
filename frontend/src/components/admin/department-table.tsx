"use client";

// 부서 테이블 — 기본: 부서명. 디버그 토글 시 가변 orgLevels 컬럼 노출 /
// Department table — default: name. Debug toggle reveals variable-length orgLevels columns.
// orgLevels depth is VARIABLE — max depth computed at runtime, never hardcoded.

import { useEffect, useState } from "react";

import { type AdminDept, getAdminUsers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, TableCard } from "./admin-table";

export function DepartmentTable() {
  const { t } = useI18n();
  const [departments, setDepartments] = useState<AdminDept[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOrg, setShowOrg] = useState(false);

  useEffect(() => {
    getAdminUsers()
      .then((data) => setDepartments(data.departments))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // orgLevels 최대 깊이 동적 계산 — 절대 하드코딩 금지 /
  // Compute max orgLevels length dynamically across all departments.
  const maxOrgDepth = departments.reduce(
    (max, d) => Math.max(max, d.org_levels.length),
    0,
  );

  // Org 컬럼 인덱스 배열 (0-based, label은 1-based) /
  // Column index array for orgLevels (0-based; labels are 1-based).
  const orgColIndices = Array.from({ length: maxOrgDepth }, (_, i) => i);

  if (error) {
    return (
      <div className="text-caption text-error">
        Failed to load departments: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 디버그 토글 / Debug toggle */}
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
