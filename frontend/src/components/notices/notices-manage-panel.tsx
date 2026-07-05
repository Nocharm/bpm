"use client";

// 설정 · 공지사항 관리 — 목록(상태·게시기간·아코디언 미리보기·아이콘 액션·페이징) + 등록/수정 모달. sysadmin. (design 2026-07-05)

import { Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { deleteNotice, listNoticesManage, type NoticeItem } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { MarkdownView } from "@/components/markdown-view";
import { Pagination } from "@/components/pagination";
import { Tooltip } from "@/components/tooltip";
import { NoticeEditModal } from "@/components/notices/notice-edit-modal";

const PAGE_SIZE = 20;

type NoticeStatus = "live" | "scheduled" | "ended";

const STATUS_STYLE: Record<NoticeStatus, string> = {
  live: "bg-added/15 text-added",
  scheduled: "bg-accent/15 text-accent",
  ended: "bg-surface-alt text-ink-tertiary",
};

const STATUS_LABEL: Record<NoticeStatus, MessageKey> = {
  live: "noticeAdmin.statusLive",
  scheduled: "noticeAdmin.statusScheduled",
  ended: "noticeAdmin.statusEnded",
};

function deriveStatus(notice: NoticeItem, nowMs: number): NoticeStatus {
  const start = new Date(notice.starts_at).getTime();
  const end = notice.ends_at ? new Date(notice.ends_at).getTime() : null;
  if (start > nowMs) return "scheduled";
  if (end !== null && end < nowMs) return "ended";
  return "live";
}

function dateOnly(iso: string): string {
  return formatKstShort(iso).split(" ")[0];
}

export function NoticesManagePanel({ onToast }: { onToast: (message: string) => void }) {
  const { t } = useI18n();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  // null=닫힘, "new"=등록, item=수정
  const [editing, setEditing] = useState<NoticeItem | "new" | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const clickTimer = useRef<number | null>(null);

  // 상태 파생 기준 시각 — 마운트 시 1회 캡처(렌더 중 Date.now 금지, react-hooks/purity)
  const [nowMs] = useState(() => Date.now());

  const reload = () => listNoticesManage().then(setNotices);
  useEffect(() => {
    void reload();
    return () => {
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
    };
  }, []);

  // 단일 클릭=미리보기 아코디언 토글, 더블클릭=편집 (200ms 타이머로 구분)
  const handleRowClick = (id: number) => {
    if (clickTimer.current) return;
    clickTimer.current = window.setTimeout(() => {
      setExpandedId((prev) => (prev === id ? null : id));
      clickTimer.current = null;
    }, 200);
  };
  const handleRowDblClick = (notice: NoticeItem) => {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    setEditing(notice);
  };

  const handleDelete = async (id: number) => {
    await deleteNotice(id);
    setConfirmId(null);
    onToast(t("noticeAdmin.deleted"));
    void reload();
  };

  const live = notices.filter((n) => deriveStatus(n, nowMs) === "live").length;
  const pageCount = Math.max(1, Math.ceil(notices.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = notices.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-body-strong text-ink">{t("noticeAdmin.title")}</h2>
          <p className="text-caption text-ink-tertiary">
            {t("noticeAdmin.summary", { total: notices.length, active: live })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("noticeAdmin.new")}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full table-fixed border-collapse text-caption">
          <colgroup>
            <col style={{ width: "6rem" }} />
            <col />
            <col style={{ width: "6rem" }} />
            <col style={{ width: "13rem" }} />
            <col style={{ width: "6rem" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-hairline bg-surface-alt text-left text-ink-secondary">
              <th className="px-3 py-2 font-normal">{t("noticeAdmin.colStatus")}</th>
              <th className="px-3 py-2 font-normal">{t("noticeAdmin.colTitle")}</th>
              <th className="px-3 py-2 font-normal">{t("noticeAdmin.colImportance")}</th>
              <th className="px-3 py-2 font-normal">{t("noticeAdmin.colPeriod")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {pageItems.map((n) => {
              const status = deriveStatus(n, nowMs);
              const pendingDelete = confirmId === n.id;
              return (
                <Fragment key={n.id}>
                  <tr
                    onClick={() => handleRowClick(n.id)}
                    onDoubleClick={() => handleRowDblClick(n)}
                    className="group cursor-pointer border-b border-hairline hover:bg-surface-alt"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={"rounded-sm px-1.5 py-0.5 text-fine " + STATUS_STYLE[status]}
                      >
                        {t(STATUS_LABEL[status])}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block truncate text-ink" title={n.title}>
                        {n.title}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                      {t(n.importance === "important" ? "notices.filterImportant" : "notices.filterNormal")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
                        {dateOnly(n.starts_at)}
                      </span>
                      <span className="px-1 text-ink-tertiary">~</span>
                      <span className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">
                        {n.ends_at ? dateOnly(n.ends_at) : t("notices.unlimited")}
                      </span>
                    </td>
                    {/* 액션 — 아이콘·행 호버 시에만 노출(삭제 확인 중이면 유지) */}
                    <td
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      className="px-3 py-2"
                    >
                      <div
                        className={
                          "flex items-center justify-end gap-1 transition-opacity " +
                          (pendingDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100")
                        }
                      >
                        <Tooltip label={t("noticeAdmin.edit")}>
                          <button
                            type="button"
                            onClick={() => setEditing(n)}
                            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                          >
                            <Pencil size={14} strokeWidth={1.5} />
                          </button>
                        </Tooltip>
                        <Tooltip
                          label={pendingDelete ? t("noticeAdmin.deleteConfirm") : t("noticeAdmin.delete")}
                        >
                          <button
                            type="button"
                            onClick={() => (pendingDelete ? void handleDelete(n.id) : setConfirmId(n.id))}
                            className={
                              "rounded-sm p-1 hover:bg-surface-alt " +
                              (pendingDelete ? "text-error" : "text-ink-tertiary hover:text-error")
                            }
                          >
                            <Trash2 size={14} strokeWidth={1.5} />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                  {/* 아코디언 미리보기 — 항상 렌더, grid-rows로 펼침/접힘 애니 */}
                  <tr>
                    <td colSpan={5} className="p-0">
                      <div
                        className={
                          "grid transition-[grid-template-rows] duration-350 ease-smooth " +
                          (expandedId === n.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
                        }
                      >
                        <div className="overflow-hidden">
                          <div className="border-b border-hairline bg-surface-alt px-6 py-4">
                            {n.body_md.trim() ? (
                              <MarkdownView source={n.body_md} />
                            ) : (
                              <p className="text-caption text-ink-tertiary">
                                {t("noticeAdmin.emptyBody")}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {notices.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-tertiary">
                  {t("noticeAdmin.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={notices.length} pageSize={PAGE_SIZE} page={safePage} onPage={setPage} />

      {editing !== null && (
        <NoticeEditModal
          notice={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onToast(t("noticeAdmin.saved"));
            void reload();
          }}
        />
      )}
    </div>
  );
}
