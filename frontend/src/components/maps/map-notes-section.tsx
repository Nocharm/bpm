"use client";

// 맵 노트(인터뷰 예외 규칙·VOC) 읽기전용 섹션 — 상세 카드·에디터 인스펙터 공용.
// 노트가 없거나(대다수 맵) 로드 실패면 섹션 자체를 렌더하지 않는다. 추후 일반맵 사용자
// 등록/편집 UI가 같은 표면에 얹힌다 (design 2026-08-18 §6).

import { useEffect, useState } from "react";

import { getMapNotes, type MapNote } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface MapNotesSectionProps {
  mapId: number;
}

export function MapNotesSection({ mapId }: MapNotesSectionProps) {
  const { t } = useI18n();
  // mapId를 결과에 함께 담아 파생으로 거른다 — 전환 중 이전 맵 노트 잔상·effect 내 동기 setState 회피
  const [loaded, setLoaded] = useState<{ mapId: number; rows: MapNote[] } | null>(null);

  useEffect(() => {
    let active = true;
    void getMapNotes(mapId)
      .then((rows) => {
        if (active) setLoaded({ mapId, rows });
      })
      .catch(() => {
        // 로드 실패 = 섹션 숨김 — 노트는 부가 정보라 카드 본문을 막지 않는다
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  const notes = loaded?.mapId === mapId ? loaded.rows : [];
  if (notes.length === 0) return null;

  return (
    <div
      data-id="map-notes-section"
      className="flex flex-col gap-1.5 rounded-sm border border-hairline bg-surface p-3"
    >
      <p className="text-fine uppercase tracking-wide text-ink-tertiary">{t("notes.title")}</p>
      <ul className="scroll-soft flex max-h-60 flex-col gap-1.5 overflow-y-auto">
        {notes.map((note) => (
          <li key={note.id} data-id={`map-note-${note.id}`} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine uppercase ${
                  note.kind === "exception"
                    ? "border-error/40 bg-error/10 text-error"
                    : "border-hairline bg-surface-alt text-ink-secondary"
                }`}
              >
                {note.kind}
              </span>
              {note.title && <span className="min-w-0 truncate text-caption-strong text-ink">{note.title}</span>}
            </div>
            <p className="whitespace-pre-wrap text-caption text-ink-secondary">{note.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
