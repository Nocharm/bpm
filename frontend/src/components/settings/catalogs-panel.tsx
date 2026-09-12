"use client";

// 관리 목록(카탈로그) 탭 — 역할·시스템 자동완성 목록을 sysadmin이 편집(칩 삭제·별칭 편집·직접 추가·사용 중 값 승격·CSV 임포트·저장).
// 저장 API(/admin/app-settings)는 sysadmin 전용 — 비sysadmin은 /catalogs로 읽기 전용 표시 (design 2026-09-11 §5).

import { Info, Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CheckInput } from "@/components/check-input";
import { HoverTip } from "@/components/hover-tip";
import type { CatalogEntry } from "@/lib/api";
import { getAppSettings, getCatalogs, putAppSettings } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { mergeCatalogEntries, normalizeAliases, parseCatalogCsv } from "@/lib/catalog-csv";
import { invalidateCatalogs, OTHER_SYSTEM } from "@/lib/catalogs";
import { decodeCsvBuffer } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

interface Lists {
  assignee_roles: CatalogEntry[];
  systems: CatalogEntry[];
  available_systems: string[];
}

interface CatalogsPanelProps {
  isSysadmin: boolean;
  onToast: (message: string) => void;
}

const INPUT_CLASS =
  "min-w-0 rounded-sm border border-hairline bg-surface px-3 py-1 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";
const SECONDARY_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const ALIAS_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-40";

interface ManagedListCardProps {
  dataId: string;
  title: string;
  hint: string;
  values: CatalogEntry[];
  // 삭제 불가 항목(시스템 Other) — 별칭은 편집 가능
  lockedValues?: readonly string[];
  // 사용 중 값 후보 — 체크하면 목록에 추가(시스템 카드만)
  available?: string[];
  readOnly: boolean;
  onSave: (next: CatalogEntry[]) => Promise<CatalogEntry[]>;
  onToast: (message: string) => void;
}

function ManagedListCard({
  dataId, title, hint, values, lockedValues = [], available = [], readOnly, onSave, onToast,
}: ManagedListCardProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<CatalogEntry[]>(values);
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  // 서버 값이 내용상 바뀌었을 때만 초안을 새 값으로 — 참조 비교면 형제 카드 저장·재조회마다 미저장 초안이 날아간다 (review 2026-09-11)
  const valuesKey = JSON.stringify(values);
  const [seenKey, setSeenKey] = useState(valuesKey);
  if (valuesKey !== seenKey) {
    setSeenKey(valuesKey);
    setDraft(values);
    setEditingAlias(null);
  }
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [importNote, setImportNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(values);
  const isLocked = (value: string) => lockedValues.some((locked) => locked.toLocaleLowerCase() === value.toLocaleLowerCase());
  const has = (value: string) => draft.some((item) => item.value.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  const addValues = (incoming: CatalogEntry[]) => {
    // 기존 항목의 별칭 총수를 전후로 비교 — normalizeAliases가 새 값/별칭과 충돌해 조용히 지운 개수(dropped)를 admin에게 알린다
    const before = draft.reduce((sum, entry) => sum + entry.aliases.length, 0);
    const result = mergeCatalogEntries(draft, incoming);
    setDraft(result.next);
    const after = result.next
      .filter((entry) => draft.some((existing) => existing.value.toLocaleLowerCase() === entry.value.toLocaleLowerCase()))
      .reduce((sum, entry) => sum + entry.aliases.length, 0);
    const dropped = Math.max(0, before - after);
    return { ...result, dropped };
  };
  const handleAdd = () => {
    if (adding.trim() === "") return;
    const { dropped } = addValues([{ value: adding, aliases: [] }]);
    setImportNote(dropped > 0 ? t("catalog.aliasesDropped", { count: dropped }) : "");
    setAdding("");
  };
  const handleFile = async (file: File) => {
    const text = decodeCsvBuffer(await file.arrayBuffer());
    const { added, duplicates, aliasesAdded, dropped } = addValues(parseCatalogCsv(text));
    const base = t("catalog.importResult", { added, duplicates, aliases: aliasesAdded });
    setImportNote(dropped > 0 ? `${base} ${t("catalog.aliasesDropped", { count: dropped })}` : base);
  };
  const applyAliases = () => {
    if (editingAlias === null) return;
    const aliases = aliasDraft.split(",").map((alias) => alias.trim()).filter((alias) => alias !== "");
    const requested = aliases.length;
    // 값·별칭 전역 불변식은 normalizeAliases가 서버 규칙 그대로 집행(값 우선·casefold 중복 제거)
    const next = normalizeAliases(draft.map((entry) => (entry.value === editingAlias ? { value: entry.value, aliases } : entry)));
    setDraft(next);
    const kept = next.find((entry) => entry.value === editingAlias)?.aliases.length ?? 0;
    setImportNote(requested - kept > 0 ? t("catalog.aliasesDropped", { count: requested - kept }) : "");
    setEditingAlias(null);
  };
  const handleSave = async () => {
    setBusy(true);
    try {
      const saved = await onSave(draft);
      setDraft(saved);
      invalidateCatalogs();
      onToast(t("catalog.saved", { title }));
    } catch (err) {
      onToast(humanizeApiError(err, t));
    } finally {
      setBusy(false);
    }
  };
  const candidates = available.filter((value) => !has(value));

  return (
    <section data-id={dataId} className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-alt p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-caption-strong text-ink">{title}</p>
        <span className="text-fine text-ink-tertiary">{t("catalog.count", { n: draft.length })}</span>
        <HoverTip
          tip={
            <div className="flex flex-col gap-1 text-fine text-ink-secondary">
              <p>{hint}</p>
              <p>{t("catalog.csvHint")}</p>
            </div>
          }
        >
          <Info size={14} strokeWidth={1.5} className="text-ink-tertiary" />
        </HoverTip>
        {!readOnly && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              data-id={`${dataId}-add-input`}
              className={`${INPUT_CLASS} w-56`}
              value={adding}
              placeholder={t("catalog.addPlaceholder")}
              maxLength={100}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAdd();
                }
              }}
            />
            <button type="button" data-id={`${dataId}-add`} className={SECONDARY_BUTTON} disabled={adding.trim() === ""} onClick={handleAdd}>
              <Plus size={14} strokeWidth={1.5} />
              {t("catalog.add")}
            </button>
            <button type="button" data-id={`${dataId}-import`} className={SECONDARY_BUTTON} onClick={() => fileRef.current?.click()}>
              <Upload size={14} strokeWidth={1.5} />
              {t("catalog.importCsv")}
            </button>
            <input
              ref={fileRef}
              data-id={`${dataId}-file`}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = ""; // 같은 파일 재선택 허용
              }}
            />
            <button
              type="button"
              data-id={`${dataId}-save`}
              disabled={busy || !dirty}
              className={
                dirty
                  ? "rounded-sm bg-accent px-3 py-1 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-40"
                  : "rounded-sm border border-hairline px-3 py-1 text-caption font-semibold text-ink-tertiary disabled:opacity-40"
              }
              onClick={() => void handleSave()}
            >
              {t("catalog.save")}
            </button>
          </div>
        )}
      </div>
      {importNote !== "" && (
        <p data-id={`${dataId}-import-note`} className="text-fine text-ink-tertiary">{importNote}</p>
      )}
      <div className="flex flex-wrap gap-1" data-id={`${dataId}-chips`}>
        {draft.length === 0 && <span className="text-fine text-ink-tertiary">{t("catalog.empty")}</span>}
        {draft.map((entry) => {
          const locked = isLocked(entry.value);
          const editing = editingAlias === entry.value;
          return (
            <span
              key={entry.value}
              data-id={`${dataId}-chip`}
              data-value={entry.value}
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0 text-fine text-ink ${
                editing ? "border-accent bg-accent-tint" : "border-hairline bg-surface"
              }`}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1"
                title={entry.aliases.length > 0 ? t("suggest.aliasesOf", { list: entry.aliases.join(", ") }) : t("catalog.aliases")}
                disabled={readOnly}
                onClick={() => {
                  setEditingAlias(editing ? null : entry.value);
                  setAliasDraft(entry.aliases.join(", "));
                }}
              >
                {entry.value}
                {entry.aliases.length > 0 && (
                  <span data-id={`${dataId}-alias-badge`} className="rounded-xs bg-surface-alt px-1 text-fine text-ink-tertiary">
                    +{entry.aliases.length}
                  </span>
                )}
              </button>
              {locked && <span className="text-fine text-ink-tertiary">{t("catalog.otherLocked")}</span>}
              {!readOnly && !locked && (
                <button type="button" aria-label={t("catalog.remove")} className="text-ink-tertiary hover:text-ink"
                  onClick={() => { setDraft((prev) => prev.filter((item) => item.value !== entry.value)); if (editing) setEditingAlias(null); }}>
                  <X size={11} strokeWidth={1.5} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!readOnly && editingAlias !== null && (
        <div data-id={`${dataId}-alias-editor`} className="flex items-center gap-2 rounded-sm border border-accent-tint-border bg-surface px-2 py-1">
          <span className="shrink-0 text-fine text-ink-secondary">{t("catalog.aliasesFor", { value: editingAlias })}</span>
          <input
            data-id={`${dataId}-alias-input`}
            className={`${INPUT_CLASS} flex-1`}
            value={aliasDraft}
            placeholder={t("catalog.aliasesPlaceholder")}
            maxLength={400}
            autoFocus
            onChange={(event) => setAliasDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); applyAliases(); }
              if (event.key === "Escape") { event.stopPropagation(); setEditingAlias(null); }
            }}
          />
          <button type="button" data-id={`${dataId}-alias-apply`} className={ALIAS_BUTTON} onClick={applyAliases}>{t("catalog.aliasesApply")}</button>
          <button type="button" data-id={`${dataId}-alias-cancel`} className={ALIAS_BUTTON} onClick={() => setEditingAlias(null)}>{t("catalog.aliasesCancel")}</button>
        </div>
      )}
      {!readOnly && candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-fine text-ink-secondary">{t("catalog.inUse")}</p>
          <div
            className={`grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-3 ${candidates.length > 8 ? "max-h-24 overflow-y-auto" : ""}`}
            data-id={`${dataId}-candidates`}
          >
            {candidates.map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-1.5 text-fine text-ink-secondary">
                <CheckInput
                  checked={false}
                  onChange={() => {
                    const { dropped } = addValues([{ value, aliases: [] }]);
                    setImportNote(dropped > 0 ? t("catalog.aliasesDropped", { count: dropped }) : "");
                  }}
                />
                {value}
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function CatalogsPanel({ isSysadmin, onToast }: CatalogsPanelProps) {
  const { t } = useI18n();
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    // 편집 권한이 있으면 후보(available_systems)까지 실린 관리자 응답, 아니면 읽기 전용 /catalogs
    const load: Promise<Lists> = isSysadmin
      ? getAppSettings().then((s) => ({ assignee_roles: s.assignee_roles, systems: s.systems, available_systems: s.available_systems }))
      : getCatalogs().then((c) => ({ ...c, available_systems: [] }));
    void load
      .then((next) => {
        if (alive) setLists(next);
      })
      .catch((err) => {
        if (alive) setError(err);
      });
    return () => {
      alive = false;
    };
    // t는 의도적으로 제외 — 언어 토글마다 새 클로저가 돼 재조회를 유발하면 두 카드의 미저장 초안이 날아간다 (review 2026-09-11)
  }, [isSysadmin]);

  const save = async (patch: { assignee_roles?: CatalogEntry[]; systems?: CatalogEntry[] }): Promise<CatalogEntry[]> => {
    const saved = await putAppSettings(patch);
    setLists({ assignee_roles: saved.assignee_roles, systems: saved.systems, available_systems: saved.available_systems });
    return patch.assignee_roles !== undefined ? saved.assignee_roles : saved.systems;
  };

  if (error !== null) return <p className="text-caption text-error">{humanizeApiError(error, t)}</p>;
  if (lists === null) return <p className="text-caption text-ink-tertiary">{t("catalog.loading")}</p>;
  return (
    <div className="flex max-w-6xl flex-col gap-6" data-id="catalogs-panel">
      <div>
        <h2 className="text-body-strong text-ink">{t("catalog.tab")}</h2>
        <p className="text-caption text-ink-tertiary">{isSysadmin ? t("catalog.pageHint") : t("catalog.readOnly")}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ManagedListCard
          dataId="catalog-roles"
          title={t("catalog.rolesTitle")}
          hint={t("catalog.rolesHint")}
          values={lists.assignee_roles}
          readOnly={!isSysadmin}
          onSave={(next) => save({ assignee_roles: next })}
          onToast={onToast}
        />
        <ManagedListCard
          dataId="catalog-systems"
          title={t("catalog.systemsTitle")}
          hint={t("catalog.systemsHint")}
          values={lists.systems}
          lockedValues={[OTHER_SYSTEM]}
          available={lists.available_systems}
          readOnly={!isSysadmin}
          onSave={(next) => save({ systems: next })}
          onToast={onToast}
        />
      </div>
    </div>
  );
}
