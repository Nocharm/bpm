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
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  approveVersion,
  decideApprovalRequest,
  decideCheckoutRequest,
  getWorkflowState,
  listInboxApprovals,
  listMapPermissions,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  rejectVersion,
  type DirectoryUser,
  type InboxApproval,
  type InboxApprovalKind,
  type MapPermission,
  type NotificationItem,
  type WorkflowState,
} from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { filterByQuery } from "@/lib/search";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { useSlashFocus } from "@/lib/use-slash-focus";
import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { IconPillFilter, type IconPillOption } from "@/components/icon-pill-filter";
import { MarkdownView } from "@/components/markdown-view";
import { SearchBox } from "@/components/search-box";
import { TimePills } from "@/components/time-pills";
import { UserPill } from "@/components/user-pill";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

// approval_request는 title이 내부 kind(visibility_change 등) — 읽기 좋은 라벨로.
function approvalTitle(a: InboxApproval, t: Translate): string {
  if (a.kind === "approval_request") {
    if (a.title === "visibility_change") return t("inbox.reqKind.visibility_change");
    if (a.title === "permission_downgrade") return t("inbox.reqKind.permission_downgrade");
  }
  return a.title;
}

// 요청 내용 요약 — inline code(`값`) + 변경 후 값 강조. MarkdownView로 렌더.
function approvalSummary(a: InboxApproval, t: Translate): string {
  if (a.kind === "version_approval")
    return t("inbox.summary.version_approval", { label: a.version_label ?? a.title });
  if (a.kind === "checkout_transfer")
    return t("inbox.summary.checkout_transfer", { label: a.version_label ?? a.title });
  if (a.title === "permission_downgrade")
    return t("inbox.summary.permission_downgrade", { before: a.before ?? "?", after: a.after ?? "?" });
  return t("inbox.summary.visibility_change", { before: a.before ?? "?", after: a.after ?? "?" });
}

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
  // 25개씩 증분 렌더 — 알림·승인 두 목록 각각(읽음 필터·검색 변경 시 리셋)
  const {
    visible: shownItems,
    hasMore: hasMoreItems,
    sentinelRef: itemsSentinelRef,
  } = useInfiniteSlice(filtered, `${readFilter}:${search}`);
  const selected = items.find((n) => n.id === selectedId) ?? null;

  // 승인 큐도 검색 — 제목·맵·요청자(id+이름) 대상
  const filteredApprovals = filterByQuery(approvals, search, (a) => [
    { field: "title", text: a.title },
    { field: "map", text: a.map_name },
    { field: "requester", text: a.requester },
    { field: "requesterName", text: dir.get(a.requester)?.name ?? "" },
  ]).map((hit) => hit.item);
  const {
    visible: shownApprovals,
    hasMore: hasMoreApprovals,
    sentinelRef: approvalsSentinelRef,
  } = useInfiniteSlice(filteredApprovals, search);

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
  const actApproval = async (a: InboxApproval, approve: boolean, reason: string) => {
    if (approvalBusy) return;
    setApprovalBusy(true);
    try {
      if (a.kind === "version_approval") {
        if (approve) await approveVersion(a.id);
        else await rejectVersion(a.id, reason.trim());
      } else if (a.kind === "checkout_transfer") {
        await decideCheckoutRequest(a.id, approve);
      } else {
        await decideApprovalRequest(a.id, approve ? "approve" : "reject");
      }
      const next = await listInboxApprovals();
      setApprovals(next);
      setSelectedApprovalKey(null);
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

        {/* 빈 여백 클릭 = 선택 해제(알림·승인 모두) — 맵 탭과 동일. 카드·상세는 stopPropagation으로 제외 (batch2 ⑩) */}
        <div
          className="flex min-h-0 flex-1 gap-4"
          onClick={() => {
            setSelectedId(null);
            setSelectedApprovalKey(null);
          }}
        >
          {/* 좌 목록 — 검색·필터(알림 전용) + 탭(우측정렬) + 카드 */}
          <aside className="flex min-w-[18rem] flex-1 flex-col">
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
                  {shownApprovals.map((a) => {
                    const key = approvalKey(a);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation(); // 카드 선택이 배경(선택 해제)으로 버블링 방지
                            setSelectedApprovalKey(key);
                          }}
                          className={
                            "flex w-full flex-col gap-1.5 rounded-xs border border-hairline px-3 py-2.5 text-left " +
                            (key === selectedApprovalKey
                              ? "border-l-2 border-l-accent bg-accent-tint"
                              : "bg-surface hover:bg-surface-alt")
                          }
                        >
                          {/* 아이콘 + 제목(우측) · 유형 필(맨 오른쪽) */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <ApprovalKindIcon
                                kind={a.kind}
                                size={14}
                                className="shrink-0 text-ink-tertiary"
                              />
                              <span className="truncate text-caption font-semibold text-ink">
                                {approvalTitle(a, t)}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">
                              {t(approvalKindLabel(a.kind))}
                            </span>
                          </div>
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
                  {hasMoreApprovals && <li ref={approvalsSentinelRef} className="h-px shrink-0" />}
                </ul>
              )
            ) : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-caption text-ink-tertiary">
                {t("inbox.empty")}
              </p>
            ) : (
              <ul className="flex flex-1 flex-col gap-2 overflow-y-auto pr-3 pb-3">
                {shownItems.map((n) => {
                  const TypeIcon = typeIcon(n.type);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation(); // 카드 선택이 배경(선택 해제)으로 버블링 방지
                          void openNotification(n);
                        }}
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
                {hasMoreItems && <li ref={itemsSentinelRef} className="h-px shrink-0" />}
              </ul>
            )}
          </aside>

          {/* 우 상세 — 맵 탭처럼 옅은 회색 바디박스 */}
          <div
            className="min-w-0 flex-[2] overflow-y-auto rounded-sm border border-hairline bg-surface-alt"
            onClick={(e) => e.stopPropagation()}
          >
            {tab === "approvals" ? (
              selectedApproval ? (
                <ApprovalDetail
                  key={approvalKey(selectedApproval)}
                  approval={selectedApproval}
                  busy={approvalBusy}
                  nowMs={nowMs}
                  dir={dir}
                  onAct={(approve, reason) => void actApproval(selectedApproval, approve, reason)}
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

// 승인 항목 상세 — 요청 내용·메타·승인자 현황(버전) + 승인/반려(에디터와 동일한 ConfirmDialog).
function ApprovalDetail({
  approval,
  busy,
  nowMs,
  dir,
  onAct,
  t,
}: {
  approval: InboxApproval;
  busy: boolean;
  nowMs: number;
  dir: Map<string, DirectoryUser>;
  onAct: (approve: boolean, reason: string) => void;
  t: Translate;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);

  const isVersion = approval.kind === "version_approval";
  const versionId = approval.version_id;

  // 버전 승인 — 승인자 현황(누가 승인/대기/반려) 조회
  useEffect(() => {
    if (!isVersion || versionId === null) return;
    let alive = true;
    getWorkflowState(versionId)
      .then((data) => {
        if (alive) setWorkflow(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isVersion, versionId]);

  const resolveName = (id: string) => dir.get(id)?.name ?? id;
  const approvers = workflow?.approvers ?? [];
  const approvals = new Set(workflow?.approvals ?? []);
  const rejectedBy = workflow?.rejected_by ?? null;

  // ConfirmDialog lines(에디터 승인/반려 모달과 동일) — 승인자별 상태 뱃지
  const approverLines: ConfirmLine[] = approvers.map((id) => {
    const rejected = id === rejectedBy;
    const approved = !rejected && approvals.has(id);
    return {
      icon: rejected ? (
        <X size={14} strokeWidth={1.5} />
      ) : approved ? (
        <Check size={14} strokeWidth={1.5} />
      ) : (
        <User size={14} strokeWidth={1.5} />
      ),
      text: resolveName(id),
      tone: approved ? "ink" : "muted",
      badge: rejected
        ? { text: t("approval.statusRejected"), tone: "warn" }
        : {
            text: approved ? t("approval.statusApproved") : t("approval.statusPending"),
            tone: approved ? "approved" : "pending",
          },
    };
  });

  const subtitle = `${approval.map_name}${approval.version_label ? ` · ${approval.version_label}` : ""}`;

  return (
    <article className="px-6 py-4">
      {/* 헤더 — 아이콘 + 제목 + 유형 필 */}
      <div className="flex items-center gap-2">
        <ApprovalKindIcon kind={approval.kind} size={16} className="shrink-0 text-ink-tertiary" />
        <h2 className="min-w-0 flex-1 truncate text-body-strong text-ink">
          {approvalTitle(approval, t)}
        </h2>
        <span className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 text-fine text-ink-secondary">
          {t(approvalKindLabel(approval.kind))}
        </span>
      </div>

      {/* 요청 내용 — 마크다운(`값` inline code + 변경 후 값 강조) */}
      <div className="mt-3 rounded-sm border border-hairline bg-surface px-3 py-2">
        <MarkdownView source={approvalSummary(approval, t)} />
      </div>

      {/* 상세 메타 — 맵·버전·업데이트·요청 시각·요청자(+점유자/대상) */}
      <dl className="mt-4 flex flex-col gap-2 text-caption">
        <DetailRow label={t("inbox.map")}>
          <Link href={`/maps/${approval.map_id}`} className="text-accent hover:underline">
            {approval.map_name}
          </Link>
        </DetailRow>
        {approval.version_label && (
          <DetailRow label={t("inbox.version")}>
            <span className="rounded-sm bg-surface px-1.5 py-0.5 text-fine text-ink-secondary">
              {approval.version_label}
              {approval.version_number ? ` · v${approval.version_number}` : ""}
            </span>
          </DetailRow>
        )}
        {approval.updated_at && (
          <DetailRow label={t("inbox.updatedAt")}>
            <TimePills iso={approval.updated_at} nowMs={nowMs} />
          </DetailRow>
        )}
        <DetailRow label={t("inbox.requestedAt")}>
          <TimePills iso={approval.created_at} nowMs={nowMs} />
        </DetailRow>
        <DetailRow label={t("inbox.requestedBy")}>
          <UserPill loginId={approval.requester} />
        </DetailRow>
        {approval.holder && (
          <DetailRow label={t("inbox.holder")}>
            <UserPill loginId={approval.holder} />
          </DetailRow>
        )}
        {approval.principal && (
          <DetailRow label={t("inbox.target")}>
            <UserPill loginId={approval.principal} />
          </DetailRow>
        )}
      </dl>

      {/* 승인자 현황 — 버전 승인만(✓승인/○대기/✗반려) */}
      {isVersion && approvers.length > 0 && (
        <div className="mt-4">
          <span className="text-caption-strong text-ink-secondary">
            {t("inbox.approverStatus")}
          </span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {approvers.map((id) => {
              const rejected = id === rejectedBy;
              const approved = !rejected && approvals.has(id);
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-tint text-fine font-semibold text-accent">
                    {resolveName(id).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">
                    {resolveName(id)}
                  </span>
                  {rejected ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-fine text-error">
                      <X size={12} strokeWidth={2} />
                      {t("approval.statusRejected")}
                    </span>
                  ) : approved ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-fine text-added">
                      <Check size={12} strokeWidth={2} />
                      {t("approval.statusApproved")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-fine text-ink-tertiary">
                      {t("approval.statusPending")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 멤버 보기 — 맵 허용 인원. key로 맵 변경 시 상태 리셋 */}
      <MapMembers key={approval.map_id} mapId={approval.map_id} t={t} />

      {/* 액션 — 클릭 시 에디터와 동일한 확인 모달 */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setApproveOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
        >
          <Check size={14} strokeWidth={1.5} />
          {t("inbox.approve")}
        </button>
        <button
          type="button"
          onClick={() => setRejectOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-sm border border-error/40 px-3 py-1.5 text-caption text-error hover:bg-error/10 disabled:opacity-40"
        >
          <X size={14} strokeWidth={1.5} />
          {t("inbox.reject")}
        </button>
        <Link
          href={`/maps/${approval.map_id}`}
          className="inline-flex items-center gap-1 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface"
        >
          {t("inbox.viewMap")}
        </Link>
      </div>

      {/* 승인 확인 모달(에디터 approve 모달과 동일 컴포넌트) */}
      {approveOpen && (
        <ConfirmDialog
          icon={<Check size={28} strokeWidth={1.5} />}
          title={t("approval.approveConfirmTitle")}
          message={subtitle}
          lines={isVersion ? approverLines : undefined}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setApproveOpen(false);
            onAct(true, "");
          }}
          onClose={() => setApproveOpen(false)}
        />
      )}

      {/* 반려 확인 모달 — 버전 승인은 사유 입력 필수(에디터 reject 모달과 동일) */}
      {rejectOpen && (
        <ConfirmDialog
          icon={<X size={28} strokeWidth={1.5} />}
          danger
          title={t("wf.rejectTitle")}
          message={subtitle}
          lines={isVersion ? approverLines : undefined}
          input={
            isVersion
              ? {
                  value: rejectReason,
                  onChange: setRejectReason,
                  placeholder: t("wf.rejectReason"),
                }
              : undefined
          }
          confirmDisabled={isVersion && rejectReason.trim().length === 0}
          confirmLabel={t("inbox.reject")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const reason = rejectReason.trim();
            setRejectOpen(false);
            setRejectReason("");
            onAct(false, reason);
          }}
          onClose={() => {
            setRejectOpen(false);
            setRejectReason("");
          }}
        />
      )}
    </article>
  );
}

// 상세 메타 한 줄 — 라벨(좌) · 값(우, 필/링크/컴포넌트)
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-tertiary">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">{children}</dd>
    </div>
  );
}

// 멤버 보기 — 맵 허용 인원(사용자=이름 필, 그룹=필) + 역할. 펼칠 때 1회 조회.
function MapMembers({ mapId, t }: { mapId: number; t: Translate }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<MapPermission[] | null>(null);

  const toggle = () => {
    setOpen((prev) => !prev);
    if (members === null) {
      listMapPermissions(mapId)
        .then(setMembers)
        .catch(() => setMembers([]));
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt hover:text-ink"
      >
        <Users size={14} strokeWidth={1.5} />
        {t("inbox.viewMembers")}
        {members && <span className="text-ink-tertiary">({members.length})</span>}
      </button>
      {open && members && (
        <ul className="mt-2 flex flex-col gap-1">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-xs border border-hairline bg-surface px-2.5 py-1.5"
            >
              {m.principal_type === "user" ? (
                <UserPill loginId={m.principal_id} />
              ) : (
                <span className="truncate rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
                  {t("inbox.group")} #{m.principal_id}
                </span>
              )}
              <span className="shrink-0 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
