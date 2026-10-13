"use client";

// 계획 타일 → 외부 L6 전환 모달 — 체계 피커(FrameworkTreePicker)를 다이얼로그에 담아 다른 L5의 L6 맵을 고르면 그 타일이
// 외부 참조 타일로 바뀐다. 타일 우클릭 "외부 L6 목록 보기"에서 열린다(사용자 요청 2026-09-29). 좌측 [외부 L6] 탭과 같은 피커·같은 추가 계약.
import { ExternalLink, X } from "lucide-react";

import { FrameworkTreePicker } from "@/components/framework-tree-picker";
import { ModalBackdrop } from "@/components/modal-backdrop";
import type { PeekAddPayload } from "@/components/subprocess-preview-peek";
import { useI18n } from "@/lib/i18n";

interface ExternalL6ModalProps {
  // 전환할 타일의 현재 이름 — 헤더 부제로 어느 타일이 바뀌는지 못 박는다
  tileName: string;
  // 이 세션의 L5 — 같은 L5의 L6는 외부가 아니라 배지·차단 기준이 된다
  linkageCategoryId: number;
  // 이미 계획에 들어온 맵(기존 L6 + 외부 타일) — 피커가 링크됨으로 막는다
  linkedMapIds: Set<number>;
  onPick: (payload: PeekAddPayload) => void;
  onClose: () => void;
}

export function ExternalL6Modal({ tileName, linkageCategoryId, linkedMapIds, onPick, onClose }: ExternalL6ModalProps) {
  const { t } = useI18n();
  return (
    // 좌측 정렬 — 행을 고르면 뜨는 미리보기 피크가 오른쪽으로 펼쳐지므로 가운데 두면 모달과 겹친다(사용자 요청 2026-09-29, 연결 다이얼로그와 같은 배치)
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[1200] flex items-start justify-start bg-ink/20 p-6 backdrop-blur-sm">
      <div data-id="fw-consult-external-modal" className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-md border glass glass-dense">
        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
            <ExternalLink size={15} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-caption-strong font-semibold">{t("fwConsult.switchExternalTitle")}</div>
            <div className="truncate text-fine text-ink-tertiary">{tileName}</div>
          </div>
          <button type="button" data-id="fw-consult-external-modal-close" onClick={onClose} aria-label={t("summary.close")} className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="px-4 pt-2 text-fine text-ink-tertiary">{t("fwConsult.switchExternalHint")}</p>
        {/* 피커 헤더는 숨긴다(다이얼로그 헤더와 중복). 트리는 남는 높이만큼 차지하고 안에서 스크롤 */}
        <FrameworkTreePicker
          currentMapId={0}
          linkedMapIds={linkedMapIds}
          readOnly={false}
          nodeDisplayFields={[]}
          linkageCategoryId={linkageCategoryId}
          hideHeader
          ctaLabelKey="fwConsult.switchExternalCta"
          className="flex min-h-0 min-w-[20rem] flex-1 flex-col bg-surface"
          onClose={onClose}
          onPeekAdd={onPick}
          onPeekOpenMap={(mapId) => window.open(`/maps/${mapId}`, "_blank", "noopener")}
          onFocusLinkedNode={() => undefined}
        />
      </div>
    </ModalBackdrop>
  );
}
