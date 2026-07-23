// 섹션 피커 패널 — Word 맵 전용, process-library-panel의 컨테이너/검색/목록 마크업을 미러링.
// 서브프로세스 라이브러리와 달리 사이클/미등록/링크중복 개념이 없으므로 그 로직은 전부 제외하고
// 카탈로그(sections)를 그대로 검색+드래그 소스로 노출한다. 텍스트는 i18n 미배선(section.* 키가
// 아직 없어 이 태스크 범위 밖 — 프로젝트 기본인 영어 하드코딩, C3 배선 시 필요하면 키 추가).
"use client";

import { FileUp, Hash, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SectionEntry } from "@/lib/word-import";
import { filterByQuery } from "@/lib/search";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

export interface SectionPanelProps {
  sections: SectionEntry[];
  docName: string;
  onReimport: () => void;
  onClose: () => void;
}

function handleDragStart(e: React.DragEvent<HTMLDivElement>, s: SectionEntry) {
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("application/bpm-section", s.anchor);
  e.dataTransfer.setData("application/bpm-section-number", s.number);
  e.dataTransfer.setData("application/bpm-section-title", s.title);
}

export function SectionPanel({ sections, docName, onReimport, onClose }: SectionPanelProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // 패널은 열릴 때마다 새로 마운트되므로 모든 오픈 경로에서 검색창에 포커스된다.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // 부분일치+초성+로마자+시퀀스 매칭(filterByQuery) — 번호·제목 대상, 랭크순 정렬.
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return sections;
    return filterByQuery(sections, q, (s) => [
      { field: "number", text: s.number },
      { field: "title", text: s.title },
    ]).map((h) => h.item);
  }, [sections, query]);
  // 25개씩 증분 렌더 — 카탈로그가 커도 패널 오픈 부하 없음
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(filtered, query);

  return (
    <div
      data-id="section-panel"
      className="flex w-56 flex-col border-r border-hairline bg-surface"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-ink">
          <Hash size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 truncate">{docName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded-sm p-0.5 text-ink/50 hover:bg-surface-alt hover:text-ink"
            onClick={onReimport}
            aria-label="Re-import"
            title="Re-import"
          >
            <FileUp size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="rounded-sm p-0.5 text-ink/50 hover:bg-surface-alt hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* search */}
      <div className="border-b border-hairline px-2 py-1.5">
        <div className="flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5">
          <Search size={12} strokeWidth={1.5} className="shrink-0 text-ink/40" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="min-w-0 flex-1 bg-transparent text-fine text-ink outline-none placeholder:text-ink/40"
          />
        </div>
      </div>

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sections.length === 0 ? (
          <div data-id="section-empty-state" className="flex flex-col items-center gap-2 px-3 py-6 text-center">
            <FileUp size={20} strokeWidth={1.5} className="text-ink/30" />
            <p className="text-fine text-ink/40">Import a Word document to list its sections here.</p>
            <button
              type="button"
              className="rounded-sm border border-hairline px-2 py-1 text-caption font-medium text-accent hover:bg-surface-alt"
              onClick={onReimport}
            >
              Import a Word document
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p data-id="section-empty-filtered" className="px-3 py-4 text-center text-fine text-ink/40">
            No sections
          </p>
        ) : (
          visible.map((s) => (
            <div
              key={s.anchor}
              data-anchor={s.anchor}
              draggable
              onDragStart={(e) => handleDragStart(e, s)}
              title={s.title}
              className="flex cursor-grab items-center gap-2 border-b border-hairline px-3 py-2 text-caption text-ink hover:bg-surface-alt active:cursor-grabbing"
            >
              <span className="shrink-0 rounded-xs border border-accent-tint-border bg-accent-tint px-1 py-px text-fine text-accent">
                {s.number || "—"}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
            </div>
          ))
        )}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>
    </div>
  );
}
