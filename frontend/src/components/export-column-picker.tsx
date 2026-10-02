// 내보내기 열 선택 체크박스 그리드 — CSV 내보내기 모달과 Excel 내보내기 모달(Columns 섹션)이 공유.
// 잠금 열(CSV는 다시 가져오기에 필요한 열, Excel은 맵을 다시 그릴 최소 열)과 값 열을 따라가는 짝 열은 체크 고정+비활성. 선택 영속은 호출부(lib/export-columns save/load)가 맡는다.
"use client";

import { CheckInput } from "@/components/check-input";
import type { ExportColumnDef, ExportKind } from "@/lib/export-columns";
import { isExportColumnForced, normalizeExportColumns } from "@/lib/export-columns";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface ExportColumnPickerProps {
  kind: ExportKind;
  defs: readonly ExportColumnDef<string>[];
  selected: readonly string[];
  onChange: (keys: string[]) => void;
  // 제목 줄("Columns (n/m)") 표시 — 접이식 토글이 이미 같은 제목을 보여 주는 Excel 모달은 끈다
  showLabel?: boolean;
  // 잠금 열 안내 문구 키({columns} 자리에 잠금 열 이름) — 잠금 이유가 종류마다 달라 호출부가 고른다
  // (CSV: 다시 가져오기에 필요, Excel: 맵을 다시 그릴 최소 정보)
  lockedHintKey: MessageKey;
}

export function ExportColumnPicker({
  kind,
  defs,
  selected,
  onChange,
  showLabel = true,
  lockedHintKey,
}: ExportColumnPickerProps) {
  const { t } = useI18n();
  const picked = new Set(selected);
  const requiredHeaders = defs.filter((def) => def.required === true).map((def) => def.header).join(", ");
  // 짝 열 안내 — 값 열(Input 등)마다 따라가는 줄 정렬 열 묶음
  const headerOf = new Map(defs.map((def) => [def.key, def.header]));
  const pairedGroups = new Map<string, string[]>();
  for (const def of defs) {
    if (def.pairedWith === undefined) continue;
    pairedGroups.set(def.pairedWith, [...(pairedGroups.get(def.pairedWith) ?? []), def.header]);
  }

  const handleToggle = (key: string) => {
    const next = picked.has(key) ? selected.filter((value) => value !== key) : [...selected, key];
    onChange(normalizeExportColumns(defs, next));
  };

  return (
    <div data-id={`export-columns-${kind}`} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {showLabel && (
          <span className="text-caption text-ink-secondary">
            {t("export.columnsLabel")} ({selected.length}/{defs.length})
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-fine">
          <button
            type="button"
            data-id={`export-columns-${kind}-select-all`}
            className="rounded-xs px-1 text-accent hover:bg-accent-tint"
            onClick={() => onChange(normalizeExportColumns(defs, undefined))}
          >
            {t("export.selectAll")}
          </button>
          <button
            type="button"
            data-id={`export-columns-${kind}-deselect-all`}
            className="rounded-xs px-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink-secondary"
            onClick={() => onChange(normalizeExportColumns(defs, []))}
          >
            {t("export.deselectAll")}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
        {defs.map((def) => {
          const isForced = isExportColumnForced(def, picked);
          const inputId = `export-column-${kind}-${def.key}`;
          return (
            <label
              key={def.key}
              htmlFor={inputId}
              className={`flex min-w-0 items-center gap-1.5 text-caption ${isForced ? "text-ink-tertiary" : "cursor-pointer text-ink"}`}
            >
              <CheckInput
                id={inputId}
                data-id={`export-column-${def.key}`}
                checked={isForced || picked.has(def.key)}
                disabled={isForced}
                onChange={() => handleToggle(def.key)}
              />
              <span className="truncate">{def.header}</span>
            </label>
          );
        })}
      </div>
      <p data-id={`export-columns-${kind}-locked-hint`} className="text-fine text-ink-tertiary">
        {t(lockedHintKey, { columns: requiredHeaders })}
      </p>
      {[...pairedGroups].map(([parent, headers]) => (
        <p key={parent} data-id={`export-columns-${kind}-paired-hint-${parent}`} className="text-fine text-ink-tertiary">
          {t("export.pairedHint", { columns: headers.join(", "), parent: headerOf.get(parent) ?? parent })}
        </p>
      ))}
    </div>
  );
}
