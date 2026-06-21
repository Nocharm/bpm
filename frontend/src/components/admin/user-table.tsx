"use client";

// 사용자 목록 (읽기 전용) — 이름·로그인ID·부서·상태·시스템 관리자 태그 /
// User list (read-only) — name, login ID, department, status, sysadmin tag.
// isSysadmin reflects the SERVER is_sysadmin flag (env-managed, no toggle).
// active reflects employees.active (AD userAccountControl bit 0x2, Task 2).

import { useEffect, useState } from "react";

import { type AdminUser, getAdminUsers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function UserTable() {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminUsers()
      .then((data) => setUsers(data.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <div className="text-caption text-error">
        Failed to load users: {error}
      </div>
    );
  }

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
          {users.map((user) => (
            <tr
              key={user.login_id}
              className="border-b border-hairline last:border-0 hover:bg-surface-alt"
            >
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <span className="text-ink">{user.name}</span>
                  {/* 시스템 관리자 태그 — 읽기 전용 (env 관리) /
                      Sysadmin tag — read-only, env-managed, no toggle. */}
                  {user.is_sysadmin && (
                    <span
                      className="rounded-sm border border-accent px-1.5 py-0.5 text-fine text-accent"
                      title={t("perm.sysadmin.userSysadminNote")}
                    >
                      {t("perm.sysadmin.userSysadminTag")}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-2 pr-4 font-mono text-ink-secondary">{user.login_id}</td>
              <td className="py-2 pr-4 text-ink-secondary">{user.department}</td>
              <td className="py-2 pr-4">
                {/* AD active status — derived from userAccountControl bit 0x2 */}
                <span
                  className={user.active ? "text-ink" : "text-ink-secondary"}
                >
                  {user.active
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
