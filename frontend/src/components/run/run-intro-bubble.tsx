"use client";

// Run 소개 말풍선 — 맵 화면 상단바 Run 버튼(run-menu.tsx) 바로 아래에 꼬리를 달고 잠깐 떴다가 스스로 사라진다.
// 마우스를 올린 동안은 시간이 멈춘다. 버튼은 Run 메뉴 모양을 따른다: 게시본은 [Run 시작하기](새 Run 창), Draft는 게시본 안내+
// [게시본으로 가기], 게시본 없는 맵은 안내 한 줄만(버튼 없음). 표시 조건은 lib/run-intro.
// 빈 새 맵에서 AI 컨설턴트 온보딩 카드가 같이 떠 있으면 그 카드 바로 아래로 내려 함께 보이고, 그 카드에 마우스를 올려도 시간이 멈춘다
// (사용자 결정 2026-11-09: 숨기지 않고 위아래로, 닫힐 때는 같이 — 같이 닫는 일은 run-menu가 한다).

import { useEffect, useRef, useState, type RefObject } from "react";
import { ListChecks } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { RUN_INTRO_SHOW_MS } from "@/lib/run-intro";
import type { RunMenuMode } from "@/lib/run-view";

interface RunIntroBubbleProps {
  mode: Exclude<RunMenuMode, "framework">;
  // start=새 Run 창, goPublished=게시본으로 전환 (noPublished는 버튼이 없어 부르지 않는다)
  onAction: () => void;
  onDismiss: () => void;
  // 위에 함께 떠 있는 카드(AI 컨설턴트 온보딩) — 있으면 그 아래로 내려 쌓는다
  stackBelowRef: RefObject<HTMLElement | null> | null;
}

// 위 카드와의 간격(px)
const STACK_GAP = 8;

export function RunIntroBubble({ mode, onAction, onDismiss, stackBelowRef }: RunIntroBubbleProps) {
  const { t } = useI18n();
  const [isPaused, setIsPaused] = useState(false);
  // 남은 시간 — 멈출 때 지난 만큼 빼 두고, 다시 움직일 때 남은 만큼만 기다린다
  const remainingRef = useRef(RUN_INTRO_SHOW_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  // 쌓일 때의 top(px, Run 메뉴 기준) — 재기 전(null)엔 숨겨 한 프레임도 겹쳐 보이지 않게
  const [stackTop, setStackTop] = useState<number | null>(null);
  const isStacked = stackBelowRef !== null;
  const note = mode === "goPublished" ? t("run.menu.goPublishedHint") : mode === "noPublished" ? t("run.intro.noteNoPublished") : null;
  const actionLabel = mode === "start" ? t("run.intro.start") : mode === "goPublished" ? t("run.menu.goPublished") : null;

  // 위 카드 크기가 바뀌면(문구 줄바꿈·창 폭) 다시 잰다 — ResizeObserver 콜백이라 첫 관찰 때도 한 번 불린다.
  // 둘이 한 묶음으로 닫히니 위 카드를 읽는 동안에도 시간을 멈춘다
  useEffect(() => {
    const above = stackBelowRef?.current;
    const anchor = rootRef.current?.offsetParent;
    if (!above || !anchor) return;
    const observer = new ResizeObserver(() => {
      setStackTop(above.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top + STACK_GAP);
    });
    observer.observe(above);
    const handleEnter = () => setIsPaused(true);
    const handleLeave = () => setIsPaused(false);
    above.addEventListener("pointerenter", handleEnter);
    above.addEventListener("pointerleave", handleLeave);
    return () => {
      observer.disconnect();
      above.removeEventListener("pointerenter", handleEnter);
      above.removeEventListener("pointerleave", handleLeave);
    };
  }, [stackBelowRef]);

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
      ref={rootRef}
      role="status"
      className={
        "run-intro-in absolute right-0 z-[1100] w-72 whitespace-normal break-keep rounded-md border p-3 text-left glass glass-dense " +
        (isStacked ? (stackTop === null ? "invisible" : "") : "top-full mt-2")
      }
      style={isStacked && stackTop !== null ? { top: stackTop } : undefined}
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={() => setIsPaused(false)}
    >
      {/* 꼬리 — Run 버튼 가운데를 가리킨다(버튼 폭 약 60px). 위 카드 아래로 쌓이면 가리킬 버튼과 떨어져 뺀다 */}
      {!isStacked && (
        <span
          aria-hidden
          className="absolute -top-[6px] right-[25px] h-[10px] w-[10px] rotate-45 border-l border-t bg-surface"
        />
      )}
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
