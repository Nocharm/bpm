"use client";

// 판단(decision) 노드에서 엣지를 연결할 때 뜨는 분기 선택 — Yes / No / 기타.
// 레이아웃: 헤더(캡션+우상단 X) → 3열 아이콘 타일 → 하단 Cancel 바. (디시전/액션 팝업과 동일 체계)
// 모션: 타일 팝(열림 1회) + 아이콘 — Yes 체크·No 엑스가 그려지고(브랜치 색), Other 점 3개 순차 팝. 정지=최종형.
//   키프레임은 globals.css `.edge-br-*`. hover 시 아이콘 SVG를 replayKey로 리마운트해 재생.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import type { BranchKind } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";

// Yes/No는 실제 캔버스 분기 엣지와 같은 브랜치 색(데이터 색 — 토큰 규칙 예외). Other는 중립.
const BRANCH_YES = { stroke: "var(--color-branch-yes)" };
const BRANCH_NO = { stroke: "var(--color-branch-no)" };

// 분기별 아이콘 — replayKey 변경 시 SVG 리마운트→재생. 정지 상태(애니 없이)도 완성된 아이콘.
function BranchIcon({ kind, replayKey }: { kind: BranchKind; replayKey: number }) {
  if (kind === "yes") {
    return (
      <svg key={replayKey} width={24} height={24} viewBox="0 0 24 24" fill="none" style={BRANCH_YES} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path className="edge-br-check" pathLength={1} d="M20 6 L9 17 L4 12" />
      </svg>
    );
  }
  if (kind === "no") {
    return (
      <svg key={replayKey} width={24} height={24} viewBox="0 0 24 24" fill="none" style={BRANCH_NO} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path className="edge-br-x1" pathLength={1} d="M18 6 L6 18" />
        <path className="edge-br-x2" pathLength={1} d="M6 6 L18 18" />
      </svg>
    );
  }
  return (
    <svg key={replayKey} className="text-ink-tertiary" width={24} height={24} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <circle className="edge-br-dot edge-br-dot1" cx="5" cy="12" r="2" />
      <circle className="edge-br-dot edge-br-dot2" cx="12" cy="12" r="2" />
      <circle className="edge-br-dot edge-br-dot3" cx="19" cy="12" r="2" />
    </svg>
  );
}

// 분기 타일 — 자체 replay state로 hover 시 아이콘만 재생.
function BranchTile({
  kind,
  label,
  delayMs,
  onPick,
}: {
  kind: BranchKind;
  label: string;
  delayMs: number;
  onPick: (kind: BranchKind) => void;
}) {
  const [replay, setReplay] = useState(0);
  return (
    <button
      type="button"
      className="edge-tile-pop group flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-sm border border-hairline text-caption text-ink transition-colors hover:border-accent hover:bg-accent-tint"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      onMouseEnter={() => setReplay((k) => k + 1)}
      onClick={() => onPick(kind)}
    >
      <BranchIcon kind={kind} replayKey={replay} />
      {label}
    </button>
  );
}

const KINDS: { kind: BranchKind; delay: number }[] = [
  { kind: "yes", delay: 0 },
  { kind: "no", delay: 60 },
  { kind: "other", delay: 120 },
];

export function EdgeBranchModal({
  onPick,
  onClose,
  position,
}: {
  onPick: (kind: BranchKind) => void;
  onClose: () => void;
  /** 마우스 위치 — 주면 그 자리에(화면 안으로 클램프) 띄운다 (동선 최소화). */
  position?: { x: number; y: number };
}) {
  const { t } = useI18n();
  // 연결 릴리스(pointerup) 직후 따라오는 click이 백드롭에 떨어져 모달이 즉시 닫히는 문제는
  // ModalBackdrop의 mousedown-출처 가드가 처리한다(릴리스 click엔 백드롭 mousedown이 없음).

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // position 없으면 중앙 폴백.
  const pos = position ?? { x: 0, y: 0 };
  const { left, top } = clampToViewport(pos.x, pos.y, 256, 150);

  return createPortal(
    <ModalBackdrop
      className={
        position
          ? "fixed inset-0 z-[1200]"
          : "fixed inset-0 z-[1200] flex items-center justify-center"
      }
      style={{ background: "transparent" }}
      onClose={onClose}
    >
      <div
        data-id="edge-branch-modal"
        className="w-64 rounded-md border border-hairline bg-surface p-2 shadow-lg"
        style={position ? { position: "fixed", left, top } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("branch.pick")}
          </span>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {KINDS.map(({ kind, delay }) => (
            <BranchTile key={kind} kind={kind} label={t(`branch.${kind}`)} delayMs={delay} onPick={onPick} />
          ))}
        </div>
        <button
          type="button"
          className="mt-1.5 flex h-8 w-full items-center justify-center rounded-sm text-caption text-ink-tertiary hover:bg-surface-alt"
          onClick={onClose}
        >
          {t("common.cancel")}
        </button>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
