"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { createMap, deleteMap, listMaps, type MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function MapListPage() {
  const { t } = useI18n();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.loadMaps"));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await listMaps();
        if (active) {
          setMaps(result);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : t("err.loadMaps"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    try {
      await createMap(trimmed);
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.createMap"));
    }
  }, [name, refresh, t]);

  const handleDelete = useCallback(
    async (mapId: number) => {
      try {
        await deleteMap(mapId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("err.deleteMap"));
      }
    },
    [refresh, t],
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-tagline text-ink">BPM — {t("home.title")}</h1>

      <div className="mb-6 flex gap-2">
        <input
          className="flex-1 rounded-sm border border-hairline px-3 py-2 text-caption"
          placeholder={t("home.newMapPlaceholder")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleCreate();
            }
          }}
        />
        <button
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1 text-caption-strong text-on-accent hover:bg-accent-focus"
          onClick={() => void handleCreate()}
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("home.create")}
        </button>
      </div>

      {error && <p className="mb-4 text-caption text-error">{error}</p>}

      <ul className="divide-y divide-divider rounded-sm border border-hairline bg-surface">
        {maps.length === 0 && (
          <li className="p-4 text-caption text-ink-tertiary">{t("home.empty")}</li>
        )}
        {maps.map((processMap) => (
          <li key={processMap.id} className="flex items-center justify-between p-4 hover:bg-surface-alt">
            <Link
              href={`/maps/${processMap.id}`}
              className="text-body-strong text-ink hover:underline"
            >
              {processMap.name}
            </Link>
            <button
              className="inline-flex items-center gap-1 text-caption text-error hover:bg-surface-alt"
              onClick={() => void handleDelete(processMap.id)}
            >
              <Trash2 size={16} strokeWidth={1.5} />
              {t("home.delete")}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
