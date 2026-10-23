// 고아 참조 카드 아래 집계 한 줄 — 고침·알림·잠김·게시 대기 점과 곳 수. 부서·사용자 카드가 공유한다.
"use client";

import { useI18n } from "@/lib/i18n";
import type { Bucket } from "@/lib/ref-audit";
import type { CardFootItem } from "@/lib/ref-audit-view";

// 결과 막대·링과 같은 색 — 토큰만
const DOT_CLASS: Record<Bucket, string> = {
  fix: "bg-added",
  notify: "bg-warn",
  lock: "bg-border-strong",
  pend: "bg-accent",
};

interface RefCardFootProps {
  items: CardFootItem[];
  center?: boolean; // 사용자 카드는 가운데 정렬
}

export function RefCardFoot({ items, center }: RefCardFootProps) {
  const { t } = useI18n();
  return (
    <span className={`flex flex-wrap gap-x-2.5 gap-y-1 text-[11.5px] leading-[14px] text-ink-tertiary ${center ? "justify-center" : ""}`}>
      {items.map((item) => (
        <span key={item.bucket} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span aria-hidden className={`size-1.5 rounded-full ${DOT_CLASS[item.bucket]}`} />
          {t(item.labelKey)}
          <b className="font-semibold tabular-nums text-ink-secondary">{item.count}</b>
        </span>
      ))}
    </span>
  );
}
