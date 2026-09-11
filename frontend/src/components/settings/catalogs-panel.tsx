"use client";

// 관리 목록(카탈로그) 탭 — 역할·시스템 자동완성 목록을 sysadmin이 편집(칩 삭제·직접 추가·사용 중 값 승격·CSV 임포트·저장).
// 저장 API(/admin/app-settings)는 sysadmin 전용 — 비sysadmin은 /catalogs로 읽기 전용 표시 (design 2026-09-11 §5).

import { Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CheckInput } from "@/components/check-input";
import { getAppSettings, getCatalogs, putAppSettings } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { mergeCatalogValues, parseCatalogCsv } from "@/lib/catalog-csv";
import { invalidateCatalogs, OTHER_SYSTEM } from "@/lib/catalogs";
import { decodeCsvBuffer } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

interface Lists {
  assignee_roles: string[];
  systems: string[];
  available_systems: string[];
}

interface CatalogsPanelProps {
  isSysadmin: boolean;
  onToast: (message: string) => void;
}

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";
const SECONDARY_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface ManagedListCardProps {
  dataId: string;
  title: string;
  hint: string;
  values: string[];
  // 삭제 불가 항목(시스템 Other)
  lockedValues?: readonly string[];
  // 사용 중 값 후보 — 체크하면 목록에 추가(시스템 카드만)
  available?: string[];
  readOnly: boolean;
  onSave: (next: string[]) => Promise<string[]>;
  onToast: (message: string) => void;
}

function ManagedListCard({
  dataId, title, hint, values, lockedValues = [], available = [], readOnly, onSave, onToast,
}: ManagedListCardProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string[]>(values);
  // 서버 값이 내용상 바뀌었을 때만 초안을 새 값으로 — 참조 비교면 형제 카드 저장·재조회마다 미저장 초안이 날아간다 (review 2026-09-11)
  const valuesKey = JSON.stringify(values);
  const [seenKey, setSeenKey] = useState(valuesKey);
  if (valuesKey !== seenKey) {
    setSeenKey(valuesKey);
    setDraft(values);
  }
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [importNote, setImportNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(values);
  const isLocked = (value: string) => lockedValues.some((locked) => locked.toLocaleLowerCase() === value.toLocaleLowerCase());
  const has = (value: string) => draft.some((item) => item.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  const addValues = (incoming: string[]) => {
    const result = mergeCatalogValues(draft, incoming);
    setDraft(result.next);
    return result;
  };
  const handleAdd = () => {
    if (adding.trim() === "") return;
    addValues([adding]);
    setAdding("");
  };
  const handleFile = async (file: File) => {
    const text = decodeCsvBuffer(await file.arrayBuffer());
    const { added, duplicates } = addValues(parseCatalogCsv(text));
    setImportNote(t("catalog.importResult", { added, duplicates }));
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
    <section data-id={dataId} className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-alt p-4">
      <div>
        <p className="text-caption-strong text-ink">{title}</p>
        <p className="text-fine text-ink-tertiary">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" data-id={`${dataId}-chips`}>
        {draft.length === 0 && <span className="text-fine text-ink-tertiary">{t("catalog.empty")}</span>}
        {draft.map((value) => {
          const locked = isLocked(value);
          return (
            <span
              key={value}
              data-id={`${dataId}-chip`}
              className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface px-2 py-0.5 text-caption text-ink"
            >
              {value}
              {locked && <span className="text-fine text-ink-tertiary">{t("catalog.otherLocked")}</span>}
              {!readOnly && !locked && (
                <button
                  type="button"
                  aria-label={t("catalog.remove")}
                  className="text-ink-tertiary hover:text-ink"
                  onClick={() => setDraft((prev) => prev.filter((item) => item !== value))}
                >
                  <X size={11} strokeWidth={1.5} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!readOnly && (
        <>
          <div className="flex items-center gap-2">
            <input
              data-id={`${dataId}-add-input`}
              className={INPUT_CLASS}
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
          </div>
          {importNote !== "" && (
            <p data-id={`${dataId}-import-note`} className="text-fine text-ink-tertiary">{importNote}</p>
          )}
          {candidates.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-fine text-ink-secondary">{t("catalog.inUse")}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5" data-id={`${dataId}-candidates`}>
                {candidates.map((value) => (
                  <label key={value} className="flex cursor-pointer items-center gap-1.5 text-caption text-ink-secondary">
                    <CheckInput checked={false} onChange={() => addValues([value])} />
                    {value}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              data-id={`${dataId}-save`}
              disabled={busy || !dirty}
              className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-40"
              onClick={() => void handleSave()}
            >
              {t("catalog.save")}
            </button>
          </div>
        </>
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

  const save = async (patch: { assignee_roles?: string[]; systems?: string[] }): Promise<string[]> => {
    const saved = await putAppSettings(patch);
    setLists({ assignee_roles: saved.assignee_roles, systems: saved.systems, available_systems: saved.available_systems });
    return patch.assignee_roles !== undefined ? saved.assignee_roles : saved.systems;
  };

  if (error !== null) return <p className="text-caption text-error">{humanizeApiError(error, t)}</p>;
  if (lists === null) return <p className="text-caption text-ink-tertiary">{t("catalog.loading")}</p>;
  return (
    <div className="flex max-w-3xl flex-col gap-6" data-id="catalogs-panel">
      <div>
        <h2 className="text-body-strong text-ink">{t("catalog.tab")}</h2>
        <p className="text-caption text-ink-tertiary">{isSysadmin ? t("catalog.pageHint") : t("catalog.readOnly")}</p>
      </div>
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
  );
}
