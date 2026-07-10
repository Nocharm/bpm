"use client";

// 공지사항 열람 — 홈 폭(max-w-[80rem]) 경계 카드 안 마스터-디테일. 좌 목록(전체/중요/일반·미읽음 점)
// + 우 마크다운 상세. 읽음은 클라 캐시(notices-read) — 서버 저장 없음. (design 2026-07-05)

import { Circle, CircleAlert, List } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { listNotices, type DirectoryUser, type NoticeImportance, type NoticeItem } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { formatKstShort } from "@/lib/datetime";
import { openFeedbackPanel } from "@/lib/feedback-panel";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { countUnreadNotices, getReadNoticeIds, markNoticeRead } from "@/lib/notices-read";
import { filterByQuery } from "@/lib/search";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";
import { useSlashFocus } from "@/lib/use-slash-focus";
import { IconPillFilter, type IconPillOption } from "@/components/icon-pill-filter";
import { MarkdownView } from "@/components/markdown-view";
import { SearchBox } from "@/components/search-box";
import { TimePills } from "@/components/time-pills";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { UserPill } from "@/components/user-pill";

type Filter = "all" | NoticeImportance;

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const IMPORTANCE_STYLE: Record<NoticeImportance, string> = {
  important: "bg-error/15 text-error",
  normal: "bg-surface-alt text-ink-secondary",
};

const IMPORTANCE_LABEL: Record<NoticeImportance, MessageKey> = {
  important: "notices.filterImportant",
  normal: "notices.filterNormal",
};

// "MM-DD" — 목록/게시기간용(시각 없이)
function dateOnly(iso: string): string {
  return formatKstShort(iso).split(" ")[0];
}

// 내용 첫 줄 미리보기 — 첫 비어있지 않은 줄에서 마크다운 마커 제거 후 앞부분만
function bodyPreview(md: string): string {
  const firstLine = md.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  return firstLine
    .replace(/[#>*_`~[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

export default function NoticesPage() {
  const { t } = useI18n();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [readIds, setReadIds] = useState<number[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nowMs] = useState(() => Date.now());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dir = useDirectory(); // 작성자 login_id → 이름 해석(아바타 이니셜용)
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((toast) => toast.id !== id));
  const notifyCopied = () =>
    setToasts((prev) => [{ id: genId(), message: t("ai.copied") }, ...prev]);

  useEffect(() => {
    let alive = true;
    listNotices().then((data) => {
      if (!alive) return;
      setNotices(data);
      setReadIds(getReadNoticeIds());
    });
    return () => {
      alive = false;
    };
  }, []);

  const byImportance = notices.filter((n) => filter === "all" || n.importance === filter);
  const filtered = filterByQuery(byImportance, search, (n) => [
    { field: "title", text: n.title },
    { field: "body", text: n.body_md },
  ]).map((hit) => hit.item);
  // 25개씩 증분 렌더 — 공지가 누적돼도 목록 렌더 부하 없음(필터·검색 변경 시 리셋)
  const {
    visible: shownNotices,
    hasMore,
    sentinelRef,
  } = useInfiniteSlice(filtered, `${filter}:${search}`);
  const unread = countUnreadNotices(
    notices.map((n) => n.id),
    readIds,
  );
  const readSet = new Set(readIds);
  const selected = notices.find((n) => n.id === selectedId) ?? null;

  const openNotice = (id: number) => {
    setSelectedId(id);
    setReadIds(markNoticeRead(id));
  };

  const filterOptions: IconPillOption<Filter>[] = [
    { value: "all", label: t("notices.filterAll"), Icon: List },
    { value: "important", label: t("notices.filterImportant"), Icon: CircleAlert },
    { value: "normal", label: t("notices.filterNormal"), Icon: Circle },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col px-8 py-6">
      {/* 페이지 헤더 — 맵/인박스와 동일 기준점·크기 */}
      <div className="mx-auto mb-4 flex w-full max-w-[80rem] shrink-0 items-center justify-between gap-4">
        <h1 className="text-tagline text-ink">{t("nav.tab.notices")}</h1>
        {unread > 0 && (
          <span className="text-caption text-changed">
            {t("notices.unreadCount", { n: unread })}
          </span>
        )}
      </div>
      {/* 빈 여백 클릭 = 선택 해제 — 맵 탭과 동일. 카드·상세는 stopPropagation으로 제외 (batch2 ⑩) */}
      <div
        className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 overflow-hidden"
        onClick={() => setSelectedId(null)}
      >
        {/* 좌 목록 — 폭은 맵 목록과 동일(flex-1 : flex-[2]) */}
        <aside className="flex min-w-[18rem] flex-1 flex-col">
          <div className="flex flex-col gap-2 py-3 pr-3">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder={t("notices.searchPlaceholder")}
              inputRef={searchRef}
            />
            <IconPillFilter options={filterOptions} value={filter} onChange={setFilter} />
          </div>
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto py-3 pr-3">
            {shownNotices.map((n) => {
              const isRead = readSet.has(n.id);
              return (
                <li key={n.id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation(); // 카드 선택이 배경(선택 해제)으로 버블링 방지
                      openNotice(n.id);
                    }}
                    className={
                      "flex w-full flex-col gap-1.5 rounded-xs border border-hairline px-3 py-2.5 text-left " +
                      (n.id === selectedId
                        ? "border-l-2 border-l-accent bg-accent-tint"
                        : "bg-surface hover:bg-surface-alt")
                    }
                  >
                    {/* 유형 필(좌) · 읽음 표시(우) */}
                    <div className="flex items-center justify-between">
                      <span
                        className={
                          "rounded-sm px-1.5 py-0.5 text-fine " + IMPORTANCE_STYLE[n.importance]
                        }
                      >
                        {t(IMPORTANCE_LABEL[n.importance])}
                      </span>
                      {isRead ? (
                        <span className="text-fine text-ink-tertiary">{t("notices.read")}</span>
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                      )}
                    </div>
                    <span className="truncate text-caption font-semibold text-ink">{n.title}</span>
                    <span className="truncate text-fine text-ink-tertiary">
                      {bodyPreview(n.body_md)}
                    </span>
                    {/* 작성자 이름 필(좌, 1초 호버 시 유저 카드) · 시간 필(우) */}
                    <div className="flex items-center justify-between gap-2 text-fine text-ink-tertiary">
                      <UserPill loginId={n.created_by} />
                      <span className="flex shrink-0 items-center gap-1">
                        <TimePills iso={n.starts_at} nowMs={nowMs} />
                      </span>
                    </div>
                  </button>
                  {/* < split(980px) — 카드 아래 인라인 아코디언 (맵 탭과 동일 패턴) */}
                  <div
                    data-id="notice-detail-accordion"
                    onClick={(e) => e.stopPropagation()} // 상세 내부 클릭이 배경(선택 해제)으로 버블링 방지
                    className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth split:hidden ${
                      n.id === selectedId ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      {n.id === selectedId && (
                        <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
                          <NoticeDetail
                            notice={n}
                            nowMs={nowMs}
                            dir={dir}
                            t={t}
                            onCopy={notifyCopied}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {hasMore && <li ref={sentinelRef} className="h-px shrink-0" />}
            {filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-caption text-ink-tertiary">
                {t("notices.empty")}
              </li>
            )}
          </ul>
        </aside>

        {/* 우 상세 — ≥ split(980px)만. 좁으면 카드 아래 아코디언이 대신한다. 상세 내부 클릭은 선택 해제로 버블링 방지 */}
        <div
          data-id="notice-detail-aside"
          className="ml-4 hidden min-w-0 flex-[2] overflow-y-auto rounded-sm border border-hairline bg-surface-alt split:block"
          onClick={(e) => e.stopPropagation()}
        >
          {selected ? (
            <NoticeDetail notice={selected} nowMs={nowMs} dir={dir} t={t} onCopy={notifyCopied} />
          ) : (
            <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
              {t("notices.selectPrompt")}
            </div>
          )}
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// 공지 본문 — 우측 패널(넓은 화면)과 카드 아래 아코디언(좁은 화면)이 공유.
function NoticeDetail({
  notice,
  nowMs,
  dir,
  t,
  onCopy,
}: {
  notice: NoticeItem;
  nowMs: number;
  dir: Map<string, DirectoryUser>;
  t: Translate;
  onCopy: () => void;
}) {
  return (
    <article className="px-8 py-6">
      <div className="flex items-center gap-2">
        <span
          className={"rounded-sm px-1.5 py-0.5 text-fine " + IMPORTANCE_STYLE[notice.importance]}
        >
          {t(IMPORTANCE_LABEL[notice.importance])}
        </span>
        <span className="text-caption text-ink-tertiary">
          {t("notices.label")} · #{notice.id}
        </span>
      </div>
      <h2 className="mt-2 text-tagline text-ink">{notice.title}</h2>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-caption text-ink-secondary">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-fine text-accent">
            {(dir.get(notice.created_by)?.name ?? notice.created_by).charAt(0).toUpperCase()}
          </span>
          <UserPill loginId={notice.created_by} />
          <span className="flex items-center gap-1">
            <TimePills iso={notice.created_at} nowMs={nowMs} />
          </span>
        </div>
        <span className="shrink-0 text-fine text-ink-tertiary">
          {t("notices.period")} {dateOnly(notice.starts_at)} ~{" "}
          {notice.ends_at ? dateOnly(notice.ends_at) : t("notices.unlimited")}
        </span>
      </div>
      <hr className="my-5 border-hairline" />
      <MarkdownView source={notice.body_md} onCopy={onCopy} />
      <div className="mt-6 rounded-md bg-accent-tint px-4 py-3 text-caption text-ink-secondary">
        {t("notices.contactPre")}{" "}
        <button
          type="button"
          onClick={openFeedbackPanel}
          className="font-semibold text-accent hover:underline"
        >
          {t("feedback.button")}
        </button>{" "}
        {t("notices.contactPost")}
      </div>
    </article>
  );
}
