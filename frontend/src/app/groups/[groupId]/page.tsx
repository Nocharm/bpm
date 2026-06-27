"use client";

// 유저 그룹 상세 페이지 — 헤더(이름·상태·설명) + 공용 GroupDetail(멤버·관리자·편집) (실 API) /
// Group detail page: header + shared GroupDetail. Direct-URL access; the settings panel renders the same inline.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { GroupActions } from "@/components/groups/group-actions";
import { GroupDetail } from "@/components/groups/group-detail";
import {
  getDirectory,
  getGroup,
  type DirectoryDept,
  type DirectoryUser,
  type Group,
  type GroupStatus,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";

// 그룹 상태 pill / Group status pill.
function GroupStatusBadge({ status }: { status: GroupStatus }) {
  const { t } = useI18n();
  const styles: Record<GroupStatus, string> = {
    active: "border-added text-added",
    pending: "border-changed text-changed",
    rejected: "border-error text-error",
    inactive: "border-divider text-ink-tertiary",
  };
  const labels: Record<GroupStatus, string> = {
    active: t("perm.group.statusActive"),
    pending: t("perm.group.statusPending"),
    rejected: t("perm.group.statusRejected"),
    inactive: t("perm.group.statusInactive"),
  };
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-fine ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const groupIdNum = Number(groupId);
  const { t } = useI18n();
  const router = useRouter();

  const [group, setGroup] = useState<Group | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (message: string) => setToasts((prev) => [{ id: genId(), message }, ...prev]);
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((item) => item.id !== id));

  // 초기 로드 — 그룹 + 디렉터리 / Initial load: group + directory.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [g, dir] = await Promise.all([getGroup(groupIdNum), getDirectory()]);
        if (active) {
          setGroup(g);
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
        }
      } catch {
        // 가시성 규칙상 404(존재 은닉) 포함 — not-found 화면으로 / 404 hides existence per server rule.
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [groupIdNum]);

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Link href="/settings" className="text-caption text-accent hover:underline">
          {t("perm.group.backToList")}
        </Link>
        <p className="text-caption text-ink-tertiary">{t("perm.group.notFound")}</p>
      </div>
    );
  }

  if (group === null) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Link href="/settings" className="text-caption text-accent hover:underline">
          {t("perm.group.backToList")}
        </Link>
        <p className="text-caption text-ink-tertiary">…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Link href="/settings" className="text-caption text-accent hover:underline">
        {t("perm.group.backToList")}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <p className="text-body-strong text-ink">{group.name}</p>
            <GroupStatusBadge status={group.status} />
          </div>
          <p className="text-caption text-ink-tertiary">
            {group.description || t("perm.group.descEmpty")}
          </p>
        </div>
        <GroupActions
          group={group}
          onGroupChange={setGroup}
          onGroupGone={() => router.push("/settings")}
          onReRequest={() => router.push("/settings")}
          onToast={addToast}
        />
      </div>

      <GroupDetail
        group={group}
        dirUsers={dirUsers}
        dirDepts={dirDepts}
        onGroupChange={setGroup}
        onToast={addToast}
      />
    </div>
  );
}
