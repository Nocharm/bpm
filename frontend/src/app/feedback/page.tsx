"use client";

// 전체 피드백 페이지 — 집계 카드 · 유형 필터 · 목록 · 행 클릭 상세/관리 모달 (design 2026-07-05).

import { Bug, Ellipsis, Lightbulb, List, MessageCircle, MessageSquareText, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { listFeedback, type FeedbackItem, type FeedbackKind } from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { formatKstShort } from "@/lib/datetime";
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KIND_STYLE,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUS_STYLE,
} from "@/lib/feedback-meta";
import { openFeedbackPanel } from "@/lib/feedback-panel";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { FeedbackDetailModal } from "@/components/feedback-detail-modal";
import { FeedbackNotesFlyout } from "@/components/feedback-notes-flyout";
import { IconPillFilter, type IconPillOption } from "@/components/icon-pill-filter";
import { Pagination } from "@/components/pagination";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { UserPill } from "@/components/user-pill";

const PAGE_SIZE = 20;

// 등록일 필 — 날짜/시간 두 pill
function DatePills({ iso }: { iso: string }) {
  const [dateStr, timeStr] = formatKstShort(iso).split(" ");
  return (
    <>
      <span className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
        {dateStr}
      </span>
      {timeStr && (
        <span className="ml-1 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">
          {timeStr}
        </span>
      )}
    </>
  );
}

export default function FeedbackPage() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const isSysadmin = user?.isSysadmin ?? false;
  const loginId = user?.loginId ?? "";
  // 노트 플라이아웃 — 트리거 버튼 rect 기준으로 body portal 위치 산정
  const [notesFor, setNotesFor] = useState<{
    id: number;
    body: string;
    anchor: { left: number; bottom: number };
  } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = (message: string, tone?: "error") =>
    setToasts((prev) => [{ id: genId(), message, tone }, ...prev]);

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [kindFilter, setKindFilter] = useState<FeedbackKind | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    listFeedback().then((data) => {
      if (alive) setItems(data.items);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 딥링크 ?feedback=<id> — 목록 로드 후 해당 id가 있으면 상세 모달을 1회만 오픈.
  // useSearchParams 대신 window.location을 직접 읽어 Suspense 경계 없이 client-only로 처리.
  const seededDeepLink = useRef(false);
  useEffect(() => {
    if (seededDeepLink.current) return;
    const raw = new URLSearchParams(window.location.search).get("feedback");
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    if (!items.some((f) => f.id === id)) return; // 목록 로드 후에만 매칭
    seededDeepLink.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link seed guarded by ref
    setSelectedId(id);
  }, [items]);

  // 집계·필터는 파생값 — 렌더 중 계산(React Compiler가 메모이즈)
  const counts = {
    total: items.length,
    mine: items.filter((f) => f.author === loginId).length,
    inProgress: items.filter((f) => f.status === "in_progress").length,
    done: items.filter((f) => f.status === "done").length,
  };
  const donePct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

  const query = search.trim().toLowerCase();
  const filtered = items.filter(
    (f) =>
      (kindFilter === "all" || f.kind === kindFilter) &&
      (query === "" || f.body.toLowerCase().includes(query)),
  );
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selected = items.find((f) => f.id === selectedId) ?? null;

  const handleChanged = (updated: FeedbackItem | null) => {
    if (updated === null) {
      setItems((prev) => prev.filter((f) => f.id !== selectedId));
      setSelectedId(null);
    } else {
      setItems((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    }
  };

  const filterOptions: IconPillOption<FeedbackKind | "all">[] = [
    { value: "all", label: t("feedback.filterAll"), Icon: List },
    { value: "bug", label: t(FEEDBACK_KIND_LABEL.bug), Icon: Bug },
    { value: "suggestion", label: t(FEEDBACK_KIND_LABEL.suggestion), Icon: Lightbulb },
    { value: "question", label: t(FEEDBACK_KIND_LABEL.question), Icon: MessageCircle },
    { value: "etc", label: t(FEEDBACK_KIND_LABEL.etc), Icon: Ellipsis },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-tagline text-ink">{t("feedback.button")}</h1>
          <p className="text-caption text-ink-secondary">{t("feedback.pageSubtitle")}</p>
        </div>
        <button
          type="button"
          onClick={openFeedbackPanel}
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-surface hover:opacity-90"
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("feedback.panelTitle")}
        </button>
      </div>

      {/* 집계 카드 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-hairline bg-surface px-4 py-3">
          <p className="text-caption text-ink-secondary">{t("feedback.stat.total")}</p>
          <p className="mt-1 text-tagline text-ink">{counts.total}</p>
        </div>
        <div className="rounded-md border border-accent bg-accent-tint px-4 py-3">
          <p className="text-caption text-accent">{t("feedback.stat.mine")}</p>
          <p className="mt-1 text-tagline text-accent">{counts.mine}</p>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-4 py-3">
          <p className="text-caption text-ink-secondary">{t("feedback.stat.inProgress")}</p>
          <p className="mt-1 text-tagline text-changed">{counts.inProgress}</p>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-4 py-3">
          <p className="text-caption text-ink-secondary">{t("feedback.stat.done")}</p>
          <p className="mt-1 text-tagline text-added">
            {counts.done}
            <span className="ml-1 text-caption text-ink-tertiary">{donePct}%</span>
          </p>
        </div>
      </div>

      {/* 유형 필터 + 검색 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <IconPillFilter
          options={filterOptions}
          value={kindFilter}
          onChange={(v) => {
            setKindFilter(v);
            setPage(1);
          }}
        />
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t("feedback.searchPlaceholder")}
          className="w-56 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
      </div>

      {/* 목록 — 행 클릭 시 상세/관리 모달 */}
      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full table-fixed border-collapse text-caption">
          <colgroup>
            <col style={{ width: "5rem" }} />
            <col />
            <col style={{ width: "8rem" }} />
            <col style={{ width: "6rem" }} />
            <col style={{ width: "11rem" }} />
            <col style={{ width: "4rem" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-hairline bg-surface-alt text-left text-ink-secondary">
              <th className="px-3 py-2 font-normal">{t("feedback.typeLabel")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.contentLabel")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.colAuthor")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.colStatus")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.colDate")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.notes.title")}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((f) => (
              <tr
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-alt"
              >
                <td className="px-3 py-2">
                  <span
                    className={"rounded-sm px-1.5 py-0.5 text-fine " + FEEDBACK_KIND_STYLE[f.kind]}
                  >
                    {t(FEEDBACK_KIND_LABEL[f.kind])}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink">
                  <span className="block truncate" title={f.body}>
                    {f.body}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <UserPill loginId={f.author} />
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      "rounded-sm px-1.5 py-0.5 text-fine " + FEEDBACK_STATUS_STYLE[f.status]
                    }
                  >
                    {t(FEEDBACK_STATUS_LABEL[f.status])}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <DatePills iso={f.created_at} />
                </td>
                <td className="px-3 py-2">
                  {/* 노트 플라이아웃 — 행 클릭(상세 모달)과 분리 */}
                  <button
                    type="button"
                    aria-label={t("feedback.notes.open")}
                    title={t("feedback.notes.open")}
                    data-id={`feedback-notes-btn-${f.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setNotesFor((prev) =>
                        prev?.id === f.id
                          ? null
                          : { id: f.id, body: f.body, anchor: { left: rect.left, bottom: rect.bottom } },
                      );
                    }}
                    className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                  >
                    <MessageSquareText size={16} strokeWidth={1.5} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-tertiary">
                  {t("feedback.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={filtered.length} pageSize={PAGE_SIZE} page={safePage} onPage={setPage} />

      {selected && (
        <FeedbackDetailModal
          key={selected.id}
          feedback={selected}
          currentLoginId={loginId}
          isSysadmin={isSysadmin}
          onClose={() => {
            setSelectedId(null);
            if (new URLSearchParams(window.location.search).get("feedback")) {
              router.replace("/feedback");
            }
          }}
          onChanged={handleChanged}
          onToast={pushToast}
        />
      )}
      {notesFor && (
        <FeedbackNotesFlyout
          key={notesFor.id}
          feedbackId={notesFor.id}
          feedbackBody={notesFor.body}
          anchor={notesFor.anchor}
          onClose={() => setNotesFor(null)}
          onToast={pushToast}
        />
      )}
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))}
      />
    </div>
  );
}
