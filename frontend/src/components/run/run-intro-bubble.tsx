"use client";

// Run 소개 말풍선 — 맵 화면 상단바 Run 버튼(run-menu.tsx) 바로 아래에 꼬리를 달고 잠깐 떴다가 스스로 사라진다.
// 마우스를 올린 동안은 시간이 멈춘다. 버튼은 Run 메뉴 모양을 따른다: 게시본은 [Run 시작하기](새 Run 창), Draft는 게시본 안내+
// [게시본으로 가기], 게시본 없는 맵은 안내 한 줄만(버튼 없음). 표시 조건은 lib/run-intro.

import { useEffect, useRef, useState } from "react";
import { ListChecks } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { RUN_INTRO_SHOW_MS } from "@/lib/run-intro";
import type { RunMenuMode } from "@/lib/run-view";

interface RunIntroBubbleProps {
  mode: Exclude<RunMenuMode, "framework">;
  // start=새 Run 창, goPublished=게시본으로 전환 (noPublished는 버튼이 없어 부르지 않는다)
  onAction: () => void;
  onDismiss: () => void;
}

export function RunIntroBubble({ mode, onAction, onDismiss }: RunIntroBubbleProps) {
  const { t } = useI18n();
  const [isPaused, setIsPaused] = useState(false);
  // 남은 시간 — 멈출 때 지난 만큼 빼 두고, 다시 움직일 때 남은 만큼만 기다린다
  const remainingRef = useRef(RUN_INTRO_SHOW_MS);
  const note = mode === "goPublished" ? t("run.menu.goPublishedHint") : mode === "noPublished" ? t("run.intro.noteNoPublished") : null;
  const actionLabel = mode === "start" ? t("run.intro.start") : mode === "goPublished" ? t("run.menu.goPublished") : null;

  useEffect(() => {
    if (isPaused) return;
    const startedAt = performance.now();
    const timer = window.setTimeout(onDismiss, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - startedAt));
    };
  }, [isPaused, onDismiss]);

  return (
    <div
      data-id="run-intro"
      role="status"
      className="run-intro-in absolute right-0 top-full z-[1100] mt-2 w-72 whitespace-normal break-keep rounded-md border p-3 text-left glass glass-dense"
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={() => setIsPaused(false)}
    >
      {/* 꼬리 — Run 버튼 가운데를 가리킨다(버튼 폭 약 60px) */}
      <span
        aria-hidden
        className="absolute -top-[6px] right-[25px] h-[10px] w-[10px] rotate-45 border-l border-t bg-surface"
      />
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
          <ListChecks size={16} strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <p className="text-caption-strong text-ink">{t("run.intro.title")}</p>
          <p className="mt-0.5 text-caption text-ink-secondary">{t("run.intro.body")}</p>
          {note !== null && (
            <p data-id="run-intro-note" className="mt-1.5 text-caption-strong text-accent">
              {note}
            </p>
          )}
        </div>
      </div>
      {actionLabel !== null && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            data-id={mode === "start" ? "run-intro-start" : "run-intro-go-published"}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        </div>
      )}
      {/* 남은 시간 막대 — 타이머와 같은 길이로 줄고, 마우스를 올리면 같이 멈춘다 */}
      <span
        aria-hidden
        data-id="run-intro-timer"
        className="run-intro-timer absolute inset-x-0 bottom-0 h-[2px] rounded-b-md bg-accent"
        style={{ animationDuration: `${RUN_INTRO_SHOW_MS}ms`, animationPlayState: isPaused ? "paused" : "running" }}
      />
    </div>
  );
}
