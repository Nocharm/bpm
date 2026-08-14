"use client";

// 인물 호버 카드 — 트리거(아이디 텍스트 등) hover 0.7초 후 부드럽게 등장.
// 이름(언어설정 기준 주/보조 치환)·아이디+사내 메신저 링크·말단 부서+조직 경로 아코디언.
// 트리거/카드 어느 쪽이든 벗어나면 짧은 유예 후 닫힘(포인터가 카드로 건너갈 시간 확보).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronRight, MessageCircle } from "lucide-react";

import { clampToViewport } from "@/lib/clamp-viewport";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";

const OPEN_DELAY_MS = 700; // hover 의도 판정 — 스치는 이동엔 안 뜬다
const CLOSE_DELAY_MS = 120; // 트리거→카드 포인터 이동 유예

interface PersonHoverCardProps {
  userId: string;
  /** 트리거 래퍼(span)에 적용 — 기존 자리의 레이아웃 클래스를 그대로 이어받는다. */
  className?: string;
  children: ReactNode;
}

export function PersonHoverCard({ userId, className, children }: PersonHoverCardProps) {
  const { t, lang } = useI18n();
  const users = useDirectory();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
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

  const user = users.get(userId);

  const scheduleOpen = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (pos !== null || openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setOrgOpen(false);
      setPos(clampToViewport(rect.left, rect.bottom + 6, 264, 170));
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
    <span ref={triggerRef} className={className} onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
      {children}
      {pos !== null &&
        createPortal(
          <div
            data-id="person-hover-card"
            className="animate-item-in fixed z-[1400] w-64 rounded-md border border-hairline bg-surface p-3 shadow-lg"
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            {/* 이름 — 주 언어 타이틀 + 보조 언어 이름 */}
            <p className="flex items-baseline gap-1.5">
              <span className="min-w-0 truncate text-caption-strong text-ink">{primaryName}</span>
              {secondaryName && (
                <span className="min-w-0 truncate text-fine text-ink-tertiary">{secondaryName}</span>
              )}
            </p>
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
          </div>,
          document.body,
        )}
    </span>
  );
}
