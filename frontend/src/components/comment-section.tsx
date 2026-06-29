"use client";

// 노드 코멘트 스레드 — 목록/작성/해결 토글/삭제. 읽기 전용 모드에서도 작성 가능 (spec §7 Phase C).

import { useRef, useState } from "react";
import { ArrowDown, Check, Trash2 } from "lucide-react";

import type { CommentItem } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

interface CommentSectionProps {
  comments: CommentItem[];
  onAdd: (body: string) => void;
  onToggleResolved: (comment: CommentItem) => void;
  onDelete: (comment: CommentItem) => void;
  // 작성칸 숨김 — 활동 탭의 전체 코멘트 뷰처럼 노드 컨텍스트가 없어 추가가 불가한 경우 / hide the input.
  hideInput?: boolean;
}

export function CommentSection({
  comments,
  onAdd,
  onToggleResolved,
  onDelete,
  hideInput = false,
}: CommentSectionProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  // 상대 시각 기준 "지금"을 마운트 시 1회 캡처 — render 중 Date.now() 호출(순수성 위반) 회피
  const [now] = useState(() => Date.now());
  const listRef = useRef<HTMLUListElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 작성칸 자동 확장(스크롤 없이 아래로 늘어남) — 내용 높이만큼 height 재설정
  const grow = () => {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "0px";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  };

  const handleSubmit = () => {
    const body = draft.trim();
    if (!body) {
      return;
    }
    onAdd(body);
    setDraft("");
    if (taRef.current) taRef.current.style.height = ""; // 전송 후 높이 초기화
  };

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // 상대 시각 — 백엔드 tz-aware 저장이라 new Date(iso) 차이로 안전. 30일 초과는 절대(컴팩트).
  const relativeTime = (iso: string): string => {
    const min = Math.floor((now - new Date(iso).getTime()) / 60000);
    if (min < 1) return t("time.justNow");
    if (min < 60) return t("time.minutesAgo", { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t("time.hoursAgo", { n: hr });
    const day = Math.floor(hr / 24);
    if (day < 30) return t("time.daysAgo", { n: day });
    return formatKstShort(iso);
  };

  return (
    <div className="flex flex-col gap-2">
      <ul ref={listRef} className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
        {comments.map((comment) => (
          <li key={comment.id} className={`flex gap-2 ${comment.resolved ? "opacity-60" : ""}`}>
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-tint text-fine font-semibold text-accent">
              {comment.author.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 text-fine text-ink-tertiary">
                <span className="font-semibold text-ink">{comment.author}</span>
                <span>· {relativeTime(comment.created_at)}</span>
                {comment.resolved && (
                  <span className="inline-flex items-center gap-0.5 rounded-sm bg-added/10 px-1 py-0.5 text-fine text-added">
                    <Check size={11} strokeWidth={1.8} />
                    {t("comment.resolvedBadge")}
                  </span>
                )}
              </div>
              <p
                className={`whitespace-pre-wrap text-caption ${
                  comment.resolved ? "text-ink-tertiary" : "text-ink"
                }`}
              >
                {comment.body}
              </p>
              <div className="mt-0.5 flex gap-2 text-fine">
                <button
                  className="text-ink-secondary hover:text-accent"
                  onClick={() => onToggleResolved(comment)}
                >
                  {comment.resolved ? t("comment.reopen") : t("comment.resolve")}
                </button>
                {/* 작성자만 삭제 가능 — 서버가 403으로 거부, 클라이언트는 단순 노출 */}
                <button
                  className="inline-flex items-center gap-0.5 text-ink-tertiary hover:text-error"
                  onClick={() => onDelete(comment)}
                >
                  <Trash2 size={12} strokeWidth={1.5} />
                  {t("comment.delete")}
                </button>
              </div>
            </div>
          </li>
        ))}
        {comments.length === 0 && (
          <li className="text-caption text-ink-tertiary">{t("comment.empty")}</li>
        )}
      </ul>
      {comments.length > 1 && (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 self-end text-fine text-ink-tertiary hover:text-accent"
          onClick={scrollToBottom}
        >
          <ArrowDown size={12} strokeWidth={1.5} />
          {t("comment.goToBottom")}
        </button>
      )}
      {/* 작성칸 — 자동 확장(스크롤 없음), 버튼·단축키 힌트는 박스 안 하단 라인. 활동 탭 전체뷰는 숨김 */}
      {!hideInput && (
      <div className="rounded-sm border border-hairline focus-within:border-accent/50">
        <textarea
          ref={taRef}
          rows={2}
          className="block w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 text-caption focus:outline-none"
          placeholder={t("comment.placeholder")}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            grow();
          }}
          onKeyDown={(event) => {
            // Enter=줄바꿈(기본), Ctrl/Cmd+Enter=전송
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2 border-t border-divider px-2 py-1">
          {/* 단축키 안내 — 키 모양 배지로 가시성 향상(Enter 줄바꿈 · Ctrl+Enter 전송) */}
          <span className="flex min-w-0 items-center gap-1 truncate text-fine text-ink-tertiary">
            <kbd className="rounded-xs border border-hairline bg-surface px-1 py-px font-medium text-ink-secondary">
              Enter
            </kbd>
            {t("comment.keyNewline")}
            <span className="mx-0.5 text-divider">·</span>
            <kbd className="rounded-xs border border-hairline bg-surface px-1 py-px font-medium text-ink-secondary">
              Ctrl
            </kbd>
            +
            <kbd className="rounded-xs border border-hairline bg-surface px-1 py-px font-medium text-ink-secondary">
              Enter
            </kbd>
            {t("comment.keySend")}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-sm bg-accent px-2.5 py-1 text-fine font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={handleSubmit}
            disabled={!draft.trim()}
          >
            {t("comment.submit")}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
