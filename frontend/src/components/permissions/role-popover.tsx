"use client";

// 클릭 위치(또는 Enter 폴백 좌표) 기준 역할 팝오버 — Viewer/Editor 중 하나를 고르는 2단계.
// add-collaborator.tsx(협업자 패널·맵 상세 카드)에서 추출, create-map-dialog.tsx(새 맵 모달)와 공용 (T3, 설계: 2026-08-08-governance-ux-design.md §B).

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";

export function RolePopover({
  name,
  x,
  y,
  viewerGrantDisabled,
  onPick,
  onCancel,
}: {
  name: string;
  x: number;
  y: number;
  /** 퍼블릭 맵이면 Viewer 버튼을 숨김 — Editor 하나뿐이어도 2-step은 유지 (사용자 지시). */
  viewerGrantDisabled?: boolean;
  onPick: (role: "viewer" | "editor") => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc = 취소(선택 없이 닫힘) — capture로 등록해 팝오버 자신의 클릭보다 먼저 보되,
  // ref.contains로 내부 클릭은 걸러낸다.
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel]);

  // 커서 우하단 오프셋으로 클램프 — 클릭된 이름을 팝오버가 가리지 않게, 화면 밖으로 나가지 않게.
  const { left, top } = clampToViewport(x + 12, y + 12, 200, 96);

  return createPortal(
    <div
      ref={popoverRef}
      data-id="add-pick-popover"
      style={{ left, top }}
      className="fixed z-[1300] rounded-md border border-hairline bg-surface p-2 shadow-lg"
    >
      <p className="max-w-[176px] truncate text-fine text-ink-tertiary">{name}</p>
      <p className="mb-1.5 text-fine text-ink-tertiary">{t("perm.addPick.title")}</p>
      <div className="flex gap-1.5">
        {!viewerGrantDisabled && (
          <button
            type="button"
            data-id="add-pick-viewer"
            className="rounded-sm border border-hairline px-2 py-1 text-fine hover:bg-surface-alt"
            onClick={() => onPick("viewer")}
          >
            {t("perm.roleViewer")}
          </button>
        )}
        <button
          type="button"
          data-id="add-pick-editor"
          className="rounded-sm border border-hairline px-2 py-1 text-fine hover:bg-surface-alt"
          onClick={() => onPick("editor")}
        >
          {t("perm.roleEditor")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
