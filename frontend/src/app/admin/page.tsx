"use client";

// 통합 어드민 콘솔 — 직원 디렉터리(admin) + 권한 콘솔(sysadmin)을 좌측 세로 탭으로 묶음.
// Unified admin console: directory (role=admin) + permissions (sysadmin), left tab rail.
// 게이트는 권한별 카테고리 노출 — 둘 다 없으면 안내. 서버 엔드포인트가 최종 보호.

import { Fragment, useState, useSyncExternalStore } from "react";

import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { EmployeeTable } from "@/components/admin/employee-table";
import { ApprovalQueue } from "@/components/admin/approval-queue";
import { DepartmentTable } from "@/components/admin/department-table";
import { UserTable } from "@/components/admin/user-table";

// ── 탭/카테고리 정의 / Tabs grouped into categories ────────────────

type TabId = "employees" | "queue" | "depts" | "users";
type Access = "admin" | "sysadmin";

interface Category {
  labelKey: MessageKey;
  access: Access; // 카테고리 노출에 필요한 권한 / permission gating this category
  tabs: { id: TabId; labelKey: MessageKey }[];
}

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
];

// ── 메인 / Main ────────────────────────────────────────────────────

export default function AdminConsolePage() {
  const { t } = useI18n();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (item: ToastItem) => setToasts((prev) => [item, ...prev]);
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));

  const canAccess = (access: Access): boolean =>
    access === "admin" ? user?.role === "admin" : Boolean(user?.isSysadmin);

  const visibleCategories = CATEGORIES.filter((c) => canAccess(c.access));
  const allTabs = visibleCategories.flatMap((c) => c.tabs);

  // 권한 없음 — 둘 다 아니면 안내 / No access to any category.
  if (allTabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-caption text-ink-tertiary">{t("admin.noAccess")}</p>
      </div>
    );
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
          <h1 className="px-3 pb-3 text-body-strong text-ink">{t("admin.consoleTitle")}</h1>
          {visibleCategories.map((cat) => (
            <Fragment key={cat.labelKey}>
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
          {current === "employees" && <EmployeeTable />}
          {current === "queue" && user && (
            <ApprovalQueue currentUserId={user.loginId} onToast={showToast} />
          )}
          {current === "depts" && <DepartmentTable />}
          {current === "users" && <UserTable />}
        </main>
      </div>
    </>
  );
}
