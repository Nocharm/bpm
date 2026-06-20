"use client";

// 사용자 목록 (읽기 전용) — 이름·로그인ID·부서·상태·시스템 관리자 태그 /
// User list (read-only) — name, login ID, department, status, sysadmin tag.
// isSysadmin is READ-ONLY: displayed as a tag, no grant/revoke toggle (env-managed).

import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/mock/permissions";

export function UserTable() {
  const { t } = useI18n();
  const state = usePermissions();

  // 부서 id → name 맵 / Department id → name map for display.
  const deptMap = new Map(state.departments.map((d) => [d.id, d.name]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-caption">
        <thead>
          <tr className="border-b border-hairline">
            <th className="py-2 pr-4 text-left text-fine text-ink-secondary">
              {t("perm.sysadmin.userColName")}
            </th>
            <th className="py-2 pr-4 text-left text-fine text-ink-secondary">
              {t("perm.sysadmin.userColId")}
            </th>
            <th className="py-2 pr-4 text-left text-fine text-ink-secondary">
              {t("perm.sysadmin.userColDept")}
            </th>
            <th className="py-2 pr-4 text-left text-fine text-ink-secondary">
              {t("perm.sysadmin.userColStatus")}
            </th>
          </tr>
        </thead>
        <tbody>
          {state.users.map((user) => (
            <tr
              key={user.id}
              className="border-b border-hairline last:border-0 hover:bg-surface-alt"
            >
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <span className="text-ink">{user.name}</span>
                  {/* 시스템 관리자 태그 — 읽기 전용 (env 관리) /
                      Sysadmin tag — read-only, env-managed, no toggle. */}
                  {user.isSysadmin && (
                    <span
                      className="rounded-sm border border-accent px-1.5 py-0.5 text-fine text-accent"
                      title={t("perm.sysadmin.userSysadminNote")}
                    >
                      {t("perm.sysadmin.userSysadminTag")}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-2 pr-4 font-mono text-ink-secondary">{user.id}</td>
              <td className="py-2 pr-4 text-ink-secondary">
                {deptMap.get(user.departmentId) ?? user.departmentId}
              </td>
              <td className="py-2 pr-4">
                <span
                  className={`rounded-sm border px-1.5 py-0.5 text-fine ${
                    user.status === "active"
                      ? "border-added text-added"
                      : "border-error text-error"
                  }`}
                >
                  {user.status === "active"
                    ? t("perm.sysadmin.userStatusActive")
                    : t("perm.sysadmin.userStatusInactive")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
