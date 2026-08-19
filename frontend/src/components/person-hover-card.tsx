"use client";

// 인물 카드 — 두 진입점: ① 트리거 hover 0.7초/클릭 즉시(PersonHoverCard) ② 우클릭 메뉴 Info용
// 스탠드얼론 팝업(PersonInfoPopup). 내용 공용: 이름(언어설정 기준 주/보조 치환)·아이디+사내 메신저 링크·
// 말단 부서+조직 경로 아코디언. 포털이어도 React 트리로는 트리거 조상에게 버블링 — 카드에서 전부 차단.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronRight, MessageCircle } from "lucide-react";

import { clampToViewport } from "@/lib/clamp-viewport";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { formatTitleWithPosition } from "@/lib/korean-dept";

const OPEN_DELAY_MS = 700; // hover 의도 판정 — 스치는 이동엔 안 뜬다
const CLOSE_DELAY_MS = 120; // 트리거→카드 포인터 이동 유예
const CARD_WIDTH = 264; // 클램프 추정 폭(w-64)
const CARD_EST_HEIGHT = 170; // 클램프 추정 높이 — 아코디언 접힘 기준 근사치

// 카드 본문 — 마운트마다 새로 뜨므로 아코디언 상태도 자연 리셋된다.
function PersonCardContent({ userId }: { userId: string }) {
  const { t, lang } = useI18n();
  const users = useDirectory();
  const [orgOpen, setOrgOpen] = useState(false);

  const user = users.get(userId);

  // 이름 — 언어설정 기준 주 이름 타이틀, 다른 언어 이름은 보조 위치로 치환. 한글명 없으면 영문 폴백.
  const englishName = user?.name || userId;
  const koreanName = user?.korean_name || "";
  const primaryName = lang === "ko" ? koreanName || englishName : englishName;
  const secondaryName = lang === "ko" ? (koreanName ? englishName : "") : koreanName;

  const segments = (user?.org_path ?? "").split("/").filter(Boolean);
  const leafFromPath = segments[segments.length - 1] ?? "";
  const leafDept =
    lang === "ko"
      ? user?.korean_dept || leafFromPath || user?.department || ""
      : leafFromPath || user?.department || "";

  return (
    <>
      {/* 이름 — 주 언어 타이틀 + 보조 언어 이름 */}
      <p className="flex items-baseline gap-1.5">
        <span className="min-w-0 truncate text-caption-strong text-ink">{primaryName}</span>
        {secondaryName && (
          <span className="min-w-0 truncate text-fine text-ink-tertiary">{secondaryName}</span>
        )}
      </p>
      {/* 직급 · 보직(노출 허용된 보직만 — 서버 allowlist) — 멤버 행 펼침 필과 동일 표기 규칙 */}
      {formatTitleWithPosition(user?.title ?? "", user?.position ?? "") && (
        <p className="mt-1">
          <span className="inline-flex rounded-xs border border-accent-tint-border px-1.5 py-0.5 text-fine text-accent">
            {formatTitleWithPosition(user?.title ?? "", user?.position ?? "")}
          </span>
        </p>
      )}
      {/* 아이디 + 사내 메신저 열기(mysingleim 프로토콜) */}
      <p className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-fine text-ink-secondary">{userId}</span>
        <a
          data-id="person-hover-messenger"
          href={`mysingleim://token=&ids=${userId}`}
          title={t("person.openMessenger")}
          className="shrink-0 rounded-sm p-1 text-accent hover:bg-accent-tint"
        >
          <MessageCircle size={14} strokeWidth={1.5} />
        </a>
      </p>
      {/* 부서 — 말단 + 조직 경로 아코디언(경로 2단 이상일 때만 쉐브론) */}
      {leafDept && (
        <div className="mt-2 border-t border-hairline pt-2">
          <button
            type="button"
            data-id="person-hover-org-toggle"
            className="flex w-full items-center gap-1 text-left"
            onClick={() => setOrgOpen((v) => !v)}
            disabled={segments.length <= 1}
          >
            <Building2 size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            <span className="min-w-0 flex-1 truncate text-fine text-ink-secondary">{leafDept}</span>
            {segments.length > 1 && (
              <ChevronRight
                size={12}
                strokeWidth={1.5}
                className={`shrink-0 text-ink-tertiary transition-transform duration-150 ${
                  orgOpen ? "rotate-90" : ""
                }`}
              />
            )}
          </button>
          {segments.length > 1 && (
            <div
              className={`grid transition-all duration-300 ease-in-out ${
                orgOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {segments.map((seg, i) => (
                    <li
                      key={`${seg}-${i}`}
                      className={`truncate text-fine ${
                        i === segments.length - 1 ? "text-ink-secondary" : "text-ink-tertiary"
                      }`}
                      style={{ paddingLeft: `${i * 10}px` }}
                    >
                      {seg}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

interface PersonHoverCardProps {
  userId: string;
  /** 트리거 래퍼(span)에 적용 — 기존 자리의 레이아웃 클래스를 그대로 이어받는다. */
  className?: string;
  children: ReactNode;
}

export function PersonHoverCard({ userId, className, children }: PersonHoverCardProps) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // 언마운트 시 잔여 타이머 정리 — 닫힌 뒤 열림/닫힘이 뒤늦게 발화하지 않게
  useEffect(
    () => () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const openNow = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(clampToViewport(rect.left, rect.bottom + 6, CARD_WIDTH, CARD_EST_HEIGHT));
  };

  const scheduleOpen = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (pos !== null || openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      openNow();
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (pos === null) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPos(null);
    }, CLOSE_DELAY_MS);
  };

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  return (
    <span
      ref={triggerRef}
      // 호버 어포던스 + 클릭 즉시 열림(0.7초 대기 생략). 부모가 클릭 토글 카드여도 번지지 않게 차단.
      className={`${className ?? ""} cursor-pointer transition-colors duration-150 hover:text-accent`}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onClick={(event) => {
        event.stopPropagation();
        // 토글 — 열려 있으면 클릭으로 닫기
        if (pos !== null) {
          if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
          }
          setPos(null);
        } else {
          openNow();
        }
      }}
    >
      {children}
      {pos !== null &&
        createPortal(
          <div
            data-id="person-hover-card"
            className="animate-item-in fixed z-[1400] w-64 rounded-md border border-hairline bg-surface p-3 shadow-lg"
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            // 포털이어도 React 트리로는 트리거의 조상(클릭 토글 카드 등)으로 이벤트가 버블링 — 전부 차단.
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <PersonCardContent userId={userId} />
          </div>,
          document.body,
        )}
    </span>
  );
}

interface PersonInfoPopupProps {
  userId: string;
  /** 메뉴 클릭 지점 — 이 자리에(화면 안 클램프) 띄운다. */
  position: { x: number; y: number };
  onClose: () => void;
}

// 우클릭 메뉴 Info용 스탠드얼론 팝업 — 호버 아닌 명시 열림, 바깥 mousedown/Escape 닫힘.
export function PersonInfoPopup({ userId, position, onClose }: PersonInfoPopupProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // 스크롤·리사이즈에도 닫는다 — 팝업은 fixed 좌표라 목록이 움직이면 앵커에서 떨어진다
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const { left, top } = clampToViewport(position.x, position.y, CARD_WIDTH, CARD_EST_HEIGHT);

  return createPortal(
    <div
      className="fixed inset-0 z-[1400]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        data-id="person-info-popup"
        className="animate-item-in fixed w-64 rounded-md border border-hairline bg-surface p-3 shadow-lg"
        style={{ left, top }}
        // 마운트 지점의 React 조상으로 버블링 차단(행 클릭 토글 등)
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <PersonCardContent userId={userId} />
      </div>
    </div>,
    document.body,
  );
}
