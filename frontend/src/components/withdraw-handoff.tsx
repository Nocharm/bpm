"use client";

// 회수 모달 핸드오프 — "제출자 → 회수자(you)"를 한 줄로. 제출자·you 모두 필(pill).
// 회수자≠제출자일 때만: 화살표(폭 중앙)가 1초에 걸쳐 좌→우로 늘어나고 you(오른쪽 정렬)가 페이드인,
// 다 펼쳐진 후 you를 한 번 페이드로 깜빡인다. 아래 행은 승인 초기화 안내.

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
  // 회수자 ≠ 제출자 — 이 경우에만 "→ you"를 펼친다.
  transfers: boolean;
}) {
  const { t } = useI18n();
  const [started, setStarted] = useState(false);
  const [blinkDim, setBlinkDim] = useState(false);
  useEffect(() => {
    if (!transfers) return;
    // 모달이 먼저 그려진 뒤 한 프레임 후 펼침 시작(로딩→펼침).
    const raf = requestAnimationFrame(() => setStarted(true));
    // 1초 펼침 완료 후 you를 한 번 페이드로 깜빡.
    const t1 = setTimeout(() => setBlinkDim(true), 1000);
    const t2 = setTimeout(() => setBlinkDim(false), 1400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [transfers]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-caption">
        <Send size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
        {/* 제출자 — 필(중립) */}
        <span className="max-w-[9rem] shrink-0 truncate rounded-xs border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-secondary">
          {submitterName}
        </span>
        {transfers && (
          <>
            {/* 화살표 — 폭 중앙, 1초에 걸쳐 좌→우로 늘어남 */}
            <span className="flex flex-1 items-center justify-center overflow-hidden">
              <ArrowRight
                size={16}
                strokeWidth={1.5}
                className={`origin-left text-accent transition-transform duration-1000 ease-in-out ${
                  started ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </span>
            {/* 회수자(you) — 오른쪽 정렬 필(accent). ellipsis 없이 잘려도 유지. 펼침 후 1회 깜빡. */}
            <span
              className={`shrink-0 whitespace-nowrap rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent transition-opacity duration-300 ease-in-out ${
                blinkDim ? "opacity-30" : started ? "opacity-100" : "opacity-0"
              }`}
            >
              {youName}
            </span>
          </>
        )}
      </div>
      {/* 승인 초기화 */}
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
