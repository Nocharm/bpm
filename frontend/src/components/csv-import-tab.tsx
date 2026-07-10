"use client";

// 인스펙터 Import 탭 — CSV 머지 프리뷰의 요약·경고·소멸 노드 목록·삭제/유지 선택·Apply/Cancel.
// 프리뷰 중에는 다른 탭과 접기가 잠긴다(page.tsx). 요약만 MarkdownView, 노드 제목은 React 리스트로 —
// 마크다운은 제목의 `**`/`#`/`[]()` 를 서식으로 먹고 클릭 핸들러도 못 단다.
import type { ReactNode } from "react";

import { Check, Trash2, Undo2 } from "lucide-react";

import { MarkdownView } from "@/components/markdown-view";
import { Tooltip } from "@/components/tooltip";
import type { CsvImportWarning, CsvMergeInfo } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

interface CsvImportTabProps {
  merge: CsvMergeInfo;
  warnings: CsvImportWarning[];
  keepRemoved: boolean;
  onKeepRemovedChange: (keep: boolean) => void;
  onFocusNode: (nodeId: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

// 리치 툴팁 카드 — 굵은 결론 한 줄 + 이유 한 줄 (Tooltip content는 max-w-56)
function TipCard({ head, body }: { head: string; body?: string }) {
  return (
    <span className="flex flex-col gap-0.5 text-left">
      <span className="text-fine font-semibold text-ink">{head}</span>
      {body && <span className="text-fine text-ink-secondary">{body}</span>}
    </span>
  );
}

export function CsvImportTab({
  merge, warnings, keepRemoved, onKeepRemovedChange, onFocusNode, onApply, onCancel,
}: CsvImportTabProps) {
  const { t } = useI18n();
  const removedCount = merge.removedNodes.length;
  const lostCount = merge.lostEdges.length;

  const modeButton = (mode: "delete" | "keep", label: string, tip: ReactNode) => {
    const active = (mode === "keep") === keepRemoved;
    return (
      <Tooltip content={tip} className="flex-1">
        <button
          type="button"
          data-id={`csv-import-mode-${mode}`}
          aria-pressed={active}
          onClick={() => onKeepRemovedChange(mode === "keep")}
          className={`flex w-full items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-caption ${
            active ? "border-accent bg-accent-tint text-accent" : "border-hairline text-ink-secondary hover:bg-surface-alt"
          }`}
        >
          {mode === "delete" ? <Trash2 size={14} strokeWidth={1.5} /> : <Undo2 size={14} strokeWidth={1.5} />}
          {label}
        </button>
      </Tooltip>
    );
  };

  return (
    <div data-id="csv-import-tab" className="flex flex-col gap-4">
      <MarkdownView
        className="md"
        source={t("csvImport.tabIntro", { updated: merge.matchedCount, added: merge.addedNodeIds.length })}
      />

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-caption-strong text-ink">{t("csvImport.warningsTitle", { n: warnings.length })}</span>
          <ul className="scroll-soft flex max-h-32 flex-col gap-0.5">
            {warnings.map((warn) => (
              <li key={`${warn.line}-${warn.message}`} className="text-fine text-ink-tertiary">
                {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {removedCount === 0 ? (
        <p className="text-caption text-ink-tertiary">{t("csvImport.tabNoRemoved")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-caption-strong text-ink">{t("csvImport.removedTitle", { n: removedCount })}</span>
            <span className="text-fine text-ink-tertiary">{t("csvImport.removedHint")}</span>
          </div>
          <ul className="scroll-soft flex max-h-40 flex-col gap-1">
            {merge.removedNodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onFocusNode(node.id)}
                  className="w-full truncate rounded-sm border border-dashed border-removed px-2 py-1 text-left text-caption text-ink hover:bg-surface-alt"
                  title={node.title}
                >
                  {node.title}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            {modeButton("delete", t("csvImport.modeDelete"), (
              <TipCard head={t("csvImport.modeDeleteTipHead", { n: removedCount, m: lostCount })} body={t("csvImport.modeDeleteTipBody")} />
            ))}
            {modeButton("keep", t("csvImport.modeKeep"), (
              <TipCard head={t("csvImport.modeKeepTipHead", { n: removedCount, m: lostCount })} body={t("csvImport.modeKeepTipBody")} />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 border-t border-hairline pt-3">
        <Tooltip content={<TipCard head={t("csvImport.applyTipHead")} />} className="flex-1">
          <button
            type="button"
            data-id="csv-import-apply"
            onClick={onApply}
            className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
          >
            <Check size={14} strokeWidth={1.5} />
            {t("csvImport.apply")}
          </button>
        </Tooltip>
        <Tooltip content={<TipCard head={t("csvImport.cancelTipHead")} body={t("csvImport.cancelTipBody")} />}>
          <button
            type="button"
            data-id="csv-import-cancel"
            onClick={onCancel}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            {t("common.cancel")}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
