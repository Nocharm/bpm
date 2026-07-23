"use client";

// 홈 Word documents 섹션 — word 맵(문서 부속 산출물)을 조직도 밖 문서 중심 평면 목록으로 분리 표시.
// 설계: docs/design/2026-07-24-word-map-lifecycle-design.md §2. word 표면은 영어 하드코딩(word-create-modal 관례).
import { ArrowUpRight, ChevronDown, ChevronRight, FileText, Plus, RefreshCw } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import { formatDocStamp, needsRegenerate } from "@/lib/word-map-home";

interface WordDocsSectionProps {
  maps: MapSummary[];
  open: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onReimport: (map: MapSummary) => void;
  onPromote: (map: MapSummary) => void;
}

export function WordDocsSection({
  maps,
  open,
  onToggle,
  selectedId,
  onSelect,
  onCreate,
  onReimport,
  onPromote,
}: WordDocsSectionProps) {
  return (
    <section data-id="word-docs-section" className="shrink-0 rounded-sm border border-hairline bg-surface">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          data-id="word-docs-toggle"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={onToggle}
        >
          {open ? (
            <ChevronDown size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          )}
          <FileText size={16} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
          <span className="truncate text-caption-strong text-ink">Word documents</span>
          <span className="text-fine text-ink-muted">{maps.length}</span>
        </button>
        <button
          data-id="word-docs-create"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink hover:bg-surface-alt"
          onClick={onCreate}
        >
          <Plus size={16} strokeWidth={1.5} />
          New
        </button>
      </div>
      {open && (
        <ul className="flex flex-col gap-0.5 border-t border-hairline p-1">
          {maps.length === 0 && (
            <li className="px-2 py-1.5 text-fine text-ink-muted">
              No Word documents yet — create one from a .docx.
            </li>
          )}
          {maps.map((m) => {
            const imported = formatDocStamp(m.doc_imported_at);
            const generated = formatDocStamp(m.doc_generated_at);
            return (
              <li key={m.id}>
                <div
                  data-id={`word-doc-row-${m.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation(); // 행 선택은 배경(선택 해제)으로 버블링 방지 — map-card.tsx와 동일 패턴
                    onSelect(m.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSelect(m.id);
                  }}
                  className={`group flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-alt ${selectedId === m.id ? "bg-accent-tint" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption text-ink">{m.name}</p>
                    <p className="truncate text-fine text-ink-muted">
                      {m.doc_name || "(no document)"} · {m.doc_sections?.length ?? 0} sections
                      {imported ? ` · imported ${imported}` : ""}
                      {generated ? ` · generated ${generated}` : ""}
                    </p>
                    {needsRegenerate(m) && (
                      <p data-id={`word-doc-regen-hint-${m.id}`} className="truncate text-fine text-changed">
                        Re-imported after last generation — regenerate the document.
                      </p>
                    )}
                  </div>
                  <button
                    data-id={`word-doc-reimport-${m.id}`}
                    title="Re-import document"
                    className="hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReimport(m);
                    }}
                  >
                    <RefreshCw size={16} strokeWidth={1.5} />
                  </button>
                  <button
                    data-id={`word-doc-promote-${m.id}`}
                    title="Convert to process map"
                    className="hidden shrink-0 rounded-sm p-1 text-ink-muted hover:bg-surface group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPromote(m);
                    }}
                  >
                    <ArrowUpRight size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
