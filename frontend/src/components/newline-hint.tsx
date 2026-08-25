// 줄바꿈 단축키 안내 캡션 — Enter=저장, Alt/Shift+Enter=줄바꿈. 키는 kbd 캡으로 강조 (사용자 요청 2026-08-23).
"use client";

import { useI18n } from "@/lib/i18n";

function Key({ label }: { label: string }) {
  return (
    <kbd className="rounded-[3px] border border-b-2 border-hairline bg-surface-alt px-1 py-px text-[10px] font-semibold text-ink-secondary">
      {label}
    </kbd>
  );
}

/** 멀티라인 편집 표면(모달·인스펙터 이름/엣지 라벨) 공용 힌트 — 캔버스 인라인은 title 툴팁이라 텍스트 유지. */
export function NewlineHint() {
  const { t } = useI18n();
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-fine text-ink-muted">
      <Key label="Enter" />
      <span>{t("hint.enterSave")}</span>
      <span>·</span>
      <Key label="Alt" />
      <span className="-mx-0.5">/</span>
      <Key label="Shift" />
      <span className="-mx-0.5">+</span>
      <Key label="Enter" />
      <span>{t("hint.enterNewline")}</span>
    </p>
  );
}
