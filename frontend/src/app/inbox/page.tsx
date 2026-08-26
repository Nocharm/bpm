"use client";

// 알림·승인 인박스 — 홈 폭. 탭(승인 대기/알림). 알림=마스터-디테일(검색·필터·카드), 승인=대기 큐(승인/반려). (design 2026-07-05)

import {
  ArrowLeftRight,
  CalendarClock,
  Check,
  CheckSquare,
  FileCheck,
  List,
  Mail,
  Megaphone,
  Network,
  ShieldCheck,
  Square,
  Trash2,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createElement, useEffect, useRef, useState, type ReactNode } from "react";

import {
  approveVersion,
  bulkDeleteNotifications,
  decideApprovalRequest,
  decideCheckoutRequest,
  deleteNotification,
  getApiErrorDetail,
  getMap,
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
  type MapDetail,
  type MapPermission,
  type NotificationItem,
  type WorkflowState,
} from "@/lib/api";
import {
  SubprocessDesignationModal,
  type DesignationForm,
} from "@/components/permissions/subprocess-designation-modal";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { genId } from "@/lib/id";
import { formatKst } from "@/lib/datetime";
import { getNotificationCategory, NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notification-categories";
import { formatNotification, formatNotificationBodyParts, getNotificationIcon } from "@/lib/notification-format";
import { filterByQuery } from "@/lib/search";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { useQuietScroll } from "@/lib/use-quiet-scroll";
import { useSlashFocus } from "@/lib/use-slash-focus";
import { ActivityDigest } from "@/components/activity-digest";
import { AutoHeight } from "@/components/auto-height";
import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import {
  findLatestSubmitComment,
  RequesterCommentBanner,
} from "@/components/version/requester-comment-banner";
import { IconPillFilter, type IconPillOption } from "@/components/icon-pill-filter";
import { MarkdownView } from "@/components/markdown-view";
import { PersonHoverCard } from "@/components/person-hover-card";
import { SearchBox } from "@/components/search-box";
import { TimePills } from "@/components/time-pills";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { UserPill } from "@/components/user-pill";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

// approval_request는 title이 내부 kind(visibility_change 등) — 읽기 좋은 라벨로.
function approvalTitle(a: InboxApproval, t: Translate): string {
  if (a.kind === "approval_request") {
    if (a.title === "visibility_change") return t("inbox.reqKind.visibility_change");
    if (a.title === "permission_downgrade") return t("inbox.reqKind.permission_downgrade");
    if (a.title === "map_rename") return t("inbox.reqKind.map_rename");
    if (a.title === "sp_designation") return t("inbox.reqKind.sp_designation");
  }
  return a.title;
}

// sp_designation payload에서 출처 맵 이름 — 요청자가 볼 수 없는 맵이면 서버가 빈 값으로 박제
function spFromMapName(a: InboxApproval): string {
  const raw = a.detail?.from_map_name;
  return typeof raw === "string" ? raw : "";
}

// 요청 내용 요약 — inline code(`값`) + 변경 후 값 강조. MarkdownView로 렌더.
function approvalSummary(a: InboxApproval, t: Translate): string {
  if (a.kind === "version_approval")
    return t("inbox.summary.version_approval", { label: a.version_label ?? a.title });
  if (a.kind === "checkout_transfer")
    return t("inbox.summary.checkout_transfer", { label: a.version_label ?? a.title });
  if (a.title === "permission_downgrade")
    return t("inbox.summary.permission_downgrade", { before: a.before ?? "?", after: a.after ?? "?" });
  if (a.kind === "approval_request" && a.title === "map_rename")
    return t("inbox.summary.map_rename", { from: a.before ?? "", to: a.after ?? "" });
  if (a.kind === "approval_request" && a.title === "sp_designation") {
    const from = spFromMapName(a);
    return from
      ? t("inbox.summary.sp_designation", { map: a.map_name, from })
      : t("inbox.summary.sp_designation_nofrom", { map: a.map_name });
  }
  return t("inbox.summary.visibility_change", { before: a.before ?? "?", after: a.after ?? "?" });
}

type Tab = "approvals" | "notifications";
type ReadFilter = "all" | "unread";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "approvals", labelKey: "inbox.tabApprovals" },
  { id: "notifications", labelKey: "inbox.tabNotifications" },
];

// 결재 대기 필 — 앞 2명만 이름 필로, 나머지는 "+n"으로 접는다(카드 폭 보호)
function DeciderPills({ logins, t }: { logins: string[]; t: Translate }) {
  if (logins.length === 0) {
    return <span className="truncate">{t("inbox.approverNone")}</span>;
  }
  const shown = logins.slice(0, 2);
  const rest = logins.length - shown.length;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="shrink-0">{t("inbox.pendingOn")}</span>
      {shown.map((login) => (
        <UserPill key={login} loginId={login} />
      ))}
      {rest > 0 && <span className="shrink-0">+{rest}</span>}
    </span>
  );
}

// 알림 유형별 아이콘은 lib/notification-format.getNotificationIcon 공용 (2026-08-26)

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
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("notifications");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | NotificationCategory>("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [beforeDate, setBeforeDate] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<null | "ids" | "read" | "before">(null);
  const [approvals, setApprovals] = useState<InboxApproval[]>([]);
  const [selectedApprovalKey, setSelectedApprovalKey] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = (message: string) => setToasts((prev) => [{ id: genId(), message }, ...prev]);
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));
  const dir = useDirectory(); // 요청자 login_id → 이름 해석(검색·표시)
  // 좌측 목록 — 스크롤하는 동안에만 막대 노출(평소엔 감춤)
  const approvalsScrollRef = useQuietScroll<HTMLUListElement>();
  const notificationsScrollRef = useQuietScroll<HTMLUListElement>();
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  useEffect(() => {
    let alive = true;
    listNotifications().then((data) => {
      if (!alive) return;
      setItems(data);
      // 벨의 딥링크(`?notification=<id>`) 소비 — 탭 전환·선택·읽음 처리 후 URL 파라미터 소거(재트리거 방지)
      const target = Number(new URLSearchParams(window.location.search).get("notification"));
      if (target) {
        setTab("notifications");
        const hit = data.find((n) => n.id === target);
        if (hit) {
          setSelectedId(hit.id);
          if (!hit.read) {
            void markNotificationRead(hit.id).then((updated) => {
              setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            });
          }
        }
        router.replace("/inbox");
      }
    });
    listInboxApprovals().then((data) => {
      if (alive) setApprovals(data);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  const unread = items.filter((n) => !n.read).length;
  const byRead = readFilter === "unread" ? items.filter((n) => !n.read) : items;
  const byCategory =
    categoryFilter === "all"
      ? byRead
      : byRead.filter((n) => getNotificationCategory(n.type) === categoryFilter);
  const filtered = filterByQuery(byCategory, search, (n) => {
    // 언어 토글 렌더 텍스트로도 검색 — 원문 message는 레거시·영어 검색용으로 유지
    const view = formatNotification(n, t);
    return [
      { field: "message", text: n.message },
      { field: "title", text: view.title },
      { field: "body", text: view.body },
    ];
  }).map((hit) => hit.item);
  // 25개씩 증분 렌더 — 알림·승인 두 목록 각각(읽음/카테고리 필터·검색 변경 시 리셋)
  const {
    visible: shownItems,
    hasMore: hasMoreItems,
    sentinelRef: itemsSentinelRef,
  } = useInfiniteSlice(filtered, `${readFilter}:${categoryFilter}:${search}`);
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

  // 선택/읽음/날짜 삭제 3종 — 서버 삭제 후 재조회(unread 배지·목록 서버 진실 반영)
  const performBulkDelete = async () => {
    if (!confirmDelete) return;
    const body =
      confirmDelete === "ids"
        ? { ids: [...selectedIds] }
        : confirmDelete === "read"
          ? { read_only: true as const }
          : { before: beforeDate };
    await bulkDeleteNotifications(body);
    const next = await listNotifications();
    setItems(next);
    setSelectedIds(new Set());
    setSelectMode(false);
    setBeforeDate("");
    setConfirmDelete(null);
    if (selectedId !== null && !next.some((n) => n.id === selectedId)) setSelectedId(null);
  };

  const deleteOne = async (id: number) => {
    await deleteNotification(id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        try {
          await decideApprovalRequest(a.id, approve ? "approve" : "reject", approve ? undefined : reason.trim() || undefined);
          if (a.title === "map_rename")
            pushToast(t(approve ? "inbox.toast.renameApproved" : "inbox.toast.renameRejected"));
          if (a.title === "sp_designation" && !approve)
            pushToast(t("inbox.toast.spRejected"));
        } catch (err) {
          // 승인 시점 이름 선점 409 등 — 백엔드 detail 노출
          pushToast(getApiErrorDetail(err));
        }
      }
      const next = await listInboxApprovals();
      setApprovals(next);
      setSelectedApprovalKey(null);
    } finally {
      setApprovalBusy(false);
    }
  };

  // sp_designation 수락 — decide 대신 지정 모달 저장(PUT이 pending 자동 applied) (spec 2026-07-19)
  const [spModal, setSpModal] = useState<{ approval: InboxApproval; detail: MapDetail } | null>(null);
  const openSpDesignationModal = (approval: InboxApproval, detail: MapDetail) => {
    setSpModal({ approval, detail });
  };
  const spModalPublishedId = spModal
    ? spModal.detail.versions.reduce<number | null>(
        (acc, v) => (v.status === "published" && (acc === null || v.id > acc) ? v.id : acc),
        null,
      )
    : null;
  const spModalInitial: DesignationForm | null = spModal
    ? {
        department: spModal.detail.sp_department ?? "",
        assignee: spModal.detail.sp_assignee ?? "",
        system: spModal.detail.sp_system ?? "",
        duration: spModal.detail.sp_duration ?? "",
        touch_time: spModal.detail.sp_touch_time ?? "",
        cost_krw: spModal.detail.sp_cost_krw ?? "",
        cost_usd: spModal.detail.sp_cost_usd ?? "",
        headcount: spModal.detail.sp_headcount ?? "",
        url: spModal.detail.sp_url ?? "",
        urlLabel: spModal.detail.sp_url_label ?? "",
        input: spModal.detail.sp_input ?? "",
        input_forms: spModal.detail.sp_input_forms ?? "",
        input_ids: spModal.detail.sp_input_ids ?? "",
        output: spModal.detail.sp_output ?? "",
        output_forms: spModal.detail.sp_output_forms ?? "",
        output_ids: spModal.detail.sp_output_ids ?? "",
        description: spModal.detail.sp_description ?? "",
      }
    : null;

  const filterOptions: IconPillOption<ReadFilter>[] = [
    { value: "all", label: t("inbox.filterAll"), Icon: List },
    { value: "unread", label: t("inbox.filterUnread"), Icon: Mail },
  ];

  const CATEGORY_ICONS: Record<NotificationCategory, LucideIcon> = {
    version: FileCheck,
    checkout: ArrowLeftRight,
    permission: ShieldCheck,
    subprocess: Network,
    notice: Megaphone,
  };
  const categoryOptions: IconPillOption<"all" | NotificationCategory>[] = [
    { value: "all", label: t("inbox.catAll"), Icon: List },
    ...NOTIFICATION_CATEGORIES.map((c) => ({
      value: c,
      label: t(`inbox.cat.${c}` as MessageKey),
      Icon: CATEGORY_ICONS[c],
    })),
  ];

  // 페이지 여백을 "직접" 누르면 선택 해제 — 패널 사이 간격(아래 flex row)과 같은 규칙
  const clearSelectionOnEmptyPress = (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (event.target !== event.currentTarget) return;
    setSelectedId(null);
    setSelectedApprovalKey(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-8 py-6" onMouseDown={clearSelectionOnEmptyPress}>
      <div
        className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 flex-col gap-4"
        onMouseDown={clearSelectionOnEmptyPress}
      >
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

        {/* 빈 여백을 "직접" 눌렀을 때만 선택 해제 — 카드·상세에서 올라온 이벤트로는 풀지 않는다.
            (예전엔 click 버블 + 자식 stopPropagation 가드였는데, 가드가 빠진 곳에서 내용 클릭·드래그만 해도
             선택이 풀렸다 — 사용자 피드백 2026-08-19. 홈과 같은 규칙·같은 단계(mousedown)로 통일.) */}
        <div
          className="flex min-h-0 flex-1 gap-4"
          onMouseDown={clearSelectionOnEmptyPress}
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
              {/* 카테고리 필 필터 — 알림 전용(버전/점유권/권한/공지) */}
              {tab === "notifications" && (
                <IconPillFilter
                  options={categoryOptions}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                />
              )}
              {/* 선택/읽음/날짜 삭제 3종 툴바 — 알림 전용 */}
              {tab === "notifications" && (
                <div className="flex flex-wrap items-center gap-2 pb-2 pr-3 text-fine">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectMode((v) => !v);
                      setSelectedIds(new Set());
                    }}
                    className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 ${
                      selectMode
                        ? "border-accent-tint-border bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                  >
                    <CheckSquare size={14} strokeWidth={1.5} />
                    {t("inbox.selectMode")}
                  </button>
                  {selectMode && (
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      onClick={() => setConfirmDelete("ids")}
                      className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-error disabled:opacity-40"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                      {t("inbox.deleteSelected", { count: selectedIds.size })}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!items.some((n) => n.read)}
                    onClick={() => setConfirmDelete("read")}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                    {t("inbox.deleteRead")}
                  </button>
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    <CalendarClock size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                    <input
                      type="date"
                      value={beforeDate}
                      onChange={(e) => setBeforeDate(e.target.value)}
                      className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink"
                    />
                    <button
                      type="button"
                      disabled={!beforeDate}
                      onClick={() => setConfirmDelete("before")}
                      className="rounded-sm border border-hairline px-2 py-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
                    >
                      {t("inbox.deleteBefore")}
                    </button>
                  </span>
                </div>
              )}
            </div>

            {tab === "approvals" ? (
              filteredApprovals.length === 0 ? (
                <p className="px-4 py-8 text-center text-caption text-ink-tertiary">
                  {t("inbox.approvalsEmpty")}
                </p>
              ) : (
                <ul ref={approvalsScrollRef} className="scroll-quiet flex flex-1 flex-col gap-2 overflow-y-auto pr-3 pb-3">
                  {shownApprovals.map((a) => {
                    const key = approvalKey(a);
                    return (
                      <li key={key} className="flex flex-col">
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
                          {/* 결재 주체 — 누구에게 걸려 있는지 + 내가 결재자인지(관리자 열람인지) */}
                          <div className="flex items-center justify-between gap-2 text-fine text-ink-tertiary">
                            <DeciderPills logins={a.pending_on} t={t} />
                            {a.via_sysadmin && (
                              <span
                                title={t("inbox.viaSysadminHint")}
                                className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-surface-alt px-1.5 py-0.5 text-ink-tertiary"
                              >
                                <ShieldCheck size={11} strokeWidth={1.5} />
                                {t("inbox.viaSysadmin")}
                              </span>
                            )}
                          </div>
                        </button>
                        {/* < split(980px) — 카드 아래 인라인 아코디언 (맵 탭과 동일 패턴) */}
                        <div
                          data-id="approval-detail-accordion"
                          onClick={(e) => e.stopPropagation()} // 상세 내부 클릭이 배경(선택 해제)으로 버블링 방지
                          className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth split:hidden ${
                            key === selectedApprovalKey ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                          }`}
                        >
                          <div className="min-h-0 overflow-hidden">
                            {key === selectedApprovalKey && (
                              <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
                                <ApprovalDetail
                                  approval={a}
                                  busy={approvalBusy}
                                  nowMs={nowMs}
                                  dir={dir}
                                  onAct={(approve, reason) => void actApproval(a, approve, reason)}
                                  onSpAccept={openSpDesignationModal}
                                  t={t}
                                />
                              </div>
                            )}
                          </div>
                        </div>
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
              <ul ref={notificationsScrollRef} className="scroll-quiet flex flex-1 flex-col gap-2 overflow-y-auto pr-3 pb-3">
                {shownItems.map((n) => {
                  const TypeIcon = getNotificationIcon(n.type);
                  const view = formatNotification(n, t);
                  return (
                    <li key={n.id} className="flex flex-col">
                      {/* div role=button — 내부 삭제 버튼과의 button-in-button 중첩(validateDOMNesting) 회피 */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation(); // 카드 선택이 배경(선택 해제)으로 버블링 방지
                          if (selectMode) toggleSelected(n.id);
                          else void openNotification(n);
                        }}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return; // 내부 삭제 버튼의 Enter/Space 버블링이 카드 동작으로 새는 것 방지
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          if (selectMode) toggleSelected(n.id);
                          else void openNotification(n);
                        }}
                        className={
                          "flex w-full cursor-pointer flex-col gap-1.5 rounded-xs border border-hairline px-3 py-2.5 text-left " +
                          (n.id === selectedId
                            ? "border-l-2 border-l-accent bg-accent-tint"
                            : "bg-surface hover:bg-surface-alt")
                        }
                      >
                        {/* 선택 표시(선택모드, 시각 전용 — 토글은 카드 클릭) · 유형 아이콘(좌) · 읽음(우) */}
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            {selectMode &&
                              (selectedIds.has(n.id) ? (
                                <CheckSquare size={14} strokeWidth={1.5} className="text-accent" />
                              ) : (
                                <Square size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                              ))}
                            <TypeIcon size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                            {/* 유형 라벨 — 언어 토글 반영 (notification-format) */}
                            <span className="text-fine text-ink-tertiary">{view.label}</span>
                          </span>
                          {n.read ? (
                            <span className="text-fine text-ink-tertiary">{t("notices.read")}</span>
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                          )}
                        </div>
                        <span
                          className={
                            "line-clamp-1 text-caption " +
                            (n.read ? "text-ink-tertiary" : "font-semibold text-ink")
                          }
                        >
                          {view.title}
                        </span>
                        {view.body && (
                          <span
                            className={
                              "line-clamp-2 text-fine " +
                              (n.read ? "text-ink-tertiary" : "text-ink-secondary")
                            }
                          >
                            {view.body}
                          </span>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            aria-label={t("notif.delete")}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteOne(n.id);
                            }}
                            className="text-ink-tertiary hover:text-error"
                          >
                            <Trash2 size={13} strokeWidth={1.5} />
                          </button>
                          <TimePills iso={n.created_at} nowMs={nowMs} />
                        </div>
                      </div>
                      {/* < split(980px) — 카드 아래 인라인 아코디언 (맵 탭과 동일 패턴) */}
                      <div
                        data-id="notification-detail-accordion"
                        onClick={(e) => e.stopPropagation()} // 상세 내부 클릭이 배경(선택 해제)으로 버블링 방지
                        className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth split:hidden ${
                          n.id === selectedId ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          {n.id === selectedId && (
                            <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
                              <NotificationDetail notification={n} nowMs={nowMs} t={t} />
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {hasMoreItems && <li ref={itemsSentinelRef} className="h-px shrink-0" />}
              </ul>
            )}
          </aside>

          {/* 우 상세 — ≥ split(980px)만. 좁으면 카드 아래 아코디언이 대신한다.
              높이는 내용에 맞추고(AutoHeight) 카드 전환 시 이전 높이에서 부드럽게 이어진다;
              가용 높이를 넘으면 max-h-full에 걸려 내부 스크롤. */}
          <AutoHeight
            dataId="inbox-detail-shell"
            className="hidden min-w-0 max-h-full flex-[2] self-start overflow-y-auto rounded-sm border border-hairline bg-surface-alt split:block"
          >
          <div data-id="inbox-detail-aside" onMouseDown={(e) => e.stopPropagation()}>
            {tab === "approvals" ? (
              selectedApproval ? (
                <ApprovalDetail
                  key={approvalKey(selectedApproval)}
                  approval={selectedApproval}
                  busy={approvalBusy}
                  nowMs={nowMs}
                  dir={dir}
                  onAct={(approve, reason) => void actApproval(selectedApproval, approve, reason)}
                  onSpAccept={openSpDesignationModal}
                  t={t}
                />
              ) : (
                <ActivityDigest title={t("inbox.tabApprovals")} stats={[]} hint={t("digest.selectHint")}>
                  <div className="rounded-sm bg-accent-tint px-3 py-2 text-caption text-accent">
                    {approvals.length === 0
                      ? t("home.allCaughtUp")
                      : t("inbox.pendingCount", { n: approvals.length })}
                  </div>
                </ActivityDigest>
              )
            ) : selected ? (
              <NotificationDetail notification={selected} nowMs={nowMs} t={t} />
            ) : (
              <ActivityDigest
                title={t("inbox.tabNotifications")}
                stats={NOTIFICATION_CATEGORIES.map((c) => ({
                  icon: (() => {
                    const Icon = CATEGORY_ICONS[c];
                    return <Icon size={14} strokeWidth={1.5} />;
                  })(),
                  label: t(`inbox.cat.${c}` as MessageKey),
                  count: items.filter((n) => getNotificationCategory(n.type) === c).length,
                }))}
                unreadCount={unread}
                hint={t("digest.selectHint")}
              />
            )}
          </div>
          </AutoHeight>
        </div>

        {/* 삭제 확인 모달 — 선택/읽음/날짜 3종 공용, 요약 1줄만 다르게 */}
        {confirmDelete && (
          <ConfirmDialog
            icon={<Trash2 size={28} strokeWidth={1.5} />}
            danger
            title={t("inbox.deleteConfirmTitle")}
            message={
              confirmDelete === "ids"
                ? t("inbox.deleteConfirmIds", { count: selectedIds.size })
                : confirmDelete === "read"
                  ? t("inbox.deleteConfirmRead", { count: items.filter((n) => n.read).length })
                  : t("inbox.deleteConfirmBefore", {
                      date: beforeDate,
                      count: items.filter((n) => n.created_at.slice(0, 10) < beforeDate).length,
                    })
            }
            confirmLabel={t("inbox.deleteConfirmAction")}
            cancelLabel={t("common.cancel")}
            onConfirm={() => void performBulkDelete()}
            onClose={() => setConfirmDelete(null)}
          />
        )}
      </div>
      {/* sp_designation 수락 — 지정 모달 저장이 곧 수락(PUT이 pending 자동 applied) */}
      {spModal && spModalInitial && (
        <SubprocessDesignationModal
          mapId={spModal.approval.map_id}
          designated={spModal.detail.sp_designated_at != null}
          publishedVersionId={spModalPublishedId}
          initial={spModalInitial}
          onSaved={() => {
            setSpModal(null);
            pushToast(t("inbox.toast.spDesignated"));
            void listInboxApprovals().then(setApprovals).catch(() => undefined);
            setSelectedApprovalKey(null);
          }}
          onClose={() => setSpModal(null)}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// 알림 상세 행위자 필 — 필 스타일 트리거 + 인물 카드(부서 경로 아코디언 포함, PersonHoverCard 공용).
// 이름은 디렉터리 해석(ko는 한글명 우선), 미해석 시 payload actor_name → login_id 폴백.
function ActorPill({ loginId, fallbackName }: { loginId: string; fallbackName?: string }) {
  const { lang } = useI18n();
  const user = useDirectory().get(loginId);
  const display =
    (lang === "ko" ? user?.korean_name || user?.name : user?.name) || fallbackName || loginId;
  return (
    <PersonHoverCard userId={loginId} className="align-baseline">
      {/* 상세 패널 배경이 surface-alt — 필은 surface+헤어라인으로 분리, 크기는 본문과 어울리는 caption */}
      <span className="inline-flex items-baseline rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-caption text-ink transition-colors hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent">
        {display}
      </span>
    </PersonHoverCard>
  );
}

// 알림 상세 텍스트 칩 — 따옴표 표기 대신 칩. 버전이면 v번호 뱃지 동반(복사 모달 드롭다운과 동일 v 규칙).
function DetailChip({ label, version }: { label: string; version?: number | null }) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1 truncate rounded-sm border border-hairline bg-surface px-1.5 py-0.5 align-baseline text-caption text-ink">
      {label}
      {version != null && (
        <span className="rounded-xs bg-accent-tint px-1 text-fine font-semibold text-accent">
          v{version}
        </span>
      )}
    </span>
  );
}

// 알림 본문 — 우측 패널(넓은 화면)과 카드 아래 아코디언(좁은 화면)이 공유.
function NotificationDetail({
  notification,
  nowMs,
  t,
}: {
  notification: NotificationItem;
  nowMs: number;
  t: Translate;
}) {
  const view = formatNotification(notification, t);
  return (
    <article className="px-6 py-4">
      {/* 유형 칩 + 제목(맵 이름) — 언어 토글 반영, 본문은 상세 문장.
          아이콘은 createElement — 렌더 중 파생 컴포넌트 변수 금지(react-hooks/static-components) */}
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
          {createElement(getNotificationIcon(notification.type), { size: 12, strokeWidth: 1.5 })}
          {view.label}
        </span>
      </div>
      <h3 className="mt-2 break-keep text-body-strong text-ink">{view.title}</h3>
      {view.body && (
        <p className="mt-1 whitespace-pre-wrap break-keep text-body text-ink-secondary">
          {/* 행위자=유저 필(인물 카드), 버전/이름/인용=칩 — 따옴표 없는 리치 렌더 */}
          {formatNotificationBodyParts(notification, t).map((part, i) =>
            typeof part === "string" ? (
              <span key={i}>{part}</span>
            ) : "actorLogin" in part ? (
              <ActorPill key={i} loginId={part.actorLogin} fallbackName={part.actorName} />
            ) : "versionLabel" in part ? (
              <DetailChip key={i} label={part.versionLabel} version={part.versionNumber} />
            ) : (
              <DetailChip key={i} label={part.chip} />
            ),
          )}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <TimePills iso={notification.created_at} nowMs={nowMs} />
        {/* 절대 시각(KST) — 상대 필과 병기 */}
        <span className="text-fine text-ink-tertiary">{formatKst(notification.created_at)}</span>
      </div>
      {notification.map_id !== null && (
        <Link
          href={`/maps/${notification.map_id}`}
          className="mt-4 inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
        >
          {t("inbox.relatedMap")}
        </Link>
      )}
    </article>
  );
}

// 승인 항목 상세 — 요청 내용·메타·승인자 현황(버전) + 승인/반려(에디터와 동일한 ConfirmDialog).
function ApprovalDetail({
  approval,
  busy,
  nowMs,
  dir,
  onAct,
  onSpAccept,
  t,
}: {
  approval: InboxApproval;
  busy: boolean;
  nowMs: number;
  dir: Map<string, DirectoryUser>;
  onAct: (approve: boolean, reason: string) => void;
  // sp_designation 수락 — decide 대신 지정 모달 체인 (spec 2026-07-19)
  onSpAccept?: (approval: InboxApproval, detail: MapDetail) => void;
  t: Translate;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  // sp_designation — 지정 모달 프리필·게시본 유무 판정용 맵 상세
  const [spDetail, setSpDetail] = useState<MapDetail | null>(null);

  const isVersion = approval.kind === "version_approval";
  const isApprovalRequest = approval.kind === "approval_request";
  const versionId = approval.version_id;
  const isSpDesignation = approval.kind === "approval_request" && approval.title === "sp_designation";

  // 버전 승인 — 요청자(제출자)의 제출 코멘트. 승인 모달 배너로 공개.
  const [submitComment, setSubmitComment] = useState<string | null>(null);

  // 버전 승인 — 승인자 현황(누가 승인/대기/반려) + 제출 코멘트(맵 상세의 이벤트) 조회
  useEffect(() => {
    if (!isVersion || versionId === null) return;
    let alive = true;
    getWorkflowState(versionId)
      .then((data) => {
        if (alive) setWorkflow(data);
      })
      .catch(() => {});
    getMap(approval.map_id)
      .then((detail) => {
        if (!alive) return;
        const version = detail.versions.find((v) => v.id === versionId);
        setSubmitComment(findLatestSubmitComment(version?.events));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isVersion, versionId, approval.map_id]);

  // sp_designation — 대상 맵 상세(게시본·sp_* 프리필). 실패는 조용히(버튼 비활성 유지)
  useEffect(() => {
    if (!isSpDesignation) return;
    let alive = true;
    getMap(approval.map_id)
      .then((data) => {
        if (alive) setSpDetail(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isSpDesignation, approval.map_id]);

  // 지정은 게시본 필수(백엔드 409) — 없으면 수락 자체를 막고 안내
  const spPublishedId = spDetail
    ? spDetail.versions.reduce<number | null>(
        (acc, v) => (v.status === "published" && (acc === null || v.id > acc) ? v.id : acc),
        null,
      )
    : null;

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
        {/* 결재 주체 — 버전 승인은 아래 "승인자 현황"이 더 자세하므로 그 외 종류에만 */}
        {!isVersion && (
          <>
            <DetailRow label={t("inbox.deciders")}>
              {approval.deciders.length === 0 ? (
                <span className="text-fine text-ink-tertiary">{t("inbox.approverNone")}</span>
              ) : (
                <span className="flex flex-wrap items-center gap-1">
                  {approval.deciders.map((login) => (
                    <UserPill key={login} loginId={login} />
                  ))}
                </span>
              )}
            </DetailRow>
            {approval.pending_on.length > 0 && (
              <DetailRow label={t("inbox.pendingOn")}>
                <span className="flex flex-wrap items-center gap-1">
                  {approval.pending_on.map((login) => (
                    <UserPill key={login} loginId={login} />
                  ))}
                </span>
              </DetailRow>
            )}
          </>
        )}
      </dl>

      {/* 내가 결재자가 아닌데 보인다면 그 근거를 알려 준다 — 관리자 인박스 혼동 방지 */}
      {approval.via_sysadmin && (
        <p className="mt-3 flex items-start gap-1.5 rounded-sm bg-surface px-3 py-2 text-fine text-ink-tertiary">
          <ShieldCheck size={13} strokeWidth={1.5} className="mt-0.5 shrink-0" />
          {t("inbox.viaSysadminHint")}
        </p>
      )}

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

      {/* sp_designation — 게시본 없으면 지정(수락) 불가 안내 */}
      {isSpDesignation && spDetail !== null && spPublishedId === null && (
        <p className="mt-4 rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-caption text-error">
          {t("inbox.sp.noPublished")}
        </p>
      )}

      {/* 액션 — 클릭 시 에디터와 동일한 확인 모달. sp_designation 수락은 지정 모달 체인 */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          data-id={isSpDesignation ? "inbox-sp-designate" : undefined}
          onClick={() => {
            if (isSpDesignation) {
              if (spDetail !== null) onSpAccept?.(approval, spDetail);
              return;
            }
            setApproveOpen(true);
          }}
          disabled={busy || (isSpDesignation && (spDetail === null || spPublishedId === null))}
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
        >
          <Check size={14} strokeWidth={1.5} />
          {isSpDesignation ? t("inbox.sp.designate") : t("inbox.approve")}
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
        {isSpDesignation && spPublishedId !== null && (
          <Link
            href={`/maps/${approval.map_id}?version=${spPublishedId}`}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface"
          >
            {t("inbox.sp.goPublished")}
          </Link>
        )}
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
          banner={
            isVersion && submitComment ? (
              <RequesterCommentBanner authorName={approval.requester} comment={submitComment} />
            ) : undefined
          }
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
          banner={
            isVersion && submitComment ? (
              <RequesterCommentBanner authorName={approval.requester} comment={submitComment} />
            ) : undefined
          }
          lines={isVersion ? approverLines : undefined}
          input={
            isVersion || isApprovalRequest
              ? {
                  value: rejectReason,
                  onChange: setRejectReason,
                  placeholder: isVersion ? t("wf.rejectReason") : t("wf.commentPlaceholder"),
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
