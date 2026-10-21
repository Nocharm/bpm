"use client";

// 인스펙터 속성 탭 SP 노드 머리 배너 — 이 노드가 연결한 맵(이름·열기)과 지정·버전 추종 상태를 노드 편집 맨 위에 보인다.
// 상태 표기는 캔버스 SP 노드 배너와 같은 문구(지정 필은 영어 고정, 추종 필은 번역). 에디터 page.tsx 전용.

import { AlertTriangle, ExternalLink, Lock, Pin, RefreshCw, Workflow } from "lucide-react";

import { Tooltip } from "@/components/tooltip";
import { useI18n } from "@/lib/i18n";

interface SubprocessNodeBannerProps {
  // 노드 라벨 — 링크 맵 이름을 라이브로 따른다
  name: string;
  // 링크 맵 없음(플레이스홀더)
  linked: boolean;
  // 열람 권한 없는 링크(잠금 노드)
  locked: boolean;
  // 지정 여부 — 참조 정보 도착 전이면 null(필 생략)
  designated: boolean | null;
  followLatest: boolean;
  // 연결 맵 열기 — 미저장 경고 확인을 거친다. 열 수 없으면(미연결·잠금) 생략
  onOpenMap?: () => void;
}

const CHIP = "inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-fine";

export function SubprocessNodeBanner({ name, linked, locked, designated, followLatest, onOpenMap }: SubprocessNodeBannerProps) {
  const { t } = useI18n();
  return (
    <section data-id="inspector-sp-node-banner" className="rounded-md border border-hairline bg-surface-alt/50 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
          <Workflow size={14} strokeWidth={1.5} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-fine text-ink-tertiary">{t("field.linkedMap")}</span>
          <span data-id="inspector-sp-node-name" className="block truncate text-caption-strong text-ink" title={name}>
            {name || "-"}
          </span>
        </span>
        {onOpenMap && (
          <Tooltip content={t("subprocess.openMap")}>
            <button
              type="button"
              data-id="inspector-sp-open-map"
              aria-label={t("subprocess.openMap")}
              className="shrink-0 rounded-sm p-1.5 text-ink-tertiary hover:bg-surface hover:text-accent"
              onClick={onOpenMap}
            >
              <ExternalLink size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
      </div>
      <div data-id="inspector-sp-node-status" className="mt-2 flex flex-wrap items-center gap-1">
        {!linked ? (
          <span title={t("subprocess.placeholderNotice")} className={`${CHIP} border-changed/40 bg-changed/10 text-changed`}>
            <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0" />
            {t("subprocess.placeholderBanner")}
          </span>
        ) : locked ? (
          <span className={`${CHIP} border-hairline bg-surface text-ink-secondary`}>
            <Lock size={12} strokeWidth={1.5} className="shrink-0" />
            {t("subprocess.locked")}
          </span>
        ) : designated === false ? (
          // 지정 해제 — 캔버스 배너와 같은 에러 톤·문구(이때 캔버스는 추종 상태를 보이지 않는다)
          <span title={t("subprocess.undesignated")} className={`${CHIP} border-error/40 bg-error/10 text-error`}>
            <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0" />
            {t("subprocess.undesignatedBanner")}
          </span>
        ) : (
          <>
            {/* 지정 상태 — 영어 고정(인스펙터 SP 카드 필과 같은 모양) */}
            {designated === true && (
              <span className={`${CHIP} border-accent-tint-border bg-accent-tint text-accent`}>Designated</span>
            )}
            {followLatest ? (
              <span title={t("subprocess.followingNotice")} className={`${CHIP} border-hairline bg-surface text-ink-secondary`}>
                <RefreshCw size={12} strokeWidth={1.5} className="shrink-0" />
                {t("subprocess.followingBanner")}
              </span>
            ) : (
              <span title={t("subprocess.pinnedNotice")} className={`${CHIP} border-hairline bg-surface text-ink-secondary`}>
                <Pin size={12} strokeWidth={1.5} className="shrink-0" />
                {t("subprocess.pinnedBanner")}
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
