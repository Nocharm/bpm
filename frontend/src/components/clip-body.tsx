"use client";

// 고정 높이 클립 본문 — 넘치면 스크롤바 없이 휠로만 스크롤되고 하단 페이드로 "더 있음"을 암시, 헤더의
// 펼치기/접기(ClipToggle)로 전체를 연다. 홈 맵 상세 카드의 설명·노트 섹션 공용 (사용자 결정 2026-09-09).
// 넘침 판정은 useClipOverflow — 부모가 결과로 토글 노출을 정하고 ref를 본문에 꽂는다(토글은 헤더, 본문은 아래라
// 한 컴포넌트에 못 담는다).

import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode, type RefCallback } from "react";

import { useI18n } from "@/lib/i18n";

/** 본문 내용이 접힘 높이를 넘는지 — 열린 상태에서도 scrollHeight는 내용 높이라 "접을 수 있음"이 유지된다.
 *  ref는 콜백 — 본문이 나중에 마운트되거나(노트 지연 로드) 접혔다 다시 펼쳐져도 부착 시점에 재측정한다. */
export function useClipOverflow(maxHeight: number): { ref: RefCallback<HTMLDivElement>; overflowing: boolean } {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setOverflowing(node.scrollHeight > maxHeight + 1);
    measure();
    // 컨테이너는 접힘 높이에 묶여 크기가 안 변하므로 내용 래퍼(첫 자식)도 같이 관찰 — 노트 추가·삭제 반영
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [node, maxHeight]);

  return { ref: setNode, overflowing };
}

interface ClipBodyProps {
  bodyRef: RefCallback<HTMLDivElement>;
  maxHeight: number;
  open: boolean;
  overflowing: boolean;
  className?: string;
  children: ReactNode;
}

export function ClipBody({ bodyRef, maxHeight, open, overflowing, className = "", children }: ClipBodyProps) {
  return (
    <div className={`relative min-h-0 flex-1 ${className}`}>
      <div
        ref={bodyRef}
        className="scrollbar-hidden min-h-0 overflow-y-auto"
        style={open ? undefined : { maxHeight }}
      >
        <div>{children}</div>
      </div>
      {overflowing && !open && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-surface/0 to-surface"
        />
      )}
    </div>
  );
}

interface ClipToggleProps {
  dataId: string;
  open: boolean;
  onToggle: () => void;
}

export function ClipToggle({ dataId, open, onToggle }: ClipToggleProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-id={dataId}
      aria-expanded={open}
      // -my-1 — 호버 배경용 세로 패딩이 h-5 헤더 행 높이를 키우지 않게(SP 지정 모달 '모두 펼치기'와 동일)
      className="-my-1 flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-fine text-ink-tertiary hover:bg-surface-alt hover:text-ink"
      onClick={onToggle}
    >
      {open ? <ChevronsDownUp size={13} strokeWidth={1.5} /> : <ChevronsUpDown size={13} strokeWidth={1.5} />}
      {t(open ? "section.collapse" : "section.expand")}
    </button>
  );
}
