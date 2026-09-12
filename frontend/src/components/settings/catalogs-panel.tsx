"use client";

// 관리 목록(카탈로그) 탭 — 역할·시스템 자동완성 목록을 sysadmin이 편집(선택 항목 별칭 편집·직접 추가·
// 사용 중 값 승격·CSV 임포트·저장). 탭(역할|시스템) 아래 마스터(목록)-디테일(별칭 편집) 2단 레이아웃.
// 저장 API(/admin/app-settings)는 sysadmin 전용 — 비sysadmin은 /catalogs로 읽기 전용 표시 (design 2026-09-11 §5).

import { Plus, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
const PRIMARY_ALIAS_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent px-2 py-1 text-fine font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-40";

interface ManagedListCardProps {
  dataId: string;
  // 렌더링에는 쓰지 않음(헤더 제거) — 저장 완료 토스트 문구에만 사용
  title: string;
  values: CatalogEntry[];
  // 삭제 불가 항목(시스템 Other) — 별칭은 편집 가능
  lockedValues?: readonly string[];
  // 사용 중 값 후보 — 클릭하면 목록에 추가(시스템 카드만)
  available?: string[];
  readOnly: boolean;
  hidden: boolean;
  onSave: (next: CatalogEntry[]) => Promise<CatalogEntry[]>;
  onToast: (message: string) => void;
}

function ManagedListCard({
  dataId, title, values, lockedValues = [], available = [], readOnly, hidden, onSave, onToast,
}: ManagedListCardProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<CatalogEntry[]>(values);
  const [selected, setSelected] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [filter, setFilter] = useState("");
  // 서버 값이 내용상 바뀌었을 때만 초안을 새 값으로 — 참조 비교면 형제 카드 저장·재조회마다 미저장 초안이 날아간다 (review 2026-09-11)
  const valuesKey = JSON.stringify(values);
  const [seenKey, setSeenKey] = useState(valuesKey);
  if (valuesKey !== seenKey) {
    setSeenKey(valuesKey);
    setDraft(values);
    setSelected((prev) => (prev !== null && values.some((entry) => entry.value === prev) ? prev : null));
  }
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [importNote, setImportNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(values);
  const isLocked = (value: string) => lockedValues.some((locked) => locked.toLocaleLowerCase() === value.toLocaleLowerCase());
  const has = (value: string) => draft.some((item) => item.value.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  const selectedEntry = selected !== null ? (draft.find((entry) => entry.value === selected) ?? null) : null;
  // 선택이 바뀔 때만 별칭 입력을 저장된 별칭으로 리셋 — resync와 같은 render-time 조정 패턴
  const [seenSelected, setSeenSelected] = useState(selected);
  if (selected !== seenSelected) {
    setSeenSelected(selected);
    setAliasDraft(selectedEntry?.aliases.join(", ") ?? "");
  }

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
  const selectMatch = (result: { next: CatalogEntry[] }, value: string) => {
    const match = result.next.find((entry) => entry.value.toLocaleLowerCase() === value.toLocaleLowerCase());
    setSelected(match?.value ?? value);
  };
  const handleAdd = () => {
    if (adding.trim() === "") return;
    const value = adding.trim();
    const result = addValues([{ value, aliases: [] }]);
    setImportNote(result.dropped > 0 ? t("catalog.aliasesDropped", { count: result.dropped }) : "");
    selectMatch(result, value);
    setAdding("");
  };
  const handleFile = async (file: File) => {
    const text = decodeCsvBuffer(await file.arrayBuffer());
    const { added, duplicates, aliasesAdded, dropped } = addValues(parseCatalogCsv(text));
    const base = t("catalog.importResult", { added, duplicates, aliases: aliasesAdded });
    setImportNote(dropped > 0 ? `${base} ${t("catalog.aliasesDropped", { count: dropped })}` : base);
  };
  const applyAliases = () => {
    if (selected === null) return;
    const aliases = aliasDraft.split(",").map((alias) => alias.trim()).filter((alias) => alias !== "");
    const requested = aliases.length;
    // 값·별칭 전역 불변식은 normalizeAliases가 서버 규칙 그대로 집행(값 우선·casefold 중복 제거)
    const next = normalizeAliases(draft.map((entry) => (entry.value === selected ? { value: entry.value, aliases } : entry)));
    setDraft(next);
    const kept = next.find((entry) => entry.value === selected)?.aliases ?? [];
    setAliasDraft(kept.join(", "));
    setImportNote(requested - kept.length > 0 ? t("catalog.aliasesDropped", { count: requested - kept.length }) : "");
  };
  const handleRemove = () => {
    if (selected === null) return;
    setDraft((prev) => prev.filter((item) => item.value !== selected));
    setSelected(null);
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
  const needle = filter.trim().toLocaleLowerCase();
  const filteredDraft = needle === ""
    ? draft
    : draft.filter((entry) => entry.value.toLocaleLowerCase().includes(needle) || entry.aliases.some((alias) => alias.toLocaleLowerCase().includes(needle)));

  return (
    <section
      data-id={dataId}
      hidden={hidden}
      className="grid min-h-[420px] grid-cols-1 gap-4 rounded-md border border-hairline bg-surface-alt p-3 lg:grid-cols-[minmax(240px,320px)_1fr]"
    >
      <div data-id={`${dataId}-list-pane`} className="flex min-w-0 flex-col gap-2 lg:border-r lg:border-hairline lg:pr-3">
        <input
          data-id={`${dataId}-filter`}
          className={INPUT_CLASS}
          value={filter}
          placeholder={t("catalog.filterPlaceholder")}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div role="listbox" aria-label={title} className="flex max-h-[360px] flex-col gap-0.5 overflow-y-auto">
          {draft.length === 0 && <p className="px-1 py-1 text-fine text-ink-tertiary">{t("catalog.empty")}</p>}
          {filteredDraft.map((entry) => {
            const locked = isLocked(entry.value);
            const isSelected = selected === entry.value;
            return (
              <button
                key={entry.value}
                type="button"
                role="option"
                data-id={`${dataId}-row`}
                data-value={entry.value}
                aria-selected={isSelected}
                className={`flex items-center gap-1.5 rounded-sm px-2 py-1 text-left text-caption ${
                  isSelected ? "bg-accent-tint text-accent" : "text-ink hover:bg-surface"
                }`}
                onClick={() => setSelected(entry.value)}
              >
                <span className="min-w-0 flex-1 truncate">{entry.value}</span>
                {entry.aliases.length > 0 && (
                  <span data-id={`${dataId}-alias-badge`} className="shrink-0 rounded-xs bg-surface px-1 text-fine text-ink-tertiary">
                    +{entry.aliases.length}
                  </span>
                )}
                {locked && <span className="shrink-0 text-fine text-ink-tertiary">{t("catalog.otherLocked")}</span>}
              </button>
            );
          })}
        </div>
        {!readOnly && (
          <>
            <div className="flex items-center gap-1.5">
              <input
                data-id={`${dataId}-add-input`}
                className={`${INPUT_CLASS} flex-1`}
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
              <button
                type="button"
                data-id={`${dataId}-add`}
                aria-label={t("catalog.add")}
                className={SECONDARY_BUTTON}
                disabled={adding.trim() === ""}
                onClick={handleAdd}
              >
                <Plus size={14} strokeWidth={1.5} />
              </button>
            </div>
            {candidates.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-fine text-ink-secondary">{t("catalog.inUse")} ({candidates.length})</p>
                <div
                  className={`flex flex-wrap gap-1 ${candidates.length > 8 ? "max-h-24 overflow-y-auto" : ""}`}
                  data-id={`${dataId}-candidates`}
                >
                  {candidates.map((value) => (
                    <button
                      key={value}
                      type="button"
                      data-id={`${dataId}-candidate`}
                      data-value={value}
                      className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
                      onClick={() => {
                        const result = addValues([{ value, aliases: [] }]);
                        setImportNote(result.dropped > 0 ? t("catalog.aliasesDropped", { count: result.dropped }) : "");
                        selectMatch(result, value);
                      }}
                    >
                      <Plus size={12} strokeWidth={1.5} />
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2">
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
            {importNote !== "" && (
              <p data-id={`${dataId}-import-note`} className="text-fine text-ink-tertiary">{importNote}</p>
            )}
          </>
        )}
      </div>
      <div data-id={`${dataId}-detail`} className="flex min-w-0 flex-col gap-3">
        {selectedEntry === null ? (
          <p className="text-caption text-ink-tertiary">{t("catalog.selectHint")}</p>
        ) : (
          <>
            <div>
              <h3 className="break-words text-body-strong text-ink">{selectedEntry.value}</h3>
              {isLocked(selectedEntry.value) && <p className="text-fine text-ink-tertiary">{t("catalog.otherLocked")}</p>}
            </div>
            {readOnly ? (
              <div className="flex flex-col gap-1">
                <p className="text-caption-strong text-ink-secondary">{t("catalog.aliases")}</p>
                <div className="flex flex-wrap gap-1">
                  {selectedEntry.aliases.length === 0 && <span className="text-fine text-ink-tertiary">{t("catalog.empty")}</span>}
                  {selectedEntry.aliases.map((alias) => (
                    <span key={alias} className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink">{alias}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-caption-strong text-ink-secondary">{t("catalog.aliases")}</label>
                <input
                  data-id={`${dataId}-alias-input`}
                  className={INPUT_CLASS}
                  value={aliasDraft}
                  placeholder={t("catalog.aliasesPlaceholder")}
                  maxLength={400}
                  onChange={(event) => setAliasDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyAliases();
                    }
                  }}
                />
                <div className="flex flex-wrap gap-1">
                  {aliasDraft.split(",").map((alias) => alias.trim()).filter((alias) => alias !== "").map((alias, index) => (
                    <span key={`${alias}-${index}`} className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary">{alias}</span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" data-id={`${dataId}-alias-apply`} className={PRIMARY_ALIAS_BUTTON} onClick={applyAliases}>
                    {t("catalog.aliasesApply")}
                  </button>
                  <button
                    type="button"
                    data-id={`${dataId}-alias-cancel`}
                    className={ALIAS_BUTTON}
                    onClick={() => setAliasDraft(selectedEntry.aliases.join(", "))}
                  >
                    {t("catalog.aliasesCancel")}
                  </button>
                  {!isLocked(selectedEntry.value) && (
                    <button type="button" data-id={`${dataId}-remove`} className={`${SECONDARY_BUTTON} ml-auto`} onClick={handleRemove}>
                      {t("catalog.remove")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function CatalogsPanel({ isSysadmin, onToast }: CatalogsPanelProps) {
  const { t } = useI18n();
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [activeTab, setActiveTab] = useState<"roles" | "systems">("roles");

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
  const activeHint = activeTab === "roles" ? t("catalog.rolesHint") : t("catalog.systemsHint");
  return (
    <div className="flex max-w-6xl flex-col gap-4" data-id="catalogs-panel">
      <div>
        <h2 className="text-body-strong text-ink">{t("catalog.tab")}</h2>
        <p className="text-caption text-ink-tertiary">{isSysadmin ? t("catalog.pageHint") : t("catalog.readOnly")}</p>
      </div>
      <div className="flex items-center gap-4 border-b border-hairline">
        <button
          type="button"
          data-id="catalog-tab-roles"
          className={`border-b-2 px-1 pb-2 text-caption-strong ${activeTab === "roles" ? "border-accent text-ink" : "border-transparent text-ink-secondary"}`}
          onClick={() => setActiveTab("roles")}
        >
          {t("catalog.rolesTitle")} ({lists.assignee_roles.length})
        </button>
        <button
          type="button"
          data-id="catalog-tab-systems"
          className={`border-b-2 px-1 pb-2 text-caption-strong ${activeTab === "systems" ? "border-accent text-ink" : "border-transparent text-ink-secondary"}`}
          onClick={() => setActiveTab("systems")}
        >
          {t("catalog.systemsTitle")} ({lists.systems.length})
        </button>
      </div>
      <p className="text-fine text-ink-tertiary">{activeHint} · {t("catalog.csvHint")}</p>
      <ManagedListCard
        dataId="catalog-roles"
        title={t("catalog.rolesTitle")}
        values={lists.assignee_roles}
        readOnly={!isSysadmin}
        hidden={activeTab !== "roles"}
        onSave={(next) => save({ assignee_roles: next })}
        onToast={onToast}
      />
      <ManagedListCard
        dataId="catalog-systems"
        title={t("catalog.systemsTitle")}
        values={lists.systems}
        lockedValues={[OTHER_SYSTEM]}
        available={lists.available_systems}
        readOnly={!isSysadmin}
        hidden={activeTab !== "systems"}
        onSave={(next) => save({ systems: next })}
        onToast={onToast}
      />
    </div>
  );
}
