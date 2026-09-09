"use client";

// 홈 맵 상세 — 설명 섹션. 헤더(아이콘·제목) + 고정 높이 클립(넘치면 페이드·펼치기). 상단 3:2 행에서 노트 섹션과
// 나란히 놓이며 같은 접힘 높이를 쓴다 (사용자 결정 2026-09-09, 목업 v5).

import { AlignLeft } from "lucide-react";
import { useState } from "react";

import { ClipBody, ClipToggle, useClipOverflow } from "@/components/clip-body";
import { SectionHeader } from "@/components/section-header";
import { useI18n } from "@/lib/i18n";

// 접힘 본문 높이(px) — 노트 카드 한 장 반쯤(사용자 지시 2026-09-09: 처음 안의 절반). 설명·노트 두 섹션이 공유해 3:2 행의 키가 맞는다
export const DETAIL_CLIP_HEIGHT_PX = 136;

interface MapDetailDescriptionProps {
  description: string | null | undefined;
}

export function MapDetailDescription({ description }: MapDetailDescriptionProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const { ref, overflowing } = useClipOverflow(DETAIL_CLIP_HEIGHT_PX);

  return (
    <section
      data-id="map-detail-description-section"
      className="flex min-h-0 flex-col rounded-md border border-hairline bg-surface p-3"
    >
      <SectionHeader
        dataId="map-detail-description-toggle"
        icon={AlignLeft}
        title={t("field.description")}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        right={
          !collapsed && overflowing ? (
            <ClipToggle dataId="map-detail-description-expand" open={open} onToggle={() => setOpen((v) => !v)} />
          ) : undefined
        }
      />
      {!collapsed && (
        <ClipBody bodyRef={ref} maxHeight={DETAIL_CLIP_HEIGHT_PX} open={open} overflowing={overflowing} className="mt-2">
          <div data-id="map-detail-description" className="whitespace-pre-wrap text-caption text-ink">
            {description ? description : <span className="text-ink-tertiary">{t("home.descEmpty")}</span>}
          </div>
        </ClipBody>
      )}
    </section>
  );
}
