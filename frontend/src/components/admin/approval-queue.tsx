"use client";

// 시스템 관리자 승인 큐 — 대기 항목을 아이콘/필로 간소화한 카드로 전부 노출하고, 누르면 상세가 펼쳐진다.
// 펼친 상세도 가시성 확보(라벨+필, 충분한 간격). 결정 후 재조회. /
// Sysadmin approval queue: compact icon/pill cards for every pending item; click to expand the
// detail (readable: labels + pills). Group creation / permission downgrade / visibility change.

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Clock,
  Globe,
  Lock,
  Map,
  ShieldAlert,
  Star,
  User,
  Users,
} from "lucide-react";

import {
  decideApprovalRequest,
  decideGroup,
  listPendingApprovalRequests,
  listPendingGroups,
  type ApprovalRequest,
  type Group,
} from "@/lib/api";
import { formatKst } from "@/lib/datetime";
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

// 펼친 상세의 라벨 행 / labelled row in the expanded detail.
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-fine text-ink-tertiary">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption text-ink">
        {children}
      </span>
    </div>
  );
}

export function ApprovalQueue({ onToast, onCountChange }: Props) {
  const { t } = useI18n();

  const [pendingGroups, setPendingGroups] = useState<Group[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  const [decidingKeys, setDecidingKeys] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

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

  function toggle(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function decideItem(item: QueueItem, decision: "approve" | "reject") {
    setDecidingKeys((prev) => new Set(prev).add(item.key));
    try {
      if (item.kind === "group_create") await decideGroup(item.group.id, decision);
      else await decideApprovalRequest(item.req.id, decision);
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

  // 종류별 아이콘 + 필 + 간단 식별자(헤더) / kind icon, kind pill, brief id for the compact header.
  function kindIcon(item: QueueItem): ReactNode {
    if (item.kind === "group_create")
      return <Users size={14} strokeWidth={1.5} className="shrink-0 text-accent" />;
    if (item.kind === "permission_downgrade")
      return <ShieldAlert size={14} strokeWidth={1.5} className="shrink-0 text-changed" />;
    const toPublic = String(item.req.payload.to_visibility ?? "") === "public";
    return toPublic ? (
      <Globe size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
    ) : (
      <Lock size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
    );
  }
  function kindPill(item: QueueItem): ReactNode {
    if (item.kind === "group_create")
      return (
        <Pill className="border-accent-tint-border bg-accent-tint text-accent">
          {t("perm.sysadmin.kindGroupCreate")}
        </Pill>
      );
    if (item.kind === "permission_downgrade")
      return <Pill className="border-changed text-changed">{t("perm.sysadmin.kindDowngrade")}</Pill>;
    return <Pill className="border-hairline text-ink-secondary">{t("perm.sysadmin.kindVisibility")}</Pill>;
  }
  function brief(item: QueueItem): ReactNode {
    if (item.kind === "group_create")
      return <span className="truncate text-caption-strong text-ink">{item.group.name}</span>;
    return (
      <Pill>
        <Map size={11} strokeWidth={1.5} />
        {t("perm.sysadmin.mapLabel")} {item.req.map_id}
      </Pill>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.sysadmin.queueEmpty")}
      </p>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-2">
      {items.map((item) => {
        const expanded = expandedKeys.has(item.key);
        const deciding = decidingKeys.has(item.key);
        const requester = item.kind === "group_create" ? item.group.created_by : item.req.requested_by;
        return (
          <div key={item.key} className="rounded-md border border-hairline bg-surface">
            {/* 간소 헤더 — 클릭 시 펼침 / compact header, click to expand */}
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-alt"
              onClick={() => toggle(item.key)}
              aria-expanded={expanded}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {kindIcon(item)}
                {kindPill(item)}
                {brief(item)}
              </span>
              <ChevronDown
                size={16}
                strokeWidth={1.5}
                className={`shrink-0 text-ink-tertiary transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>

            {/* 펼친 상세 — 라벨+필, 가시성 확보 / expanded detail */}
            {expanded && (
              <div className="flex flex-col gap-2 border-t border-hairline px-4 py-3">
                {item.kind === "group_create" ? (
                  <>
                    <DetailRow label={t("perm.sysadmin.managerLabel")}>
                      {item.group.managers.map((m) => (
                        <Pill key={m} className="border-accent text-accent">
                          <Star size={11} strokeWidth={1.5} className="fill-current" />
                          {m}
                        </Pill>
                      ))}
                    </DetailRow>
                    <DetailRow label={t("perm.group.membersSection")}>
                      <Pill>
                        <Users size={11} strokeWidth={1.5} />
                        {item.group.members.length}
                      </Pill>
                    </DetailRow>
                  </>
                ) : item.kind === "permission_downgrade" ? (
                  <DetailRow label={t("perm.sysadmin.detailLabel")}>
                    <span className="inline-flex items-center gap-1">
                      <User size={11} strokeWidth={1.5} className="text-ink-tertiary" />
                      {String(item.req.payload.principal_id)}
                    </span>
                    <Pill className="border-hairline text-ink">
                      {String(item.req.payload.from_role ?? "")}
                    </Pill>
                    <ArrowRight size={12} strokeWidth={1.5} className="text-ink-tertiary" />
                    <Pill
                      className={
                        item.req.payload.to_role == null ? "border-error text-error" : "border-hairline text-ink"
                      }
                    >
                      {item.req.payload.to_role == null
                        ? t("perm.approvals.roleRemoved")
                        : String(item.req.payload.to_role)}
                    </Pill>
                  </DetailRow>
                ) : (
                  <DetailRow label={t("perm.sysadmin.detailLabel")}>
                    <Pill
                      className={
                        String(item.req.payload.to_visibility) === "public"
                          ? "border-accent text-accent"
                          : "border-hairline text-ink"
                      }
                    >
                      {String(item.req.payload.to_visibility) === "public" ? (
                        <Globe size={11} strokeWidth={1.5} />
                      ) : (
                        <Lock size={11} strokeWidth={1.5} />
                      )}
                      {t(
                        String(item.req.payload.to_visibility) === "public"
                          ? "perm.visibilityPublic"
                          : "perm.visibilityPrivate",
                      )}
                    </Pill>
                  </DetailRow>
                )}

                <DetailRow label={t("perm.sysadmin.requesterLabel")}>
                  <span className="inline-flex items-center gap-1 text-ink-secondary">
                    <User size={11} strokeWidth={1.5} className="text-ink-tertiary" />
                    {requester}
                  </span>
                  {item.kind !== "group_create" && (
                    <span className="inline-flex items-center gap-1 text-fine text-ink-tertiary">
                      <Clock size={11} strokeWidth={1.5} />
                      {formatKst(item.req.created_at)}
                    </span>
                  )}
                </DetailRow>

                <div className="mt-1 flex justify-end gap-2">
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
            )}
          </div>
        );
      })}
    </div>
  );
}
