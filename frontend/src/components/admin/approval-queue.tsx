"use client";

// 시스템 관리자 승인 큐 — 대기 항목을 아이콘/필로 간소화한 카드로 전부 노출하고, 누르면 상세가 펼쳐진다.
// 펼친 상세도 가시성 확보(라벨+필, 충분한 간격). 결정 후 재조회. /
// Sysadmin approval queue: compact icon/pill cards for every pending item; click to expand the
// detail (readable: labels + pills). Group creation / permission downgrade / visibility change.

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Globe,
  Lock,
  Map as MapIcon,
  ShieldAlert,
  Star,
  User,
  Users,
  X,
} from "lucide-react";

import {
  decideApprovalRequest,
  decideCheckoutRequest,
  decideGroup,
  getDirectory,
  getPendingCheckoutRequests,
  listPendingApprovalRequests,
  listPendingGroups,
  type ApprovalRequest,
  type CheckoutRequestQueue,
  type DirectoryUser,
  type Group,
} from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { genId } from "@/lib/id";
import type { ToastItem } from "@/components/toast-stack";

interface Props {
  onToast: (item: ToastItem) => void;
  // 좌측 nav 배지용 — 로드/결정 후 대기 건수 보고 / report pending count for the nav badge.
  onCountChange?: (count: number) => void;
}

type QueueItem =
  | { key: string; kind: "group_create"; group: Group }
  | { key: string; kind: "permission_downgrade" | "visibility_change"; req: ApprovalRequest }
  | { key: string; kind: "checkout_request"; cr: CheckoutRequestQueue };

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

// 가시성 필 (Globe/Lock + 라벨) / visibility pill.
function VisibilityPill({ isPublic, label }: { isPublic: boolean; label: string }) {
  return (
    <Pill className={isPublic ? "border-accent text-accent" : "border-hairline text-ink"}>
      {isPublic ? <Globe size={11} strokeWidth={1.5} /> : <Lock size={11} strokeWidth={1.5} />}
      {label}
    </Pill>
  );
}

// 요청자 카드 — 이름 우선·아이디·소속(메인 상세 유저 정보 디자인 재활용). 이름 미해석 시 id로 폴백 /
// requester card: name first, then id + department (reuses the home detail user-info style).
function RequesterCard({ id, user }: { id: string; user?: DirectoryUser }) {
  const dept = user?.org_path ? user.org_path.split("/").filter(Boolean).pop() : user?.department;
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-hairline bg-surface-alt px-2.5 py-1.5">
      <User size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-caption text-ink">{user?.name ?? id}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-fine text-ink-tertiary">
          <span className="truncate">{id}</span>
          {dept && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{dept}</span>
            </>
          )}
        </span>
      </span>
    </div>
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
  const visLabel = (v: string): string =>
    t(v === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate");

  const [pendingGroups, setPendingGroups] = useState<Group[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  const [pendingCheckouts, setPendingCheckouts] = useState<CheckoutRequestQueue[]>([]);
  const [decidingKeys, setDecidingKeys] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [usersById, setUsersById] = useState<Map<string, DirectoryUser>>(new Map()); // 요청자 이름·소속 해석

  // 디렉터리 로드 — 요청자 login_id → 이름/소속 / load directory to resolve requester name & dept.
  useEffect(() => {
    let active = true;
    void getDirectory()
      .then((dir) => {
        if (active) setUsersById(new Map(dir.users.map((u) => [u.id, u])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const [groups, requests, checkouts] = await Promise.all([
        listPendingGroups(),
        listPendingApprovalRequests(),
        getPendingCheckoutRequests(),
      ]);
      setPendingGroups(groups);
      setPendingRequests(requests);
      setPendingCheckouts(checkouts);
      onCountChange?.(groups.length + requests.length + checkouts.length);
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }, [onToast, onCountChange]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [groups, requests, checkouts] = await Promise.all([
          listPendingGroups(),
          listPendingApprovalRequests(),
          getPendingCheckoutRequests(),
        ]);
        if (active) {
          setPendingGroups(groups);
          setPendingRequests(requests);
          setPendingCheckouts(checkouts);
          onCountChange?.(groups.length + requests.length + checkouts.length);
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
    ...pendingCheckouts.map((cr) => ({ key: `c${cr.id}`, kind: "checkout_request" as const, cr })),
  ];
  // 25개씩 증분 렌더 — 대기 요청이 몰려도 큐 렌더 부하 없음 (early return보다 앞에서 호출)
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(items, "");

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
      else if (item.kind === "checkout_request")
        await decideCheckoutRequest(item.cr.id, decision === "approve");
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
    if (item.kind === "checkout_request")
      return <ArrowLeftRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />;
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
    if (item.kind === "checkout_request")
      return <Pill className="border-hairline text-ink-secondary">{t("perm.sysadmin.kindCheckout")}</Pill>;
    return <Pill className="border-hairline text-ink-secondary">{t("perm.sysadmin.kindVisibility")}</Pill>;
  }
  function brief(item: QueueItem): ReactNode {
    if (item.kind === "group_create")
      return <span className="truncate text-caption-strong text-ink">{item.group.name}</span>;
    if (item.kind === "checkout_request")
      return (
        <>
          <Pill>
            <MapIcon size={11} strokeWidth={1.5} />
            {item.cr.map_name}
          </Pill>
          <span className="truncate text-caption text-ink-secondary">{item.cr.version_label}</span>
        </>
      );
    return (
      <Pill>
        <MapIcon size={11} strokeWidth={1.5} />
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
      {visible.map((item) => {
        const expanded = expandedKeys.has(item.key);
        const deciding = decidingKeys.has(item.key);
        const requester =
          item.kind === "group_create"
            ? item.group.created_by
            : item.kind === "checkout_request"
              ? item.cr.requested_by
              : item.req.requested_by;
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
                ) : item.kind === "checkout_request" ? (
                  <>
                    <DetailRow label={t("perm.checkout.versionLabel")}>
                      <span className="text-caption text-ink">{item.cr.version_label}</span>
                    </DetailRow>
                    <DetailRow label={t("perm.sysadmin.requesterLabel")}>
                      <RequesterCard id={requester} user={usersById.get(requester)} />
                    </DetailRow>
                    <DetailRow label={t("perm.sysadmin.requestedAt")}>
                      <span className="inline-flex items-center gap-1 text-fine text-ink-tertiary">
                        <Clock size={11} strokeWidth={1.5} />
                        {formatKst(item.cr.created_at)}
                      </span>
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
                    {item.req.payload.from_visibility != null && (
                      <>
                        <VisibilityPill
                          isPublic={String(item.req.payload.from_visibility) === "public"}
                          label={visLabel(String(item.req.payload.from_visibility))}
                        />
                        <ArrowRight size={12} strokeWidth={1.5} className="text-ink-tertiary" />
                      </>
                    )}
                    <VisibilityPill
                      isPublic={String(item.req.payload.to_visibility) === "public"}
                      label={visLabel(String(item.req.payload.to_visibility))}
                    />
                  </DetailRow>
                )}

                {item.kind !== "checkout_request" && (
                  <>
                    <DetailRow label={t("perm.sysadmin.requesterLabel")}>
                      <RequesterCard id={requester} user={usersById.get(requester)} />
                    </DetailRow>
                    {item.kind !== "group_create" && (
                      <DetailRow label={t("perm.sysadmin.requestedAt")}>
                        <span className="inline-flex items-center gap-1 text-fine text-ink-tertiary">
                          <Clock size={11} strokeWidth={1.5} />
                          {formatKst(item.req.created_at)}
                        </span>
                      </DetailRow>
                    )}
                  </>
                )}

                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-sm border border-added px-3 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-40"
                    onClick={() => void decideItem(item, "approve")}
                    disabled={deciding}
                  >
                    <Check size={13} strokeWidth={1.5} />
                    {t("perm.sysadmin.approve")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-40"
                    onClick={() => void decideItem(item, "reject")}
                    disabled={deciding}
                  >
                    <X size={13} strokeWidth={1.5} />
                    {t("perm.sysadmin.reject")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {hasMore && <div ref={sentinelRef} className="h-px" />}
    </div>
  );
}
