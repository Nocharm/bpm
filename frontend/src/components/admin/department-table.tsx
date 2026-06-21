"use client";

// 부서 테이블 — 기본: 부서명·코드. 디버그 토글 시 가변 orgLevels 컬럼 노출 /
// Department table — default: name + code. Debug toggle reveals variable-length orgLevels columns.
// orgLevels depth is VARIABLE — max depth computed at runtime, never hardcoded.

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/mock/permissions";

export function DepartmentTable() {
  const { t } = useI18n();
  const state = usePermissions();
  const [showOrg, setShowOrg] = useState(false);

  const departments = state.departments;

  // orgLevels 최대 깊이 동적 계산 — 절대 하드코딩 금지 /
  // Compute max orgLevels length dynamically across all departments.
  const maxOrgDepth = departments.reduce(
    (max, d) => Math.max(max, d.orgLevels.length),
    0,
  );

  // Org 컬럼 인덱스 배열 (0-based, label은 1-based) /
  // Column index array for orgLevels (0-based; labels are 1-based).
  const orgColIndices = Array.from({ length: maxOrgDepth }, (_, i) => i);

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

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-caption">
          <thead>
            <tr className="border-b border-hairline">
              <th className="py-2 pr-4 text-left text-fine text-ink-secondary">
                {t("perm.sysadmin.deptColName")}
              </th>
              <th className="py-2 pr-4 text-left text-fine text-ink-secondary">
                {t("perm.sysadmin.deptColCode")}
              </th>
              {showOrg &&
                orgColIndices.map((i) => (
                  <th
                    key={i}
                    className="py-2 pr-4 text-left text-fine text-ink-secondary"
                  >
                    {t("perm.sysadmin.deptOrgCol", { n: String(i + 1) })}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {departments.map((dept) => (
              <tr
                key={dept.id}
                className="border-b border-hairline last:border-0 hover:bg-surface-alt"
              >
                <td className="py-2 pr-4 text-ink">{dept.name}</td>
                <td className="py-2 pr-4 font-mono text-ink-secondary">{dept.code}</td>
                {showOrg &&
                  orgColIndices.map((i) => (
                    <td key={i} className="py-2 pr-4 text-ink-tertiary">
                      {dept.orgLevels[i] ?? ""}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
