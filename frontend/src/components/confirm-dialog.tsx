"use client";

// 범용 확인 모달 — ModalBackdrop + portal. danger=true면 confirm 버튼 error 토큰 /
// Generic confirm dialog. Simple form (title+message) or rich form (icon circle + bullet lines, L5).

import { createPortal } from "react-dom";
import { type ReactNode } from "react";

import { ModalBackdrop } from "@/components/modal-backdrop";

type LineTone = "ink" | "accent" | "error" | "muted";
// 행 우측 끝 상태 뱃지 톤 — 승인상태(approved/pending)는 영어 고정 라벨로 사용.
type BadgeTone = "approved" | "pending" | "neutral" | "accent" | "warn";

export interface ConfirmLine {
  icon: ReactNode;
  text: string;
  tone?: LineTone;
  // 우측 끝 뱃지(예: Approved/Pending) — 이름은 좌측, 상태는 우측 뱃지.
  badge?: { text: string; tone?: BadgeTone };
  // 본인 행 강조(accent tint 배경).
  highlight?: boolean;
}

const LINE_TEXT_TONE: Record<LineTone, string> = {
  ink: "text-ink",
  accent: "text-ink",
  error: "text-ink-tertiary",
  muted: "text-ink-tertiary",
};
const LINE_ICON_TONE: Record<LineTone, string> = {
  ink: "text-ink-tertiary",
  accent: "text-accent",
  error: "text-error",
  muted: "text-ink-tertiary",
};
const BADGE_STYLE: Record<BadgeTone, string> = {
  approved: "border-added/40 bg-added/10 text-added",
  pending: "border-hairline bg-surface text-ink-tertiary",
  neutral: "border-hairline bg-surface text-ink-secondary",
  accent: "border-accent-tint-border bg-accent-tint text-accent",
  warn: "border-error/40 bg-error/10 text-error",
};

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  // 리치 폼(L5) — icon 제공 시 아이콘 원 + 요점 줄 중앙 레이아웃 / rich layout when icon is set.
  icon?: ReactNode;
  lines?: ConfirmLine[];
  // 복수 요약박스(예: 체크아웃 요약 + 승인자 목록). 지정 시 lines 대신 각 그룹을 별도 박스로.
  sections?: ConfirmLine[][];
  // 커스텀 요약박스(정적 lines로 표현 못 하는 애니메이션 행 등) — groups 위에 렌더.
  banner?: ReactNode;
  // 선택 입력(예: 거절 사유) — 있으면 message/lines 아래 textarea 노출. 값은 호출자가 관리.
  input?: { value: string; onChange: (value: string) => void; placeholder?: string; rows?: number };
  // confirm 버튼 비활성(예: 사유 미입력) / disable confirm.
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
  icon,
  lines,
  sections,
  banner,
  input,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const groups: ConfirmLine[][] = sections ?? (lines && lines.length > 0 ? [lines] : []);
  const confirmBtn = danger
    ? "bg-error text-on-accent hover:opacity-90"
    : "bg-accent text-on-accent hover:bg-accent-focus";
  const iconCircle = danger ? "bg-error/10 text-error" : "bg-accent-tint text-accent";
  const isRich = icon != null;
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="confirm-dialog"
        className={`flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg ${
          isRich ? "items-center text-center" : ""
        }`}
      >
        {isRich && (
          <div className={`flex h-16 w-16 items-center justify-center rounded-full ${iconCircle}`}>
            {icon}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{title}</h2>
          {message && (
            <p className={`text-caption ${isRich ? "text-ink-tertiary" : "text-ink-secondary"}`}>
              {message}
            </p>
          )}
        </div>
        {banner && (
          <div className="w-full rounded-sm bg-surface-alt p-2 text-left">{banner}</div>
        )}
        {groups.map((group, gi) => (
          <ul
            key={gi}
            className="flex w-full flex-col gap-1 rounded-sm bg-surface-alt p-2 text-left"
          >
            {group.map((line, i) => (
              <li
                key={i}
                className={`flex items-center gap-2 rounded-sm px-1.5 py-1 text-caption ${
                  LINE_TEXT_TONE[line.tone ?? "ink"]
                } ${line.highlight ? "bg-accent-tint" : ""}`}
              >
                <span className={`shrink-0 ${LINE_ICON_TONE[line.tone ?? "ink"]}`}>{line.icon}</span>
                {/* 말줄임 대신 줄바꿈 — 확인 모달의 경고/안내가 잘리면 안 됨 (F7, break-keep로 단어 보존) */}
                <span className="min-w-0 flex-1 break-keep">{line.text}</span>
                {line.badge && (
                  <span
                    className={`shrink-0 rounded-xs border px-1.5 py-0.5 text-fine ${
                      BADGE_STYLE[line.badge.tone ?? "neutral"]
                    }`}
                  >
                    {line.badge.text}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ))}
        {input && (
          <textarea
            className="w-full rounded-sm border border-hairline p-2 text-left text-caption"
            rows={input.rows ?? 3}
            value={input.value}
            placeholder={input.placeholder}
            onChange={(event) => input.onChange(event.target.value)}
          />
        )}
        <div className={`flex w-full justify-end gap-2 ${isRich ? "" : ""}`}>
          <button
            type="button"
            data-id="confirm-dialog-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-id="confirm-dialog-confirm"
            className={`rounded-sm px-3 py-1.5 text-caption disabled:opacity-40 ${confirmBtn}`}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
