"use client";

// 노드 코멘트 스레드 — 목록/작성/해결 토글/삭제. 읽기 전용 모드에서도 작성 가능 (spec §7 Phase C).

import { useState } from "react";
import { Trash2 } from "lucide-react";

import type { CommentItem } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

interface CommentSectionProps {
  comments: CommentItem[];
  onAdd: (body: string) => void;
  onToggleResolved: (comment: CommentItem) => void;
  onDelete: (comment: CommentItem) => void;
}

export function CommentSection({
  comments,
  onAdd,
  onToggleResolved,
  onDelete,
}: CommentSectionProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");

  const handleSubmit = () => {
    const body = draft.trim();
    if (!body) {
      return;
    }
    onAdd(body);
    setDraft("");
  };

  return (
    <div>
      <ul className="mb-2 max-h-56 space-y-2 overflow-y-auto">
        {comments.map((comment) => (
          <li
            key={comment.id}
            className={`rounded border px-2 py-1.5 text-caption ${
              comment.resolved
                ? "border-hairline bg-surface-alt"
                : "border-hairline"
            }`}
          >
            <div className="text-caption text-ink-tertiary">
              {comment.author} · {formatKst(comment.created_at)}
            </div>
            <p
              className={`whitespace-pre-wrap ${
                comment.resolved ? "text-ink-tertiary line-through" : "text-ink"
              }`}
            >
              {comment.body}
            </p>
            <div className="mt-1 flex gap-2 text-caption">
              <button
                className="text-ink-secondary hover:underline"
                onClick={() => onToggleResolved(comment)}
              >
                {comment.resolved ? t("comment.reopen") : t("comment.resolve")}
              </button>
              {/* 작성자만 삭제 가능 — 서버가 403으로 거부, 클라이언트는 단순 노출 */}
              <button
                className="inline-flex items-center gap-0.5 text-error hover:underline"
                onClick={() => onDelete(comment)}
              >
                <Trash2 size={14} strokeWidth={1.5} />
                {t("comment.delete")}
              </button>
            </div>
          </li>
        ))}
        {comments.length === 0 && (
          <li className="text-caption text-ink-tertiary">{t("comment.empty")}</li>
        )}
      </ul>
      <textarea
        className="h-16 w-full rounded border border-hairline px-2 py-1 text-caption"
        placeholder={t("comment.placeholder")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      />
      <button
        className="mt-1 rounded bg-accent px-2 py-1 text-caption font-medium text-on-accent hover:bg-accent-focus"
        onClick={handleSubmit}
      >
        {t("comment.submit")}
      </button>
    </div>
  );
}
