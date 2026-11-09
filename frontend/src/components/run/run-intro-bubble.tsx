"use client";

// Run 소개 말풍선 — 맵 화면 상단바 Run 버튼(run-menu.tsx) 바로 아래에 꼬리를 달고 잠깐 떴다가 스스로 사라진다.
// 마우스를 올린 동안은 시간이 멈춘다. 버튼은 Run 메뉴 모양을 따른다: 게시본은 [Run 시작하기](새 Run 창), Draft는 게시본 안내+
// [게시본으로 가기], 게시본 없는 맵은 안내 한 줄만(버튼 없음). 표시 조건은 lib/run-intro.
// 빈 새 맵에서 AI 컨설턴트 온보딩 카드가 같이 떠 있으면 그 카드 오른쪽에 좁은 카드로 한 줄에 나란히 놓고(자리가 모자라면 아래로),
// 그 카드에 마우스를 올려도 시간이 멈춘다(사용자 결정 2026-11-09: 숨기지 않고 함께, 닫힐 때는 같이 — 같이 닫는 일은 run-menu가 한다).
// 나란히 놓이면 높이를 그 카드에 맞추고, 그 카드 아래 변에도 같은 남은 시간 막대를 단다(같이 꺼진다는 표시, 사용자 결정 2026-11-10).

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ListChecks } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { RUN_INTRO_SHOW_MS } from "@/lib/run-intro";
import type { RunMenuMode } from "@/lib/run-view";

interface RunIntroBubbleProps {
  mode: Exclude<RunMenuMode, "framework">;
  // start=새 Run 창, goPublished=게시본으로 전환 (noPublished는 버튼이 없어 부르지 않는다)
  onAction: () => void;
  onDismiss: () => void;
  // 함께 떠 있는 카드(AI 컨설턴트 온보딩) — 있으면 그 옆(자리가 없으면 아래)에 놓는다
  stackBelowRef: RefObject<HTMLElement | null> | null;
}

// 함께 뜬 카드 옆에 놓을 때의 자리 — beside=같은 줄 오른쪽(좁은 카드), below=그 아래(기본 폭). 값은 Run 메뉴 기준 px
type CompanionLayout =
  | { kind: "beside"; left: number; width: number; height: number; tailLeft: number }
  | { kind: "below"; top: number };

// 카드 사이 간격(px)
const COMPANION_GAP = 8;
// 옆에 놓을 때 화면 오른쪽 여백(px)과 폭 범위 — AI 카드 오른쪽은 상단바 오른쪽 버튼 폭만큼이라 창 폭과 무관하게 약 157px.
// 140 밑이면 문구가 너무 잘게 쪼개져 아래로 내린다
const BESIDE_EDGE = 12;
const BESIDE_MIN_WIDTH = 140;
const BESIDE_MAX_WIDTH = 220;

export function RunIntroBubble({ mode, onAction, onDismiss, stackBelowRef }: RunIntroBubbleProps) {
  const { t } = useI18n();
  const [isPaused, setIsPaused] = useState(false);
  // 남은 시간 — 멈출 때 지난 만큼 빼 두고, 다시 움직일 때 남은 만큼만 기다린다
  const remainingRef = useRef(RUN_INTRO_SHOW_MS);
  const rootRef = useRef<HTMLDivElement>(null);
  // 함께 뜬 카드 기준 자리 — 재기 전(null)엔 숨겨 한 프레임도 겹쳐 보이지 않게
  const [companionLayout, setCompanionLayout] = useState<CompanionLayout | null>(null);
  // 남은 시간 막대를 같이 달 함께 뜬 카드 — 렌더 중엔 ref를 읽을 수 없어 잴 때 함께 담는다
  const [companionEl, setCompanionEl] = useState<HTMLElement | null>(null);
  const hasCompanion = stackBelowRef !== null;
  const isBeside = hasCompanion && companionLayout?.kind === "beside";
  // 좁은 카드는 본문과 게시본 안내를 한 문장으로 합쳐 밀도를 줄인다(사용자 결정 2026-11-09)
  const body = !isBeside || mode === "start" ? t("run.intro.body") : mode === "goPublished" ? t("run.intro.compactGoPublished") : t("run.intro.compactNoPublished");
  const note = isBeside ? null : mode === "goPublished" ? t("run.menu.goPublishedHint") : mode === "noPublished" ? t("run.intro.noteNoPublished") : null;
  const actionLabel = mode === "start" ? t("run.intro.start") : mode === "goPublished" ? t("run.menu.goPublished") : null;

  // 함께 뜬 카드의 크기·창 폭이 바뀌면 다시 잰다 — ResizeObserver 콜백이라 첫 관찰 때도 한 번 불린다.
  // 둘이 한 묶음으로 닫히니 그 카드를 읽는 동안에도 시간을 멈춘다
  useEffect(() => {
    const above = stackBelowRef?.current;
    const anchor = rootRef.current?.offsetParent;
    if (!above || !anchor) return;
    const measure = () => {
      // 그 카드는 등장 애니메이션(transform) 중일 수 있어 getBoundingClientRect 대신 레이아웃 상자로 잰다
      const companionBase = (above.offsetParent ?? document.body).getBoundingClientRect();
      const companion = {
        right: companionBase.left + above.offsetLeft + above.offsetWidth,
        bottom: companionBase.top + above.offsetTop + above.offsetHeight,
        height: above.offsetHeight,
      };
      const menu = anchor.getBoundingClientRect();
      const besideLeft = companion.right + COMPANION_GAP;
      const width = Math.min(BESIDE_MAX_WIDTH, window.innerWidth - BESIDE_EDGE - besideLeft);
      setCompanionLayout(
        width >= BESIDE_MIN_WIDTH
          ? { kind: "beside", left: besideLeft - menu.left, width, height: companion.height, tailLeft: menu.left + menu.width / 2 - besideLeft }
          : { kind: "below", top: companion.bottom - menu.top + COMPANION_GAP },
      );
      setCompanionEl(above);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(above);
    window.addEventListener("resize", measure);
    const handleEnter = () => setIsPaused(true);
    const handleLeave = () => setIsPaused(false);
    above.addEventListener("pointerenter", handleEnter);
    above.addEventListener("pointerleave", handleLeave);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
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

  const renderTimer = (dataId: string) => (
    <span
      aria-hidden
      data-id={dataId}
      className="run-intro-timer pointer-events-none absolute inset-x-0 bottom-0 h-[2px] rounded-b-md bg-accent"
      style={{ animationDuration: `${RUN_INTRO_SHOW_MS}ms`, animationPlayState: isPaused ? "paused" : "running" }}
    />
  );

  return (
    <div
      data-id="run-intro"
      ref={rootRef}
      role="status"
      className={
        "run-intro-in absolute z-[1100] whitespace-normal break-keep rounded-md border text-left glass glass-dense " +
        (isBeside ? "top-full mt-2 p-2.5 " : "right-0 w-72 p-3 ") +
        (!hasCompanion || companionLayout?.kind === "beside" ? "top-full mt-2" : companionLayout === null ? "invisible" : "")
      }
      style={
        !hasCompanion || companionLayout === null
          ? undefined
          : companionLayout.kind === "beside"
            ? { left: companionLayout.left, width: companionLayout.width, minHeight: companionLayout.height }
            : { top: companionLayout.top }
      }
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={() => setIsPaused(false)}
    >
      {/* 꼬리 — Run 버튼 가운데를 가리킨다(버튼 폭 약 60px). 옆에 놓이면 잰 자리로, 아래로 쌓이면 버튼과 떨어져 뺀다 */}
      {!hasCompanion ? (
        <span
          aria-hidden
          className="absolute -top-[6px] right-[25px] h-[10px] w-[10px] rotate-45 border-l border-t bg-surface"
        />
      ) : companionLayout?.kind === "beside" ? (
        <span
          aria-hidden
          className="absolute -top-[6px] h-[10px] w-[10px] rotate-45 border-l border-t bg-surface"
          style={{ left: companionLayout.tailLeft - 5 }}
        />
      ) : null}
      <div className="flex items-start gap-2.5">
        {/* 좁은 카드에선 아이콘을 빼 글자 폭을 남긴다 */}
        {!isBeside && (
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
            <ListChecks size={16} strokeWidth={1.5} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-caption-strong text-ink">{t("run.intro.title")}</p>
          <p className={`mt-0.5 text-ink-secondary ${isBeside ? "text-fine" : "text-caption"}`}>{body}</p>
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
      {/* 남은 시간 막대 — 타이머와 같은 길이로 줄고, 마우스를 올리면 같이 멈춘다. 함께 뜬 카드에도 같은 막대 */}
      {renderTimer("run-intro-timer")}
      {hasCompanion && companionEl !== null && createPortal(renderTimer("run-intro-companion-timer"), companionEl)}
    </div>
  );
}
