"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { createMap, deleteMap, listMaps, type MapSummary } from "@/lib/api";

export default function MapListPage() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch (err) {
      setError(err instanceof Error ? err.message : "맵 목록을 불러오지 못했습니다");
    }
  }, []);

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
          setError(err instanceof Error ? err.message : "맵 목록을 불러오지 못했습니다");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
      setError(err instanceof Error ? err.message : "맵 생성에 실패했습니다");
    }
  }, [name, refresh]);

  const handleDelete = useCallback(
    async (mapId: number) => {
      try {
        await deleteMap(mapId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "맵 삭제에 실패했습니다");
      }
    },
    [refresh],
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">BPM — 프로세스맵</h1>

      <div className="mb-6 flex gap-2">
        <input
          className="flex-1 rounded border border-zinc-300 px-3 py-2"
          placeholder="새 맵 이름"
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
          생성
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200">
        {maps.length === 0 && (
          <li className="p-4 text-sm text-zinc-500">아직 맵이 없습니다.</li>
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
              삭제
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
