"use client";

// 회수 모달 핸드오프 — "제출자 → 회수자"를 한 줄로. 회수자≠제출자일 때만 "→ 회수자"를
// 모달 로딩 후 가로로 펼치는 애니메이션으로 드러낸다(누구에게 넘어가는지 강조). 아래에 승인 초기화 안내.

import { useEffect, useState } from "react";
import { ArrowRight, RotateCcw, Send } from "lucide-react";

import { useI18n } from "@/lib/i18n";

export function WithdrawHandoff({
  submitterName,
  youName,
  transfers,
}: {
  submitterName: string;
  youName: string;
  // 회수자 ≠ 제출자 — 이 경우에만 "→ 회수자"를 펼친다.
  transfers: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!transfers) return;
    // 모달이 먼저 그려진 뒤 한 프레임 후 펼침(로딩→펼침 효과).
    const id = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(id);
  }, [transfers]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-caption">
        <Send size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
        {/* 제출자 — 필(중립) */}
        <span className="max-w-[9rem] shrink-0 truncate rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-secondary">
          {submitterName}
        </span>
        {transfers && (
          <span
            className={`grid transition-all duration-700 ease-in-out ${
              expanded ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0"
            }`}
          >
            <span className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
              <ArrowRight size={13} strokeWidth={1.5} className="shrink-0 text-accent" />
              {/* 회수자(you) — 필(accent) */}
              <span className="max-w-[9rem] truncate rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent">
                {youName}
              </span>
            </span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-caption text-ink-tertiary">
        <RotateCcw size={14} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("approval.approvalsRow")}</span>
        <span className="shrink-0 rounded-xs border border-error/40 bg-error/10 px-1.5 py-0.5 text-fine text-error">
          {t("approval.willReset")}
        </span>
      </div>
    </div>
  );
}
