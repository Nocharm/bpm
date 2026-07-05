"use client";

// 알림·승인 인박스 — 홈 폭. 탭(승인 대기/알림). 알림=마스터-디테일(검색·필터·카드), 승인=대기 큐(승인/반려). (design 2026-07-05)

import {
  ArrowLeftRight,
  Bell,
  Check,
  FileCheck,
  List,
  Mail,
  Megaphone,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  approveVersion,
  decideApprovalRequest,
  decideCheckoutRequest,
  listInboxApprovals,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  rejectVersion,
  type InboxApproval,
  type InboxApprovalKind,
  type NotificationItem,
} from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { filterByQuery } from "@/lib/search";
import { useSlashFocus } from "@/lib/use-slash-focus";
import { IconPillFilter, type IconPillOption } from "@/components/icon-pill-filter";
import { SearchBox } from "@/components/search-box";
import { TimePills } from "@/components/time-pills";
import { UserPill } from "@/components/user-pill";

type Tab = "approvals" | "notifications";
type ReadFilter = "all" | "unread";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "approvals", labelKey: "inbox.tabApprovals" },
  { id: "notifications", labelKey: "inbox.tabNotifications" },
];

// 알림 유형별 아이콘 — 공지/승인요청/기타
function typeIcon(type: string): LucideIcon {
  if (type === "notice") return Megaphone;
  if (type === "review_requested") return FileCheck;
  return Bell;
}

// 승인 항목 유형별 아이콘 — 버전 승인/점유권 이전/권한·가시성. 구체 JSX 반환(파생 컴포넌트 금지).
function ApprovalKindIcon({
  kind,
  size = 16,
  className,
}: {
  kind: InboxApprovalKind;
  size?: number;
  className?: string;
}) {
  if (kind === "version_approval")
    return <FileCheck size={size} strokeWidth={1.5} className={className} />;
  if (kind === "checkout_transfer")
    return <ArrowLeftRight size={size} strokeWidth={1.5} className={className} />;
  return <ShieldCheck size={size} strokeWidth={1.5} className={className} />;
}

function approvalKindLabel(kind: InboxApprovalKind): MessageKey {
  return `inbox.approvalKind.${kind}`;
}

export default function InboxPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("notifications");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [approvals, setApprovals] = useState<InboxApproval[]>([]);
  const [selectedApprovalKey, setSelectedApprovalKey] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [nowMs] = useState(() => Date.now());
  const dir = useDirectory(); // 요청자 login_id → 이름 해석(검색·표시)
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  useEffect(() => {
    let alive = true;
    listNotifications().then((data) => {
      if (alive) setItems(data);
    });
    listInboxApprovals().then((data) => {
      if (alive) setApprovals(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const unread = items.filter((n) => !n.read).length;
  const byRead = readFilter === "unread" ? items.filter((n) => !n.read) : items;
  const filtered = filterByQuery(byRead, search, (n) => [
    { field: "message", text: n.message },
  ]).map((hit) => hit.item);
  const selected = items.find((n) => n.id === selectedId) ?? null;

  // 승인 큐도 검색 — 제목·맵·요청자(id+이름) 대상
  const filteredApprovals = filterByQuery(approvals, search, (a) => [
    { field: "title", text: a.title },
    { field: "map", text: a.map_name },
    { field: "requester", text: a.requester },
    { field: "requesterName", text: dir.get(a.requester)?.name ?? "" },
  ]).map((hit) => hit.item);

  const approvalKey = (a: InboxApproval) => `${a.kind}:${a.id}`;
  const selectedApproval =
    approvals.find((a) => approvalKey(a) === selectedApprovalKey) ?? null;

  const openNotification = async (notification: NotificationItem) => {
    setSelectedId(notification.id);
    if (!notification.read) {
      const updated = await markNotificationRead(notification.id);
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    }
  };

  const markAll = async () => {
    await markAllNotificationsRead();
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
  };

  // 승인/반려 — kind별 기존 엔드포인트 호출 후 큐 재조회(서버 진실, 낙관적 갱신 금지)
  const actApproval = async (a: InboxApproval, approve: boolean) => {
    if (approvalBusy) return;
    setApprovalBusy(true);
    try {
      if (a.kind === "version_approval") {
        if (approve) await approveVersion(a.id);
        else await rejectVersion(a.id, rejectReason.trim());
      } else if (a.kind === "checkout_transfer") {
        await decideCheckoutRequest(a.id, approve);
      } else {
        await decideApprovalRequest(a.id, approve ? "approve" : "reject");
      }
      const next = await listInboxApprovals();
      setApprovals(next);
      setSelectedApprovalKey(null);
      setRejectReason("");
    } finally {
      setApprovalBusy(false);
    }
  };

  const filterOptions: IconPillOption<ReadFilter>[] = [
    { value: "all", label: t("inbox.filterAll"), Icon: List },
    { value: "unread", label: t("inbox.filterUnread"), Icon: Mail },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col px-8 py-6">
      <div className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 flex-col gap-4">
        {/* 페이지 헤더 — 타이틀(좌) · 모두 읽음(우), 노티스 헤더와 정렬 */}
        <div className="flex shrink-0 items-center justify-between gap-4">
          <h1 className="text-tagline text-ink">Inbox</h1>
          {tab === "notifications" && unread > 0 && (
            <button
              type="button"
              onClick={() => void markAll()}
              className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt hover:text-ink"
            >
              <Check size={14} strokeWidth={1.5} />
              {t("inbox.markAllRead")}
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 gap-4">
          {/* 좌 목록 — 검색·필터(알림 전용) + 탭(우측정렬) + 카드 */}
          <aside className="flex min-w-[18rem] flex-1 flex-col border-r border-hairline">
            <div className="flex flex-col gap-2 py-3 pr-3">
              {/* 검색 — 두 탭 동일 위치. 알림=메시지, 승인=제목·맵·요청자 */}
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={
                  tab === "approvals"
                    ? t("inbox.approvalsSearchPlaceholder")
                    : t("inbox.searchPlaceholder")
                }
                inputRef={searchRef}
              />
              {/* All/안읽음 필터(알림 전용, 좌) · 승인대기/알림 탭(우측정렬) */}
              <div className="flex items-center gap-2">
                {tab === "notifications" && (
                  <IconPillFilter
                    options={filterOptions}
                    value={readFilter}
                    onChange={setReadFilter}
                  />
                )}
                <div className="ml-auto inline-grid grid-cols-2 gap-1 rounded-sm bg-surface-alt p-1 text-fine">
                  {TABS.map((tabDef) => {
                    const active = tab === tabDef.id;
                    const badge = tabDef.id === "notifications" ? unread : approvals.length;
                    return (
                      <button
                        key={tabDef.id}
                        type="button"
                        onClick={() => setTab(tabDef.id)}
                        className={
                          "inline-flex items-center justify-center gap-1 rounded-xs px-3 py-1 transition-colors " +
                          (active ? "bg-surface text-accent shadow-sm" : "text-ink-secondary hover:text-ink")
                        }
                      >
                        {t(tabDef.labelKey)}
                        {badge > 0 && (
                          <span className="rounded-full bg-accent px-1 text-fine text-on-accent">
                            {badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {tab === "approvals" ? (
              filteredApprovals.length === 0 ? (
                <p className="px-4 py-8 text-center text-caption text-ink-tertiary">
                  {t("inbox.approvalsEmpty")}
                </p>
              ) : (
                <ul className="flex flex-1 flex-col gap-2 overflow-y-auto pr-3 pb-3">
                  {filteredApprovals.map((a) => {
                    const key = approvalKey(a);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setSelectedApprovalKey(key)}
                          className={
                            "flex w-full flex-col gap-1.5 rounded-xs border border-hairline px-3 py-2.5 text-left " +
                            (key === selectedApprovalKey
                              ? "border-l-2 border-l-accent bg-accent-tint"
                              : "bg-surface hover:bg-surface-alt")
                          }
                        >
                          {/* 유형 아이콘(좌) · 유형 필(우) */}
                          <div className="flex items-center justify-between">
                            <ApprovalKindIcon kind={a.kind} size={14} className="text-ink-tertiary" />
                            <span className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">
                              {t(approvalKindLabel(a.kind))}
                            </span>
                          </div>
                          <span className="line-clamp-2 text-caption font-semibold text-ink">
                            {a.title}
                          </span>
                          <span className="truncate text-fine text-ink-tertiary">{a.map_name}</span>
                          {/* 요청자 이름 필(좌) · 시간 필(우) */}
                          <div className="flex items-center justify-between gap-2 text-fine text-ink-tertiary">
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="shrink-0">{t("inbox.requestedBy")}</span>
                              <UserPill loginId={a.requester} />
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              <TimePills iso={a.created_at} nowMs={nowMs} />
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-caption text-ink-tertiary">
                {t("inbox.empty")}
              </p>
            ) : (
              <ul className="flex flex-1 flex-col gap-2 overflow-y-auto pr-3 pb-3">
                {filtered.map((n) => {
                  const TypeIcon = typeIcon(n.type);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => void openNotification(n)}
                        className={
                          "flex w-full flex-col gap-1.5 rounded-xs border border-hairline px-3 py-2.5 text-left " +
                          (n.id === selectedId
                            ? "border-l-2 border-l-accent bg-accent-tint"
                            : "bg-surface hover:bg-surface-alt")
                        }
                      >
                        {/* 유형 아이콘(좌) · 읽음(우) */}
                        <div className="flex items-center justify-between">
                          <TypeIcon size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                          {n.read ? (
                            <span className="text-fine text-ink-tertiary">{t("notices.read")}</span>
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                          )}
                        </div>
                        <span
                          className={
                            "line-clamp-2 text-caption " +
                            (n.read ? "text-ink-tertiary" : "font-semibold text-ink")
                          }
                        >
                          {n.message}
                        </span>
                        <div className="flex justify-end gap-1">
                          <TimePills iso={n.created_at} nowMs={nowMs} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* 우 상세 */}
          <div className="min-w-0 flex-[2] overflow-y-auto">
            {tab === "approvals" ? (
              selectedApproval ? (
                <ApprovalDetail
                  approval={selectedApproval}
                  rejectReason={rejectReason}
                  onRejectReasonChange={setRejectReason}
                  busy={approvalBusy}
                  nowMs={nowMs}
                  onApprove={() => void actApproval(selectedApproval, true)}
                  onReject={() => void actApproval(selectedApproval, false)}
                  t={t}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
                  {t("inbox.approvalsSelectPrompt")}
                </div>
              )
            ) : selected ? (
              <article className="px-6 py-4">
                <p className="whitespace-pre-wrap text-body text-ink">{selected.message}</p>
                <div className="mt-2 flex">
                  <TimePills iso={selected.created_at} nowMs={nowMs} />
                </div>
                {selected.map_id !== null && (
                  <Link
                    href={`/maps/${selected.map_id}`}
                    className="mt-4 inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                  >
                    {t("inbox.relatedMap")}
                  </Link>
                )}
              </article>
            ) : (
              <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
                {t("inbox.selectPrompt")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 승인 항목 상세 — 유형·제목·맵·요청자 + 승인/반려. 버전 승인은 반려 사유 필수.
function ApprovalDetail({
  approval,
  rejectReason,
  onRejectReasonChange,
  busy,
  nowMs,
  onApprove,
  onReject,
  t,
}: {
  approval: InboxApproval;
  rejectReason: string;
  onRejectReasonChange: (value: string) => void;
  busy: boolean;
  nowMs: number;
  onApprove: () => void;
  onReject: () => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const needsReason = approval.kind === "version_approval";
  const rejectDisabled = busy || (needsReason && rejectReason.trim().length === 0);

  return (
    <article className="px-6 py-4">
      <div className="flex items-center gap-2">
        <ApprovalKindIcon kind={approval.kind} size={16} className="text-ink-tertiary" />
        <span className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
          {t(approvalKindLabel(approval.kind))}
        </span>
      </div>
      <h2 className="mt-2 text-body-strong text-ink">{approval.title}</h2>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
        <Link href={`/maps/${approval.map_id}`} className="text-accent hover:underline">
          {approval.map_name}
        </Link>
        <span className="text-ink-tertiary">·</span>
        <span className="flex items-center gap-1">
          {t("inbox.requestedBy")}
          <UserPill loginId={approval.requester} />
        </span>
        <span className="flex items-center gap-1">
          <TimePills iso={approval.created_at} nowMs={nowMs} />
        </span>
      </div>

      {approval.detail && Object.keys(approval.detail).length > 0 && (
        <pre className="mt-3 overflow-x-auto rounded-sm bg-surface-alt px-3 py-2 text-fine text-ink-secondary">
          {JSON.stringify(approval.detail, null, 2)}
        </pre>
      )}

      {needsReason && (
        <textarea
          value={rejectReason}
          onChange={(event) => onRejectReasonChange(event.target.value)}
          placeholder={t("inbox.rejectReason")}
          maxLength={500}
          className="mt-4 min-h-20 w-full resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
        >
          <Check size={14} strokeWidth={1.5} />
          {t("inbox.approve")}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={rejectDisabled}
          className="inline-flex items-center gap-1 rounded-sm border border-error/40 px-3 py-1.5 text-caption text-error hover:bg-error/10 disabled:opacity-40"
        >
          <X size={14} strokeWidth={1.5} />
          {t("inbox.reject")}
        </button>
        <Link
          href={`/maps/${approval.map_id}`}
          className="inline-flex items-center gap-1 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
        >
          {t("inbox.viewMap")}
        </Link>
      </div>
    </article>
  );
}
