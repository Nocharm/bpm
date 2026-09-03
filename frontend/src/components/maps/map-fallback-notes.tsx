"use client";

// 맵 단위 인터뷰 원문 메모 5종(GMP·빈도·총시간·실작업·시스템) — 대표값과 별개로 보관되는 프리텍스트.
// 에디터 맵 탭(점유권자 편집)·홈 상세 카드(읽기)·비교 요약 탭(읽기, 기본 접힘) 공용
// (design 2026-09-03 followups §2). 자체 조회(getMap) — 마운트 지점마다 상세를 들고 다니지 않게.
// 행 = 행머리 아이콘(호버 시 노트 아이콘으로 스왑, 클릭=열람/추가/수정) + 라벨(작게) + 값(작고 톤다운).
// 빈 행은 별도 표기 없이 비활성 톤 — 편집 가능하면 호버에 "추가" 아이콘 (사용자 피드백 2026-09-03).

import { ChevronRight, Monitor, ShieldCheck, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { FallbackHint } from "@/components/fallback-hint";
import { PARAM_ICON } from "@/components/param-icons";
import { getMap, patchFallbackNotes, type FallbackNotesBody, type MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface MapFallbackNotesProps {
  mapId: number;
  // 편집 허용 — 에디터 점유권자(readOnly=false)일 때만. 없으면 열람 전용
  canEdit?: boolean;
  defaultCollapsed?: boolean;
  onToast?: (message: string) => void;
}

type NoteKey = keyof FallbackNotesBody;

const ROWS: { key: NoteKey; detailKey: keyof MapSummary; labelKey: MessageKey | null; icon: LucideIcon }[] = [
  { key: "gmp_fallback", detailKey: "sp_gmp_fallback", labelKey: null, icon: ShieldCheck },
  { key: "frequency_fallback", detailKey: "sp_frequency_fallback", labelKey: "field.annualCount", icon: PARAM_ICON.annual_count },
  { key: "total_time_fallback", detailKey: "sp_total_time_fallback", labelKey: "field.duration", icon: PARAM_ICON.duration },
  { key: "touch_time_fallback", detailKey: "sp_touch_time_fallback", labelKey: "field.touchTime", icon: PARAM_ICON.touch_time },
  { key: "system_fallback", detailKey: "sp_system_fallback", labelKey: "field.system", icon: Monitor },
];

export function MapFallbackNotes({ mapId, canEdit = false, defaultCollapsed = false, onToast }: MapFallbackNotesProps) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<{ mapId: number; detail: MapSummary } | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    let active = true;
    void getMap(mapId)
      .then((detail) => {
        if (active) setLoaded({ mapId, detail });
      })
      .catch(() => {
        // 조회 실패 = 섹션 숨김 — 부가 정보라 본문을 막지 않는다
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  const detail = loaded?.mapId === mapId ? loaded.detail : null;
  if (detail === null) return null;
  const valueOf = (row: (typeof ROWS)[number]): string => {
    const raw = detail[row.detailKey];
    return typeof raw === "string" ? raw : "";
  };
  const filled = ROWS.filter((row) => valueOf(row).trim() !== "").length;
  // 읽기 전용이고 원문이 하나도 없으면 섹션 자체를 숨긴다(비인터뷰 맵 노이즈 방지)
  if (filled === 0 && !canEdit) return null;

  async function save(patch: FallbackNotesBody) {
    try {
      const updated = await patchFallbackNotes(mapId, patch);
      setLoaded({ mapId, detail: updated });
      onToast?.(t("fallback.saved"));
    } catch {
      onToast?.(t("fallback.saveFailed"));
    }
  }

  return (
    <div data-id="map-fallback-notes" className="rounded-md border border-hairline bg-surface p-3">
      <button
        type="button"
        data-id="map-fallback-notes-toggle"
        data-acc-toggle
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1 text-fine font-semibold text-ink"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
        />
        {t("fallback.title")}
        <span className="font-normal text-ink-tertiary">({filled})</span>
      </button>
      {!collapsed && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {ROWS.map((row) => {
            const value = valueOf(row);
            const isEmpty = value.trim() === "";
            const Icon = row.icon;
            // 행머리: 값이 있거나 편집 가능하면 노트 트리거(호버 스왑), 아니면 정적 아이콘
            const interactive = !isEmpty || canEdit;
            return (
              <li
                key={row.key}
                data-id={`map-fallback-${row.key}`}
                data-empty={isEmpty ? "true" : "false"}
                className={`group flex items-center gap-2 rounded-sm px-1 py-0.5 ${
                  isEmpty ? "opacity-50" : "hover:bg-surface-alt"
                }`}
              >
                {interactive ? (
                  <FallbackHint
                    dataId={`map-fallback-${row.key}-hint`}
                    fallback={value}
                    restIcon={Icon}
                    onSaveFallback={canEdit ? (text) => void save({ [row.key]: text }) : undefined}
                  />
                ) : (
                  <span className="shrink-0 p-0.5 text-ink-tertiary">
                    <Icon size={14} strokeWidth={1.5} />
                  </span>
                )}
                <span className="w-24 shrink-0 truncate text-fine text-ink-tertiary">
                  {row.labelKey ? t(row.labelKey) : "GMP"}
                </span>
                <span className="min-w-0 flex-1 truncate text-fine text-ink-secondary" title={value || undefined}>
                  {value}
                </span>
              </li>
            );
          })}
          {!canEdit && <li className="px-1 pt-0.5 text-fine text-ink-tertiary">{t("fallback.readOnlyHint")}</li>}
        </ul>
      )}
    </div>
  );
}
