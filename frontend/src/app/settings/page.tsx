"use client";

// 설정 콘솔 — 누구나 접근. 좌측 세로 탭이 권한별로 다르게 노출 /
// Settings console: everyone can open it; the left tab rail differs by permission.
//   Groups(모두) · Directory/조직(role=admin) · Permissions/권한(sysadmin)
// 백엔드 무변경 — 서버 엔드포인트 가드(require_admin·sysadmin)가 최종 보호.

import { Fragment, useState, useSyncExternalStore } from "react";

import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { GroupsPanel } from "@/components/groups/groups-panel";
import { EmployeeTable } from "@/components/admin/employee-table";
import { ApprovalQueue } from "@/components/admin/approval-queue";
import { DepartmentTable } from "@/components/admin/department-table";
import { UserTable } from "@/components/admin/user-table";
import { TableViewer } from "@/components/admin/table-viewer";

// ── 탭/카테고리 정의 / Tabs grouped into categories ────────────────

type TabId = "employees" | "queue" | "depts" | "users" | "tables" | "groups";
type Access = "everyone" | "admin" | "sysadmin";

interface Category {
  labelKey: MessageKey;
  access: Access; // 카테고리 노출에 필요한 권한 / permission gating this category
  tabs: { id: TabId; labelKey: MessageKey }[];
}

// 순서: admin/sysadmin 카테고리가 앞, Groups(모두)는 뒤 — 일반 유저는 Groups만 보인다 /
// Order: admin/sysadmin categories first, Groups (everyone) last.
const CATEGORIES: Category[] = [
  {
    labelKey: "admin.catDirectory",
    access: "admin",
    tabs: [{ id: "employees", labelKey: "admin.title" }],
  },
  {
    labelKey: "admin.catPermissions",
    access: "sysadmin",
    tabs: [
      { id: "queue", labelKey: "perm.sysadmin.tabQueue" },
      { id: "depts", labelKey: "perm.sysadmin.tabDepts" },
      { id: "users", labelKey: "perm.sysadmin.tabUsers" },
    ],
  },
  {
    labelKey: "admin.catDatabase",
    access: "sysadmin",
    tabs: [{ id: "tables", labelKey: "db.tablesTab" }],
  },
  {
    labelKey: "nav.groups",
    access: "everyone",
    tabs: [{ id: "groups", labelKey: "perm.group.pageTitle" }],
  },
];

// ── 메인 / Main ────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useI18n();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (item: ToastItem) => setToasts((prev) => [item, ...prev]);
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));

  const canAccess = (access: Access): boolean => {
    if (access === "everyone") return true;
    if (access === "admin") return user?.role === "admin";
    return Boolean(user?.isSysadmin);
  };

  const visibleCategories = CATEGORIES.filter((c) => canAccess(c.access));
  const allTabs = visibleCategories.flatMap((c) => c.tabs);

  // Groups(모두) 카테고리가 항상 있어 비는 경우는 없지만, 방어적으로 / Defensive guard.
  if (allTabs.length === 0) {
    return null;
  }

  // activeTab이 비었거나 더 이상 가시 범위가 아니면 첫 가용 탭으로 폴백 /
  // Fall back to the first visible tab when none selected or selection is no longer visible.
  const current =
    activeTab && allTabs.some((tab) => tab.id === activeTab) ? activeTab : allTabs[0].id;

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="flex h-full">
        {/* 좌측 세로 탭 레일 — 카테고리별 스페이서로 구분 / Left tab rail, categories spaced */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-hairline bg-surface p-3">
          <h1 className="px-3 pb-3 text-body-strong text-ink">{t("nav.settings")}</h1>
          {visibleCategories.map((cat) => (
            <Fragment key={cat.labelKey + cat.access}>
              <p className="px-3 pb-1 pt-4 text-fine uppercase tracking-wide text-ink-tertiary">
                {t(cat.labelKey)}
              </p>
              {cat.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`rounded-sm px-3 py-1.5 text-left text-caption transition-colors ${
                    current === tab.id
                      ? "bg-accent-tint text-accent"
                      : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </Fragment>
          ))}
        </aside>

        {/* 탭 콘텐츠 / Tab content */}
        <main className="flex-1 overflow-y-auto p-6">
          {current === "groups" && <GroupsPanel />}
          {current === "employees" && <EmployeeTable />}
          {current === "queue" && user && (
            <ApprovalQueue currentUserId={user.loginId} onToast={showToast} />
          )}
          {current === "depts" && <DepartmentTable />}
          {current === "users" && <UserTable />}
          {current === "tables" && <TableViewer />}
        </main>
      </div>
    </>
  );
}
