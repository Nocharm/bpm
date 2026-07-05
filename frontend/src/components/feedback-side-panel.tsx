"use client";

// 피드백 사이드 패널 — 우측 슬라이드인. 유형·본문 + 현재 화면 자동첨부, 제출 후 토스트.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useState } from "react";

import { submitFeedback, type FeedbackKind } from "@/lib/api";
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
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = (id: string) =>
    setToasts((prev) => prev.filter((toast) => toast.id !== id));

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

  const mapId = currentMapId(pathname);

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
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="text-body-strong text-ink">{t("feedback.panelTitle")}</span>
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
          {/* 유형 세그먼트 — 한 행 */}
          <div className="grid grid-cols-4 gap-1">
            {KINDS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={kind === item.value}
                onClick={() => setKind(item.value)}
                className={
                  "rounded-sm px-2 py-1.5 text-caption " +
                  (kind === item.value
                    ? "bg-accent-tint text-accent"
                    : "border border-hairline text-ink-secondary hover:bg-surface-alt")
                }
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>

          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t("feedback.bodyPlaceholder")}
            className="min-h-40 w-full resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
          />

          {/* 현재 화면 자동 첨부 안내 */}
          <div className="rounded-sm bg-surface-alt px-3 py-2 text-fine text-ink-tertiary">
            <p>{t("feedback.contextNote")}</p>
            <p className="mt-1 text-ink-secondary">
              {t("feedback.currentScreen")}: {pathname}
              {mapId !== null ? ` · map #${mapId}` : ""}
            </p>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-hairline px-4 py-3">
          <Link
            href="/feedback"
            onClick={onClose}
            className="text-caption text-accent hover:underline"
          >
            {t("feedback.viewAll")}
          </Link>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || body.trim().length === 0}
            className="rounded-sm bg-accent px-4 py-1.5 text-caption text-surface hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? t("feedback.submitting") : t("feedback.submit")}
          </button>
        </footer>
      </aside>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
