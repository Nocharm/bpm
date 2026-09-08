"use client";

// 임포트 리포트 공용 조각 — 결과 배지 톤, 행 강조/흐림 클래스, 외부 L6 상태 필, 고유키(#) 호버 카드.
// 좌측 섹션과 우측 파일 카드가 같은 톤을 쓰도록 한 곳에 둔다.

import { AlertTriangle, CircleDashed, Hash, Link2 } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { ExternalRefState, ReportMessage } from "@/lib/interview-report";
import { Tooltip } from "@/components/tooltip";

/** 백엔드 상세 문구 → 사람말(i18n). 호출부(리포트 루트)가 t를 닫아 넘긴다. */
export type Describe = (kind: ReportMessage["kind"], subject: string, raw: string) => string;

// 결과 배지 — 색은 diff 토큰과 같은 의미축(added/changed/error)
export const OUTCOME_PILL = {
  created: "border-added/40 bg-added/10 text-added",
  updated: "border-changed/40 bg-changed/10 text-changed",
  unchanged: "border-hairline bg-surface-alt text-ink-tertiary",
  error: "border-error/40 bg-error/10 text-error",
} as const;

export const OUTCOME_LABEL = {
  created: "framework.importCreated",
  updated: "framework.importUpdated",
  unchanged: "framework.importUnchanged",
  error: "framework.interviewFileError",
} as const;

// 포커스 상태별 행 클래스 — hit는 액센트 틴트 + 왼쪽 3px 바, dim은 흐림만(목록에서 빼지 않는다)
export const ROW_STATE_CLASS = {
  "": "",
  dim: "opacity-40",
  hit: "bg-accent-tint shadow-[inset_3px_0_0_var(--color-accent)]",
} as const;

// 좌→우 호버 강조(peer) — 포커스 강조보다 한 톤 연하게
export const ROW_PEER_CLASS = "bg-accent-tint/60";

export const EXTERNAL_STATE_TONE: Record<ExternalRefState, string> = {
  linked: "border-accent/30 bg-accent-tint text-accent",
  placeholder: "border-error/40 bg-error/10 text-error",
  ambiguous: "border-changed/40 bg-changed/10 text-changed",
  "unknown-origin": "border-changed/40 bg-changed/10 text-changed",
};

export const PILL_BASE = "inline-flex items-center gap-1 rounded-full border px-2 py-px text-fine whitespace-nowrap";

export function ExternalStatePill({ state, sameNameCount }: { state: ExternalRefState; sameNameCount: number | null }) {
  const { t } = useI18n();
  const Icon = state === "linked" ? Link2 : state === "placeholder" ? CircleDashed : AlertTriangle;
  const label =
    state === "linked"
      ? t("framework.importExternalStateLinked")
      : state === "placeholder"
        ? t("framework.importExternalStatePlaceholder")
        : state === "ambiguous"
          ? t("framework.importExternalStateAmbiguous", { count: sameNameCount ?? 0 })
          : t("framework.importExternalStateUnknown");
  return (
    <span className={`${PILL_BASE} ${EXTERNAL_STATE_TONE[state]}`}>
      <Icon size={11} strokeWidth={1.5} />
      {label}
    </span>
  );
}

/** 고유키 카드 본문 — 폭 고정(w-60): fixed 툴팁은 화면 오른쪽 앵커에서 가용폭이 0으로 수렴해 세로로 접힌다. */
export function KeyCard({ entries }: { entries: [string, string][] }) {
  return (
    <span className="flex w-60 flex-col gap-1">
      {entries
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <span key={label} className="flex gap-2">
            <span className="shrink-0 text-fine text-ink-tertiary">{label}</span>
            <span className="min-w-0 flex-1 break-all font-mono text-fine text-ink">{value}</span>
          </span>
        ))}
    </span>
  );
}

/** 행에는 이름만, 실데이터 키는 # 아이콘 호버로만 꺼내 본다. */
export function KeyIcon({ entries, dataId }: { entries: [string, string][]; dataId: string }) {
  return (
    <Tooltip content={<KeyCard entries={entries} />}>
      <span data-id={dataId} className="inline-flex shrink-0 cursor-help text-ink-muted hover:text-ink-secondary">
        <Hash size={13} strokeWidth={1.5} />
      </span>
    </Tooltip>
  );
}
