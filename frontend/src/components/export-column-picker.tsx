// 내보내기 열 선택 체크박스 그리드 — CSV 내보내기 모달과 Excel 내보내기 모달(Columns 섹션)이 공유.
// 잠금 열(CSV Name, Excel No·Name)은 체크 고정+비활성. 선택 영속은 호출부(lib/export-columns save/load)가 맡는다.
"use client";

import { CheckInput } from "@/components/check-input";
import type { ExportColumnDef, ExportKind } from "@/lib/export-columns";
import { normalizeExportColumns } from "@/lib/export-columns";
import { useI18n } from "@/lib/i18n";

interface ExportColumnPickerProps {
  kind: ExportKind;
  defs: readonly ExportColumnDef<string>[];
  selected: readonly string[];
  onChange: (keys: string[]) => void;
  // 제목 줄("Columns (n/m)") 표시 — 접이식 토글이 이미 같은 제목을 보여 주는 Excel 모달은 끈다
  showLabel?: boolean;
}

export function ExportColumnPicker({ kind, defs, selected, onChange, showLabel = true }: ExportColumnPickerProps) {
  const { t } = useI18n();
  const picked = new Set(selected);
  const requiredHeaders = defs.filter((def) => def.required === true).map((def) => def.header).join(", ");

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
          const isRequired = def.required === true;
          const inputId = `export-column-${kind}-${def.key}`;
          return (
            <label
              key={def.key}
              htmlFor={inputId}
              className={`flex min-w-0 items-center gap-1.5 text-caption ${isRequired ? "text-ink-tertiary" : "cursor-pointer text-ink"}`}
            >
              <CheckInput
                id={inputId}
                data-id={`export-column-${def.key}`}
                checked={isRequired || picked.has(def.key)}
                disabled={isRequired}
                onChange={() => handleToggle(def.key)}
              />
              <span className="truncate">{def.header}</span>
            </label>
          );
        })}
      </div>
      <p className="text-fine text-ink-tertiary">{t("export.columnsHint", { columns: requiredHeaders })}</p>
    </div>
  );
}
