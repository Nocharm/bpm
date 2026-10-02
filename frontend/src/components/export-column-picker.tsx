// 내보내기 열 선택 체크박스 — CSV 내보내기 모달과 Excel 내보내기 모달(Columns 섹션)이 공유.
// 열은 묶음(흐름·일반·속성·수행 지표·입출력·조건)별 카드로 보이고, 묶음 머리 체크박스가 그 묶음을 일괄 체크/해제한다.
// 잠금 열(CSV는 다시 가져오기에 필요한 열, Excel은 맵을 다시 그릴 최소 열)과 값 열을 따라가는 짝 열은 체크 고정+비활성.
// 선택 영속은 호출부(lib/export-columns save/load)가 맡는다.
"use client";

import {
  AlignLeft,
  ArrowLeftRight,
  ArrowRight,
  Bookmark,
  Boxes,
  BriefcaseBusiness,
  Building2,
  FileText,
  FileType,
  Flag,
  Gauge,
  Hash,
  IdCard,
  Link,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  Monitor,
  Play,
  Shapes,
  ShieldCheck,
  Type,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { CheckInput } from "@/components/check-input";
import { PARAM_ICON } from "@/components/param-icons";
import type { CsvColumnKey, ExcelColumnKey, ExportColumnDef, ExportColumnGroup, ExportKind } from "@/lib/export-columns";
import {
  EXPORT_COLUMN_GROUPS,
  getExportGroupState,
  isExportColumnForced,
  normalizeExportColumns,
  toggleExportColumnGroup,
} from "@/lib/export-columns";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { ParallelExitIcon } from "@/lib/parallel-icon";

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

// 묶음 머리 — 라벨은 인스펙터 카드·일괄 편집 카테고리와 같은 키를 재사용
const GROUP_META: Record<ExportColumnGroup, { icon: LucideIcon; labelKey: MessageKey }> = {
  flow: { icon: Workflow, labelKey: "export.groupFlow" },
  general: { icon: FileText, labelKey: "export.groupGeneral" },
  attributes: { icon: IdCard, labelKey: "bulk.catAttributes" },
  metrics: { icon: Gauge, labelKey: "inspector.parameters" },
  details: { icon: ArrowLeftRight, labelKey: "inspector.details" },
};

// 열 아이콘 — 노드 편집 타일·인스펙터 행과 같은 아이콘(수행 지표는 PARAM_ICON 단일 소스). 키 집합은 CSV ∪ Excel 전부(누락은 타입 오류).
const COLUMN_ICON: Record<CsvColumnKey | ExcelColumnKey, LucideIcon> = {
  no: Hash,
  name: Type,
  type: Shapes,
  parallel: ParallelExitIcon,
  next: ArrowRight,
  description: AlignLeft,
  url: Link,
  url_label: Bookmark,
  groups: Boxes,
  assignee: UserRound,
  role: BriefcaseBusiness,
  department: Building2,
  system: Monitor,
  gmp: ShieldCheck,
  ...PARAM_ICON,
  input: LogIn,
  input_flags: ListChecks,
  input_forms: FileType,
  output: LogOut,
  output_forms: FileType,
  start_condition: Play,
  end_condition: Flag,
};

function isColumnIconKey(key: string): key is keyof typeof COLUMN_ICON {
  return Object.prototype.hasOwnProperty.call(COLUMN_ICON, key);
}

export function ExportColumnPicker({ kind, defs, selected, onChange, showLabel = true, lockedHintKey }: ExportColumnPickerProps) {
  const { t } = useI18n();
  const picked = new Set(selected);
  const requiredHeaders = defs.filter((def) => def.required === true).map((def) => def.header).join(", ");
  const headerOf = new Map(defs.map((def) => [def.key, def.header]));

  const handleToggle = (key: string) => {
    const next = picked.has(key) ? selected.filter((value) => value !== key) : [...selected, key];
    onChange(normalizeExportColumns(defs, next));
  };

  return (
    <div data-id={`export-columns-${kind}`} className="flex flex-col gap-2">
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

      {EXPORT_COLUMN_GROUPS.map((group) => {
        const members = defs.filter((def) => def.group === group);
        if (members.length === 0) return null;
        const { isLocked, onCount, isAllOn, isSomeOn } = getExportGroupState(defs, selected, group);
        const { icon: GroupIcon, labelKey } = GROUP_META[group];
        const label = t(labelKey);
        const hasRequired = members.some((def) => def.required === true);
        // 이 묶음 안의 짝 열 — 값 열마다 따라가는 줄 정렬 열 안내
        const pairedGroups = new Map<string, string[]>();
        for (const def of members) {
          if (def.pairedWith === undefined) continue;
          pairedGroups.set(def.pairedWith, [...(pairedGroups.get(def.pairedWith) ?? []), def.header]);
        }
        return (
          <section
            key={group}
            data-id={`export-columns-${kind}-group-${group}`}
            className="overflow-hidden rounded-sm border border-hairline"
          >
            <div className="flex items-center gap-2 border-b border-hairline bg-surface-alt px-2.5 py-1.5">
              <CheckInput
                data-id={`export-columns-${kind}-group-${group}-toggle`}
                aria-label={t("export.groupToggle", { group: label })}
                checked={isLocked || isAllOn}
                indeterminate={!isLocked && isSomeOn && !isAllOn}
                disabled={isLocked}
                onChange={() => onChange(toggleExportColumnGroup(defs, selected, group))}
              />
              <GroupIcon size={14} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
              <span className="text-caption-strong text-ink">{label}</span>
              <span data-id={`export-columns-${kind}-group-${group}-count`} className="text-fine text-ink-tertiary">
                {onCount}/{members.length}
              </span>
              {isLocked && (
                <span className="ml-auto inline-flex items-center gap-1 text-fine text-ink-tertiary">
                  <Lock size={12} strokeWidth={1.5} />
                  {t("export.groupLocked")}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-2.5 py-2 sm:grid-cols-3">
              {members.map((def) => {
                const isForced = isExportColumnForced(def, picked);
                const inputId = `export-column-${kind}-${def.key}`;
                const ColumnIcon = isColumnIconKey(def.key) ? COLUMN_ICON[def.key] : undefined;
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
                    {ColumnIcon && <ColumnIcon size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
                    <span className="truncate">{def.header}</span>
                  </label>
                );
              })}
            </div>
            {(hasRequired || pairedGroups.size > 0) && (
              <div className="flex flex-col gap-0.5 px-2.5 pb-2">
                {hasRequired && (
                  <p data-id={`export-columns-${kind}-locked-hint`} className="text-fine text-ink-tertiary">
                    {t(lockedHintKey, { columns: requiredHeaders })}
                  </p>
                )}
                {[...pairedGroups].map(([parent, headers]) => (
                  <p
                    key={parent}
                    data-id={`export-columns-${kind}-paired-hint-${parent}`}
                    className="text-fine text-ink-tertiary"
                  >
                    {t("export.pairedHint", { columns: headers.join(", "), parent: headerOf.get(parent) ?? parent })}
                  </p>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
