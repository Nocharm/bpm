"use client";

// 버전 코멘트 이력 모달 — note 있는 전이 이벤트만 시간순 나열.
// 등장: 클릭 지점→중앙 확대(comment-modal-in), 닫힘: 바깥 mousedown 즉시 + Escape (spec 2026-08-14 §5.4).
// ModalBackdrop(mousedown-origin 판정)을 쓰지 않는 이유: 읽기전용 모달이라 드래그-이탈 오발 리스크를
// 수용하고 즉시 닫힘(사용자 명시 요구)을 우선한다.

import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle, MessageSquare, Send, Undo2, Upload, User, XCircle, type LucideIcon,
} from "lucide-react";

import { type VersionEvent } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const EVENT_ICONS: Record<string, LucideIcon> = {
  submitted: Send,
  approved: CheckCircle,
  rejected: XCircle,
  published: Upload,
  withdrawn: Undo2,
};

interface CommentHistoryModalProps {
  label: string;
  events: VersionEvent[];
  nameById: Map<string, string>;
  /** 클릭 지점 — 등장 애니메이션 시작 오프셋 계산용. */
  origin: { x: number; y: number };
  onClose: () => void;
}

export function CommentHistoryModal({ label, events, nameById, origin, onClose }: CommentHistoryModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const commented = events.filter((evt) => evt.note);
  // 클릭점 − 뷰포트 중앙 = 시작 오프셋 (카드는 flex 중앙 정렬이라 최종 위치가 중앙)
  const fromDx = origin.x - window.innerWidth / 2;
  const fromDy = origin.y - window.innerHeight / 2;
  const originVars = { "--from-dx": `${fromDx}px`, "--from-dy": `${fromDy}px` } as CSSProperties;

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-id="version-comments-modal"
        className="comment-modal-in flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-5 shadow-lg"
        style={originVars}
      >
        <h2 className="flex items-center gap-1.5 text-body-strong text-ink">
          <MessageSquare size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
          <span className="truncate">{t("wf.commentsTitle", { label })}</span>
        </h2>
        {commented.length === 0 ? (
          <p className="text-caption text-ink-tertiary">{t("wf.commentsEmpty")}</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {commented.map((evt) => {
              const Icon = EVENT_ICONS[evt.event_type] ?? MessageSquare;
              const iconTone = evt.event_type === "rejected" ? "text-error" : "text-ink-secondary";
              return (
                <li key={evt.id} className="rounded-sm border border-hairline bg-surface-alt p-2.5">
                  <div className="flex items-center gap-1.5">
                    <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${iconTone}`} />
                    <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink">
                      <User size={12} strokeWidth={1.5} />
                      {nameById.get(evt.actor) ?? evt.actor}
                    </span>
                    <span className="ml-auto shrink-0 text-fine text-ink-tertiary">
                      {formatKstShort(evt.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 break-keep whitespace-pre-wrap text-caption text-ink">{evt.note}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
