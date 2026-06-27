"use client";

// 시스템 관리자 승인 큐 — 대기 항목(그룹 생성 · 권한 하향 · 가시성 변경)을 모두 카드로 노출.
// 각 카드는 아이콘/필로 내용을 한눈에 보여준다(필터 아님, 전부 표시). 결정 후 재조회. /
// Sysadmin approval queue: every pending item (group creation / permission downgrade / visibility
// change) is shown as a card whose content is conveyed with icons + pills for at-a-glance review.

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ArrowRight, Globe, Lock, Map, ShieldAlert, Star, User, Users } from "lucide-react";

import {
  decideApprovalRequest,
  decideGroup,
  listPendingApprovalRequests,
  listPendingGroups,
  type ApprovalRequest,
  type Group,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import type { ToastItem } from "@/components/toast-stack";

interface Props {
  onToast: (item: ToastItem) => void;
  // 좌측 nav 배지용 — 로드/결정 후 대기 건수 보고 / report pending count for the nav badge.
  onCountChange?: (count: number) => void;
}

type QueueItem =
  | { key: string; kind: "group_create"; group: Group }
  | { key: string; kind: "permission_downgrade" | "visibility_change"; req: ApprovalRequest };

// 필 / pill chip.
function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-fine ${
        className ?? "border-hairline text-ink-secondary"
      }`}
    >
      {children}
    </span>
  );
}

export function ApprovalQueue({ onToast, onCountChange }: Props) {
  const { t } = useI18n();

  const [pendingGroups, setPendingGroups] = useState<Group[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  const [decidingKeys, setDecidingKeys] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      const [groups, requests] = await Promise.all([
        listPendingGroups(),
        listPendingApprovalRequests(),
      ]);
      setPendingGroups(groups);
      setPendingRequests(requests);
      onCountChange?.(groups.length + requests.length);
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }, [onToast, onCountChange]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [groups, requests] = await Promise.all([
          listPendingGroups(),
          listPendingApprovalRequests(),
        ]);
        if (active) {
          setPendingGroups(groups);
          setPendingRequests(requests);
          onCountChange?.(groups.length + requests.length);
        }
      } catch (err) {
        if (active) onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, [onToast, onCountChange]);

  const items: QueueItem[] = [
    ...pendingGroups.map((g) => ({ key: `g${g.id}`, kind: "group_create" as const, group: g })),
    ...pendingRequests.map((r) => ({
      key: `r${r.id}`,
      kind: r.kind as "permission_downgrade" | "visibility_change",
      req: r,
    })),
  ];

  async function decideItem(item: QueueItem, decision: "approve" | "reject") {
    setDecidingKeys((prev) => new Set(prev).add(item.key));
    try {
      if (item.kind === "group_create") await decideGroup(item.group.id, decision);
      else await decideApprovalRequest(item.req.id, decision); // approve → 서버가 즉시 적용
      onToast({
        id: genId(),
        message: decision === "approve" ? t("perm.sysadmin.toastApproved") : t("perm.sysadmin.toastRejected"),
      });
      await reload();
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDecidingKeys((prev) => {
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
    }
  }

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.sysadmin.queueEmpty")}
      </p>
    );
  }

  // 카드 1행: 아이콘 + 종류 필 + 한눈 정보 필들 / line 1: kind icon + kind pill + glance pills.
  function glanceLine(item: QueueItem): ReactNode {
    if (item.kind === "group_create") {
      const g = item.group;
      return (
        <>
          <Users size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
          <Pill className="border-accent-tint-border bg-accent-tint text-accent">
            {t("perm.sysadmin.kindGroupCreate")}
          </Pill>
          <span className="truncate text-caption-strong text-ink">{g.name}</span>
          <Pill>
            <Users size={11} strokeWidth={1.5} />
            {g.members.length}
          </Pill>
          {g.managers.length > 0 && (
            <Pill className="border-accent text-accent">
              <Star size={11} strokeWidth={1.5} className="fill-current" />
              {g.managers.join(", ")}
            </Pill>
          )}
        </>
      );
    }
    if (item.kind === "permission_downgrade") {
      const p = item.req.payload;
      const to = p.to_role == null ? t("perm.approvals.roleRemoved") : String(p.to_role);
      return (
        <>
          <ShieldAlert size={14} strokeWidth={1.5} className="shrink-0 text-changed" />
          <Pill className="border-changed text-changed">{t("perm.sysadmin.kindDowngrade")}</Pill>
          <Pill>
            <Map size={11} strokeWidth={1.5} />
            {t("perm.sysadmin.mapLabel")} {item.req.map_id}
          </Pill>
          <span className="truncate text-caption text-ink">{String(p.principal_id)}</span>
          <Pill className="border-hairline text-ink">{String(p.from_role ?? "")}</Pill>
          <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <Pill className={p.to_role == null ? "border-error text-error" : "border-hairline text-ink"}>
            {to}
          </Pill>
        </>
      );
    }
    // visibility_change
    const toVis = String(item.req.payload.to_visibility ?? "");
    const toPublic = toVis === "public";
    return (
      <>
        {toPublic ? (
          <Globe size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
        ) : (
          <Lock size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        )}
        <Pill className="border-hairline text-ink-secondary">{t("perm.sysadmin.kindVisibility")}</Pill>
        <Pill>
          <Map size={11} strokeWidth={1.5} />
          {t("perm.sysadmin.mapLabel")} {item.req.map_id}
        </Pill>
        <ArrowRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <Pill className={toPublic ? "border-accent text-accent" : "border-hairline text-ink"}>
          {toPublic ? <Globe size={11} strokeWidth={1.5} /> : <Lock size={11} strokeWidth={1.5} />}
          {t(toPublic ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
        </Pill>
      </>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-2">
      {items.map((item) => {
        const requester = item.kind === "group_create" ? item.group.created_by : item.req.requested_by;
        const deciding = decidingKeys.has(item.key);
        return (
          <div
            key={item.key}
            className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">{glanceLine(item)}</div>
              <span className="flex items-center gap-1 text-fine text-ink-tertiary">
                <User size={11} strokeWidth={1.5} />
                {t("perm.sysadmin.requesterLabel")}: {requester}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded-sm border border-added px-3 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-40"
                onClick={() => void decideItem(item, "approve")}
                disabled={deciding}
              >
                {t("perm.sysadmin.approve")}
              </button>
              <button
                type="button"
                className="rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-40"
                onClick={() => void decideItem(item, "reject")}
                disabled={deciding}
              >
                {t("perm.sysadmin.reject")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
