"use client";

// 검색 드롭다운 — 옵션 목록을 검색어로 필터 + 매치 하이라이트, 선택 시 value 저장 (F5 담당자/부서).
// 자유입력 불가(목록에서만 선택). 기존 값이 옵션에 없으면 버튼에 그대로 표시(레거시 보존).
// SR: 키 내비(Tab/↓ 다음, ↑/Shift+Tab 이전, Enter 선택) · 드롭다운은 오버레이라 입력창 위치 불변.
// 두 모드 모두 document.body 포털 + fixed — 모달(overflow-hidden)·인스펙터(overflow-y-auto)에 잘리지 않는다.
//   addMode: 트리거가 ＋아이콘, 플라이아웃을 "클릭한 마우스 위치"에.
//   기본: 트리거 버튼 rect 기준(아래 우선, 공간 없으면 위). fitContent면 우측 정렬.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, X } from "lucide-react";

import { Highlight } from "@/components/highlight";
import { useI18n } from "@/lib/i18n";
import { filterByQuery, type MatchRange } from "@/lib/search";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

export interface SelectOption {
  value: string;
  label: string;
  sub?: string; // 보조 표기(표시 전용, 예: 아이디 · 부서) — 검색 대상 아님
  keywords?: string; // 추가 검색어(표시 안 함, 예: 아이디). label과 함께 검색
}

const FLYOUT_W = 224; // w-56
const FLYOUT_H = 300; // 대략 높이(화면 하단 클램프용) — 검색 입력 + max-h-56 목록
const GAP = 4; // 트리거와 메뉴 사이
const MARGIN = 8; // 뷰포트 가장자리 최소 여백

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 기본 모드 메뉴 좌표 — 트리거 rect 기준. 아래 우선, 공간 없으면 위, 그래도 없으면 화면 안으로 클램프. */
function computeMenuPos(
  rect: DOMRect,
  viewport: { width: number; height: number },
  alignRight: boolean,
): { left: number; top: number; width: number } {
  const width = Math.max(FLYOUT_W, rect.width);
  const rawLeft = alignRight ? rect.right - width : rect.left;
  const left = clamp(rawLeft, MARGIN, Math.max(MARGIN, viewport.width - MARGIN - width));

  const below = rect.bottom + GAP;
  const above = rect.top - GAP - FLYOUT_H;
  const top =
    below + FLYOUT_H <= viewport.height - MARGIN
      ? below
      : above >= MARGIN
        ? above
        : Math.max(MARGIN, viewport.height - MARGIN - FLYOUT_H);
  return { left, top, width };
}

export function SearchSelect({
  value,
  options,
  emptyLabel,
  placeholder,
  onChange,
  addMode = false,
  fitContent = false,
}: {
  value: string;
  options: SelectOption[];
  emptyLabel: string; // 미지정 옵션 라벨
  placeholder: string; // 검색 입력 placeholder
  onChange: (value: string) => void;
  // true면 ＋아이콘 트리거 + 마우스 위치 포털 플라이아웃(담당자 추가용).
  addMode?: boolean;
  // true면 flex-1로 늘리지 않고 값 내용폭(최대폭 캡)으로 — 라벨 옆 우측정렬용(부서 등).
  fitContent?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 검색어는 닫아도 유지 — 재오픈 시 남은 검색어로 재검색, X 버튼으로만 전체 삭제 (batch2 ⑪)
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0); // 0=미지정, 1..n=hits
  const listRef = useRef<HTMLDivElement>(null);
  // addMode 플라이아웃의 fixed 좌표(클릭 마우스 위치 기준).
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number } | null>(null);
  // 기본 모드 메뉴의 fixed 좌표(트리거 rect 기준) — 열려 있는 동안 스크롤·리사이즈에 재계산.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (addMode || !open) return;
    const updatePos = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setMenuPos(
        computeMenuPos(
          trigger.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
          fitContent,
        ),
      );
    };
    updatePos(); // DOM 측정은 커밋 후에만 — menuPos=null 동안은 렌더 안 하므로 잘못된 위치로 깜빡이지 않는다
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true); // capture — 모달 본문·인스펙터 등 내부 스크롤까지
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open, addMode, fitContent]);

  // 검색은 label + keywords만 — sub(부서 등)는 표시 전용(검색 제외).
  const hits = query.trim()
    ? filterByQuery(options, query, (option) => [
        { field: "label", text: option.label },
        ...(option.keywords ? [{ field: "keywords", text: option.keywords }] : []),
      ])
    : options.map((item) => ({ item, matches: [] as { field: string; ranges: MatchRange[] }[] }));
  // 25개씩 증분 렌더 — 담당자 옵션이 수천 명(공개 맵 eligible)일 때 전량 DOM 렌더 부하 방지.
  const { visible: shown, hasMore, sentinelRef } = useInfiniteSlice(hits, query);
  const navCount = 1 + shown.length;
  const current = options.find((option) => option.value === value);
  const display = current ? current.label : value || emptyLabel;

  // addMode — 클릭 마우스 위치에 플라이아웃(화면 넘치면 좌/상으로 접음).
  const openAt = (clientX: number, clientY: number) => {
    const left = clientX + FLYOUT_W + 8 > window.innerWidth ? Math.max(8, clientX - FLYOUT_W) : clientX;
    const top = Math.max(8, Math.min(clientY, window.innerHeight - FLYOUT_H));
    setFlyoutPos({ left, top });
    setOpen(true);
    setActive(0);
  };

  // 닫힘은 항상 좌표를 함께 비운다 — 남겨두면 재개방 첫 프레임이 옛 위치로 그려진다(effect는 페인트 후 실행).
  const closeMenu = () => {
    setOpen(false);
    setMenuPos(null);
  };

  const pick = (index: number) => {
    if (index <= 0) {
      onChange("");
    } else {
      onChange(shown[index - 1].item.value);
    }
    closeMenu();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, navCount - 1));
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape") {
      closeMenu();
    }
  };

  // 플라이아웃 내용 — addMode(마우스 위치)와 기본(트리거 아래) 공용. 둘 다 body 포털·fixed.
  const menu = (
    <>
      <div className="relative mx-2 mb-1">
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full rounded-sm border border-hairline px-2 py-1 pr-6 text-fine text-ink outline-none"
        />
        {/* 전체 지우기 — 검색어만 비움, 드롭다운 유지 (batch2 ⑪) */}
        {query.length > 0 && (
          <button
            type="button"
            data-id="picker-clear-query"
            aria-label={t("perm.pickerClear")}
            title={t("perm.pickerClear")}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            onClick={() => {
              setQuery("");
              setActive(0);
            }}
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto">
        {/* 미지정 (index 0) */}
        <button
          type="button"
          className={`block w-full px-3 py-1 text-left text-caption text-ink-tertiary hover:bg-surface-alt ${
            active === 0 ? "bg-surface-alt" : ""
          }`}
          onMouseEnter={() => setActive(0)}
          onClick={() => pick(0)}
        >
          {emptyLabel}
        </button>
        {hits.length === 0 ? (
          <p className="px-3 py-1 text-fine text-ink-tertiary">…</p>
        ) : (
          shown.map(({ item, matches }, idx) => {
            const labelRanges = matches.find((m) => m.field === "label")?.ranges ?? [];
            return (
              <button
                key={item.value}
                type="button"
                className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-caption text-ink hover:bg-surface-alt ${
                  active === idx + 1 ? "bg-surface-alt" : ""
                }`}
                onMouseEnter={() => setActive(idx + 1)}
                onClick={() => pick(idx + 1)}
              >
                <span className="min-w-0 truncate">
                  <Highlight text={item.label} ranges={labelRanges} />
                  {item.sub && <span className="ml-1 text-fine text-ink-tertiary">· {item.sub}</span>}
                </span>
                {item.value === value && (
                  <Check size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
                )}
              </button>
            );
          })
        )}
        {hasMore && <div ref={sentinelRef} className="h-px shrink-0" />}
      </div>
    </>
  );

  return (
    <div
      className={
        addMode ? "relative shrink-0" : fitContent ? "relative min-w-0" : "relative min-w-0 flex-1"
      }
    >
      {addMode ? (
        <button
          type="button"
          aria-label={placeholder}
          title={placeholder}
          className={`flex h-[22px] w-[22px] items-center justify-center rounded-sm border ${
            open
              ? "border-solid border-accent bg-accent-tint text-accent"
              : "border-dashed border-hairline text-ink-tertiary hover:border-solid hover:border-accent hover:text-accent"
          }`}
          onClick={(event) => (open ? closeMenu() : openAt(event.clientX, event.clientY))}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          data-id="search-select-trigger"
          className={`flex ${
            fitContent ? "w-auto min-w-0 max-w-[176px]" : "w-full"
          } items-center justify-between gap-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink hover:bg-surface-alt`}
          onClick={() => {
            if (open) closeMenu();
            else setOpen(true);
            setActive(0);
          }}
        >
          <span className="truncate">{display}</span>
          <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        </button>
      )}

      {open &&
        (addMode ? (
          // 마우스 위치 포털(fixed) — 모달 transform 조상 영향 없음, 아래 필드 미가림.
          createPortal(
            // z는 노드 편집 모달(z-1200)보다 위 — 안 그러면 모달 뒤로 깔려 클릭 불가.
            <>
              <div className="fixed inset-0 z-[1340]" onClick={closeMenu} />
              <div
                className="fixed z-[1350] w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg"
                style={flyoutPos ? { left: flyoutPos.left, top: flyoutPos.top } : undefined}
              >
                {menu}
              </div>
            </>,
            document.body,
          )
        ) : (
          menuPos &&
          // 트리거 rect 포털(fixed) — 모달 overflow-hidden·인스펙터 overflow-y-auto에 잘리지 않는다.
          // z는 노드 편집 모달(1200)·서브프로세스 지정 모달(1300)보다 위.
          createPortal(
            <>
              {/* 바깥 클릭 닫기 */}
              <div className="fixed inset-0 z-[1340]" onClick={closeMenu} />
              <div
                data-id="search-select-menu"
                className="fixed z-[1350] rounded-md border border-hairline bg-surface py-1 shadow-lg"
                style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
              >
                {menu}
              </div>
            </>,
            document.body,
          )
        ))}
    </div>
  );
}
