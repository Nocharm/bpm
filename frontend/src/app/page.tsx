"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
      <h1 className="mb-6 text-2xl font-semibold">BPM — {t("home.title")}</h1>

      <div className="mb-6 flex gap-2">
        <input
          className="flex-1 rounded border border-zinc-300 px-3 py-2"
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
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          onClick={() => void handleCreate()}
        >
          {t("home.create")}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200">
        {maps.length === 0 && (
          <li className="p-4 text-sm text-zinc-500">{t("home.empty")}</li>
        )}
        {maps.map((processMap) => (
          <li key={processMap.id} className="flex items-center justify-between p-4">
            <Link
              href={`/maps/${processMap.id}`}
              className="font-medium text-blue-700 hover:underline"
            >
              {processMap.name}
            </Link>
            <button
              className="text-sm text-zinc-500 hover:text-red-600"
              onClick={() => void handleDelete(processMap.id)}
            >
              {t("home.delete")}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
