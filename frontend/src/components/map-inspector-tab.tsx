"use client";

// NEW 인스펙터 맵 탭(좁은 폭) — 가시성 · 멤버(허용 인원) · 설명. 목업 inspector-map-tab 순서.
// 멤버 카드는 MapDetailCard(only="members")로 OLD '허용 인원' 디자인을 그대로 재사용(아코디언). 가시성/설명은 getMap.
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Globe, Lock } from "lucide-react";

import { getMap, updateMap } from "@/lib/api";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { useI18n } from "@/lib/i18n";

interface MapInspectorTabProps {
  mapId: number;
  readOnly: boolean;
}

export function MapInspectorTab({ mapId, readOnly }: MapInspectorTabProps) {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [description, setDescription] = useState("");
  const loadedFor = useRef<number | null>(null);

  useEffect(() => {
    if (loadedFor.current === mapId) return;
    let active = true;
    void getMap(mapId)
      .then((detail) => {
        if (!active) return;
        setVisibility(detail.visibility);
        setDescription(detail.description);
        loadedFor.current = mapId;
      })
      .catch(() => {
        // 조회 실패는 섹션만 비표시
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  return (
    <div className="flex flex-col gap-4">
      {/* 가시성 — 현재값 표시(변경은 설정 화면 승인 플로) */}
      <section>
        <div className="mb-1 text-fine text-ink-tertiary">{t("inspector.visibility")}</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(["public", "private"] as const).map((value) => {
            const active = visibility === value;
            const Icon = value === "public" ? Globe : Lock;
            return (
              <div
                key={value}
                className={`flex items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-caption ${
                  active ? "border-accent bg-accent-tint font-medium text-accent" : "border-hairline text-ink-tertiary"
                }`}
              >
                <Icon size={14} strokeWidth={1.5} />
                {t(value === "public" ? "perm.visibilityPublic" : "perm.visibilityPrivate")}
              </div>
            );
          })}
        </div>
      </section>

      {/* 멤버(허용 인원) — 아코디언. 카드 디자인은 OLD MapDetailCard 재사용(클릭 펼침·역할 배지 포함) */}
      <details className="group" open>
        <summary className="flex cursor-pointer list-none items-center gap-1 text-fine uppercase tracking-wide text-ink-tertiary [&::-webkit-details-marker]:hidden">
          <ChevronRight size={12} strokeWidth={1.5} className="transition-transform group-open:rotate-90" />
          {t("inspector.collaborators")}
        </summary>
        <div className="mt-2">
          <MapDetailCard mapId={mapId} only="members" hideOpen showFooter={false} />
        </div>
      </details>

      {/* 설명 */}
      <section>
        <div className="mb-1 text-fine text-ink-tertiary">{t("field.description")}</div>
        <textarea
          className="h-20 w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption"
          value={description}
          disabled={readOnly}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => void updateMap(mapId, { description })}
        />
      </section>
    </div>
  );
}
