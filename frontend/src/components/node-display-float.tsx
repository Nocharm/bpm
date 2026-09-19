// 캔버스 우하단 노드 표시 정보 플로팅 카드 — 에디터·비교 화면의 줌 필 옆 버튼 + 위로 뜨는 카드(NodeDisplaySection flat).
// 인스펙터 탭이 어디에 있든 토글을 바로 쓰기 위한 진입점. 상태는 호출부(에디터 displayFields / 비교 페이지 상태)가
// 소유하므로 인스펙터 섹션과 항상 같은 값을 본다(사용자 요청 2026-09-19).
"use client";

import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NodeDisplaySection } from "@/components/node-display-section";
import { useI18n } from "@/lib/i18n";
import type { NodeDisplayToggle } from "@/lib/node-actions";

interface NodeDisplayFloatProps {
  displayFields: NodeDisplayToggle[];
  onToggle: (field: NodeDisplayToggle) => void;
  onSetCategory: (fields: NodeDisplayToggle[], on: boolean) => void;
  // 표면별 data-id 접두("canvas" | "compare") — 인스펙터 섹션("inspector")과 같은 화면에 공존
  idPrefix: string;
  // 비교 화면 줌 바(h-7·rounded-sm)와 키 맞춤. 기본은 에디터 줌 필(h-9·rounded-full)과 동일.
  compact?: boolean;
}

export function NodeDisplayFloat({
  displayFields,
  onToggle,
  onSetCategory,
  idPrefix,
  compact = false,
}: NodeDisplayFloatProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 닫기 = 바깥 mousedown + Esc(모달 컨벤션). 캔버스 팬/선택이 같은 mousedown을 받아도 무방 — 카드는 닫히기만 한다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onCount = displayFields.length;
  const buttonClass = compact
    ? "flex h-7 w-7 items-center justify-center rounded-sm border border-hairline bg-surface/90 shadow-sm backdrop-blur-sm hover:bg-surface-alt"
    : "flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface shadow-md hover:bg-surface-alt";

  return (
    <div ref={rootRef} className="pointer-events-auto relative select-none">
      <button
        type="button"
        data-id={`${idPrefix}-node-display-float-toggle`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("inspector.nodeDisplay")}
        aria-label={t("inspector.nodeDisplay")}
        onClick={() => setOpen((v) => !v)}
        className={`${buttonClass} ${open || onCount > 0 ? "text-accent" : "text-ink-secondary"}`}
      >
        <Eye size={16} strokeWidth={1.5} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("inspector.nodeDisplay")}
          data-id={`${idPrefix}-node-display-float`}
          className="absolute bottom-full right-0 mb-2 w-60 rounded-md border border-hairline bg-surface p-3 shadow-lg"
        >
          <NodeDisplaySection
            flat
            idPrefix={idPrefix}
            displayFields={displayFields}
            onToggle={onToggle}
            onSetCategory={onSetCategory}
          />
        </div>
      )}
    </div>
  );
}
