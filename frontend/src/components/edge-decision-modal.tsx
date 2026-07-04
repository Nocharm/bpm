"use client";

// 디시전 노드에 노드를 드롭(출력 ≥1)했을 때 선택 모달 — 분기 만들기 / 인터셉트 / 취소 (F1).
// 분기=새 출력선(yes/no/기타 라벨), 인터셉트=기존 출력선 하나에 끼워넣기. 마우스 위치 팝업.
// 레이아웃: 헤더(캡션+우상단 X) → 2열 아이콘 타일(경계·3:2·hover accent) → 하단 Cancel 바.
// 모션: 타일 팝(열림 1회) + 아이콘 의미 애니메이션(브랜치=가지 뻗음·끝 노드 강조, 인터셉트=박스 껴듦·가운데 강조).
//   키프레임은 globals.css `.edge-*`. hover 시 아이콘 SVG를 replayKey로 리마운트해 아이콘만 재생(타일 팝은 유지).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

// 중요 포인트 강조색(브랜치 끝 노드·인터셉트 가운데 박스) — 데이터가 아닌 토큰이므로 var 사용.
const ACCENT_STROKE = { stroke: "var(--color-accent)" };

// 브랜치 — base 원 위에서 곡선이 뻗어 node 원 좌측으로, 끝 노드(강조색)가 톡. replayKey 변경 시 리마운트→재생.
// 정지 상태(애니 없이)도 곡선은 그려지고 노드는 보이는 완성 아이콘이다.
function BranchAnimIcon({ replayKey }: { replayKey: number }) {
  return (
    <svg
      key={replayKey}
      className="text-ink-tertiary transition-colors group-hover:text-accent"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="6" cy="18" r="3" />
      <path className="edge-branchline" pathLength={1} d="M6 15 C6 11 11 6 15 6" />
      <circle className="edge-branchnode" cx="18" cy="6" r="3" style={ACCENT_STROKE} />
    </svg>
  );
}

// 인터셉트 — 가운데 박스(강조색)가 위에서 사이로 드롭 + 커넥터 페이드인. 좌우 박스·커넥터는 테두리만 연결(겹침 없음).
// 정지 상태(애니 없이)도 [ㅁ]—[ㅁ]—[ㅁ] 완성형으로 깨끗하다(겹치는 임시 선 없음).
function InterceptAnimIcon({ replayKey }: { replayKey: number }) {
  return (
    <svg
      key={replayKey}
      className="text-ink-tertiary transition-colors group-hover:text-accent"
      width={40}
      height={24}
      viewBox="0 0 40 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="7" width="8" height="10" rx="2" />
      <rect x="30" y="7" width="8" height="10" rx="2" />
      <line className="edge-conn" x1="10" y1="12" x2="16" y2="12" />
      <line className="edge-conn" x1="24" y1="12" x2="30" y2="12" />
      <rect className="edge-box-mid" x="16" y="7" width="8" height="10" rx="2" style={ACCENT_STROKE} />
    </svg>
  );
}

export function EdgeDecisionModal({
  position,
  onBranch,
  onIntercept,
  onClose,
}: {
  position: { x: number; y: number };
  onBranch: () => void;
  onIntercept: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // hover 시 해당 아이콘만 재생 — key 증가로 SVG 리마운트.
  const [branchReplay, setBranchReplay] = useState(0);
  const [interceptReplay, setInterceptReplay] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { left, top } = clampToViewport(position.x, position.y, 240, 176);

  // 경계 있는 3:2 아이콘 타일 — 열림 시 팝(1회), hover 시 accent 보더/틴트/아이콘.
  const tileClass =
    "edge-tile-pop group flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-sm border border-hairline text-caption text-ink transition-colors hover:border-accent hover:bg-accent-tint";

  return createPortal(
    <ModalBackdrop className="fixed inset-0 z-[1200]" style={{ background: "transparent" }} onClose={onClose}>
      <div
        data-id="edge-decision-modal"
        className="fixed w-60 rounded-md border border-hairline bg-surface p-2 shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("edge.decisionPrompt")}
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
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={tileClass}
            onMouseEnter={() => setBranchReplay((k) => k + 1)}
            onClick={onBranch}
          >
            <BranchAnimIcon replayKey={branchReplay} />
            {t("edge.actionBranch")}
          </button>
          <button
            type="button"
            className={tileClass}
            style={{ animationDelay: "80ms" }}
            onMouseEnter={() => setInterceptReplay((k) => k + 1)}
            onClick={onIntercept}
          >
            <InterceptAnimIcon replayKey={interceptReplay} />
            {t("edge.actionIntercept")}
          </button>
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
