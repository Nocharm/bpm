"use client";

// sysadmin 전용 권한 관리 콘솔 (§7.4) — 승인 큐 · 부서 · 사용자 /
// Sysadmin-only permissions console: approval queue, department table, user list.
// Gate: isSysadmin (mock User). Non-sysadmin sees a notice, no redirect.

import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { ApprovalQueue } from "@/components/admin/approval-queue";
import { DepartmentTable } from "@/components/admin/department-table";
import { UserTable } from "@/components/admin/user-table";

// ── 탭 정의 / Tab definitions ────────────────────────────────────

type TabId = "queue" | "depts" | "users";

interface Tab {
  id: TabId;
  labelKey:
    | "perm.sysadmin.tabQueue"
    | "perm.sysadmin.tabDepts"
    | "perm.sysadmin.tabUsers";
}

const TABS: Tab[] = [
  { id: "queue", labelKey: "perm.sysadmin.tabQueue" },
  { id: "depts", labelKey: "perm.sysadmin.tabDepts" },
  { id: "users", labelKey: "perm.sysadmin.tabUsers" },
];

// ── 메인 페이지 컴포넌트 / Main page component ──────────────────

export default function SysadminPermissionsPage() {
  const { t } = useI18n();
  const me = useCurrentMockUser();
  const [activeTab, setActiveTab] = useState<TabId>("queue");
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function showToast(item: ToastItem) {
    setToasts((prev) => [item, ...prev]);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // ── 게이트: 비 sysadmin / Gate: non-sysadmin sees notice ──────
  if (!me?.isSysadmin) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-caption text-ink-tertiary">
          권한 없음 (시스템 관리자 전용)
        </p>
      </div>
    );
  }

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="flex h-full flex-col">
        {/* 페이지 헤더 / Page header */}
        <header className="border-b border-hairline bg-surface px-6 py-4">
          <h1 className="text-body-strong text-ink">{t("perm.sysadmin.pageTitle")}</h1>
        </header>

        {/* 탭 네비게이션 / Tab navigation */}
        <nav className="flex border-b border-hairline px-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`px-4 py-2.5 text-caption transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-accent text-accent"
                  : "text-ink-tertiary hover:text-ink"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        {/* 탭 콘텐츠 / Tab content */}
        <main className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === "queue" ? (
            <ApprovalQueue
              currentUserId={me.id}
              onToast={showToast}
            />
          ) : activeTab === "depts" ? (
            <DepartmentTable />
          ) : activeTab === "users" ? (
            <UserTable />
          ) : null}
        </main>
      </div>
    </>
  );
}
