"use client";

// 노드 코멘트 스레드 — 목록/작성/해결 토글/삭제. 읽기 전용 모드에서도 작성 가능 (spec §7 Phase C).

import { useState } from "react";

import type { CommentItem } from "@/lib/api";

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
            className={`rounded border px-2 py-1.5 text-sm ${
              comment.resolved
                ? "border-zinc-100 bg-zinc-50"
                : "border-zinc-200"
            }`}
          >
            <div className="text-xs text-zinc-500">
              {comment.author} · {new Date(comment.created_at).toLocaleString()}
            </div>
            <p
              className={`whitespace-pre-wrap ${
                comment.resolved ? "text-zinc-400 line-through" : "text-zinc-800"
              }`}
            >
              {comment.body}
            </p>
            <div className="mt-1 flex gap-2 text-xs">
              <button
                className="text-blue-600 hover:underline"
                onClick={() => onToggleResolved(comment)}
              >
                {comment.resolved ? "재열기" : "해결"}
              </button>
              {/* 작성자만 삭제 가능 — 서버가 403으로 거부, 클라이언트는 단순 노출 */}
              <button
                className="text-red-500 hover:underline"
                onClick={() => onDelete(comment)}
              >
                삭제
              </button>
            </div>
          </li>
        ))}
        {comments.length === 0 && (
          <li className="text-xs text-zinc-400">아직 코멘트가 없습니다.</li>
        )}
      </ul>
      <textarea
        className="h-16 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
        placeholder="코멘트 작성 — Ctrl+Enter 전송"
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
        className="mt-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
        onClick={handleSubmit}
      >
        등록
      </button>
    </div>
  );
}
