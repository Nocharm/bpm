// 분포 막대·범례·상태/버전 탭 — 내 문서·내 부서 카드가 공유(도넛 대체, 2026-09-11). 막대는 2px 간격의 알약 조각(폭 전환 애니메이션),
// 조각 호버 ↔ 범례 필 강조가 서로 연동되고 선택·호버 중엔 나머지 조각을 눌러 초점을 만든다. 탭(상태|버전)은 카드별 localStorage 영속.
// 버전 탭은 맵을 미게시·게시본 최신·업데이트 진행 중·재확인 필요 네 버킷으로 센다(lib/dashboard-stats.bucketOfMap).
"use client";

import { useState, type ReactNode } from "react";

import type { MapSummary, VersionStatus } from "@/lib/api";
import { type StatusCount, type VersionBucket, type VersionBucketCount } from "@/lib/dashboard-stats";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_TONE } from "@/lib/version-status";

export type DistTab = "status" | "version";

// 버킷 점 색 — 상태 점과 같은 차트 채움 토큰(미게시=draft, 최신=published, 진행 중=pending, 재확인=rejected)
export const VERSION_BUCKET_TONE: Record<VersionBucket, string> = {
  unpublished: "bg-chart-draft",
  current: "bg-chart-published",
  updating: "bg-chart-pending",
  recheck: "bg-chart-rejected",
};
export const VERSION_BUCKET_LABEL: Record<VersionBucket, MessageKey> = {
  unpublished: "home.dash.bucket.unpublished",
  current: "home.dash.bucket.current",
  updating: "home.dash.bucket.updating",
  recheck: "home.dash.bucket.recheck",
};
const VERSION_BUCKET_HINT: Record<VersionBucket, MessageKey> = {
  unpublished: "home.dash.bucketHint.unpublished",
  current: "home.dash.bucketHint.current",
  updating: "home.dash.bucketHint.updating",
  recheck: "home.dash.bucketHint.recheck",
};

// 막대·범례가 보는 공통 조각 — 상태/버킷 둘 다 이 모양으로 바꿔 넘긴다
export interface DistItem {
  key: string;
  label: string;
  count: number;
  dot: string; // 점·조각 색 클래스
  hint?: string; // 범례 필 title
}

export function toStatusItems(counts: StatusCount[]): DistItem[] {
  return counts.map((c) => ({ key: c.status, label: VERSION_STATUS_LABEL_EN[c.status], count: c.count, dot: VERSION_STATUS_TONE[c.status].dot }));
}

export function useBucketItems(): (counts: VersionBucketCount[]) => DistItem[] {
  const { t } = useI18n();
  return (counts) =>
    counts.map((c) => ({ key: c.bucket, label: t(VERSION_BUCKET_LABEL[c.bucket]), count: c.count, dot: VERSION_BUCKET_TONE[c.bucket], hint: t(VERSION_BUCKET_HINT[c.bucket]) }));
}

// 탭 선택 영속 — 읽기는 초기화에서, 쓰기는 핸들러에서(StrictMode 이펙트 리셋 회피)
const TAB_KEY = "bpm.home.distTab.";
export function useDistTab(card: string): [DistTab, (tab: DistTab) => void] {
  const [tab, setTab] = useState<DistTab>(() => {
    if (typeof window === "undefined") return "status";
    try {
      const saved = window.localStorage.getItem(TAB_KEY + card);
      return saved === "version" ? "version" : "status";
    } catch {
      return "status";
    }
  });
  const pick = (next: DistTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY + card, next);
    } catch {
      // 저장 실패(프라이빗 모드 등)는 이번 세션 선택만 유지
    }
  };
  return [tab, pick];
}

interface DistributionTabsProps {
  card: string; // data-id 접두(home-my-documents 등)
  value: DistTab;
  onChange: (tab: DistTab) => void;
}

// 헤더 우측 세그먼트 탭 — 상태 | 버전
export function DistributionTabs({ card, value, onChange }: DistributionTabsProps) {
  const { t } = useI18n();
  const tabs: { id: DistTab; label: string }[] = [
    { id: "status", label: t("home.dash.distTabStatus") },
    { id: "version", label: t("home.dash.distTabVersion") },
  ];
  return (
    <span role="tablist" data-id={`${card}-dist-tabs`} className="inline-flex h-6 gap-0.5 rounded-sm bg-surface-alt p-0.5">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-id={`${card}-dist-tab-${tab.id}`}
            onClick={(e) => { e.stopPropagation(); onChange(tab.id); }}
            className={`rounded-[3px] px-2 text-fine transition-colors duration-150 ${
              active ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-tertiary hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </span>
  );
}

interface DistributionProps {
  items: DistItem[];
  selected?: string | null; // 범례 선택(필터) — 없으면 읽기 전용
  onSelect?: (key: string) => void;
}

// 막대 + 범례 한 묶음 — 조각 호버 상태를 둘이 공유한다
export function Distribution({ items, selected = null, onSelect }: DistributionProps) {
  const [hover, setHover] = useState<string | null>(null);
  const total = items.reduce((a, c) => a + c.count, 0);
  const focus = hover ?? selected;
  return (
    <>
      <div data-id="dist-bar" className="mx-3 flex h-2 gap-[2px]" aria-hidden="true">
        {total === 0 ? (
          <span className="h-full flex-1 rounded-full border border-dashed border-hairline" />
        ) : (
          items.map((c) => (
            <span
              key={c.key}
              data-key={c.key}
              title={`${c.label} · ${c.count}`}
              onMouseEnter={() => setHover(c.key)}
              onMouseLeave={() => setHover(null)}
              onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(c.key); } : undefined}
              className={`h-full min-w-[6px] rounded-full transition-[width,opacity] duration-350 ease-smooth ${c.dot} ${
                focus && focus !== c.key ? "opacity-35" : ""
              } ${onSelect ? "cursor-pointer" : ""}`}
              style={{ width: `${(c.count / total) * 100}%` }}
            />
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-x-1.5 gap-y-1 px-3 pt-2 pb-2.5">
        {items.map((c) => {
          const active = selected === c.key;
          const hovered = hover === c.key;
          const inner = (
            <>
              <span className={`inline-block h-2 w-2 rounded-full ${c.dot}`} />
              <span>{c.label}</span>
              <span className={`tabular-nums ${active ? "" : "text-ink-tertiary"}`}>{c.count}</span>
            </>
          );
          const cls = `inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-fine transition-colors duration-150 ${
            active
              ? "border-accent-tint-border bg-accent-tint text-accent-elevated"
              : hovered
                ? "border-hairline bg-surface-alt text-ink"
                : "border-transparent text-ink-secondary"
          }`;
          return onSelect ? (
            <button
              key={c.key}
              type="button"
              data-id="dist-legend"
              data-key={c.key}
              aria-pressed={active}
              title={c.hint}
              onMouseEnter={() => setHover(c.key)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => { e.stopPropagation(); onSelect(c.key); }}
              className={`${cls} hover:border-hairline`}
            >
              {inner}
            </button>
          ) : (
            <span
              key={c.key}
              data-id="dist-legend"
              data-key={c.key}
              title={c.hint}
              onMouseEnter={() => setHover(c.key)}
              onMouseLeave={() => setHover(null)}
              className={cls}
            >
              {inner}
            </span>
          );
        })}
      </div>
    </>
  );
}

// 버전 탭 행 메타 — 게시본 번호 + (게시본 뒤에 진행 중인 버전이 있으면) 그 상태 칩. 게시본 없으면 최신 상태만.
export function VersionChip({ map }: { map: MapSummary }): ReactNode {
  const status: VersionStatus = map.latest_version_status ?? "draft";
  const pub = map.published_version_number;
  const live = status === "published" || status === "confirmed";
  const base = "inline-flex h-[18px] items-center rounded-xs px-1.5 text-[10.5px] font-semibold";
  if (pub == null) {
    return <span data-id="dist-version-chip" className={`${base} ${VERSION_STATUS_TONE[status].pill}`}>{VERSION_STATUS_LABEL_EN[status]}</span>;
  }
  return (
    <span data-id="dist-version-chip" className="inline-flex items-center gap-1">
      <span className={`${base} bg-surface-alt text-ink-tertiary tabular-nums`}>v{pub}</span>
      {!live && (
        <span className={`${base} ${VERSION_STATUS_TONE[status].pill}`}>
          → {map.latest_version_number != null ? `v${map.latest_version_number} ` : ""}{VERSION_STATUS_LABEL_EN[status]}
        </span>
      )}
    </span>
  );
}
