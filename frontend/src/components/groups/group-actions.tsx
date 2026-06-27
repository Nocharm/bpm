"use client";

// 그룹 라이프사이클 액션 — 카드 헤더(타이틀쪽)에 노출. 상태별 버튼(아이콘 전용·호버 라벨) + 확인 모달 + 인라인 이름변경.
// 멤버 편집(추가/제거·매니저 토글)은 GroupDetail이 담당하고, 여기는 그룹 전체 상태 전이만 다룬다. (L6)

import { type ReactNode, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { IconActionButton } from "@/components/icon-action-button";
import {
  deactivateGroup,
  deleteGroup,
  reactivateGroup,
  renameGroup,
  withdrawGroup,
  type Group,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";

export function GroupActions({
  group,
  onGroupChange,
  onGroupGone,
  onReRequest,
  onToast,
}: {
  group: Group;
  onGroupChange: (g: Group) => void;
  onGroupGone?: () => void; // 삭제/철회로 그룹이 사라졌을 때
  onReRequest?: (group: Group) => void; // 거절 그룹 재신청 — 부모가 생성 모달 프리필
  onToast: (msg: string) => void;
}) {
  const { t } = useI18n();
  const currentUser = useCurrentMockUser();
  const groupIdNum = group.id;

  const isGroupManager = currentUser != null && group.managers.includes(currentUser.id);
  const isSysadmin = currentUser?.isSysadmin ?? false;
  const canManage = isSysadmin || isGroupManager || currentUser?.id === group.created_by;

  const [now] = useState(() => Date.now()); // 마운트 고정(순수성)
  const purgeLabel = (deletedAt: string): string => {
    const days = Math.floor((new Date(deletedAt).getTime() + 7 * 86400000 - now) / 86400000);
    return days >= 1 ? t("perm.group.autoDeleteIn", { n: days }) : t("perm.group.autoDeleteSoon");
  };
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const [pendingAction, setPendingAction] = useState<"delete" | "deactivate" | "reactivate" | null>(
    null,
  );

  async function handleDelete() {
    try {
      await deleteGroup(groupIdNum);
      onToast(t("perm.group.toastDeleted"));
      onGroupGone?.();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleWithdraw() {
    try {
      await withdrawGroup(groupIdNum);
      onToast(t("perm.group.toastWithdrawn"));
      onGroupGone?.();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeactivate() {
    try {
      onGroupChange(await deactivateGroup(groupIdNum));
      onToast(t("perm.group.toastDeactivated"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReactivate() {
    try {
      onGroupChange(await reactivateGroup(groupIdNum));
      onToast(t("perm.group.toastReactivated"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRename() {
    const next = renameValue.trim();
    if (!next || next === group.name) {
      setRenaming(false);
      return;
    }
    try {
      onGroupChange(await renameGroup(groupIdNum, next));
      onToast(t("perm.group.toastRenamed"));
      setRenaming(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  type Action = {
    key: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    variant?: "plain" | "accent" | "error";
  };
  const actions: Action[] = [];
  if (group.status === "pending") {
    actions.push({ key: "withdraw", label: t("perm.group.withdraw"), icon: <Undo2 size={13} strokeWidth={1.5} />, onClick: () => void handleWithdraw() });
  } else if (group.status === "active") {
    actions.push({
      key: "rename",
      label: t("perm.group.rename"),
      icon: <Pencil size={13} strokeWidth={1.5} />,
      onClick: () => {
        setRenameValue(group.name);
        setRenaming(true);
      },
    });
    actions.push({ key: "deactivate", label: t("perm.group.deactivate"), icon: <PauseCircle size={13} strokeWidth={1.5} />, onClick: () => setPendingAction("deactivate") });
  } else if (group.status === "inactive") {
    actions.push({ key: "reactivate", label: t("perm.group.reactivate"), icon: <PlayCircle size={13} strokeWidth={1.5} />, onClick: () => setPendingAction("reactivate"), variant: "accent" });
    actions.push({ key: "delete", label: t("perm.group.delete"), icon: <Trash2 size={13} strokeWidth={1.5} />, onClick: () => setPendingAction("delete"), variant: "error" });
  } else if (group.status === "rejected") {
    if (onReRequest) {
      actions.push({ key: "resubmit", label: t("perm.group.resubmit"), icon: <RotateCcw size={13} strokeWidth={1.5} />, onClick: () => onReRequest(group), variant: "accent" });
    }
    actions.push({ key: "delete", label: t("perm.group.delete"), icon: <Trash2 size={13} strokeWidth={1.5} />, onClick: () => setPendingAction("delete"), variant: "error" });
  }

  if (!canManage) return null;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      {group.deleted_at && (
        <span className="flex items-center gap-1 text-fine font-semibold text-error">
          <Clock size={12} strokeWidth={1.5} className="shrink-0" />
          {purgeLabel(group.deleted_at)}
        </span>
      )}
      {renaming ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="w-44 rounded-sm border border-accent bg-surface px-2 py-1 text-caption text-ink outline-none"
          />
          <button type="button" onClick={() => void handleRename()} className="rounded-sm border border-accent p-1 text-accent hover:bg-accent-tint" aria-label={t("perm.group.rename")}>
            <Check size={14} strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => setRenaming(false)} className="rounded-sm border border-hairline p-1 text-ink-tertiary hover:bg-surface-alt" aria-label={t("common.cancel")}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {actions.map((a) => (
            <IconActionButton key={a.key} icon={a.icon} label={a.label} align="right" tone={a.variant} onClick={a.onClick} />
          ))}
        </div>
      )}

      {pendingAction === "delete" && (
        <ConfirmDialog
          icon={<Trash2 size={28} strokeWidth={1.5} />}
          title={t("perm.group.confirmDeleteTitle")}
          message={group.name}
          danger
          lines={
            [
              { icon: <Trash2 size={14} strokeWidth={1.5} />, text: t("delete.lineTrash") },
              { icon: <Clock size={14} strokeWidth={1.5} />, text: t("delete.lineRecover"), tone: "accent" },
              { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("delete.linePurge"), tone: "error" },
            ] satisfies ConfirmLine[]
          }
          confirmLabel={t("delete.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setPendingAction(null);
            void handleDelete();
          }}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === "deactivate" && (
        <ConfirmDialog
          icon={<PauseCircle size={28} strokeWidth={1.5} />}
          title={t("perm.group.confirmDeactivateTitle")}
          lines={
            [
              { icon: <PauseCircle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmDeactivateL1") },
              { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmDeactivateL3"), tone: "error" },
              { icon: <PlayCircle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmDeactivateL2"), tone: "accent" },
            ] satisfies ConfirmLine[]
          }
          confirmLabel={t("perm.group.deactivate")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setPendingAction(null);
            void handleDeactivate();
          }}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === "reactivate" && (
        <ConfirmDialog
          icon={<PlayCircle size={28} strokeWidth={1.5} />}
          title={t("perm.group.confirmReactivateTitle")}
          danger={false}
          lines={
            [
              { icon: <PlayCircle size={14} strokeWidth={1.5} />, text: t("perm.group.confirmReactivateL1"), tone: "accent" },
            ] satisfies ConfirmLine[]
          }
          confirmLabel={t("perm.group.reactivate")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setPendingAction(null);
            void handleReactivate();
          }}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
