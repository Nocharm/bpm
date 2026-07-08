"use client";

// 링크 미리보기 패널 — 노드 참조 url을 우측 슬라이드 서브 브라우저(iframe)로 열람.
// 임베드 차단(X-Frame-Options/CSP)은 크로스오리진이라 직접 감지 불가 → onLoad + 타임아웃 조합으로
// 폴백을 띄우고, "새 탭에서 열기"를 크롬·폴백 양쪽에 상시 제공한다.

import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Link,
  Lock,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { checkEmbeddable } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { isSafePreviewUrl } from "@/lib/url";

// load 이벤트가 이 시간 안에 안 오면 임베드 차단으로 판정(ms) — 스펙 6s
const LOAD_TIMEOUT_MS = 6000;

type LoadStatus = { key: string; state: "loaded" | "failed" } | null;

export function LinkPreviewPanel({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<LoadStatus>(null);
  // 서버 임베드 체크 판정 — 차단(false) verdict가 온 key만 기록(크롬 오류 화면 대신 폴백 카드)
  const [blockedKey, setBlockedKey] = useState<string | null>(null);

  // http(s) + 자기 오리진 차단만 로드 — 액션 바와 같은 가드(isSafePreviewUrl, 샌드박스 탈출 방지)
  const validUrl = url !== null && isSafePreviewUrl(url) ? url : null;
  const open = validUrl !== null;
  const currentKey = `${validUrl ?? ""}#${reloadKey}`;
  // 로딩/실패는 status↔currentKey 비교로 파생 — effect 내 동기 setState 금지(react-hooks/set-state-in-effect)
  const loaded = status?.key === currentKey && status.state === "loaded";
  // 서버 판정 차단도 폴백 카드 경로로 — Chrome은 차단 로드에도 onLoad를 쏴 클라이언트 단독 감지 불가
  const failed =
    (status?.key === currentKey && status.state === "failed") ||
    blockedKey === currentKey;
  const loading = open && !loaded && !failed;

  // 슬라이드 아웃 애니메이션 동안 주소 줄 유지 — 렌더 중 상태 조정(effect 아님).
  // ref 변형은 react-hooks/refs(React Compiler)가 렌더 중 접근을 금지 — group-title-bar.tsx와 같은 패턴.
  const [shownUrl, setShownUrl] = useState("");
  if (validUrl !== null && validUrl !== shownUrl) {
    setShownUrl(validUrl);
  }

  // 임베드 차단 타임아웃 — 만료 시점까지 이 key로 load가 안 왔으면 failed 마킹(이미 loaded면 유지)
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setStatus((prev) =>
        prev?.key === currentKey ? prev : { key: currentKey, state: "failed" },
      );
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [open, currentKey]);

  // 서버 임베드 체크 — iframe 로드와 병행, 차단 사이트는 폴백 카드를 즉시 표시 (embed-check design 2026-07-08).
  // 판정 실패(null/네트워크 오류)는 무해 — 기존 onLoad+타임아웃 동작 유지.
  useEffect(() => {
    if (!open || validUrl === null) return;
    let active = true;
    const key = currentKey;
    checkEmbeddable(validUrl)
      .then((verdict) => {
        if (active && verdict.embeddable === false) setBlockedKey(key);
      })
      .catch(() => {
        // 체크 엔드포인트 실패 — 기능 저하 없이 기존 경로로
      });
    return () => {
      active = false;
    };
  }, [open, validUrl, currentKey]);

  // Esc 닫기 — 열려 있는 동안만 구독
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const chromeBtn =
    "inline-flex h-7 w-7 items-center justify-center rounded-xs text-ink-tertiary " +
    "hover:bg-surface-alt hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <>
      {/* 스크림 — 클릭 시 닫힘. z는 피드백 패널(1200/1300)보다 아래 */}
      <div
        aria-hidden
        onClick={onClose}
        className={
          "fixed inset-0 z-[1100] bg-ink/20 transition-opacity duration-350 " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />
      <aside
        role="dialog"
        aria-label={t("linkPreview.title")}
        data-id="link-preview-panel"
        className={
          "fixed right-0 top-0 z-[1110] flex h-full w-[520px] flex-col border-l border-hairline " +
          "bg-surface shadow-lg transition-transform duration-350 ease-spring " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        {/* 로딩 진행 바 — 패널 최상단 3px, 액센트 그라데이션 */}
        {loading && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px]">
            <div
              className="h-full"
              style={{
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 65%, white), var(--color-accent))",
                boxShadow: "0 0 8px color-mix(in srgb, var(--color-accent) 45%, transparent)",
                animation: "lp-bar 2.4s ease-out forwards",
              }}
            />
          </div>
        )}
        {/* 브라우저 크롬 — 타이틀 줄 + 주소 줄 */}
        <div className="shrink-0 border-b border-hairline bg-surface-pearl">
          <div className="flex h-11 items-center gap-2 pl-3 pr-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
              <Link size={14} strokeWidth={1.5} className="text-accent" />
              {t("linkPreview.title")}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (validUrl) window.open(validUrl, "_blank", "noopener");
                }}
                aria-label={t("linkPreview.openNewTab")}
                title={t("linkPreview.openNewTab")}
                className={chromeBtn}
              >
                <ExternalLink size={14} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("linkPreview.close")}
                title={t("linkPreview.close")}
                className={chromeBtn}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2.5">
            {/* iframe history는 cross-origin 접근 불가 — 뒤/앞은 비활성 고정(스펙 허용) */}
            <button type="button" disabled aria-label={t("linkPreview.back")} title={t("linkPreview.back")} className={chromeBtn}>
              <ArrowLeft size={14} strokeWidth={1.5} />
            </button>
            <button type="button" disabled aria-label={t("linkPreview.forward")} title={t("linkPreview.forward")} className={chromeBtn}>
              <ArrowRight size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              aria-label={t("linkPreview.refresh")}
              title={t("linkPreview.refresh")}
              className={chromeBtn}
            >
              <RefreshCw size={13} strokeWidth={1.5} />
            </button>
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5">
              <Lock size={11} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="truncate text-fine text-ink-secondary">{shownUrl}</span>
            </div>
          </div>
        </div>
        {/* 콘텐츠 — iframe / 로딩 / 임베드 차단 폴백 */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-alt">
          {validUrl && !failed && (
            <iframe
              key={currentKey}
              src={validUrl}
              title={t("linkPreview.title")}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer"
              onLoad={() => setStatus({ key: currentKey, state: "loaded" })}
              className={"h-full w-full border-0 bg-surface " + (loading ? "invisible" : "")}
            />
          )}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
              <div className="relative h-14 w-14">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: "2.5px solid var(--color-accent-tint)",
                    borderTopColor: "var(--color-accent)",
                    animation: "lp-spin 0.85s linear infinite",
                  }}
                />
                <Globe
                  size={30}
                  strokeWidth={1.5}
                  className="absolute inset-0 m-auto text-accent"
                  style={{ animation: "lp-pulse 1.3s ease-in-out infinite" }}
                />
              </div>
              <div className="flex items-center gap-1.5 text-caption text-ink-tertiary">
                {t("linkPreview.loading")}
                <span className="inline-flex items-center gap-[3px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-[3px] w-[3px] rounded-full bg-accent"
                      style={{ animation: `lp-dot 1.1s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="flex w-full max-w-[360px] flex-col items-center gap-3 rounded-md bg-surface p-6 text-center shadow-md">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-accent-tint">
                  <Globe size={24} strokeWidth={1.5} className="text-accent" />
                </span>
                <p className="text-caption text-ink-secondary">{t("linkPreview.blocked")}</p>
                <div className="w-full truncate rounded-xs border border-hairline bg-surface-alt px-2.5 py-1.5 text-fine text-ink-tertiary">
                  {shownUrl}
                </div>
                <button
                  type="button"
                  onClick={() => window.open(shownUrl, "_blank", "noopener")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-focus"
                >
                  <ExternalLink size={14} strokeWidth={1.5} />
                  {t("linkPreview.openNewTab")}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
