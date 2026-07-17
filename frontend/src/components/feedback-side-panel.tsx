"use client";

// 피드백 사이드 패널 — 우측 슬라이드인. 유형·본문 + 현재 화면 자동첨부, 제출 후 토스트.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, List, X } from "lucide-react";
import { useEffect, useState } from "react";

import { listFeedback, submitFeedback, type FeedbackItem, type FeedbackKind } from "@/lib/api";
import { getCurrentUser } from "@/lib/current-user";
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KIND_STYLE,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUS_STYLE,
} from "@/lib/feedback-meta";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { ToastStack, type ToastItem } from "@/components/toast-stack";

const KINDS: { value: FeedbackKind; labelKey: MessageKey }[] = [
  { value: "bug", labelKey: "feedback.kind.bug" },
  { value: "suggestion", labelKey: "feedback.kind.suggestion" },
  { value: "question", labelKey: "feedback.kind.question" },
  { value: "etc", labelKey: "feedback.kind.etc" },
];

// 본문 최대 길이 — 백엔드 FeedbackCreate.body max_length과 동일
const MAX_BODY = 4000;

// /maps/<id> 경로에서 열린 맵 id 추출(없으면 null) — 제출 시 컨텍스트 자동 첨부용
function currentMapId(pathname: string): number | null {
  const match = pathname.match(/^\/maps\/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function FeedbackSidePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [recent, setRecent] = useState<FeedbackItem[]>([]);

  const dismissToast = (id: string) =>
    setToasts((prev) => prev.filter((toast) => toast.id !== id));

  // 패널을 열 때마다 내 최근 피드백을 새로 불러온다 — 방금 제출한 항목도 반영되도록
  useEffect(() => {
    if (!open) {
      return;
    }
    const loginId = getCurrentUser()?.loginId;
    let active = true;
    void listFeedback()
      .then((list) => {
        if (!active) {
          return;
        }
        const mine = list.items
          .filter((f) => f.author === loginId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 5);
        setRecent(mine);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  const openFeedback = (id: number) => {
    router.push(`/feedback?feedback=${id}`);
    onClose();
  };

  const handleSubmit = async () => {
    const text = body.trim();
    if (!text || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await submitFeedback({
        kind,
        body: text,
        context: { route: pathname, map_id: currentMapId(pathname) },
      });
      setToasts((prev) => [{ id: genId(), message: t("feedback.sent") }, ...prev]);
      setBody("");
      onClose();
    } catch {
      setToasts((prev) => [{ id: genId(), message: t("feedback.error") }, ...prev]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={
          "fixed inset-0 z-[1200] bg-ink/20 transition-opacity duration-350 " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />
      <aside
        role="dialog"
        aria-label={t("feedback.panelTitle")}
        className={
          "fixed right-0 top-0 z-[1300] flex h-full w-96 flex-col border-l border-hairline " +
          "bg-surface shadow-lg transition-transform duration-350 ease-spring " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        <header className="flex items-start justify-between border-b border-hairline px-4 py-3">
          <div>
            <p className="text-body-strong text-ink">{t("feedback.panelTitle")}</p>
            <p className="text-fine text-ink-tertiary">{t("feedback.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("action.close")}
            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {/* 유형 세그먼트 — 회색 트랙 + 흰 활성 pill */}
          <div className="flex flex-col gap-1.5">
            <span className="text-caption-strong text-ink-secondary">
              {t("feedback.typeLabel")}
            </span>
            <div className="grid grid-cols-4 gap-1 rounded-sm bg-surface-alt p-1">
              {KINDS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={kind === item.value}
                  onClick={() => setKind(item.value)}
                  className={
                    "rounded-xs px-2 py-1.5 text-caption transition-colors " +
                    (kind === item.value
                      ? "bg-surface text-accent shadow-sm"
                      : "text-ink-secondary hover:text-ink")
                  }
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* 내용 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-caption-strong text-ink-secondary">
                {t("feedback.contentLabel")}
              </span>
              <span className="text-fine tabular-nums text-ink-tertiary">
                {body.length} / {MAX_BODY}
              </span>
            </div>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("feedback.bodyPlaceholder")}
              maxLength={MAX_BODY}
              className="min-h-40 w-full resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
            />
          </div>

          {/* 내 최근 피드백 — 클릭 시 상세 모달로 이동 + 패널 닫기 */}
          {recent.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
              <span className="text-caption-strong text-ink-secondary">
                {t("feedback.yourRecent")}
              </span>
              <ul className="flex flex-col gap-1.5">
                {recent.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => openFeedback(f.id)}
                      aria-label={`${t("feedback.viewOnPage")}: ${f.body}`}
                      className="flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-left hover:bg-surface-alt"
                    >
                      <span
                        className={
                          "shrink-0 rounded-sm px-1.5 py-0.5 text-fine " + FEEDBACK_KIND_STYLE[f.kind]
                        }
                      >
                        {t(FEEDBACK_KIND_LABEL[f.kind])}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-fine text-ink">{f.body}</span>
                      <span
                        className={
                          "shrink-0 rounded-sm px-1.5 py-0.5 text-fine " + FEEDBACK_STATUS_STYLE[f.status]
                        }
                      >
                        {t(FEEDBACK_STATUS_LABEL[f.status])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-hairline px-4 py-3">
          <Link
            href="/feedback"
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-sm border border-hairline px-3 py-2 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            <List size={14} strokeWidth={1.5} />
            {t("feedback.viewAll")}
            <ArrowRight size={14} strokeWidth={1.5} />
          </Link>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="col-span-1 rounded-sm border border-hairline px-3 py-2 text-caption text-ink hover:bg-surface-alt"
            >
              {t("feedback.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || body.trim().length === 0}
              className="col-span-2 rounded-sm bg-accent px-3 py-2 text-caption text-surface hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? t("feedback.submitting") : t("feedback.submit")}
            </button>
          </div>
        </footer>
      </aside>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
